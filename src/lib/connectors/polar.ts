// Connecteur Polar — paiements et abonnements (décision imposée : Polar, règle absolue mission).
//
// Contrats officiels vérifiés par lecture réelle de la documentation :
// - Checkout API (https://polar.sh/docs/features/checkout/session + api-reference
//   checkouts/create-checkout-session) :
//   POST https://api.polar.sh/v1/checkouts avec `Authorization: Bearer <access token>`,
//   corps JSON {products: [<productId>], metadata, customer_email, external_id, success_url}
//   → réponse contenant `url` où rediriger le client.
// - Webhooks (https://polar.sh/docs/integrate/webhooks/delivery — « Validate & parse webhooks ») :
//   schéma Standard Webhooks : en-têtes `webhook-id`, `webhook-timestamp`, `webhook-signature`
//   (« v1,<base64> »), contenu signé `${msg_id}.${timestamp}.${payload}` en HMAC-SHA256.
//   Secrets générés après le 08/09/2026 : clé = base64-decode(whsec_ sans préfixe).
//   Secrets antérieurs (Polar HMAC) : clé = octets UTF-8 de la chaîne whsec complète.
//   Les deux schémas sont vérifiés, tolérance d'horloge 300 s, timingSafeEqual.
// - Événements (https://polar.sh/docs/integrate/webhooks/events) : subscription.created /
//   subscription.active / subscription.cycled / subscription.past_due / subscription.canceled /
//   subscription.revoked / subscription.updated / order.created.
// - Livraison : jusqu'à 10 reprises, timeout 10 s → le handler répond vite et idempotent.
//
// L'état d'abonnement n'est modifié QUE par des webhooks signés. Sans identifiants,
// le connecteur est DORMANT et honnête (polar_non_configure).

import { createHmac, timingSafeEqual } from "crypto";

const POLAR_API = "https://api.polar.sh";

export function polarConfigured(): boolean {
  return Boolean(process.env.POLAR_ACCESS_TOKEN && process.env.POLAR_WEBHOOK_SECRET);
}

export function polarProductForPlan(planCode: string): string | null {
  if (planCode === "STANDARD") return process.env.POLAR_PRODUCT_ID_STANDARD ?? null;
  if (planCode === "ENTREPRISE") return process.env.POLAR_PRODUCT_ID_ENTREPRISE ?? null;
  return null;
}

export type CheckoutParams = {
  planCode: string;
  organizationId: string;
  organizationName: string;
  customerEmail: string;
  successUrl: string;
};

/** Création réelle d'une session Checkout (page hébergée Polar) → URL de redirection. */
export async function createCheckoutSession(params: CheckoutParams): Promise<{ url: string }> {
  const token = process.env.POLAR_ACCESS_TOKEN;
  if (!token) throw new Error("polar_non_configure");
  const productId = polarProductForPlan(params.planCode);
  if (!productId) throw new Error("produit_polar_absent_pour_offre");

  const res = await fetch(`${POLAR_API}/v1/checkouts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "HESYD-ONE/1.0" },
    body: JSON.stringify({
      products: [productId],
      customer_email: params.customerEmail,
      external_id: params.organizationId,
      metadata: { organizationId: params.organizationId, planCode: params.planCode, organizationName: params.organizationName },
      success_url: params.successUrl,
    }),
  });
  if (!res.ok) throw new Error(`polar_checkout_http_${res.status}`);
  const json = (await res.json()) as { url?: string; id?: string };
  if (!json.url) throw new Error("polar_checkout_sans_url");
  return { url: json.url };
}

/**
 * Vérification réelle de la signature Polar selon Standard Webhooks (+ schéma historique).
 * Signatures multiples acceptées par la spécification : « v1,base64A v1,base64B ».
 */
export function verifyPolarSignature(rawBody: string, headers: { id: string | null; timestamp: string | null; signature: string | null }): boolean {
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(headers.timestamp)) > 300) return false;
  const signedContent = `${headers.id}.${headers.timestamp}.${rawBody}`;
  const candidates = headers.signature
    .split(/\s+/)
    .map((s) => s.replace(/^v1,/, ""))
    .filter(Boolean);

  const keys: Buffer[] = [];
  try {
    // Schéma Standard Webhooks (secrets après le 08/09/2026) : whsec_<base64>
    keys.push(Buffer.from(secret.replace(/^whsec_/, ""), "base64"));
  } catch {
    // clé illisible → on tentera le schéma historique ci-dessous
  }
  // Schéma Polar historique : clé = octets UTF-8 de la chaîne whsec complète
  keys.push(Buffer.from(secret, "utf8"));

  for (const key of keys) {
    const expected = createHmac("sha256", key).update(signedContent, "utf8").digest("base64");
    for (const candidate of candidates) {
      const a = Buffer.from(expected);
      const b = Buffer.from(candidate);
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    }
  }
  return false;
}

export type PolarWebhookEvent = {
  type: string;
  data: Record<string, unknown>;
  timestamp?: string;
};

type PolarSubscriptionData = {
  id?: string;
  status?: string;
  customer?: string | { id?: string };
  current_period_start?: string;
  current_period_end?: string;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, string>;
  product?: string | { id?: string };
};

const PLAN_BY_PRODUCT: Record<string, string> = {};
export function registerPlanProduct(planCode: string, productId: string): void {
  PLAN_BY_PRODUCT[productId] = planCode;
}
export function planCodeFromProduct(productId: string | null): string | null {
  if (!productId) return null;
  const id = typeof productId === "string" ? productId : productId;
  if (PLAN_BY_PRODUCT[id]) return PLAN_BY_PRODUCT[id];
  if (process.env.POLAR_PRODUCT_ID_STANDARD === id) return "STANDARD";
  if (process.env.POLAR_PRODUCT_ID_ENTREPRISE === id) return "ENTREPRISE";
  return null;
}

/** Transition d'abonnement réelle depuis un événement signé — métier uniquement. */
export async function applySubscriptionEvent(event: PolarWebhookEvent): Promise<{ organizationId: string; creditsGranted: number } | null> {
  const { db } = await import("@/lib/db");
  const data = event.data as PolarSubscriptionData & { amount?: number; currency?: string; product?: string | { id?: string } };
  const organizationId = (data.metadata?.organizationId as string) ?? (typeof data.metadata?.external_id === "string" ? (data.metadata.external_id as string) : null);
  if (!organizationId) throw new Error("organisation_absente_de_l_evenement");

  const subscription = await db.subscription.findUnique({ where: { organizationId } });
  if (!subscription) return null;

  const customerId = typeof data.customer === "string" ? data.customer : data.customer?.id ?? subscription.providerCustomerId ?? "";
  const productCode = planCodeFromProduct(typeof data.product === "string" ? data.product : data.product?.id ?? null);
  const plan = await db.plan.findUnique({ where: { code: productCode ?? subscription.planCode } });

  switch (event.type) {
    case "subscription.created":
    case "subscription.active":
    case "subscription.resumed": {
      // resumed : officiellement « Fired when a paused subscription resumes. A new
      // billing period starts and the customer is charged » (docs Polar, events).
      await db.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { organizationId },
          data: {
            planCode: productCode ?? subscription.planCode,
            status: "ACTIF",
            providerCustomerId: customerId,
            providerSubscriptionId: data.id ?? subscription.providerSubscriptionId,
            cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
            currentPeriodStart: data.current_period_start ? new Date(data.current_period_start) : new Date(),
            currentPeriodEnd: data.current_period_end ? new Date(data.current_period_end) : new Date(Date.now() + 30 * 24 * 3600 * 1000),
          },
        });
        await tx.organization.update({ where: { id: organizationId }, data: { status: "ACTIF", purgeScheduledAt: null } });
      });
      return { organizationId, creditsGranted: 0 };
    }
    case "subscription.cycled": {
      // Docs officiels : « Fired when a subscription enters a new billing period, before
      // the renewal order exists and WHETHER OR NOT THE PAYMENT SUCCEEDS ». Le passage
      // ACTIF et l'octroi de crédits sont donc conditionnés au champ `status` réel du
      // payload — jamais forcés sur un paiement qui a échoué (past_due arrive séparément).
      const cycleStatus = typeof data.status === "string" ? data.status : null;
      const cycleActive = cycleStatus === "active";
      await db.subscription.update({
        where: { organizationId },
        data: {
          ...(cycleActive ? { status: "ACTIF" } : {}),
          cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
          currentPeriodStart: data.current_period_start ? new Date(data.current_period_start) : new Date(),
          currentPeriodEnd: data.current_period_end ? new Date(data.current_period_end) : new Date(Date.now() + 30 * 24 * 3600 * 1000),
        },
      });
      const monthlyCredits = cycleActive ? (plan?.monthlyCredits ?? 0) : 0;
      if (monthlyCredits > 0) {
        const { grantCredits } = await import("@/lib/quota");
        await grantCredits(organizationId, monthlyCredits, "RENOUVELLEMENT", `Crédits du cycle (${plan?.name ?? productCode ?? "offre"})`);
      }
      return { organizationId, creditsGranted: monthlyCredits };
    }
    case "subscription.past_due": {
      // Docs : « Fired when a subscription payment has failed. The customer can recover
      // by updating their payment method. » → période de grâce.
      await db.$transaction(async (tx) => {
        await tx.subscription.update({ where: { organizationId }, data: { status: "GRACE" } });
        await tx.organization.update({ where: { id: organizationId }, data: { status: "GRACE" } });
      });
      return { organizationId, creditsGranted: 0 };
    }
    case "subscription.paused": {
      // Docs : « Fired when a scheduled pause takes effect at the end of the period.
      // Billing stops and benefits are revoked until the subscription resumes. »
      await db.$transaction(async (tx) => {
        await tx.subscription.update({ where: { organizationId }, data: { status: "SUSPENDU", cancelAtPeriodEnd: false } });
        await tx.organization.update({ where: { id: organizationId }, data: { status: "SUSPENDU" } });
      });
      return { organizationId, creditsGranted: 0 };
    }
    case "subscription.canceled":
    case "subscription.revoked": {
      await db.$transaction(async (tx) => {
        await tx.subscription.update({ where: { organizationId }, data: { status: "RESILIE", cancelAtPeriodEnd: false } });
        await tx.organization.update({
          where: { id: organizationId },
          data: { status: "SUSPENDU", purgeScheduledAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
        });
      });
      return { organizationId, creditsGranted: 0 };
    }
    case "subscription.updated":
    case "subscription.uncanceled": {
      // uncanceled : annulation programmée annulée — rafraîchissement du drapeau,
      // sans forcer un statut ACTIF (le statut réel reste porté par les autres événements).
      await db.subscription.update({
        where: { organizationId },
        data: { cancelAtPeriodEnd: Boolean(data.cancel_at_period_end) },
      });
      return { organizationId, creditsGranted: 0 };
    }
    default:
      // Événement connu mais sans transition métier (order.created par ex.) — traité ailleurs.
      return { organizationId, creditsGranted: -1 };
  }
}
