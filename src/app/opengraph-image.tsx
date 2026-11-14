import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const alt = "HESYD ONE — Agent documentaire";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type FontOption = { name: string; data: ArrayBuffer; weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900; style: "normal" };

/** Lecture stricte : copie du fichier vers un ArrayBuffer dédié (Buffer Node est adossé à un pool partagé). */
function readFontFile(path: string): ArrayBuffer {
  const buf = readFileSync(path);
  const out = new ArrayBuffer(buf.byteLength);
  new Uint8Array(out).set(buf);
  return out;
}

/** Polices TTF embarquées dans public/fonts (converties depuis @fontsource-variable, OFL) — aucun réseau requis. */
function loadFonts(): FontOption[] {
  const fontsDir = join(process.cwd(), "public", "fonts");
  try {
    return [
      {
        name: "Fraunces",
        data: readFontFile(join(fontsDir, "fraunces-600.ttf")),
        weight: 600,
        style: "normal",
      },
      {
        name: "Instrument Sans",
        data: readFontFile(join(fontsDir, "instrument-sans-400.ttf")),
        weight: 400,
        style: "normal",
      },
    ];
  } catch {
    return [];
  }
}

/** Image OG native — mêmes couleurs que les tokens (équivalents sRGB documentés dans icon.svg). */
export default async function OpengraphImage() {
  const fonts = loadFonts();
  const serifFamily = fonts.some((f) => f.name === "Fraunces") ? "Fraunces" : undefined;
  const sansFamily = fonts.some((f) => f.name === "Instrument Sans") ? "Instrument Sans" : undefined;

  // Équivalents sRGB des tokens : papier #F6F2E9 · encre #33251F · cachet #C13B20 · encre-2 #6E5F52
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#F6F2E9",
          padding: "72px 84px",
          border: "3px solid #33251F",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <svg width="64" height="64" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="30" fill="none" stroke="#C13B20" strokeWidth="3" />
              <circle cx="32" cy="32" r="23" fill="none" stroke="#C13B20" strokeWidth="1.5" />
              {/* H en barres (satori ne rend pas <text> en SVG) */}
              <rect x="23" y="21" width="5" height="22" fill="#C13B20" />
              <rect x="36" y="21" width="5" height="22" fill="#C13B20" />
              <rect x="23" y="29.5" width="18" height="5" fill="#C13B20" />
            </svg>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontFamily: serifFamily, fontSize: 34, fontWeight: 600, color: "#33251F", letterSpacing: "0.02em" }}>
                HESYD ONE
              </span>
              <span style={{ fontFamily: sansFamily, fontSize: 17, color: "#6E5F52", letterSpacing: "0.14em", textTransform: "uppercase" }}>
                Registre documentaire
              </span>
            </div>
          </div>
          <span
            style={{
              fontFamily: sansFamily,
              fontSize: 15,
              color: "#6E5F52",
              border: "1px solid rgba(51,37,31,0.26)",
              borderRadius: 6,
              padding: "10px 18px",
              whiteSpace: "nowrap",
            }}
          >
            REGISTRE N° {new Date().getFullYear()}-01
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <span style={{ fontFamily: serifFamily, fontSize: 58, fontWeight: 600, color: "#33251F", lineHeight: 1.15, maxWidth: 940 }}>
            Recevoir, classer, archiver — avec confirmation réelle.
          </span>
          <span style={{ fontFamily: sansFamily, fontSize: 24, color: "#6E5F52", maxWidth: 860, lineHeight: 1.4 }}>
            L'agent documentaire de votre organisation : réception WhatsApp, classement vérifié, archivage Google Drive confirmé, exploitation intelligente.
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid rgba(51,37,31,0.14)", paddingTop: 26 }}>
          <span style={{ fontFamily: sansFamily, fontSize: 18, color: "#33251F" }}>
            Essai de 14 jours · sans moyen de paiement
          </span>
          <span style={{ fontFamily: sansFamily, fontSize: 18, color: "#C13B20", letterSpacing: "0.06em" }}>
            hesyd.one
          </span>
        </div>
      </div>
    ),
    { ...size, fonts }
  );
}
