// Connecteur Google Document AI — OCR imposé (règle absolue de la mission).
//
// Contrat officiel vérifié (https://docs.cloud.google.com/document-ai/docs/reference/rest/
// v1/projects.locations.processors/process) :
//   POST https://documentai.googleapis.com/v1/{name}:process
//   name = projects/{project}/locations/{location}/processors/{processor}
//   Corps : { rawDocument: { content: <base64>, mimeType }, skipHumanReview: boolean }
//   Réponse : ProcessResponse { document: { text, pages: [...] } }
//   Autorisation : OAuth 2.0 scope https://www.googleapis.com/auth/cloud-platform (Bearer).
//
// Authentification réelle : compte de service (GOOGLE_SERVICE_ACCOUNT_JSON, JWT RS256
// échangé contre un access token via https://oauth2.googleapis.com/token) OU
// DOC_AI_ACCESS_TOKEN fourni directement. Sans configuration, le connecteur est
// DORMANT et honnête : docAiConfigured() = false, le pipeline reste sur le moteur
// explicite par défaut — le moteur réellement utilisé est journalisé, jamais masqué.

import { createSign, randomUUID } from "crypto";

const DOC_AI_BASE = "https://documentai.googleapis.com/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

export function docAiConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_DOC_AI_PROJECT &&
      process.env.GOOGLE_DOC_AI_LOCATION &&
      process.env.GOOGLE_DOC_AI_PROCESSOR_ID &&
      (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.DOC_AI_ACCESS_TOKEN),
  );
}

function processorName(): string {
  return `projects/${process.env.GOOGLE_DOC_AI_PROJECT}/locations/${process.env.GOOGLE_DOC_AI_LOCATION}/processors/${process.env.GOOGLE_DOC_AI_PROCESSOR_ID}`;
}

// Cache de token en mémoire process (expiré → réémis ; aucune donnée métier dedans).
let cachedToken: { token: string; expiresAtMs: number } | null = null;

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

function readServiceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("compte_de_service_absent");
  const parsed = JSON.parse(raw) as ServiceAccount;
  if (!parsed.client_email || !parsed.private_key) throw new Error("compte_de_service_invalide");
  return parsed;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** Échange JWT RS256 (RFC 7523) contre un access token — flux officiel Google. */
async function getAccessToken(): Promise<string> {
  if (process.env.DOC_AI_ACCESS_TOKEN) return process.env.DOC_AI_ACCESS_TOKEN;
  if (cachedToken && cachedToken.expiresAtMs > Date.now() + 60_000) return cachedToken.token;

  const sa = readServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: sa.token_uri ?? TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const signature = base64url(signer.sign(sa.private_key));
  const assertion = `${header}.${claim}.${signature}`;

  const res = await fetch(sa.token_uri ?? TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "HESYD-ONE/1.0" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`docai_token_http_${res.status}`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("docai_token_absent");
  cachedToken = { token: json.access_token, expiresAtMs: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

export type DocAiProcessResult = {
  text: string;
  pagesCount: number;
  averageConfidence: number | null;
  engine: "GOOGLE_DOCUMENT_AI";
};

/** Traitement réel d'un document via processors:process (contrat REST ci-dessus). */
export async function processDocument(buffer: Buffer, mimeType: string): Promise<DocAiProcessResult> {
  if (!docAiConfigured()) throw new Error("docai_non_configure");
  const token = await getAccessToken();
  const url = `${DOC_AI_BASE}/${processorName()}:process`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "HESYD-ONE/1.0",
    },
    body: JSON.stringify({
      rawDocument: { content: buffer.toString("base64"), mimeType },
      skipHumanReview: true,
      labels: { pipeline: "hesyd-one" },
    }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`docai_process_http_${res.status}: ${detail}`);
  }
  const json = (await res.json()) as {
    document?: {
      text?: string;
      pages?: { confidence?: number }[];
    };
  };
  const text = json.document?.text ?? "";
  const pages = json.document?.pages ?? [];
  const confidences = pages.map((p) => p.confidence).filter((c): c is number => typeof c === "number" && c > 0);
  const averageConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null;
  return {
    text,
    pagesCount: pages.length || 1,
    averageConfidence,
    engine: "GOOGLE_DOCUMENT_AI",
  };
}

/** ID de corrélation de traitement (chaîne de garde, jamais un identifiant inventé du fournisseur). */
export function newProcessCorrelationId(): string {
  return randomUUID();
}
