import { NextResponse } from "next/server";

/**
 * Manifeste neutre (audit MINEURE-5) : la route index ne divulgue rien
 * (ni stack, ni framework, ni version). Réponse minimale, utilisable par
 * le healthcheck.
 */
export async function GET() {
  return NextResponse.json({ service: "hesyd-one", status: "ok" });
}