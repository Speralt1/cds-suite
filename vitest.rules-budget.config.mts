import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
// Local measurement of the Firestore Rules expression budget (not part of the
// regular gates; the regression test lives in tests/rules/). Emulator only:
//   firebase emulators:exec --only firestore --project demo-cds-suite \
//     "RULES_FILE=firestore.rules OUT_FILE=/tmp/budget.json npx vitest run --config vitest.rules-budget.config.mts"
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/rules-budget/**/*.budget.ts"],
    fileParallelism: false,
    testTimeout: 3600000,
    hookTimeout: 120000,
  },
});
