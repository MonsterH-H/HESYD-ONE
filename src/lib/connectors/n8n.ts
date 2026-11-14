import { createHmac, timingSafeEqual } from "crypto";

/**
 * Contrat Next.js ↔ n8n (CDC §13.4) — appels signés dans les deux sens,
 * secret partagé, horodatage, anti-rejeu, identifiant de corrélation.
 * Dormant sans N8N_SHARED_SECRET / N8N_BASE_URL ; le scheduler in-process
 * (voir scheduler.ts) reste actif en parallèle — aucune logique critique
 * n'est uniquement dans n8n.
 */

export function n8nConfigured(): boolean {
  return Boolean(process.env.N8N_BASE_URL && process.env.N8N_SHARED_SECRET);
}

function sign(timestamp: string, body: string): string {
  return createHmac("sha256", process.env.N8N_SHARED_SECRET ?? "").update(`${timestamp}.${body}`, "utf8").digest("hex");
}

export function buildSignedHeaders(bodyJson: string, correlationId: string): Record<string, string> {
  const timestamp = Date.now().toString();
  return {
    "Content-Type": "application/json",
    "X-HESYD-Timestamp": timestamp,
    "X-HESYD-Signature": sign(timestamp, bodyJson),
    "X-HESYD-Correlation": correlationId,
    "X-HESYD-Payload-Version": "v1",
  };
}

export function verifyN8nSignature(rawBody: string, headers: Record<string, string | null>): boolean {
  const secret = process.env.N8N_SHARED_SECRET;
  if (!secret) return false;
  // En-têtes du contrat : X-HESYD-Timestamp / X-HESYD-Signature (émis par
  // buildSignedHeaders ci-dessus et par les workflows n8n exportés).
  const timestamp = headers["x-hesyd-timestamp"];
  const signature = headers["x-hesyd-signature"];
  if (!timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp) / 1000) > 300) return false;
  const expected = sign(timestamp, rawBody);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Déclenche un workflow n8n réel (planning, reprise) — échec honnête si non configuré. */
export async function triggerWorkflow(workflowId: string, payload: Record<string, unknown>, correlationId: string): Promise<{ ok: boolean; detail: string }> {
  if (!n8nConfigured()) return { ok: false, detail: "n8n_non_configure" };
  const bodyJson = JSON.stringify({ payloadVersion: "v1", correlationId, payload });
  try {
    const res = await fetch(`${process.env.N8N_BASE_URL}/webhook/hesyd/${workflowId}`, {
      method: "POST",
      headers: buildSignedHeaders(bodyJson, correlationId),
      body: bodyJson,
    });
    return { ok: res.ok, detail: `n8n:${res.status}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "n8n_erreur" };
  }
}

/**
 * Définition du workflow n8n « Reprise des tâches » exportable vers une
 * instance n8n réelle — ALIGNED avec le contrat signé réel (audit P3) :
 * corps signé (Code), HMAC SHA256 via $env.N8N_SHARED_SECRET (Crypto), puis
 * appel de /api/scheduler/tick avec les quatre en-têtes X-HESYD-*. L'ancienne
 * définition n'envoyait pas de signature et aurait été rejetée 403 à
 * l'import. La logique critique (validation, preuve) reste côté Next.js :
 * n8n ne fait que déclencher et relayer.
 */
export const N8N_REPRISE_WORKFLOW = {
  name: "HESYD ONE — Reprise des tâches (tick signé)",
  nodes: [
    {
      name: "Déclenchement planifié",
      type: "n8n-nodes-base.scheduleTrigger",
      parameters: { rule: { interval: [{ field: "cronExpression", expression: "*/5 * * * *" }] } },
    },
    {
      name: "Corps signé",
      type: "n8n-nodes-base.code",
      parameters: {
        mode: "runOnceForAllItems",
        jsCode:
          "// Corps EXACT envoyé à HESYD — la signature HMAC porte sur la chaîne\n// « <timestamp>.<corps> » (contrat : src/lib/connectors/n8n.ts, CDC §13.4).\nconst timestamp = Date.now().toString();\nconst correlationId = 'n8n-reprise-' + timestamp + '-' + Math.random().toString(36).slice(2, 10);\nconst payload = { declencheur: 'n8n', workflow: 'hesyd-reprise' };\nconst body = JSON.stringify({ payloadVersion: 'v1', correlationId: correlationId, payload: payload });\nreturn [{ json: { timestamp: timestamp, correlationId: correlationId, body: body, stringToSign: timestamp + '.' + body } }];",
      },
    },
    {
      name: "Signature HMAC",
      type: "n8n-nodes-base.crypto",
      parameters: { action: "hmac", type: "SHA256", secret: "={{ $env.N8N_SHARED_SECRET }}", value: "={{ $json.stringToSign }}", encoding: "hex" },
    },
    {
      name: "Appel reprise (signé)",
      type: "n8n-nodes-base.httpRequest",
      parameters: {
        method: "POST",
        url: "={{ $env.HESYD_BASE_URL }}/api/scheduler/tick",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "X-HESYD-Timestamp", value: "={{ $('Corps signé').first().json.timestamp }}" },
            { name: "X-HESYD-Signature", value: "={{ $json.data }}" },
            { name: "X-HESYD-Correlation", value: "={{ $('Corps signé').first().json.correlationId }}" },
            { name: "X-HESYD-Payload-Version", value: "v1" },
          ],
        },
        sendBody: true,
        contentType: "raw",
        rawContentType: "application/json",
        body: "={{ $('Corps signé').first().json.body }}",
      },
    },
  ],
  settings: { errorWorkflow: "hesyd-error" },
} as const;
