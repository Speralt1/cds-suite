"use client";

import { useEffect, useState } from "react";
import {
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import { getFirebaseServices } from "@/lib/firebase";
import { errorMessage } from "@/lib/finance/formatters";
import type { TransactionType } from "@/lib/finance/types";
import {
  FALLBACK_FINANCE_SETTINGS,
  categoriesForType,
  resolveFinanceSettings,
  validateNewCategory,
  type FinanceSettings,
} from "./finance-settings";

export interface FinanceSettingsState {
  data: FinanceSettings;
  exists: boolean;
  loading: boolean;
  error: string;
}

export function useFinanceSettings(): FinanceSettingsState {
  const [state, setState] = useState<FinanceSettingsState>({
    data: FALLBACK_FINANCE_SETTINGS,
    exists: false,
    loading: true,
    error: "",
  });
  useEffect(
    () =>
      onSnapshot(
        doc(getFirebaseServices().db, "appSettings", "finance"),
        { includeMetadataChanges: true },
        (snapshot) =>
          setState({
            data: resolveFinanceSettings(
              snapshot.exists() ? snapshot.data() : undefined,
            ),
            exists: snapshot.exists(),
            loading: false,
            error: "",
          }),
        (error) =>
          setState((current) => ({
            ...current,
            loading: false,
            error: errorMessage(error),
          })),
      ),
    [],
  );
  return state;
}

async function changeSettings(
  db: Firestore,
  uid: string,
  update: (settings: FinanceSettings) => FinanceSettings,
) {
  const ref = doc(db, "appSettings", "finance");
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    const settings = update(
      resolveFinanceSettings(snapshot.exists() ? snapshot.data() : undefined),
    );
    transaction.set(ref, {
      schemaVersion: 1,
      ...settings,
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function initializeFinanceSettings(db: Firestore, uid: string) {
  return changeSettings(db, uid, (settings) => settings);
}

export async function addFinanceCategory(
  db: Firestore,
  uid: string,
  type: TransactionType,
  value: string,
) {
  return changeSettings(db, uid, (settings) => {
    const name = validateNewCategory(settings, type, value);
    if (type === "income")
      return {
        ...settings,
        incomeCategoriesAll: [...settings.incomeCategoriesAll, name],
        incomeCategoriesActive: [...settings.incomeCategoriesActive, name],
      };
    return {
      ...settings,
      expenseCategoriesAll: [...settings.expenseCategoriesAll, name],
      expenseCategoriesActive: [...settings.expenseCategoriesActive, name],
    };
  });
}

export async function setFinanceCategoryActive(
  db: Firestore,
  uid: string,
  type: TransactionType,
  name: string,
  active: boolean,
) {
  return changeSettings(db, uid, (settings) => {
    const known = categoriesForType(settings, type, false);
    if (!known.includes(name)) throw new Error("La categoría ya no existe.");
    const current = categoriesForType(settings, type, true);
    const next = active
      ? [...new Set([...current, name])]
      : current.filter((category) => category !== name);
    if (!next.length)
      throw new Error("Debe quedar al menos una categoría activa.");
    return type === "income"
      ? { ...settings, incomeCategoriesActive: next }
      : { ...settings, expenseCategoriesActive: next };
  });
}
