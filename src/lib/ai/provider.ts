// Fournisseur de modèle IA — contrat unique pour tout le backend HESYD ONE.
//
// Décision d'architecture (A6 / mission finalisation) :
// - Fournisseur de production : Azure AI Foundry (Azure OpenAI inférence data plane).
//   Contrat officiel vérifié (learn.microsoft.com, Azure OpenAI REST API reference) :
//   POST {endpoint}/openai/deployments/{deployment}/chat/completions?api-version={YYYY-MM-DD}
//   avec en-tête `api-key` (authentification par clé) ou Bearer Entra (non utilisé ici).
// - Runtime sandbox : GLM via z-ai-web-dev-sdk (réel, disponible).
//   Le repli GLM est EXPLICITE : chaque appel journalise en console serveur le
//   fournisseur réellement utilisé ; le modèle réellement employé est persisté
//   dans les tâches de l'agent (AgentTask.modelVersion). Jamais de substitution
//   silencieuse présentée comme Azure.
//
// Aucune réponse n'est jamais fabriquée ici : en cas d'échec des deux fournisseurs,
// l'erreur est levée et les statuts métier restent honnêtes (ECHEC/BLOQUE).

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

// Note d'architecture (contrôle final) : l'option multimodale « vision » qui
// existait ici a été SUPPRIMÉE. Aucun appelant ne l'utilisait et elle
// constituait un vecteur latent de moteur vision concurrent de Google
// Document AI, qui reste l'unique moteur OCR/extraction (directive du
// commanditaire). Le fournisseur IA (Azure AI Foundry / repli GLM) traite
// exclusivement du texte.

export type ChatResult = {
  content: string;
  provider: "AZURE_AI_FOUNDRY" | "GLM";
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number };
};

export function azureFoundryConfigured(): boolean {
  return Boolean(
    process.env.AZURE_AI_FOUNDRY_ENDPOINT &&
      process.env.AZURE_AI_FOUNDRY_API_KEY &&
      process.env.AZURE_AI_FOUNDRY_DEPLOYMENT,
  );
}

export function azureFoundryDeployment(): string | null {
  return azureFoundryConfigured() ? (process.env.AZURE_AI_FOUNDRY_DEPLOYMENT as string) : null;
}

/** Requête chat réelle : Azure AI Foundry si configuré, sinon GLM (repli explicite). Traitement TEXTE uniquement. */
export async function chatComplete(
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; jsonMode?: boolean },
): Promise<ChatResult> {
  if (azureFoundryConfigured()) {
    return chatViaAzure(messages, opts);
  }
  return chatViaGlm(messages, opts);
}

async function chatViaAzure(
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; jsonMode?: boolean },
): Promise<ChatResult> {
  const endpoint = (process.env.AZURE_AI_FOUNDRY_ENDPOINT as string).replace(/\/+$/, "");
  const deployment = process.env.AZURE_AI_FOUNDRY_DEPLOYMENT as string;
  const apiVersion = process.env.AZURE_AI_FOUNDRY_API_VERSION || "2024-10-21";
  const url = `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

  // Format de messages conforme à l'API OpenAI/Azure — texte uniquement.
  const bodyMessages = messages;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": process.env.AZURE_AI_FOUNDRY_API_KEY as string },
    body: JSON.stringify({
      messages: bodyMessages,
      temperature: opts?.temperature ?? 0.2,
      max_tokens: opts?.maxTokens ?? 2048,
      ...(opts?.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`azure_foundry_http_${res.status}: ${detail}`);
  }
  const json = (await res.json()) as {
    model?: string;
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("azure_foundry_reponse_vide");
  console.log(`[ai] fournisseur=AZURE_AI_FOUNDRY model=${json.model || deployment}`);
  return {
    content,
    provider: "AZURE_AI_FOUNDRY",
    model: json.model || deployment,
    usage: { promptTokens: json.usage?.prompt_tokens, completionTokens: json.usage?.completion_tokens },
  };
}

async function chatViaGlm(
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; jsonMode?: boolean },
): Promise<ChatResult> {
  const { default: ZAI } = await import("z-ai-web-dev-sdk");
  const zai = await ZAI.create();
  const completion = await zai.chat.completions.create({
    messages: messages as never,
    thinking: { type: "disabled" },
  });
  const content = completion.choices[0]?.message?.content ?? "";
  if (!content) throw new Error("glm_reponse_vide");
  console.log("[ai] fournisseur=GLM (repli explicite — Azure AI Foundry non configuré)");
  return {
    content,
    provider: "GLM",
    model: "glm",
    usage: { promptTokens: completion.usage?.prompt_tokens, completionTokens: completion.usage?.completion_tokens },
  };
}
