import { requireAuth } from "@/lib/auth";
import { handle } from "@/lib/api";
import { transcribeAudioBuffer } from "@/lib/pipeline/parse";
import { meterUsage, consumeCredits, creditsAvailable, CREDIT_COST } from "@/lib/quota";

export const maxDuration = 120;

/** Transcription réelle ASR : le message vocal devient une instruction vérifiable. */
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    if (!(await creditsAvailable(auth.organization.id, CREDIT_COST.TRANSCRIPTION))) {
      throw new Error("credits_insuffisants_transcription_en_attente");
    }
    const form = await req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File)) throw new Error("audio_absent");
    if (audio.size > 20 * 1024 * 1024) throw new Error("audio_trop_volumineux");
    const buffer = Buffer.from(await audio.arrayBuffer());
    const text = await transcribeAudioBuffer(buffer);
    if (!text) throw new Error("transcription_vide");
    await meterUsage({ organizationId: auth.organization.id, userId: auth.user.id, nature: "TRANSCRIPTION" });
    await consumeCredits(auth.organization.id, CREDIT_COST.TRANSCRIPTION, "CONSO_TRANSCRIPTION");
    return { text, durationSec: Math.round(buffer.length / 32000), mime: audio.type };
  });
}
