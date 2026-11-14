import { db } from "@/lib/db";
import { createHash } from "crypto";
import { verifyPolarSignature, polarConfigured, applySubscriptionEvent, type PolarWebhookEvent } from "@/lib/connectors/polar";
import { notify, logAudit } from "@/lib/audit";
import { sendEmail, systemEmailHtml, resendConfigured } from "@/lib/connectors/resend";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Webhook Polar réel (contrat vérifié : polar.sh/docs/integrate/webhooks/delivery) :
 * - signature Standard Webhooks vérifiée (tolérance 300 s) ;
 * - IDEMPOTENCE FINANCIÈRE : claim atomique AVANT application
 *   (`updateMany {processed:false} → {processed:true}`) — deux livraisons
 *   concurrentes du même `webhook-id` ne peuvent jamais appliquer deux fois
 *   les écritures (un webhook rejoué ne crédite jamais deux fois un compte) ;
 * - échec d'application → claim réverti + HTTP 500 : Polar rejoue l'événement
 *   jusqu'à 10 fois (backoff exponentiel, doc officielle) — un 202 masquerait
 *   l'échec et perdrait la relivraison ;
 * - audit horodaté + notification in-app + e-mail Resend (si configuré) sur
 *   chaque transition d'abonnement.
 */
export async function POST(req: Request) {
  if (!polarConfigured()) {
    return NextResponse.json({ error: "polar_non_configure" }, { status: 503 });
  }
  const raw = await req.text();
  const valid = verifyPolarSignature(raw, {
    id: req.headers.get("webhook-id"),
    timestamp: req.headers.get("webhook-timestamp"),
    signature: req.headers.get("webhook-signature"),
  });
  if (!valid) {
    return NextResponse.json({ error: "signature_invalide" }, { status: 403 });
  }
  let event: PolarWebhookEvent;
  try {
    event = JSON.parse(raw) as PolarWebhookEvent;
  } catch {
    return NextResponse.json({ error: "payload_invalide" }, { status: 400 });
  }
  if (!event.type || typeof event.type !== "string" || !event.data) {
    return NextResponse.json({ error: "payload_invalide" }, { status: 400 });
  }

  // MINEURE-4 (audit) : sans `webhook-id`, le repli n'est plus
  // `event.timestamp ?? raw.length` (faible : deux livraisons distinctes du
  // même type à la même seconde se partageaient la clé) mais l'empreinte
  // SHA-256 du corps brut tronquée à 16 octets hex — deux corps différents ne
  // se partagent presque jamais la clé, un corps rejoué la partage toujours.
  // Le comportement avec `webhook-id` est inchangé.
  const webhookId = req.headers.get("webhook-id");
  const providerEventKey = webhookId
    ? `polar:${webhookId}`
    : `polar:${event.type}:${createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;

  // Persistance AVANT traitement (traçabilité), puis CLAIM ATOMIQUE AVANT application.
  const row = await db.subscriptionEvent.upsert({
    where: { providerEventKey },
    create: { organizationId: null, providerEventKey, type: event.type, payloadJson: raw.slice(0, 20000), processed: false },
    update: {},
  });
  if (row.processed) {
    // Événement déjà appliqué (rejeu Polar) — aucune double écriture.
    return NextResponse.json({ received: true, idempotent: true });
  }

  const claimed = await db.subscriptionEvent.updateMany({
    where: { id: row.id, processed: false },
    data: { processed: true },
  });
  if (claimed.count !== 1) {
    // Un handler concurrent a déjà pris le claim — rejeu identifié, sans effet.
    return NextResponse.json({ received: true, idempotent: true });
  }

  try {
    const result = await applySubscriptionEvent(event);

    if (result && result.organizationId) {
      await db.subscriptionEvent.update({ where: { id: row.id }, data: { organizationId: result.organizationId } });

      // Audit horodaté réel de la transition d'abonnement.
      await logAudit({
        organizationId: result.organizationId,
        action: `ABONNEMENT_${event.type.replace("subscription.", "").toUpperCase()}`,
        entityType: "Subscription",
        entityId: providerEventKey,
        after: { type: event.type, creditsGranted: result.creditsGranted },
      });

      // Destinataire : propriétaire de l'organisation (notifications + e-mail).
      const owner = await db.membership.findFirst({
        where: { organizationId: result.organizationId, role: "PROPRIETAIRE" },
        include: { user: { select: { email: true, name: true } } },
      });
      const ownerEmail = owner?.user?.email ?? null;
      const base = process.env.PUBLIC_BASE_URL ?? process.env.APP_URL ?? "";

      const messages: Record<string, { title: string; message: string; subject: string }> = {
        "subscription.active": {
          title: "Abonnement actif",
          message: "Votre paiement a été confirmé par Polar : tous les modules sont actifs.",
          subject: "Votre abonnement HESYD ONE est actif",
        },
        "subscription.created": {
          title: "Abonnement actif",
          message: "Votre paiement a été confirmé par Polar : tous les modules sont actifs.",
          subject: "Votre abonnement HESYD ONE est actif",
        },
        "subscription.resumed": {
          title: "Abonnement repris",
          message: "Votre abonnement suspendu a repris : un nouveau cycle a démarré.",
          subject: "Votre abonnement HESYD ONE a repris",
        },
        "subscription.cycled": {
          title: result.creditsGranted > 0 ? "Crédits renouvelés" : "Nouveau cycle d'abonnement",
          message:
            result.creditsGranted > 0
              ? `${result.creditsGranted} crédits ont été ajoutés pour le nouveau cycle.`
              : "Un nouveau cycle d'abonnement a démarré. Le paiement est en cours de traitement.",
          subject: result.creditsGranted > 0 ? "Crédits renouvelés — HESYD ONE" : "Nouveau cycle d'abonnement — HESYD ONE",
        },
        "subscription.past_due": {
          title: "Paiement en attente",
          message: "Votre dernier paiement est en échec chez Polar. Votre espace passe en période de grâce.",
          subject: "Action requise : paiement en échec — HESYD ONE",
        },
        "subscription.paused": {
          title: "Abonnement suspendu",
          message: "Votre abonnement est en pause chez Polar : les bénéfices sont suspendus jusqu'à reprise.",
          subject: "Votre abonnement HESYD ONE est en pause",
        },
        "subscription.canceled": {
          title: "Abonnement résilié",
          message: "Votre abonnement a été résilié. L'espace est suspendu.",
          subject: "Votre abonnement HESYD ONE a été résilié",
        },
        "subscription.revoked": {
          title: "Abonnement résilié",
          message: "Votre abonnement a été résilié. L'espace est suspendu.",
          subject: "Votre abonnement HESYD ONE a été résilié",
        },
      };
      const msg = messages[event.type];
      if (msg) {
        await notify({ organizationId: result.organizationId, type: "SYSTEME", title: msg.title, message: msg.message });
        if (resendConfigured() && ownerEmail) {
          const body =
            `<p>${msg.message}</p>` +
            (base ? `<p>Connectez-vous à votre espace pour vérifier l'état de votre abonnement.</p>` : "");
          const email = await sendEmail({
            to: ownerEmail,
            subject: msg.subject,
            html: systemEmailHtml(msg.title, body, base ? { label: "Ouvrir mon espace", url: base } : undefined),
          });
          if (!email.sent) {
            // Échec d'e-mail honnête, journalisé, sans bloquer la transition métier.
            console.error(`[polar-webhook] e-mail non envoyé (${email.code}) type=${event.type}`);
          }
        }
      }

      // Facture d'abonnement réelle (traçabilité CDC §9) — créée UNIQUEMENT si
      // le montant réel figure dans le payload Polar : une facture à 0 €
      // marquée « PAYEE » serait une fausse preuve de paiement (audit P3-14).
      if (event.type === "subscription.cycled" && result.creditsGranted > 0) {
        const data = event.data as { amount?: number; currency?: string };
        if (typeof data.amount === "number") {
          const count = await db.invoice.count({ where: { organizationId: result.organizationId } });
          const year = new Date().getFullYear();
          await db.invoice.create({
            data: {
              organizationId: result.organizationId,
              number: `FAC-${year}-${String(count + 1).padStart(4, "0")}`,
              kind: "ABONNEMENT",
              label: `Abonnement — cycle ${new Date().toISOString().slice(0, 10)}`,
              periodStart: new Date(),
              periodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
              amountCents: data.amount,
              currency: (data.currency ?? "eur").toUpperCase(),
              status: "PAYEE",
            },
          });
        } else {
          console.warn("[polar-webhook] montant absent du payload subscription.cycled — aucune facture fabriquée (le montant réel viendra de l'ordre Polar)");
        }
      }
    }
    return NextResponse.json({ received: true });
  } catch (e) {
    // Réversion du claim + 500 : Polar rejouera (jusqu'à 10 fois, doc officielle).
    await db.subscriptionEvent.updateMany({ where: { id: row.id, processed: true }, data: { processed: false } }).catch(() => undefined);
    console.error("[polar-webhook] application échouée — relivraison Polar attendue", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "application_echouee" }, { status: 500 });
  }
}
