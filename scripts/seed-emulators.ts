/** Local fixtures only. No Admin SDK, production project or external host accepted. */
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  getDoc,
  Timestamp,
  type Firestore,
} from "firebase/firestore";
import { saveProfile } from "../lib/finance/profiles";
import { saveTransaction } from "../lib/finance/transactions";
import { today } from "../lib/finance/formatters";
const projectId = "demo-cds-suite";
if (
  process.env.CDS_SEED_LOCAL !== "true" ||
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
)
  throw new Error(
    "Fixtures require explicit local emulator flags. Production is never supported.",
  );
async function main() {
  const env = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: 8080 },
  });
  let financeUid = "";
  try {
    for (const role of [
      "admin",
      "pastor",
      "finance",
      "leader",
      "inactive",
      "missing",
    ]) {
      const email = `${role}@cds.test`,
        password = "PruebaCDS2026!";
      let response = await fetch(
        "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, returnSecureToken: true }),
        },
      );
      let account = await response.json();
      if (account.error?.message === "EMAIL_EXISTS") {
        response = await fetch(
          "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, returnSecureToken: true }),
          },
        );
        account = await response.json();
      }
      if (!account.localId)
        throw new Error(`Could not create local account ${role}`);
      if (role === "finance") financeUid = account.localId;
      if (role !== "missing")
        await env.withSecurityRulesDisabled(async (c) =>
          setDoc(doc(c.firestore(), "users", account.localId), {
            displayName: `Prueba ${role}`,
            email,
            role: role === "inactive" ? "admin" : role,
            active: role !== "inactive",
            createdAt: Timestamp.now(),
          }),
        );
    }
    const db = env
      .authenticatedContext(financeUid)
      .firestore() as unknown as Firestore;
    const date = today();
    if (!(await getDoc(doc(db, "titheProfiles", "fixture-family"))).exists())
      await saveProfile(
        db,
        financeUid,
        {
          type: "family",
          displayName: "Familia de prueba",
          phone: "",
          email: "",
          members: "Solo datos ficticios del emulador",
          active: true,
          pastoralContactAuthorized: true,
        },
        undefined,
        "fixture-family",
      );
    for (const [id, type, amount, category] of [
      ["fixture-income", "income", 250000, "Ofrendas"],
      ["fixture-expense", "expense", 60000, "Mantención"],
      ["fixture-tithe", "income", 45000, "Diezmos"],
    ] as const) {
      try {
        await saveTransaction(
          db,
          financeUid,
          id,
          {
            type,
            amount,
            date,
            category,
            paymentMethod: "transfer",
            description:
              category === "Diezmos" ? "Diezmo" : "Registro local de prueba",
            note: "",
          },
          category === "Diezmos"
            ? {
                profileId: "fixture-family",
                privateNote: "Nota privada del emulador",
              }
            : {},
        );
      } catch (e) {
        if (!(e instanceof Error && e.message.includes("ya fue registrado")))
          throw e;
      }
    }
    console.log(
      "Solo emuladores: admin/pastor/finance/leader/inactive/missing @cds.test; contraseña PruebaCDS2026!",
    );
  } finally {
    await env.cleanup();
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
