import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { ensureScheduler } from "@/lib/scheduler";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function apiError(message: string, status = 400, code?: string) {
  return NextResponse.json({ error: message, code: code ?? message }, { status });
}

/**
 * Messages d'infrastructure JAMAIS renvoyés au client (audit MINEURE-2) :
 * client Prisma (requête + arguments internes), chemins du déploiement, trames
 * de pile, errno réseau/OS, échecs réseau/fetch, erreurs de parsing JSON et
 * JWT. Choix inverse d'une liste blanche : les codes métier snake_case lancés
 * par les routes (ex. « email_deja_utilise », « docai_non_configure »,
 * « token_requis ») sont des dizaines et alimentent l'i18n client — ils passent
 * tels quels ; seuls les messages ressemblant à de l'infrastructure sont
 * masqués derrière « erreur_interne », leur message réel restant loggé serveur.
 */
const INFRA_ERROR_PATTERNS: RegExp[] = [
  /prisma/i,                    // client Prisma : requête + arguments internes
  /\/home\//,                   // chemins absolus du serveur
  /node_modules/i,              // dépendances internes
  /\n\s*at\s/,                  // trame de pile JS incrustée dans le message
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EACCES|EPERM|EPIPE/i,
  /fetch failed|socket hang up|network error|getaddrinfo/i,
  /unexpected token/i,          // parsing JSON (contient « token » sans être un code métier)
  /jwt|jsonwebtoken|json web token|invalid signature|malformed/i,
  /internal server error/i,
];

/** Wrapper commun : scheduler réellement démarré, erreurs mappées proprement. */
export async function handle<T>(fn: () => Promise<T>): Promise<Response> {
  ensureScheduler();
  try {
    const result = await fn();
    // Laisse passer les réponses brutes (SSE, téléchargements…) sans sérialisation
    if (result instanceof NextResponse || result instanceof Response) return result;
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AuthError) return apiError(e.message, e.status);
    if (e instanceof Error) {
      const msg = e.message;
      if (/Unique constraint/i.test(msg)) return apiError("doublon_conflict", 409);
      // MINEURE-2 (audit) : le message réel est TOUJOURS loggé côté serveur
      // (jamais perdu) ; seules les erreurs d'infrastructure sont masquées au
      // client — les codes métier des routes passent pour l'i18n.
      if (INFRA_ERROR_PATTERNS.some((re) => re.test(msg))) {
        console.error("[api] erreur d'infrastructure masquée au client:", msg);
        return apiError("erreur_interne", 500);
      }
      return apiError(msg, 400);
    }
    console.error("[api] erreur non-Error masquée au client:", e);
    return apiError("erreur_inattendue", 500);
  }
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new AuthError("corps_json_invalide", 400);
  }
}
