import { randomUUID } from "crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const PAGE_SIZE = 50;
const STATUTS = ["EXTRAITE", "A_VERIFIER", "VALIDE", "REJETEE"] as const;

// z.strictObject (zod v4) : champs exacts exigés, clés inconnues rejetées — création manuelle verrouillée.
const createSchema = z.strictObject({
  label: z.string().min(1).max(200),
  amountCents: z.number().int().positive(),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .default("EUR"),
  operationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  clientId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  confirmer: z.boolean().optional(),
});

/** Registre des opérations financières : listage paginé réel + synthèse agrégée (une seule passe groupBy). */
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
    const clientId = url.searchParams.get("clientId") ?? "";
    const groupId = url.searchParams.get("groupId") ?? "";
    const status = url.searchParams.get("status") ?? "";
    const pageBrute = Number(url.searchParams.get("page") ?? 1);
    const page = Math.max(1, Number.isFinite(pageBrute) ? Math.trunc(pageBrute) : 1);

    const where: Prisma.FinancialOperationWhereInput = {
      organizationId: auth.organization.id,
    };
    if (status && (STATUTS as readonly string[]).includes(status)) where.status = status;
    if (clientId) where.clientId = clientId;
    if (groupId) where.groupId = groupId;
    if (q) where.label = { contains: q };

    const [total, ops] = await Promise.all([
      db.financialOperation.count({ where }),
      db.financialOperation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);

    // Traçabilité résolue (id, code, name) — le modèle FinancialOperation ne porte pas de relation Prisma :
    // les référentiels Client / WaGroup sont joints explicitement sur la page courante.
    const clientIds = [...new Set(ops.map((o) => o.clientId).filter((v): v is string => Boolean(v)))];
    const groupIds = [...new Set(ops.map((o) => o.groupId).filter((v): v is string => Boolean(v)))];
    const clients = clientIds.length
      ? await db.client.findMany({
          where: { organizationId: auth.organization.id, id: { in: clientIds } },
          select: { id: true, code: true, name: true },
        })
      : [];
    const groups = groupIds.length
      ? await db.waGroup.findMany({
          where: { organizationId: auth.organization.id, id: { in: groupIds } },
          select: { id: true, code: true, name: true, clientId: true },
        })
      : [];
    const clientMap = new Map(clients.map((c) => [c.id, c] as const));
    const groupMap = new Map(groups.map((g) => [g.id, g] as const));
    const operations = ops.map((o) => ({
      ...o,
      client: o.clientId ? clientMap.get(o.clientId) ?? null : null,
      group: o.groupId ? groupMap.get(o.groupId) ?? null : null,
    }));

    // Synthèse réelle en une seule passe groupBy (statut × devise). Le filtre de statut
    // est volontairement exclu : les cartes restent un tableau de bord complet du périmètre
    // client/groupe/recherche courant, et le compte par statut y figure toujours.
    const whereSynthese: Prisma.FinancialOperationWhereInput = {
      organizationId: auth.organization.id,
    };
    if (clientId) whereSynthese.clientId = clientId;
    if (groupId) whereSynthese.groupId = groupId;
    if (q) whereSynthese.label = { contains: q };

    const rows = await db.financialOperation.groupBy({
      by: ["status", "currency"],
      where: whereSynthese,
      _sum: { amountCents: true },
      _count: { _all: true },
    });

    const counts: Record<string, number> = { EXTRAITE: 0, A_VERIFIER: 0, VALIDE: 0, REJETEE: 0, TOTAL: 0 };
    const totals: Record<string, Record<string, number>> = { VALIDE: {}, A_VERIFIER: {}, EXTRAITE: {} };
    for (const row of rows) {
      const statut = String(row.status);
      counts[statut] = (counts[statut] ?? 0) + row._count._all;
      counts.TOTAL += row._count._all;
      if (statut in totals && row._sum.amountCents != null) {
        const devise = row.currency.toUpperCase();
        totals[statut][devise] = (totals[statut][devise] ?? 0) + row._sum.amountCents;
      }
    }

    return { total, page, operations, summary: { counts, totals } };
  });
}

/**
 * Création manuelle d'une opération — garde EMPLOYE+.
 * Le statut VALIDE ne peut être posé que par un humain PROPRIETAIRE/ADMINISTRATEUR
 * qui coche explicitement « confirmer » (une saisie n'est jamais un encaissement confirmé par défaut).
 */
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    if (!["PROPRIETAIRE", "ADMINISTRATEUR", "EMPLOYE"].includes(auth.role)) throw new Error("forbidden");
    const body = createSchema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");
    const data = body.data;

    // D15 : le groupe appartient à un client — jamais de couple (client, groupe) incohérent.
    let clientId = data.clientId?.trim() || null;
    if (data.groupId) {
      const group = await db.waGroup.findFirst({
        where: { id: data.groupId, organizationId: auth.organization.id },
      });
      if (!group) throw new Error("groupe_introuvable");
      if (clientId && clientId !== group.clientId) throw new Error("rattachement_incoherent");
      clientId = group.clientId;
    }
    if (clientId) {
      const client = await db.client.findFirst({
        where: { id: clientId, organizationId: auth.organization.id },
      });
      if (!client) throw new Error("client_introuvable");
    }

    const confirmer = data.confirmer === true && (auth.role === "PROPRIETAIRE" || auth.role === "ADMINISTRATEUR");
    const maintenant = new Date();
    const entreeCreation = {
      at: maintenant.toISOString(),
      byId: auth.user.id,
      action: confirmer ? "CREATION_CONFIRMEE" : "CREATION",
      from: null,
      to: { status: confirmer ? "VALIDE" : "A_VERIFIER" },
      note: confirmer ? "Création manuelle confirmée par un humain (ADMIN+)" : "Création manuelle — en attente de validation humaine",
    };
    const operation = await db.financialOperation.create({
      data: {
        organizationId: auth.organization.id,
        clientId,
        groupId: data.groupId ?? null,
        sourceType: "MANUEL",
        // Idempotence stricte : une clé unique par création manuelle (le doublon réel → 409 via la contrainte SQL)
        sourceKey: `manuel:${randomUUID()}`,
        label: data.label.trim(),
        amountCents: data.amountCents,
        currency: data.currency.toUpperCase(),
        operationDate: data.operationDate ? new Date(`${data.operationDate}T12:00:00Z`) : null,
        status: confirmer ? "VALIDE" : "A_VERIFIER",
        confidence: 1,
        needsReview: !confirmer,
        validatedById: confirmer ? auth.user.id : null,
        validatedAt: confirmer ? maintenant : null,
        historyJson: JSON.stringify([entreeCreation]),
        createdById: auth.user.id,
      },
    });
    await logAudit({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: "FINANCE_OPERATION_CREEE",
      entityType: "FinancialOperation",
      entityId: operation.id,
      after: {
        label: operation.label,
        amountCents: operation.amountCents,
        currency: operation.currency,
        status: operation.status,
        sourceKey: operation.sourceKey,
      },
    });
    return { operation };
  });
}
