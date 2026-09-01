import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/lib/finance/constants";
import type { TransactionType } from "@/lib/finance/types";

export const MAX_CATEGORY_LENGTH = 80;
export const MAX_CATEGORIES_PER_TYPE = 100;

export const FALLBACK_INCOME_CATEGORIES = [
  ...INCOME_CATEGORIES,
  "Cafetería",
] as string[];

export const FALLBACK_EXPENSE_CATEGORIES = [
  ...EXPENSE_CATEGORIES,
  "Cafetería",
] as string[];

export interface FinanceSettings {
  incomeCategoriesAll: string[];
  incomeCategoriesActive: string[];
  expenseCategoriesAll: string[];
  expenseCategoriesActive: string[];
}

export const FALLBACK_FINANCE_SETTINGS: FinanceSettings = {
  incomeCategoriesAll: FALLBACK_INCOME_CATEGORIES,
  incomeCategoriesActive: FALLBACK_INCOME_CATEGORIES,
  expenseCategoriesAll: FALLBACK_EXPENSE_CATEGORIES,
  expenseCategoriesActive: FALLBACK_EXPENSE_CATEGORIES,
};

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" &&
          item.length > 0 &&
          item.length <= MAX_CATEGORY_LENGTH,
      )
    : [];
}

function unique(items: string[]) {
  return [...new Set(items)];
}

function categoryKey(value: string) {
  return normalizeCategoryName(value).toLocaleLowerCase("es-CL");
}

function mergeKnown(defaults: string[], configured: unknown) {
  const result = [...defaults];
  const keys = new Set(result.map(categoryKey));
  for (const category of strings(configured)) {
    const key = categoryKey(category);
    if (!keys.has(key)) {
      result.push(category);
      keys.add(key);
    }
  }
  return result;
}

function activeCategories(
  known: string[],
  configured: unknown,
  fallback: string[],
) {
  if (!Array.isArray(configured)) return [...fallback];
  const activeKeys = new Set(strings(configured).map(categoryKey));
  return known.filter((category) => activeKeys.has(categoryKey(category)));
}

export function resolveFinanceSettings(value: unknown): FinanceSettings {
  const data =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const incomeCategoriesAll = mergeKnown(
    FALLBACK_INCOME_CATEGORIES,
    data.incomeCategoriesAll,
  );
  const expenseCategoriesAll = mergeKnown(
    FALLBACK_EXPENSE_CATEGORIES,
    data.expenseCategoriesAll,
  );
  return {
    incomeCategoriesAll,
    incomeCategoriesActive: activeCategories(
      incomeCategoriesAll,
      data.incomeCategoriesActive,
      FALLBACK_INCOME_CATEGORIES,
    ),
    expenseCategoriesAll,
    expenseCategoriesActive: activeCategories(
      expenseCategoriesAll,
      data.expenseCategoriesActive,
      FALLBACK_EXPENSE_CATEGORIES,
    ),
  };
}

export function normalizeCategoryName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function categoriesForType(
  settings: FinanceSettings,
  type: TransactionType,
  activeOnly: boolean,
) {
  if (type === "income")
    return activeOnly
      ? settings.incomeCategoriesActive
      : settings.incomeCategoriesAll;
  return activeOnly
    ? settings.expenseCategoriesActive
    : settings.expenseCategoriesAll;
}

export function categoriesForTransaction(
  settings: FinanceSettings,
  type: TransactionType,
  existingCategory?: string,
) {
  const active = [...categoriesForType(settings, type, true)];
  if (
    existingCategory &&
    !active.some(
      (category) => categoryKey(category) === categoryKey(existingCategory),
    )
  )
    active.unshift(existingCategory);
  return unique(active);
}

export function validateNewCategory(
  settings: FinanceSettings,
  type: TransactionType,
  value: string,
) {
  const name = normalizeCategoryName(value);
  if (!name) throw new Error("Escribe el nombre de la categoría.");
  if (name.length > MAX_CATEGORY_LENGTH)
    throw new Error(
      `La categoría admite hasta ${MAX_CATEGORY_LENGTH} caracteres.`,
    );
  if (name.toLocaleLowerCase("es-CL") === "diezmos")
    throw new Error("Diezmos es una categoría reservada del sistema.");
  const known = categoriesForType(settings, type, false);
  if (known.length >= MAX_CATEGORIES_PER_TYPE)
    throw new Error("Se alcanzó el máximo de categorías para este tipo.");
  if (known.some((category) => categoryKey(category) === categoryKey(name)))
    throw new Error("Ya existe una categoría con ese nombre.");
  return name;
}
