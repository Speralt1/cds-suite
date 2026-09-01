import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import {
  saveTransaction,
  voidTransaction,
  transactionInput,
} from "../../lib/finance/transactions";
import { saveProfile, addFollowup } from "../../lib/finance/profiles";
import type {
  FinanceTransaction,
  TransactionInput,
} from "../../lib/finance/types";
import {
  FALLBACK_EXPENSE_CATEGORIES,
  FALLBACK_INCOME_CATEGORIES,
} from "../../lib/settings/finance-settings";
let env: RulesTestEnvironment;
let db: Firestore;
const input: TransactionInput = {
  type: "income",
  amount: 10000,
  date: "2026-08-10",
  category: "Ofrendas",
  paymentMethod: "cash",
  description: "Culto domingo",
  note: "",
};
const profile = {
  type: "person" as const,
  displayName: "Persona de prueba",
  phone: "",
  email: "",
  members: "",
  active: true,
  pastoralContactAuthorized: true,
};
function financeSettings(
  updatedBy: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: 1,
    incomeCategoriesAll: FALLBACK_INCOME_CATEGORIES,
    incomeCategoriesActive: FALLBACK_INCOME_CATEGORIES,
    expenseCategoriesAll: FALLBACK_EXPENSE_CATEGORIES,
    expenseCategoriesActive: FALLBACK_EXPENSE_CATEGORIES,
    updatedBy,
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}
async function transaction(id = "one") {
  const s = await getDoc(doc(db, "financeTransactions", id));
  return { id, ...s.data() } as FinanceTransaction;
}
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
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const role of ["admin", "pastor", "finance", "leader", "inactive"])
      await setDoc(doc(ctx.firestore(), "users", role), {
        displayName: role,
        email: `${role}@example.test`,
        role: role === "inactive" ? "admin" : role,
        active: role !== "inactive",
        createdAt: Timestamp.now(),
      });
  });
  db = env.authenticatedContext("finance").firestore() as unknown as Firestore;
});
afterAll(async () => await env?.cleanup());
describe("Reglas y operaciones reales, exclusivamente emulador", () => {
  it("crea entrada y salida, edita de mes y anula sin perder auditoría", async () => {
    await saveTransaction(db, "finance", "one", input);
    await saveTransaction(db, "finance", "two", {
      ...input,
      type: "expense",
      category: "Mantención",
      amount: 2000,
    });
    let s = (
      await getDoc(doc(db, "financeMonthlySummaries", "2026-08"))
    ).data()!;
    expect(s.incomeTotal).toBe(10000);
    expect(s.expenseTotal).toBe(2000);
    expect(s.result).toBe(8000);
    const before = await transaction();
    await saveTransaction(
      db,
      "finance",
      "one",
      { ...input, amount: 15000, date: "2026-09-02" },
      { existing: before },
    );
    s = (await getDoc(doc(db, "financeMonthlySummaries", "2026-08"))).data()!;
    expect(s.incomeTotal).toBe(0);
    expect(s.transactionCount).toBe(1);
    const edited = await transaction();
    expect(edited.createdAt.isEqual(before.createdAt)).toBe(true);
    expect(edited.revision).toBe(2);
    await voidTransaction(db, "finance", edited, "Registro duplicado");
    expect((await transaction()).status).toBe("voided");
    expect(
      (await getDoc(doc(db, "financeMonthlySummaries", "2026-09"))).data()!
        .incomeTotal,
    ).toBe(0);
    await assertFails(deleteDoc(doc(db, "financeTransactions", "one")));
    await expect(
      voidTransaction(db, "finance", edited, "Duplicado"),
    ).rejects.toThrow();
  });
  it("vincula diezmo privado y mantiene agregado al editar/anular", async () => {
    await saveProfile(db, "finance", profile, undefined, "person");
    await saveTransaction(
      db,
      "finance",
      "tithe",
      { ...input, category: "Diezmos", description: "Diezmo" },
      { profileId: "person", privateNote: "Privada" },
    );
    const a = (await getDoc(doc(db, "titheAttributions", "tithe"))).data()!;
    expect(a.profileId).toBe("person");
    expect(a.note).toBe("Privada");
    const t = await transaction("tithe");
    expect(t.description).toBe("Diezmo");
    expect(t.note).toBe("");
    expect(t).not.toHaveProperty("profileId");
    await saveTransaction(
      db,
      "finance",
      "tithe",
      { ...transactionInput(t), amount: 20000, date: "2026-09-02" },
      { existing: t },
    );
    expect(
      (await getDoc(doc(db, "titheAttributions", "tithe"))).data()!.amount,
    ).toBe(20000);
    expect(
      (await getDoc(doc(db, "financeMonthlySummaries", "2026-09"))).data()!
        .titheTotal,
    ).toBe(20000);
    expect(
      (await getDoc(doc(db, "titheAttributions", "tithe"))).data()!.period,
    ).toBe("2026-09");
    await voidTransaction(
      db,
      "finance",
      await transaction("tithe"),
      "Error de registro",
    );
    expect(
      (await getDoc(doc(db, "titheAttributions", "tithe"))).data()!.status,
    ).toBe("voided");
    expect(
      (await getDoc(doc(db, "financeMonthlySummaries", "2026-08"))).data()!
        .titheTotal,
    ).toBe(0);
  });
  it("líder solo lee agregados; sin autorización no hay datos", async () => {
    await saveTransaction(db, "finance", "one", input);
    const leader = env.authenticatedContext("leader").firestore();
    await assertSucceeds(
      getDoc(doc(leader, "financeMonthlySummaries", "2026-08")),
    );
    for (const c of [
      "financeTransactions",
      "titheProfiles",
      "titheAttributions",
      "pastoralFollowups",
    ])
      await assertFails(getDoc(doc(leader, c, "one")));
    for (const uid of ["missing", "inactive"])
      await assertFails(
        getDoc(
          doc(
            env.authenticatedContext(uid).firestore(),
            "financeMonthlySummaries",
            "2026-08",
          ),
        ),
      );
    await assertFails(
      getDoc(
        doc(
          env.unauthenticatedContext().firestore(),
          "financeMonthlySummaries",
          "2026-08",
        ),
      ),
    );
    await assertFails(
      updateDoc(doc(leader, "users", "leader"), { role: "admin" }),
    );
  });
  it("notas pastorales solo pastor/admin con consentimiento", async () => {
    await saveProfile(db, "finance", profile, undefined, "person");
    const pastor = env
      .authenticatedContext("pastor")
      .firestore() as unknown as Firestore;
    const note = {
      date: "2026-08-10",
      note: "Acompañamiento solicitado",
      status: "pending" as const,
      nextFollowUpDate: "",
    };
    await assertSucceeds(addFollowup(pastor, "pastor", "person", note, "note"));
    await assertFails(getDoc(doc(db, "pastoralFollowups", "note")));
    await assertFails(addFollowup(db, "finance", "person", note, "other"));
    await updateDoc(doc(db, "titheProfiles", "person"), {
      pastoralContactAuthorized: false,
      updatedAt: serverTimestamp(),
      updatedBy: "finance",
    });
    await expect(
      addFollowup(pastor, "pastor", "person", note, "another"),
    ).rejects.toThrow();
  });
  it("rechaza montos inválidos, cambios sin resumen y resumen falsificado", async () => {
    await saveTransaction(db, "finance", "one", input);
    await assertFails(
      updateDoc(doc(db, "financeTransactions", "one"), {
        amount: 1,
        revision: 2,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(db, "financeMonthlySummaries", "2026-08"), {
        incomeTotal: 999999,
        result: 999999,
        updatedAt: serverTimestamp(),
      }),
    );
    for (const amount of [0, -1, 1.5, Number.NaN])
      await expect(
        saveTransaction(db, "finance", `invalid${amount}`, {
          ...input,
          amount,
        }),
      ).rejects.toThrow();
    const b = writeBatch(db);
    b.update(doc(db, "financeTransactions", "one"), {
      amount: 1.5,
      revision: 2,
      updatedAt: serverTimestamp(),
    });
    b.update(doc(db, "financeMonthlySummaries", "2026-08"), {
      incomeTotal: 1.5,
      result: 1.5,
      updatedAt: serverTimestamp(),
    });
    await assertFails(b.commit());
  });
  it("doble envío y edición obsoleta no duplican totales", async () => {
    await saveTransaction(db, "finance", "one", input);
    const before = await transaction();
    await expect(
      saveTransaction(db, "finance", "one", input),
    ).rejects.toThrow();
    await saveTransaction(
      db,
      "finance",
      "one",
      { ...input, amount: 12000 },
      { existing: before },
    );
    await expect(
      saveTransaction(
        db,
        "finance",
        "one",
        { ...input, amount: 13000 },
        { existing: before },
      ),
    ).rejects.toThrow();
    expect(
      (await getDoc(doc(db, "financeMonthlySummaries", "2026-08"))).data()!
        .incomeTotal,
    ).toBe(12000);
  });
});

it("rechaza escrituras manipuladas aunque un cliente omita las validaciones de React", async () => {
  await saveTransaction(db, "finance", "one", input);
  const t = (await getDoc(doc(db, "financeTransactions", "one"))).data()!;
  const s = (
    await getDoc(doc(db, "financeMonthlySummaries", "2026-08"))
  ).data()!;
  for (const amount of [0, -500, 1.5]) {
    const batch = writeBatch(db);
    batch.set(doc(db, "financeTransactions", "one"), {
      ...t,
      amount,
      revision: 2,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, "financeMonthlySummaries", "2026-08"), {
      ...s,
      incomeTotal: amount,
      result: amount,
      incomeByCategory: { Ofrendas: amount },
      dailyIncome: { "10": amount },
      updatedAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  }
  const forged = writeBatch(db);
  forged.set(doc(db, "financeTransactions", "one"), {
    ...t,
    amount: 12000,
    revision: 2,
    updatedAt: serverTimestamp(),
  });
  forged.set(doc(db, "financeMonthlySummaries", "2026-08"), {
    ...s,
    incomeTotal: 12000,
    result: 12000,
    incomeByCategory: { Ofrendas: 11000, Donaciones: 1000 },
    dailyIncome: { "10": 12000 },
    updatedAt: serverTimestamp(),
  });
  await assertFails(forged.commit());
  await assertFails(
    updateDoc(doc(db, "financeMonthlySummaries", "2026-08"), {
      privateName: "No debe llegar al líder",
    }),
  );
});
it("diezmo y resumen sin atribución privada no se pueden guardar", async () => {
  await saveTransaction(db, "finance", "one", input);
  const t = (await getDoc(doc(db, "financeTransactions", "one"))).data()!;
  const s = (
    await getDoc(doc(db, "financeMonthlySummaries", "2026-08"))
  ).data()!;
  const batch = writeBatch(db);
  batch.set(doc(db, "financeTransactions", "orphan"), {
    ...t,
    source: "tithe",
    category: "Diezmos",
    description: "Diezmo",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, "financeMonthlySummaries", "2026-08"), {
    ...s,
    lastTransactionId: "orphan",
    incomeTotal: 20000,
    result: 20000,
    titheTotal: 10000,
    transactionCount: 2,
    incomeByCategory: { Ofrendas: 10000, Diezmos: 10000 },
    dailyIncome: { "10": 20000 },
    updatedAt: serverTimestamp(),
  });
  await assertFails(batch.commit());
  expect(
    (await getDoc(doc(db, "financeTransactions", "orphan"))).exists(),
  ).toBe(false);
});
it("dos altas concurrentes mantienen el total exacto", async () => {
  await Promise.all([
    saveTransaction(db, "finance", "a", input),
    saveTransaction(db, "finance", "b", { ...input, amount: 5000 }),
  ]);
  const s = (
    await getDoc(doc(db, "financeMonthlySummaries", "2026-08"))
  ).data()!;
  expect(s.incomeTotal).toBe(15000);
  expect(s.transactionCount).toBe(2);
});
it.each(["admin", "pastor", "finance"])(
  "%s puede operar; leader no puede escribir",
  async (role) => {
    const allowed = env
      .authenticatedContext(role)
      .firestore() as unknown as Firestore;
    await assertSucceeds(saveTransaction(allowed, role, "one", input));
    const leader = env
      .authenticatedContext("leader")
      .firestore() as unknown as Firestore;
    await assertFails(saveTransaction(leader, "leader", "two", input));
  },
);
it("no se puede crear una nota y revocar consentimiento en el mismo lote", async () => {
  await saveProfile(db, "finance", profile, undefined, "person");
  const pastor = env.authenticatedContext("pastor").firestore();
  const b = writeBatch(pastor);
  b.update(doc(pastor, "titheProfiles", "person"), {
    pastoralContactAuthorized: false,
    updatedAt: serverTimestamp(),
    updatedBy: "pastor",
  });
  b.set(doc(pastor, "pastoralFollowups", "note"), {
    profileId: "person",
    date: Timestamp.now(),
    note: "Sin consentimiento al confirmar",
    status: "pending",
    nextFollowUpDate: "",
    createdBy: "pastor",
    updatedBy: "pastor",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await assertFails(b.commit());
});

it("solo admin administra Configuración y puede actualizar a otro usuario", async () => {
  const admin = env.authenticatedContext("admin").firestore();
  await assertSucceeds(
    setDoc(doc(admin, "appSettings", "finance"), financeSettings("admin")),
  );
  for (const role of ["pastor", "finance", "leader"]) {
    const context = env.authenticatedContext(role).firestore();
    await assertFails(
      setDoc(doc(context, "appSettings", "finance"), financeSettings(role)),
    );
  }
  await assertSucceeds(
    updateDoc(doc(admin, "users", "finance"), {
      displayName: "Finanzas actualizado",
      role: "leader",
      active: false,
    }),
  );
  await assertFails(
    updateDoc(doc(admin, "users", "admin"), { role: "finance" }),
  );
  await assertFails(updateDoc(doc(admin, "users", "admin"), { active: false }));
});

it("Cafetería funciona para ingresos y gastos sin documento de settings", async () => {
  await assertSucceeds(
    saveTransaction(db, "finance", "cafe-income", {
      ...input,
      category: "Cafetería",
    }),
  );
  await assertSucceeds(
    saveTransaction(db, "finance", "cafe-expense", {
      ...input,
      type: "expense",
      category: "Cafetería",
    }),
  );
});

it("una categoría inactiva no sirve para altas y conserva históricos", async () => {
  await saveTransaction(db, "finance", "historical", input);
  const admin = env.authenticatedContext("admin").firestore();
  await setDoc(
    doc(admin, "appSettings", "finance"),
    financeSettings("admin", {
      incomeCategoriesActive: FALLBACK_INCOME_CATEGORIES.filter(
        (category) => category !== "Ofrendas",
      ),
    }),
  );
  await assertFails(saveTransaction(db, "finance", "new-inactive", input));

  const historical = await transaction("historical");
  await assertSucceeds(
    saveTransaction(
      db,
      "finance",
      "historical",
      { ...transactionInput(historical), amount: 12000 },
      { existing: historical },
    ),
  );
  expect((await transaction("historical")).category).toBe("Ofrendas");
  expect(
    (await getDoc(doc(db, "financeMonthlySummaries", "2026-08"))).data()!
      .incomeByCategory.Ofrendas,
  ).toBe(12000);
});

it("el universo histórico de categorías es append-only", async () => {
  const admin = env.authenticatedContext("admin").firestore();
  await setDoc(
    doc(admin, "appSettings", "finance"),
    financeSettings("admin", {
      incomeCategoriesAll: [
        ...FALLBACK_INCOME_CATEGORIES,
        "Categoría histórica",
      ],
      incomeCategoriesActive: FALLBACK_INCOME_CATEGORIES,
    }),
  );
  await assertFails(
    setDoc(doc(admin, "appSettings", "finance"), financeSettings("admin")),
  );
});
