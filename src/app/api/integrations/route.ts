import { db } from "@/lib/db";
import { requireAuth, requireRole } from "@/lib/auth";
import { handle } from "@/lib/api";
import { driveConfigured, buildAuthorizeUrl } from "@/lib/storage/drive";
import { whatsappConfigured } from "@/lib/connectors/whatsapp";
import { polarConfigured } from "@/lib/connectors/polar";
import { n8nConfigured, N8N_REPRISE_WORKFLOW } from "@/lib/connectors/n8n";
import { safeIntegrationConfig } from "@/lib/helpers";
import { logAudit } from "@/lib/audit";
import { randomBytes } from "crypto";

/** États réels des intégrations — jamais un succès inventé. */
export async function GET() {
  return handle(async () => {
    const auth = await requireAuth();
    const connections = await db.integrationConnection.findMany({ where: { organizationId: auth.organization.id } });
    // Aucun secret ni état OAuth exposé aux membres (audit P1) : le configJson
    // est filtré via safeIntegrationConfig (GOOGLE_DRIVE → champs sûrs uniquement).
    const safeConnections = connections.map((c) => ({
      ...c,
      configJson: JSON.stringify(safeIntegrationConfig(c.connector, c.configJson)),
    }));
    const env = {
      GOOGLE_DRIVE: driveConfigured(),
      WHATSAPP_CLOUD: whatsappConfigured(),
      POLAR: polarConfigured(),
      N8N: n8nConfigured(),
      STORAGE_LOCAL: true,
    };
    const webhookUrl = `${process.env.PUBLIC_BASE_URL ?? ""}/api/webhook/whatsapp`;
    return {
      connections: safeConnections,
      env,
      whatsappSetup: env.WHATSAPP_CLOUD
        ? { webhookUrl, verifyToken: "configuré côté serveur" }
        : { variablesRequises: ["WHATSAPP_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"], webhookUrl },
      driveSetup: env.GOOGLE_DRIVE
        ? { authorizeUrl: "/api/integrations/drive/authorize" }
        : { variablesRequises: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "DRIVE_ENCRYPTION_KEY"] },
      n8n: env.N8N ? { workflow: N8N_REPRISE_WORKFLOW } : { variablesRequises: ["N8N_BASE_URL", "N8N_SHARED_SECRET"] },
    };
  });
}

/** Démarrage du flux OAuth Google réel (redirection vers Google) — rôle administrateur requis. */
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireRole("ADMINISTRATEUR");
    if (!driveConfigured()) throw new Error("identifiants_requis_variables_google_absentes");
    const state = randomBytes(16).toString("hex");
    const body = { organizationId: auth.organization.id };
    await db.integrationConnection.updateMany({
      where: { organizationId: auth.organization.id, connector: "GOOGLE_DRIVE" },
      data: { status: "EN_ATTENTE_AUTH", configJson: JSON.stringify({ state, ...body }) },
    });
    await logAudit({ organizationId: auth.organization.id, userId: auth.user.id, action: "DRIVE_AUTH_DEMARREE", entityType: "IntegrationConnection" });
    return { authorizeUrl: buildAuthorizeUrl(state) };
  });
}
