import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  serverExternalPackages: ["pdfkit", "mammoth", "pdf-parse", "exceljs", "docx", "z-ai-web-dev-sdk"],
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
