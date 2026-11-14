import { ensureScheduler, tick } from "@/lib/scheduler";
import { verifyN8nSignature } from "@/lib/connectors/n8n";
import { handle } from "@/lib/api";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Santé réelle + amorçage du scheduler in-process — lecture seule, aucun tick. */
export async function GET() {
  return handle(async () => {
    ensureScheduler();
    return { status: "operational", scheduler: "actif", time: new Date().toISOString() };
  });
}

/**
 * Tick signé (utilisé par le workflow n8n de reprise ou un cron externe) —
 * contrat HMAC strictement identique à /api/scheduler/tick (CDC §13.4) :
 * HMAC-SHA256 sur « timestamp.corps », en-têtes X-HESYD-Timestamp /
 * X-HESYD-Signature, anti-rejeu 300 s. POST sans signature valide → 403,
 * jamais de tick non authentifié (audit P0).
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
  return NextResponse.json({ ok: true, ...result, at: new Date().toISOString() });
}
