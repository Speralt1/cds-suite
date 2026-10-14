// Corrección de Tesorería (doc 27 §Operaciones): un diezmo registrado en el mes equivocado se
// mueve con "Editar" (saveTransaction con el movimiento existente). Reglas reales del emulador,
// cliente real, datos ficticios. Solo `npm run test:emulator` (proyecto demo-cds-suite).
// No limpia Firestore (otros smokes usan el seed): ids y meses propios (2031) para no chocar,
// y al terminar borra (sin reglas) solo los documentos que creó.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, Timestamp, where, type Firestore } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveProfile } from "../../lib/finance/profiles";
import { saveTransaction, transactionInput } from "../../lib/finance/transactions";
import type { FinanceTransaction, TransactionInput } from "../../lib/finance/types";

const UID = "tie-finanzas";
const PROFILE = "tie-profile";
const TX = "tie-tithe-oct";
const OTHER = "tie-tithe-oct-other";
const OCT = "2031-10";
const SEP = "2031-09";

describe("mover un diezmo de octubre a septiembre con Editar", () => {
  let env: RulesTestEnvironment;
  let db: Firestore;
  const summary = async (p: string) => (await getDoc(doc(db, "financeMonthlySummaries", p))).data() ?? {};

  beforeAll(async () => {
    const project = process.env.GCLOUD_PROJECT || "demo-cds-suite";
    if (!project.startsWith("demo-")) throw new Error(`Proyecto no demo: ${project}`);
    env = await initializeTestEnvironment({
      projectId: "demo-cds-suite",
      firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("firestore.rules", "utf8") },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", UID), {
        displayName: "Tesorería de prueba",
        email: "tie-finanzas@example.test",
        role: "finance",
        active: true,
        createdAt: Timestamp.now(),
      });
    });
    db = env.authenticatedContext(UID).firestore() as unknown as Firestore;
    // Idempotente ante re-ejecuciones sobre el mismo emulador: solo crea si no existe.
    if (!(await getDoc(doc(db, "titheProfiles", PROFILE))).exists())
      await saveProfile(db, UID, {
        type: "family",
        displayName: "Familia Pérez de prueba",
        phone: "",
        email: "",
        members: "Juan Pérez y Ana Soto",
        active: true,
        pastoralContactAuthorized: false,
      }, undefined, PROFILE);
  });

  afterAll(async () => {
    // Deja el emulador como estaba: otros smokes cuentan usuarios y movimientos del seed.
    await env?.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      const paths = [
        ["users", UID],
        ["titheProfiles", PROFILE],
        ["titheProfileKeys", "familia_perez_de_prueba"],
        ["financeTransactions", TX],
        ["financeTransactions", OTHER],
        ["titheAttributions", TX],
        ["titheAttributions", OTHER],
        ["financeMonthlySummaries", OCT],
        ["financeMonthlySummaries", SEP],
      ];
      for (const [c, id] of paths) await deleteDoc(doc(fs, c, id));
    });
    await env?.cleanup();
  });

  it("septiembre +monto y +1, octubre −monto y −1, atribución movida, revisión 2, sin documentos nuevos", async () => {
    if ((await getDoc(doc(db, "financeTransactions", TX))).exists())
      throw new Error("El emulador ya contiene este caso: reinicia los emuladores (emulators:exec lo hace).");
    const tithe: TransactionInput = {
      type: "income",
      amount: 145000,
      date: `${OCT}-02`,
      category: "Diezmos",
      paymentMethod: "transfer",
      description: "Diezmo",
      note: "",
    };
    // Dos diezmos en octubre (uno legítimo que se queda) y uno que en realidad era de septiembre.
    await saveTransaction(db, UID, OTHER, { ...tithe, amount: 50000, date: `${OCT}-05` }, { profileId: PROFILE, privateNote: "" });
    await saveTransaction(db, UID, TX, tithe, { profileId: PROFILE, privateNote: "Nota privada" });
    const octBefore = await summary(OCT);
    const sepBefore = await summary(SEP);
    const attrBefore = (await getDoc(doc(db, "titheAttributions", TX))).data()!;
    const countDocs = async () => ({
      tx: (await getDocs(query(collection(db, "financeTransactions"), where("period", "in", [OCT, SEP])))).size,
      attr: (await getDocs(query(collection(db, "titheAttributions"), where("profileId", "==", PROFILE)))).size,
    });
    const docsBefore = await countDocs();

    const existing = { id: TX, ...(await getDoc(doc(db, "financeTransactions", TX))).data() } as FinanceTransaction;
    expect(existing.revision).toBe(1);
    // Exactamente lo que hace el formulario "Editar movimiento": mismo id, existing, nueva fecha.
    await saveTransaction(db, UID, TX, { ...transactionInput(existing), date: `${SEP}-28` }, { existing });

    const oct = await summary(OCT);
    const sep = await summary(SEP);
    expect(sep.incomeTotal).toBe((sepBefore.incomeTotal ?? 0) + 145000);
    expect(sep.titheTotal).toBe((sepBefore.titheTotal ?? 0) + 145000);
    expect(sep.transactionCount).toBe((sepBefore.transactionCount ?? 0) + 1);
    expect(sep.incomeByCategory.Diezmos).toBe((sepBefore.incomeByCategory?.Diezmos ?? 0) + 145000);
    expect(sep.dailyIncome["28"]).toBe((sepBefore.dailyIncome?.["28"] ?? 0) + 145000);
    expect(oct.incomeTotal).toBe(octBefore.incomeTotal - 145000);
    expect(oct.titheTotal).toBe(octBefore.titheTotal - 145000);
    expect(oct.transactionCount).toBe(octBefore.transactionCount - 1);
    expect(oct.dailyIncome["2"] ?? 0).toBe((octBefore.dailyIncome["2"] ?? 0) - 145000);
    expect(oct.titheTotal).toBe(50000); // el otro diezmo de octubre sigue contado

    const moved = (await getDoc(doc(db, "financeTransactions", TX))).data()!;
    expect(moved).toMatchObject({ period: SEP, day: "28", status: "active", revision: 2, amount: 145000, paymentMethod: "transfer", createdBy: UID, updatedBy: UID });
    expect(moved.createdAt.isEqual(existing.createdAt)).toBe(true);
    const attr = (await getDoc(doc(db, "titheAttributions", TX))).data()!;
    expect(attr).toMatchObject({ period: SEP, status: "active", profileId: PROFILE, amount: 145000, note: "Nota privada" });
    expect(attr.date.isEqual(moved.date)).toBe(true);
    expect(attr.createdAt.isEqual(attrBefore.createdAt)).toBe(true);
    expect((await getDoc(doc(db, "titheAttributions", OTHER))).data()).toMatchObject({ period: OCT, status: "active" });
    expect(await countDocs()).toEqual(docsBefore);
  });
});
