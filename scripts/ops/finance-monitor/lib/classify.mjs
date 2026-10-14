// Clasificación de escrituras (gap f): no solo por updatedBy.
// Combina createdBy, updatedBy, prefijo del id, revision y createTime == updateTime,
// con la misma definición de "creación SumUp legítima" que el snapshot R0G.
export const SYSTEM_ACTOR = "system:sumup";
export const SUMUP_ID = /^sumup_(offerings|cafeteria)_/;
export const SUMUP_CATEGORY = { offerings: "Ofrendas", cafeteria: "Cafetería" };
const SUMUP_PAYMENT_METHODS = new Set(["card", "cash"]);

/**
 * "sumup-creation" | "sumup-mutation" | "system-foreign-doc" | "human-on-sumup-doc"
 * | "human-creation" | "human-edit"
 */
export function classifyWrite(t) {
  const [, account] = SUMUP_ID.exec(String(t.id)) || [];
  // Sin valor por defecto: una revision ausente NO cuenta como 1.
  const pristine = !!t.createTime && t.createTime === t.updateTime && t.revision === 1;
  const systemTouched = t.createdBy === SYSTEM_ACTOR || t.updatedBy === SYSTEM_ACTOR;
  if (systemTouched && !account) return "system-foreign-doc";
  if (t.updatedBy === SYSTEM_ACTOR) {
    // Espejo de lo que escribe functions/sumup/engine.js al crear: ingreso general activo,
    // POS → card o CASH → cash, monto > 0, categoría de la cuenta, revision 1 sin modificar.
    const legit =
      pristine &&
      t.createdBy === SYSTEM_ACTOR &&
      t.status === "active" &&
      t.type === "income" &&
      t.source === "general" &&
      SUMUP_PAYMENT_METHODS.has(t.paymentMethod) &&
      Number.isInteger(t.amount) &&
      t.amount > 0 &&
      t.category === SUMUP_CATEGORY[account];
    return legit ? "sumup-creation" : "sumup-mutation";
  }
  if (account) return "human-on-sumup-doc";
  return pristine ? "human-creation" : "human-edit";
}

export const isHumanClass = (c) => c.startsWith("human");
