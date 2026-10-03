import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Smoke contra los emuladores reales (Auth + Firestore + Functions, proyecto
// demo-cds-suite). Solo corre vía `npm run test:emulator` (firebase emulators:exec).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/emulator/**/*.e2e.test.ts"],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 120000,
  },
});
