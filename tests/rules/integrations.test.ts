import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-cds-suite",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
});

afterAll(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", "finance-user"), {
      displayName: "Finanzas",
      email: "finance@example.com",
      role: "finance",
      active: true,
      createdAt: new Date(),
    });
    await setDoc(doc(db, "sumupIntegrations", "offerings"), {
      account: "offerings",
      configured: true,
    });
  });
});

describe("Ofrendas públicas e integración SumUp", () => {
  it("permite leer configuración pública pero no modificarla anónimamente", async () => {
    const finance = env.authenticatedContext("finance-user").firestore();
    await assertSucceeds(setDoc(doc(finance, "publicGivingSettings", "current"), {
      title: "Ofrendar",
      intro: "",
      transferEnabled: true,
      transferInstructions: "",
      onlineEnabled: false,
      onlineLabel: "Pagar online",
      onlineUrl: "",
      updatedAt: serverTimestamp(),
    }));
    const publicDb = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(publicDb, "publicGivingSettings", "current")));
    await assertFails(setDoc(doc(publicDb, "publicGivingSettings", "current"), {
      title: "Manipulado",
      intro: "",
      transferEnabled: true,
      transferInstructions: "",
      onlineEnabled: false,
      onlineLabel: "",
      onlineUrl: "",
      updatedAt: serverTimestamp(),
    }));
  });

  it("SumUp es privado y de solo lectura para el cliente", async () => {
    const publicDb = env.unauthenticatedContext().firestore();
    const finance = env.authenticatedContext("finance-user").firestore();
    await assertFails(getDoc(doc(publicDb, "sumupIntegrations", "offerings")));
    await assertSucceeds(getDoc(doc(finance, "sumupIntegrations", "offerings")));
    await assertFails(setDoc(doc(finance, "sumupIntegrations", "offerings"), { account: "offerings", configured: false }));
  });
});
