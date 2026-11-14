// Connecteur Resend — e-mails transactionnels (décision imposée : Resend).
//
// Contrat officiel vérifié (resend.com/docs/api-reference/introduction + /emails/send-email) :
// - Base URL : https://api.resend.com (HTTPS obligatoire)
// - Authentification : en-tête `Authorization: Bearer re_xxxxxxxx`
// - En-tête `User-Agent` OBLIGATOIRE (403 sans lui)
// - POST /emails : {from («Nom <email>»), to, subject, html/text}
// - Réponse 200 : {id, ...}
//
// Sans RESEND_API_KEY le connecteur est DORMANT et honnête : resendConfigured() = false,
// les flux appellants restent en mode LOCAL_REVEAL (développement uniquement) ou
// renvoient email_non_configure — jamais un faux succès d'envoi.

const RESEND_BASE_URL = "https://api.resend.com";

export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export type ResendSendResult = { sent: true; id: string } | { sent: false; code: string };

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}): Promise<ResendSendResult> {
  if (!resendConfigured()) return { sent: false, code: "email_non_configure" };
  const from = params.from || process.env.RESEND_FROM || "HESYD ONE <notifications@resend.dev>";
  try {
    const res = await fetch(`${RESEND_BASE_URL}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        // Requis par la doc : toute requête sans User-Agent est rejetée 403.
        "User-Agent": "HESYD-ONE/1.0",
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text ?? params.html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      console.error(`[resend] envoi échoué HTTP ${res.status}: ${detail}`);
      return { sent: false, code: `resend_http_${res.status}` };
    }
    const json = (await res.json()) as { id?: string };
    return { sent: true, id: json.id ?? "" };
  } catch (error) {
    console.error("[resend] erreur réseau", error instanceof Error ? error.message : error);
    return { sent: false, code: "resend_erreur_reseau" };
  }
}

/** Gabarit d'e-mail système sobre (marque HESYD, sans dépendance CSS externe). */
export function systemEmailHtml(title: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  const ctaHtml = cta
    ? `<p style="margin:24px 0"><a href="${cta.url}" style="display:inline-block;background:#C13B20;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${cta.label}</a></p>`
    : "";
  return `<div style="font-family:Georgia,serif;background:#F7F3EC;padding:32px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E4DCCF;border-radius:12px;padding:32px">
    <p style="font-size:13px;letter-spacing:.14em;color:#C13B20;margin:0 0 16px">HESYD ONE</p>
    <h1 style="font-size:22px;color:#1F1B16;margin:0 0 16px">${title}</h1>
    <div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#3B3730">${bodyHtml}</div>
    ${ctaHtml}
    <p style="font-size:12px;color:#8A8378;margin-top:28px;border-top:1px solid #E4DCCF;padding-top:16px">Cet e-mail vous a été envoyé par votre espace HESYD ONE. Si vous n'en êtes pas à l'origine, ignorez ce message.</p>
  </div>
</div>`;
}
