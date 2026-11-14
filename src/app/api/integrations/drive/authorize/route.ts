import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole, AuthError } from "@/lib/auth";
import { driveConfigured, buildAuthorizeUrl } from "@/lib/storage/drive";
import { randomBytes } from "crypto";

/** Démarrage OAuth réel : redirection 302 vers Google — réservé PROPRIÉTAIRE / ADMINISTRATEUR (audit P1, comme POST /api/integrations). */
export async function GET() {
  try {
    const auth = await requireRole("ADMINISTRATEUR");
    if (!driveConfigured()) {
      return NextResponse.json({ error: "identifiants_requis", variables: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "DRIVE_ENCRYPTION_KEY"] }, { status: 400 });
    }
    const state = randomBytes(16).toString("hex");
    await db.integrationConnection.updateMany({
      where: { organizationId: auth.organization.id, connector: "GOOGLE_DRIVE" },
      data: { status: "EN_ATTENTE_AUTH", configJson: JSON.stringify({ state, organizationId: auth.organization.id }) },
    });
    return NextResponse.redirect(buildAuthorizeUrl(state));
  } catch (e) {
    // Erreurs d'authentification honnêtes : 401 sans session, 403 sans rôle requis.
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }
}
