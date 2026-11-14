import { requireAuth } from "@/lib/auth";
import { handle } from "@/lib/api";
import { consumeRateLimitWindow } from "@/lib/rate-limit";
import { transcribeAudioBuffer } from "@/lib/pipeline/parse";
import { meterUsage, consumeCredits, creditsAvailable, CREDIT_COST } from "@/lib/quota";

export const maxDuration = 120;

const TRANSCRIBE_LIMIT = 12;
const TRANSCRIBE_WINDOW_MS = 5 * 60 * 1000;

/** Transcription réelle ASR : le message vocal devient une instruction vérifiable. */
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    // Anti-abus persisté : 12 transcriptions / 5 min par organisation+utilisateur (audit P3)
    const rl = await consumeRateLimitWindow(
      `VOICE_TRANSCRIBE:${auth.organization.id}:${auth.user.id}`,
      TRANSCRIBE_LIMIT,
      TRANSCRIBE_WINDOW_MS
    );
    if (!rl.allowed) {
      return Response.json({ error: "trop_de_tentatives", retryAfterSeconds: rl.retryAfterSeconds }, { status: 429 });
    }
    if (!(await creditsAvailable(auth.organization.id, CREDIT_COST.TRANSCRIPTION))) {
      throw new Error("credits_insuffisants_transcription_en_attente");
    }
    const form = await req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File)) throw new Error("audio_absent");
    if (audio.size > 20 * 1024 * 1024) throw new Error("audio_trop_volumineux");
    // Contrôle MIME cohérent avec la rigueur de /api/files/upload (audit P3) :
    // seuls les conteneurs audio/vidéo réellement supportés par l'ASR passent.
    const AUDIO_MIME_OK = new Set([
      "audio/ogg", "audio/ogg; codecs=opus", "audio/mpeg", "audio/mp4", "audio/aac",
      "audio/wav", "audio/x-wav", "audio/webm", "video/mp4", "video/webm", "application/ogg",
    ]);
    const mime = (audio.type || "").split(";")[0].trim();
    if (mime && !AUDIO_MIME_OK.has(mime) && !AUDIO_MIME_OK.has(audio.type)) throw new Error(`mime_audio_refuse:${audio.type}`);
    const buffer = Buffer.from(await audio.arrayBuffer());
    const text = await transcribeAudioBuffer(buffer);
    if (!text) throw new Error("transcription_vide");
    await meterUsage({ organizationId: auth.organization.id, userId: auth.user.id, nature: "TRANSCRIPTION" });
    await consumeCredits(auth.organization.id, CREDIT_COST.TRANSCRIPTION, "CONSO_TRANSCRIPTION");
    return { text, durationSec: Math.round(buffer.length / 32000), mime: audio.type };
  });
}
