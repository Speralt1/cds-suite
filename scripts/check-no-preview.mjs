// Guardia previa al deploy de Hosting: el preview Financial UX 2026 (datos de
// demostración) nunca debe publicarse. Falla si `out/` contiene la ruta del
// preview o el marcador de sus fixtures. Se ejecuta automáticamente antes de
// `npm run deploy:hosting` (script `predeploy:hosting`) y tras `npm run build`
// puede correrse a mano: `node scripts/check-no-preview.mjs`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "out");
const SENTINEL = "FX_PREVIEW_SENTINEL_V2_7f3a";

if (!existsSync(OUT)) {
  console.error("No existe out/. Ejecuta `npm run build` antes de desplegar.");
  process.exit(1);
}

const offenders = [];
if (existsSync(join(OUT, "preview"))) offenders.push("out/preview/");

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(html|js|txt|json)$/.test(name) && readFileSync(full, "utf8").includes(SENTINEL))
      offenders.push(full.slice(process.cwd().length + 1));
  }
}
walk(OUT);

if (offenders.length) {
  console.error(
    "✖ out/ contiene el preview Financial UX 2026 (datos de demostración). NO desplegar.\n" +
      offenders.map((o) => `  - ${o}`).join("\n") +
      "\nReconstruye sin la variable: `rm -rf out && npm run build`.",
  );
  process.exit(1);
}
console.log("✓ out/ no contiene el preview Financial UX 2026.");
