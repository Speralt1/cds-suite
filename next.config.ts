import path from "node:path";
import type { NextConfig } from "next";
import { OUTREACH_LIVE_BUNDLED } from "./lib/outreach/features";

// «Ve por los tuyos» (doc 40): sin la variable de simulación, el espacio de
// trabajo simulado se reemplaza por un módulo vacío y su bloque (con datos
// ficticios) no llega a la build. check:no-preview lo verifica.
const OUTREACH_SIM = process.env.NEXT_PUBLIC_CDS_OUTREACH_SIM === "1";
// El espacio en vivo se empaqueta con el submódulo habilitado o con NEXT_PUBLIC_CDS_OUTREACH_LIVE=1
// (mismo criterio que la página: OUTREACH_LIVE_BUNDLED de lib/outreach/features.ts).

const nextConfig: NextConfig = {
  output: "export",
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: { root: process.cwd() },
  webpack(config) {
    if (!OUTREACH_SIM) {
      config.resolve.alias = {
        ...config.resolve.alias,
        [path.resolve(process.cwd(), "components/outreach/sim-workspace")]: path.resolve(process.cwd(), "components/outreach/sim-disabled.tsx"),
      };
    }
    if (!OUTREACH_LIVE_BUNDLED) {
      config.resolve.alias = {
        ...config.resolve.alias,
        [path.resolve(process.cwd(), "components/outreach/live/live-workspace")]: path.resolve(process.cwd(), "components/outreach/live/live-disabled.tsx"),
      };
    }
    return config;
  },
};

export default nextConfig;
