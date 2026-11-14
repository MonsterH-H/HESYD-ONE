import { verifyN8nSignature } from "@/lib/connectors/n8n";
import { tick } from "@/lib/scheduler";
import { ensureScheduler } from "@/lib/scheduler";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Déclenchement externe du scheduler par n8n (CDC §8.5) — contrat signé
 * réel : HMAC-SHA256 (timestamp.corps), anti-rejeu 300 s. Sans N8N_SHARED_
 * SECRET configuré, la route refuse honnêtement (le scheduler in-process
 * reste le mécanisme actif — décision D9).
 */
export async function POST(req: Request) {
  ensureScheduler();
  const raw = await req.text();
  const valid = verifyN8nSignature(raw, {
    "x-hesyd-timestamp": req.headers.get("x-hesyd-timestamp"),
    "x-hesyd-signature": req.headers.get("x-hesyd-signature"),
  });
  if (!valid) {
    return NextResponse.json({ error: "signature_invalide_ou_n8n_non_configure" }, { status: 403 });
  }
  const result = await tick();
  return NextResponse.json({ ok: true, ...result });
}
