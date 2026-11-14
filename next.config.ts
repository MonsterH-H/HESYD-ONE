import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // La sécurité de type est exigée en production : plus d'ignorance des
  // erreurs TS au build (tsc --noEmit exécuté à 0 erreur avant chaque livraison).
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  serverExternalPackages: ["pdfkit", "mammoth", "pdf-parse", "exceljs", "docx", "z-ai-web-dev-sdk"],
  // En-têtes de sécurité applicatifs (audit P3) : complètent nginx lorsque
  // l'app est servie derrière le proxy, la protègent si elle est exposée seule.
  // La CSP autorise les styles inline (Tailwind/design tokens) et les images
  // d'avatar Google (lh3.googleusercontent.com).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://lh3.googleusercontent.com",
              "font-src 'self' data:",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
  // La SPA vit sur « / » : les chemins des liens à jeton (e-mail, réinitialisation)
  // servent la même page — la détection se fait côté client via window.location.
  async rewrites() {
    return [
      { source: "/reinitialisation", destination: "/" },
      { source: "/verification-email", destination: "/" },
    ];
  },
};

export default nextConfig;

