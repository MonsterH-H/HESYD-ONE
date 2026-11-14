import { db } from "@/lib/db";

/** Journal d'audit réel : toute mutation métier passe ici. */
export async function logAudit(params: {
  organizationId?: string;
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}) {
  try {
    await db.auditLog.create({
      data: {
        organizationId: params.organizationId ?? null,
        userId: params.userId ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        beforeJson: params.before ? JSON.stringify(sanitize(params.before)) : null,
        afterJson: params.after ? JSON.stringify(sanitize(params.after)) : null,
      },
    });
  } catch {
    // l'audit ne doit jamais casser la mutation métier, mais l'échec est tracé en console serveur
    console.error("[audit] échec d'écriture", params.action);
  }
}

/** Expurge les secrets et contenus complets avant journalisation (CDC §14.7). */
export function sanitize(value: unknown, maxLen = 500): unknown {
  if (value == null) return value;
  if (typeof value === "string") return value.length > maxLen ? value.slice(0, maxLen) + "…" : value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, maxLen));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/secret|token|password|apikey|api_key|authorization/i.test(k)) out[k] = "[EXPURGE]";
      else out[k] = sanitize(v, maxLen);
    }
    return out;
  }
  return value;
}

export async function notify(params: {
  organizationId: string;
  userId?: string;
  type: string;
  title: string;
  message: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}) {
  await db.notification.create({
    data: {
      organizationId: params.organizationId,
      userId: params.userId ?? null,
      type: params.type,
      title: params.title,
      message: params.message,
      relatedEntityType: params.relatedEntityType ?? null,
      relatedEntityId: params.relatedEntityId ?? null,
    },
  });
}
