import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// Preview Financial UX 2026 (app/preview/**): sus archivos especiales usan la
// extensión `.preview.tsx` y solo existen como rutas en `next dev` o en un
// build explícito con CDS_FINANCE_PREVIEW=1. El build por defecto (el que se
// despliega) no compila la ruta ni emite sus chunks ni sus datos de ejemplo.
function isFinancePreviewEnabled(phase: string) {
  return (
    phase === PHASE_DEVELOPMENT_SERVER ||
    process.env.CDS_FINANCE_PREVIEW === "1"
  );
}

export default function nextConfig(phase: string): NextConfig {
  return {
    output: "export",
    poweredByHeader: false,
    allowedDevOrigins: ["127.0.0.1"],
    turbopack: { root: process.cwd() },
    pageExtensions: [
      ...(isFinancePreviewEnabled(phase) ? ["preview.tsx"] : []),
      "tsx",
      "ts",
      "jsx",
      "js",
    ],
  };
}
