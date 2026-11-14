import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { ensureScheduler } from "@/lib/scheduler";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function apiError(message: string, status = 400, code?: string) {
  return NextResponse.json({ error: message, code: code ?? message }, { status });
}

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
      return apiError(msg, 400);
    }
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
