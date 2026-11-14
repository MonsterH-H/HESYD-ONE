#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# HESYD ONE — Restauration d'une sauvegarde produite par scripts/backup.sh
#
# Usage :
#   scripts/restore.sh <dossier-de-sauvegarde>
#
# Le dossier doit contenir hesyd-db.sql.gz et storage-archives.tar.gz.
#
# AVERTISSEMENT — opérations destructives :
#   1. La base PostgreSQL cible est vidée de ses objets puis recréée à
#      partir du dump (--clean --if-exists dans le pg_dump d'origine).
#   2. Le contenu de storage/ est ÉCRASÉ par l'archive (les fichiers
#      présents sur le disque mais absents de l'archive ne sont PAS
#      supprimés par tar — mais tout fichier homonyme est remplacé).
#
# Garde-fous :
#   - un instantané de sécurité de l'état COURANT est tenté avant tout
#     (via scripts/backup.sh) ;
#   - une confirmation explicite est exigée (taper RESTAURER) ;
#   - psql s'exécute avec ON_ERROR_STOP=1 : tout échec arrête la
#     restauration au lieu de continuer en silence.
#
# Variables d'environnement (toutes optionnelles — AUCUN secret en dur) :
#   RESTORE_DB_METHOD  "docker" (défaut) ou "url"
#                        docker : psql via `docker compose exec db`
#                        url    : psql local sur $DATABASE_URL
#   DATABASE_URL       requis si RESTORE_DB_METHOD=url (postgresql://…)
#   RESTORE_ENV_FILE   fichier d'environnement chargé si les variables ne
#                      sont pas déjà définies (défaut <dépôt>/.env)
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_METHOD="${RESTORE_DB_METHOD:-docker}"
ENV_FILE="${RESTORE_ENV_FILE:-$REPO_ROOT/.env}"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { printf '[%s] ERREUR : %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; exit 1; }

usage() {
  printf 'Usage : %s <dossier-de-sauvegarde>\n' "$0" >&2
  printf 'Exemple : %s %s/backups/2026-11-14_030000\n' "$0" "$REPO_ROOT" >&2
}

[[ $# -eq 1 ]] || { usage; exit 2; }
SRC_DIR="$1"

case "$DB_METHOD" in
  docker|url) ;;
  *) die "RESTORE_DB_METHOD doit valoir 'docker' ou 'url' (valeur : '$DB_METHOD')" ;;
esac

# ————— Chargement du fichier d'environnement (sans écraser l'existant) —————
if [[ -f "$ENV_FILE" ]]; then
  while IFS='=' read -r key value || [[ -n "$key" ]]; do
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    if [[ -z "${!key+x}" ]]; then
      export "$key=$value"
    fi
  done < "$ENV_FILE"
fi

# ————— Détection de la commande Compose —————
COMPOSE_CMD=()
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
fi

if [[ "$DB_METHOD" == "docker" ]]; then
  [[ ${#COMPOSE_CMD[@]} -gt 0 ]] || die "docker compose indisponible — installez Docker Compose ou utilisez RESTORE_DB_METHOD=url"
  [[ -f "$REPO_ROOT/docker-compose.yml" ]] || die "docker-compose.yml introuvable dans $REPO_ROOT"
else
  command -v psql >/dev/null 2>&1 || die "psql introuvable — installez le client PostgreSQL ou utilisez RESTORE_DB_METHOD=docker"
  [[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL requis avec RESTORE_DB_METHOD=url"
fi

# ————— Validation de la sauvegarde —————
[[ -d "$SRC_DIR" ]] || die "dossier de sauvegarde introuvable : $SRC_DIR"
DB_FILE="$SRC_DIR/hesyd-db.sql.gz"
STORAGE_FILE="$SRC_DIR/storage-archives.tar.gz"
[[ -f "$DB_FILE" ]]     || die "dump introuvable : $DB_FILE"
[[ -f "$STORAGE_FILE" ]] || die "archive storage introuvable : $STORAGE_FILE"

log "Sauvegarde source : $SRC_DIR"
if [[ -f "$SRC_DIR/MANIFEST.txt" ]]; then
  printf '\n———— Contenu du MANIFEST.txt ————\n'
  cat "$SRC_DIR/MANIFEST.txt"
  printf '——————————————————————————————————\n\n'
fi
gzip -t "$DB_FILE"      || die "dump compressé invalide (gzip -t a échoué)"
tar -tzf "$STORAGE_FILE" >/dev/null || die "archive storage invalide (tar -tzf a échoué)"

# ————— Instantané de sécurité de l'état courant —————
log "instantané de sécurité de l'état ACTUEL avant restauration…"
if "$REPO_ROOT/scripts/backup.sh"; then
  log "instantané de sécurité créé (voir le log ci-dessus pour le chemin)."
else
  printf '[%s] AVERTISSEMENT : instantané de sécurité échoué (base ou disque indisponible ?).\n' "$(date '+%Y-%m-%d %H:%M:%S')" >&2
  printf "Continuer SANS protection de l'état actuel ? [oui/non] " >&2
  read -r ANSWER
  [[ "$ANSWER" == "oui" ]] || die "restauration annulée par l'opérateur"
fi

# ————— Confirmation explicite avant écrasement —————
printf '\n'
printf '***************************************************************\n'
printf '*  ATTENTION — OPÉRATION DESTRUCTIVE\n'
printf '*  Base PostgreSQL cible : %s\n' "$([[ "$DB_METHOD" == "docker" ]] && printf 'conteneur « db » (docker compose)' || printf 'DATABASE_URL (masqué)')"
printf '*  Archives écrasées     : %s\n' "$REPO_ROOT/storage"
printf '*  Source                : %s\n' "$SRC_DIR"
printf '*  L'\''état courant sera remplacé par la sauvegarde choisie.\n'
printf '***************************************************************\n'
printf '\nPour confirmer, taper RESTAURER en toutes lettres : '
read -r CONFIRM
[[ "$CONFIRM" == "RESTAURER" ]] || die "confirmation absente — restauration annulée"

# ————— 1. Base de données —————
log "restauration de la base PostgreSQL…"
if [[ "$DB_METHOD" == "docker" ]]; then
  gunzip -c "$DB_FILE" | ( cd "$REPO_ROOT" && "${COMPOSE_CMD[@]}" exec -T db \
      sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' )
else
  gunzip -c "$DB_FILE" | psql "${DATABASE_URL:?}" -v ON_ERROR_STOP=1
fi
log "base restaurée."

# ————— 2. Archives documentaires —————
log "restauration de $REPO_ROOT/storage…"
tar -xzf "$STORAGE_FILE" -C "$REPO_ROOT"
log "archives restaurées."

# ————— 3. Vérifications après restauration —————
log "comptages de contrôle…"
if [[ "$DB_METHOD" == "docker" ]]; then
  printf 'SELECT count(*) FROM "Plan";\nSELECT count(*) FROM "Organization";\nSELECT count(*) FROM "File";\n' \
    | ( cd "$REPO_ROOT" && "${COMPOSE_CMD[@]}" exec -T db \
        sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' )
  log "redémarrage de l'application pour recharger les connexions…"
  ( cd "$REPO_ROOT" && "${COMPOSE_CMD[@]}" restart app )
else
  printf 'SELECT count(*) FROM "Plan";\nSELECT count(*) FROM "Organization";\nSELECT count(*) FROM "File";\n' \
    | psql "${DATABASE_URL:?}" -tA
  log "pensez à redémarrer l'application (docker compose restart app) après une restauration."
fi

log "restauration terminée — vérifier l'application puis https://<domaine>/api/health"
