import type { Metadata } from "next";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/instrument-sans";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "HESYD ONE — Agent documentaire",
  description:
    "Réception, classement, archivage confirmé et exploitation intelligente de vos documents. Essai de 14 jours, sans moyen de paiement.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body
        className={`antialiased bg-background text-foreground`}
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
