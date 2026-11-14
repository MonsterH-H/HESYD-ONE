import { createHmac, timingSafeEqual } from "crypto";

/**
 * Connecteur WhatsApp Cloud API (Meta) — implémentation réelle.
 * Dormant sans identifiants : webhook rejette tout événement non signé
 * plutôt que d'en accepter un faux. Jamais présenté comme connecté.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_APP_SECRET && process.env.WHATSAPP_TOKEN);
}

/** Vérification du hub.challenge (Meta) — comparaison en temps constant sur buffers, avec garde de longueur (audit P1). */
export function verifyHubToken(mode: string, token: string): boolean {
  if (mode !== "subscribe") return false;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN ?? "";
  if (!expected) return false; // sans token configuré : rien ne valide jamais
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(token, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Vérification HMAC réelle de X-Hub-Signature-256 sur le corps brut. */
export function verifyWhatsAppSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const received = signatureHeader.slice(7);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type WhatsAppMedia = { id: string; mimeType: string; filename?: string; caption?: string };

export type WhatsAppInboundMessage = {
  messageId: string;
  from: string;
  timestamp: Date;
  type: "text" | "audio" | "image" | "document" | "video" | "sticker" | "unknown";
  text?: string;
  media?: WhatsAppMedia;
  groupId?: string;
  phoneNumberId: string;
};

/** Extraction structurée du payload webhook officiel — rien n'est inventé. */
export function parseWebhookPayload(payload: unknown): WhatsAppInboundMessage[] {
  const messages: WhatsAppInboundMessage[] = [];
  const data = payload as {
    entry?: { changes?: { value?: { messages?: unknown[]; metadata?: { phone_number_id?: string } } }[] }[];
  };
  for (const entry of data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id ?? "";
      for (const raw of (value?.messages ?? []) as Record<string, unknown>[]) {
        const id = String(raw.id ?? "");
        if (!id) continue;
        const from = String(raw.from ?? "");
        const ts = new Date(Number(raw.timestamp ?? 0) * 1000);
        const type = String(raw.type ?? "unknown");
        const msg: WhatsAppInboundMessage = {
          messageId: id,
          from,
          timestamp: isNaN(ts.getTime()) ? new Date() : ts,
          type: type as WhatsAppInboundMessage["type"],
          phoneNumberId,
        };
        if (type === "text") msg.text = String((raw.text as Record<string, unknown>)?.body ?? "");
        if (type === "audio" || type === "image" || type === "video") {
          const mediaObj = (raw[type] as Record<string, unknown>) ?? {};
          msg.media = {
            id: String(mediaObj.id ?? ""),
            mimeType: String(mediaObj.mime_type ?? "application/octet-stream"),
            caption: mediaObj.caption ? String(mediaObj.caption) : undefined,
          };
          if (type === "audio") msg.media.filename = `audio-${id}.ogg`;
          if (type === "image") msg.media.filename = `image-${id}.jpg`;
          if (type === "video") msg.media.filename = `video-${id}.mp4`;
        }
        if (type === "document") {
          const doc = (raw.document as Record<string, unknown>) ?? {};
          msg.media = {
            id: String(doc.id ?? ""),
            mimeType: String(doc.mime_type ?? "application/octet-stream"),
            filename: doc.filename ? String(doc.filename) : `document-${id}.bin`,
            caption: doc.caption ? String(doc.caption) : undefined,
          };
        }
        messages.push(msg);
      }
    }
  }
  return messages;
}

/** Téléchargement média réel via l'API Graph. */
export async function downloadWhatsAppMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new Error("whatsapp_non_configure");
  const resMeta = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!resMeta.ok) throw new Error(`whatsapp_media_meta:${resMeta.status}`);
  const meta = (await resMeta.json()) as { url: string; mime_type: string };
  const resMedia = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resMedia.ok) throw new Error(`whatsapp_media_download:${resMedia.status}`);
  const buffer = Buffer.from(await resMedia.arrayBuffer());
  return { buffer, mimeType: meta.mime_type };
}

/** Envoi réel d'un message texte (utilisé après approbation — risque élevé). */
export async function sendWhatsAppText(to: string, body: string): Promise<{ messageId: string }> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) throw new Error("whatsapp_non_configure");
  const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  if (!res.ok) throw new Error(`whatsapp_envoi:${res.status}`);
  const json = (await res.json()) as { messages: { id: string }[] };
  return { messageId: json.messages?.[0]?.id ?? "" };
}
