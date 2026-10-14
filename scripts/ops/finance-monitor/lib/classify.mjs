// Clasificación de escrituras (gap f): no solo por updatedBy.
// Combina createdBy, updatedBy, prefijo del id, revision y createTime == updateTime,
// con la misma definición de "creación SumUp legítima" que el snapshot R0G.
export const SYSTEM_ACTOR = "system:sumup";
export const SUMUP_ID = /^sumup_(offerings|cafeteria)_/;
export const SUMUP_CATEGORY = { offerings: "Ofrendas", cafeteria: "Cafetería" };

/**
 * "sumup-creation" | "sumup-mutation" | "system-foreign-doc" | "human-on-sumup-doc"
 * | "human-creation" | "human-edit"
 */
export function classifyWrite(t) {
  const [, account] = SUMUP_ID.exec(String(t.id)) || [];
  const pristine = !!t.createTime && t.createTime === t.updateTime && Number(t.revision ?? 1) === 1;
  const systemTouched = t.createdBy === SYSTEM_ACTOR || t.updatedBy === SYSTEM_ACTOR;
  if (systemTouched && !account) return "system-foreign-doc";
  if (t.updatedBy === SYSTEM_ACTOR) {
    const legit = pristine && t.createdBy === SYSTEM_ACTOR && t.status === "active" && t.category === SUMUP_CATEGORY[account];
    return legit ? "sumup-creation" : "sumup-mutation";
  }
  if (account) return "human-on-sumup-doc";
  return pristine ? "human-creation" : "human-edit";
}

export const isHumanClass = (c) => c.startsWith("human");
