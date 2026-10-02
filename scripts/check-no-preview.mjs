// Guardia previa al deploy de Hosting: la preview de CDS Suite (Financial UX
// 2026 + Calendario + Integrantes, datos de demostración) nunca debe publicarse.
// Falla si `out/` contiene la carpeta out/preview/, alguno de los marcadores de
// sus fixtures o las rutas de la preview. Se ejecuta automáticamente antes de
// `npm run deploy:hosting` (script `predeploy:hosting` y hosting.predeploy de
// firebase.json) y tras `npm run build` puede correrse a mano:
// `node scripts/check-no-preview.mjs`.
// CDS_OUT_DIR existe solo para testear la guardia sobre carpetas temporales.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

const outEnv = process.env.CDS_OUT_DIR ?? "out";
const OUT = isAbsolute(outEnv) ? outEnv : join(process.cwd(), outEnv);
const SENTINELS = ["FX_PREVIEW_SENTINEL_V2_7f3a", "SX_PREVIEW_SENTINEL_V1_c41e"];
// No se busca el texto genérico "/preview/": falso positivo con internals de Next.
const PATHS = [
  "/preview/finanzas-2026",
  "/preview/calendario",
  "/preview/integrantes",
  "/preview/configuracion",
  "/preview/reportes",
];

if (!existsSync(OUT)) {
  console.error(`No existe ${relative(process.cwd(), OUT) || OUT}/. Ejecuta \`npm run build\` antes de desplegar.`);
  process.exit(1);
}

const offenders = [];
if (existsSync(join(OUT, "preview"))) offenders.push(`${relative(process.cwd(), join(OUT, "preview"))}/`);

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(html|js|txt|json)$/.test(name)) {
      const content = readFileSync(full, "utf8");
      if (SENTINELS.some((s) => content.includes(s)) || PATHS.some((p) => content.includes(p)))
        offenders.push(relative(process.cwd(), full));
    }
  }
}
try {
  walk(OUT);
} catch (error) {
  console.error(`No se pudo revisar out/: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

if (offenders.length) {
  console.error(
    "✖ out/ contiene la preview de CDS Suite (datos de demostración). NO desplegar.\n" +
      offenders.map((o) => `  - ${o}`).join("\n") +
      "\nReconstruye sin la variable: `rm -rf out && npm run build`.",
  );
  process.exit(1);
}
console.log("✓ out/ no contiene la preview de CDS Suite.");
