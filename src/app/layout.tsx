import type { Metadata } from "next";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/instrument-sans";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/providers";

const baseUrl = process.env.PUBLIC_BASE_URL ?? process.env.APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: "HESYD ONE — Agent documentaire",
    template: "%s · HESYD ONE",
  },
  description:
    "Réception, classement, archivage confirmé et exploitation intelligente de vos documents. Essai de 14 jours, sans moyen de paiement.",
  applicationName: "HESYD ONE",
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "HESYD ONE",
    title: "HESYD ONE — Agent documentaire",
    description:
      "Réception, classement, archivage confirmé et exploitation intelligente de vos documents.",
  },
  twitter: {
    card: "summary_large_image",
    title: "HESYD ONE — Agent documentaire",
    description:
      "Réception, classement, archivage confirmé et exploitation intelligente de vos documents.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body
        className={`antialiased bg-papier text-encre`}
        style={
          {
            "--font-sans-text": "'Instrument Sans Variable', sans-serif",
            "--font-sans-display": "'Fraunces Variable', serif",
          } as React.CSSProperties
        }
      >
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
