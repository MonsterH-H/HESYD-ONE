#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# HESYD ONE — Sauvegarde de production
#
# Contenu de chaque sauvegarde (dossier BACKUP_ROOT/<horodatage>/) :
#   hesyd-db.sql.gz          pg_dump de PostgreSQL (SQL textuel, gzip -9)
#   storage-archives.tar.gz  archives documentaires (répertoire storage/)
#   MANIFEST.txt             date, méthode, empreintes sha256
#
# Rétention : KEEP_DAYS jours (défaut 14), suppression automatique.
#
# Variables d'environnement (toutes optionnelles — AUCUN secret en dur) :
#   KEEP_DAYS          rétention en jours                    (défaut 14)
#   BACKUP_ROOT        dossier racine des sauvegardes        (défaut <dépôt>/backups)
#   BACKUP_DB_METHOD   "docker" (défaut) ou "url"
#                       docker : pg_dump via `docker compose exec db`
#                                (identifiants lus dans le conteneur)
#                       url    : pg_dump local sur $DATABASE_URL
#   DATABASE_URL       requis si BACKUP_DB_METHOD=url (postgresql://…)
#   BACKUP_ENV_FILE    fichier d'environnement chargé si les variables ne
#                      sont pas déjà définies (défaut <dépôt>/.env, format
#                      KEY=VALUE simple — le .env de production contient
#                      POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB)
#
# Cron conseillé (A_CONFIRMER.md A8 : RPO 24 h) :
#   0 3 * * *  /opt/hesyd/scripts/backup.sh >> /var/log/hesyd-backup.log 2>&1
#
# Test d'intégrité effectué à chaque exécution : gzip -t et tar -tzf.
# En cas d'échec, le dossier partiel est supprimé (aucune sauvegarde
# incomplète n'est conservée : pas de faux sentiment de sécurité).
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STORAGE_DIR="${STORAGE_DIR:-$REPO_ROOT/storage}"
BACKUP_ROOT="${BACKUP_ROOT:-$REPO_ROOT/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DB_METHOD="${BACKUP_DB_METHOD:-docker}"
ENV_FILE="${BACKUP_ENV_FILE:-$REPO_ROOT/.env}"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { printf '[%s] ERREUR : %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; exit 1; }

# ————— Validation des paramètres —————
[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || die "KEEP_DAYS doit être un entier (valeur : '$KEEP_DAYS')"
[[ -d "$STORAGE_DIR" ]] || die "répertoire d'archives introuvable : $STORAGE_DIR"
case "$DB_METHOD" in
  docker|url) ;;
  *) die "BACKUP_DB_METHOD doit valoir 'docker' ou 'url' (valeur : '$DB_METHOD')" ;;
esac

# ————— Chargement du fichier d'environnement —————
# N'écrase JAMAIS une variable déjà définie (la ligne de commande prime).
# Format attendu : lignes KEY=VALUE ; les commentaires (#) sont ignorés.
if [[ -f "$ENV_FILE" ]]; then
  while IFS='=' read -r key value || [[ -n "$key" ]]; do
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    if [[ -z "${!key+x}" ]]; then
      export "$key=$value"
    fi
  done < "$ENV_FILE"
fi

# ————— Détection de la commande Compose (plugin v2 ou binaire v1) —————
COMPOSE_CMD=()
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
fi

# ————— Vérifications d'outillage —————
if [[ "$DB_METHOD" == "docker" ]]; then
  [[ ${#COMPOSE_CMD[@]} -gt 0 ]] || die "docker compose indisponible — installez Docker Compose ou utilisez BACKUP_DB_METHOD=url"
  [[ -f "$REPO_ROOT/docker-compose.yml" ]] || die "docker-compose.yml introuvable dans $REPO_ROOT"
else
  command -v pg_dump >/dev/null 2>&1 || die "pg_dump introuvable — installez le client PostgreSQL ou utilisez BACKUP_DB_METHOD=docker"
  [[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL requis avec BACKUP_DB_METHOD=url (jamais de secret en dur dans ce script)"
fi
command -v gzip >/dev/null 2>&1      || die "gzip requis"
command -v tar >/dev/null 2>&1       || die "tar requis"
command -v sha256sum >/dev/null 2>&1 || die "sha256sum requis"

mkdir -p "$BACKUP_ROOT"

# ————— Verrou d'exécution (pas deux sauvegardes simultanées) —————
if command -v flock >/dev/null 2>&1; then
  exec 9>"$BACKUP_ROOT/.backup.lock"
  flock -n 9 || die "une sauvegarde est déjà en cours (verrou : $BACKUP_ROOT/.backup.lock)"
fi

STAMP="$(date '+%Y-%m-%d_%H%M%S')"
DEST="$BACKUP_ROOT/$STAMP"
mkdir -p "$DEST"

cleanup_on_error() {
  local rc=$?
  if (( rc != 0 )) && [[ -d "$DEST" ]]; then
    printf '[%s] Échec — suppression du dossier partiel %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$DEST" >&2
    rm -rf -- "$DEST"
  fi
  exit "$rc"
}
trap cleanup_on_error EXIT

log "Sauvegarde HESYD ONE vers $DEST (méthode base : $DB_METHOD)"

# ————— 1. Base de données : pg_dump compressé —————
# --clean --if-exists : le dump contient les DROP nécessaires pour
# restaurer AU-DESSUS d'une base existante (voir scripts/restore.sh).
# --no-owner --no-privileges : portable quel que soit le rôle de restauration.
DB_FILE="$DEST/hesyd-db.sql.gz"
log "pg_dump de la base PostgreSQL…"
if [[ "$DB_METHOD" == "docker" ]]; then
  ( cd "$REPO_ROOT" && "${COMPOSE_CMD[@]}" exec -T db \
      sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --clean --if-exists' ) \
    | gzip -9 > "$DB_FILE"
else
  pg_dump "${DATABASE_URL:?}" --no-owner --no-privileges --clean --if-exists | gzip -9 > "$DB_FILE"
fi
gzip -t "$DB_FILE" || die "dump compressé invalide (gzip -t a échoué)"
log "base sauvegardée : $DB_FILE ($(du -h "$DB_FILE" | cut -f1))"

# ————— 2. Archives documentaires : tar gz de storage/ —————
STORAGE_FILE="$DEST/storage-archives.tar.gz"
log "archivage de $STORAGE_DIR…"
tar -czf "$STORAGE_FILE" -C "$REPO_ROOT" "$(basename "$STORAGE_DIR")"
tar -tzf "$STORAGE_FILE" >/dev/null || die "archive storage invalide (tar -tzf a échoué)"
log "archives sauvegardées : $STORAGE_FILE ($(du -h "$STORAGE_FILE" | cut -f1))"

# ————— 3. Manifeste (traçabilité) —————
{
  printf 'Sauvegarde HESYD ONE\n'
  printf 'Date         : %s\n' "$(date -Is)"
  printf 'Hôte         : %s\n' "$(hostname)"
  printf 'Méthode base : %s\n' "$DB_METHOD"
  printf 'Dépôt        : %s\n' "$REPO_ROOT"
  printf '\nEmpreintes sha256 :\n'
  ( cd "$DEST" && sha256sum hesyd-db.sql.gz storage-archives.tar.gz )
} > "$DEST/MANIFEST.txt"
log "manifeste écrit : $DEST/MANIFEST.txt"

# ————— 4. Rétention —————
log "rétention : suppression des sauvegardes de plus de $KEEP_DAYS jour(s)"
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d \
  -name '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]_[0-9][0-9][0-9][0-9][0-9][0-9]' \
  -mtime "+$KEEP_DAYS" -print -exec rm -rf -- {} +

trap - EXIT
log "sauvegarde terminée : $DEST"
