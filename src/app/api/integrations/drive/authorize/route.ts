import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole, AuthError } from "@/lib/auth";
import { driveConfigured, buildAuthorizeUrl } from "@/lib/storage/drive";
import { safeJsonParse } from "@/lib/helpers";
import { randomBytes } from "crypto";

/** Démarrage OAuth réel : redirection 302 vers Google — réservé PROPRIÉTAIRE / ADMINISTRATEUR (audit P1, comme POST /api/integrations). */
export async function GET() {
  try {
    const auth = await requireRole("ADMINISTRATEUR");
    if (!driveConfigured()) {
      return NextResponse.json({ error: "identifiants_requis", variables: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "DRIVE_ENCRYPTION_KEY"] }, { status: 400 });
    }
    // Aucune destruction de connexion existante (audit P2) : un GET de navigation
    // (risque CSRF SameSite=Lax) ne doit jamais écraser le refresh token d'une
    // connexion CONNECTE — il est conservé et remplacé uniquement au callback réussi.
    const existing = await db.integrationConnection.findFirst({
      where: { organizationId: auth.organization.id, connector: "GOOGLE_DRIVE" },
    });
    const previous = safeJsonParse<{ refreshTokenEnc?: string }>(existing?.configJson ?? "", {});
    const state = randomBytes(16).toString("hex");
    if (existing) {
      await db.integrationConnection.update({
        where: { id: existing.id },
        data: {
          status: "EN_ATTENTE_AUTH",
          configJson: JSON.stringify({ state, organizationId: auth.organization.id, ...(previous.refreshTokenEnc ? { refreshTokenEnc: previous.refreshTokenEnc } : {}) }),
        },
      });
    } else {
      await db.integrationConnection.create({
        data: {
          organizationId: auth.organization.id,
          connector: "GOOGLE_DRIVE",
          status: "EN_ATTENTE_AUTH",
          configJson: JSON.stringify({ state, organizationId: auth.organization.id }),
        },
      });
    }
    return NextResponse.redirect(buildAuthorizeUrl(state));
  } catch (e) {
    // Erreurs d'authentification honnêtes : 401 sans session, 403 sans rôle requis.
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }
}
