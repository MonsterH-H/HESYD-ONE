import { handle } from "@/lib/api";
import { googleConfigured } from "@/lib/oauth-google";

/** Découverte honnête des fournisseurs d'identité disponibles côté client. */
export async function GET() {
  return handle(async () => {
    return {
      google: { configured: googleConfigured() },
    };
  });
}
