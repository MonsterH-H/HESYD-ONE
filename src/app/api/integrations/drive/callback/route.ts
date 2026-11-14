import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { driveConfigured, exchangeCodeForTokens, encryptToken, driveEnsureFolder } from "@/lib/storage/drive";
import { safeJsonParse } from "@/lib/helpers";
import { logAudit } from "@/lib/audit";

/** Comparaison d'état en temps constant sur buffers (audit P1 — timing attack). */
function statesEqual(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Callback OAuth Google réel : échange du code, chiffrement du refresh token. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) return NextResponse.redirect(`${process.env.PUBLIC_BASE_URL ?? ""}/?drive=erreur&cause=${encodeURIComponent(error)}`);
  if (!driveConfigured() || !code || !state) {
    return NextResponse.redirect(`${process.env.PUBLIC_BASE_URL ?? ""}/?drive=erreur&cause=identifiants_ou_code_absent`);
  }

  const pendingRows = await db.integrationConnection.findMany({ where: { connector: "GOOGLE_DRIVE", status: "EN_ATTENTE_AUTH" } });
  if (pendingRows.length === 0) return NextResponse.redirect(`${process.env.PUBLIC_BASE_URL ?? ""}/?drive=erreur&cause=aucune_auth_en_cours`);

  // Résolution du flux par l'état comparé en temps constant sur TOUTES les lignes
  // en attente (audit P2 — deux organisations peuvent avoir des flux simultanés ;
  // un findFirst arbitraire rejetait le callback légitime de l'autre organisation).
  let pending: (typeof pendingRows)[number] | null = null;
  for (const row of pendingRows) {
    const candidate = safeJsonParse<{ state?: string; organizationId?: string }>(row.configJson, {});
    if (statesEqual(candidate.state, state)) {
      pending = row;
      break;
    }
  }
  if (!pending) return NextResponse.redirect(`${process.env.PUBLIC_BASE_URL ?? ""}/?drive=erreur&cause=etat_invalide`);

  // Parse tolérant : un configJson corrompu ne doit pas provoquer de 500.
  const cfg = safeJsonParse<{ state?: string; organizationId?: string }>(pending.configJson, {});
  if (!statesEqual(cfg.state, state)) {
    return NextResponse.redirect(`${process.env.PUBLIC_BASE_URL ?? ""}/?drive=erreur&cause=etat_invalide`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const token = await import("@/lib/storage/drive").then((m) => m.refreshAccessToken(m.encryptToken(tokens.refreshToken)));
    const rootName = `HESYD ONE — ${pending.organizationId.slice(0, 8)}`;
    const rootFolderId = await driveEnsureFolder(token, rootName, null);
    await db.integrationConnection.update({
      where: { id: pending.id },
      data: {
        status: "CONNECTE",
        // Le state n'est jamais conservé après usage (audit P1) : le
        // configJson ne contient plus que le jeton chiffré au repos et
        // l'emplacement racine.
        configJson: JSON.stringify({ refreshTokenEnc: encryptToken(tokens.refreshToken), rootFolderId, rootName }),
        lastCheckedAt: new Date(),
      },
    });
    await db.onboardingProgress.updateMany({
      where: { organizationId: pending.organizationId, storageConnected: false },
      data: { storageConnected: true, storageAt: new Date() },
    });
    await logAudit({ organizationId: pending.organizationId, action: "DRIVE_CONNECTE", entityType: "IntegrationConnection", entityId: pending.id, after: { rootFolderId } });
    return NextResponse.redirect(`${process.env.PUBLIC_BASE_URL ?? ""}/?drive=connecte`);
  } catch (e) {
    // Même en échec, le state est purgé du configJson — jamais stocké après usage.
    await db.integrationConnection.update({
      where: { id: pending.id },
      data: {
        status: "ERREUR",
        lastError: e instanceof Error ? e.message : "erreur",
        configJson: JSON.stringify({ organizationId: pending.organizationId }),
      },
    });
    return NextResponse.redirect(`${process.env.PUBLIC_BASE_URL ?? ""}/?drive=erreur&cause=echange_jeton`);
  }
}
