"use client";

import { useEffect, useState } from "react";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Timestamp,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { getFirebaseServices } from "@/lib/firebase";
import { errorMessage } from "@/lib/finance/formatters";

export type SumUpAccount = "offerings" | "cafeteria";

export interface GivingSettings {
  title: string;
  intro: string;
  transferEnabled: boolean;
  transferInstructions: string;
  onlineEnabled: boolean;
  onlineLabel: string;
  onlineUrl: string;
  updatedAt: Timestamp | null;
}

export interface SumUpIntegration {
  account: SumUpAccount;
  label: string;
  configured: boolean;
  merchantCode: string;
  lastSyncAt: Timestamp | null;
  lastSyncStatus: "ok" | "error";
  lastError: string;
  lastImportedCount: number;
}

export interface SumUpTransaction {
  id: string;
  account: SumUpAccount;
  transactionId: string;
  transactionCode: string;
  grossAmount: number;
  refundedAmount: number;
  netAmount: number;
  feeAmount: number;
  currency: string;
  timestamp: Timestamp | null;
  status: string;
  paymentType: string;
  cardType: string;
  entryMode: string;
  user: string;
  productSummary: string;
  syncedAt: Timestamp | null;
  financeTransactionId: string;
}

export function useGivingSettings() {
  const [state, setState] = useState<{
    data: GivingSettings | null;
    loading: boolean;
    error: string;
  }>({ data: null, loading: true, error: "" });

  useEffect(() =>
    onSnapshot(
      doc(getFirebaseServices().db, "publicGivingSettings", "current"),
      (snapshot) => setState({
        data: snapshot.exists() ? (snapshot.data() as GivingSettings) : null,
        loading: false,
        error: "",
      }),
      (error) => setState({ data: null, loading: false, error: errorMessage(error) }),
    ), []);

  return state;
}

export async function saveGivingSettings(input: Omit<GivingSettings, "updatedAt">) {
  const title = input.title.trim();
  const intro = input.intro.trim();
  const transferInstructions = input.transferInstructions.trim();
  const onlineLabel = input.onlineLabel.trim();
  const onlineUrl = input.onlineUrl.trim();

  if (!title) throw new Error("Ingresa un título.");
  if (input.onlineEnabled && !onlineUrl.startsWith("https://")) {
    throw new Error("El link de pago online debe comenzar con https://");
  }

  await setDoc(doc(getFirebaseServices().db, "publicGivingSettings", "current"), {
    title,
    intro,
    transferEnabled: input.transferEnabled,
    transferInstructions,
    onlineEnabled: input.onlineEnabled,
    onlineLabel,
    onlineUrl,
    updatedAt: serverTimestamp(),
  });
}

export function useSumUpIntegration(account: SumUpAccount) {
  const [state, setState] = useState<{
    data: SumUpIntegration | null;
    loading: boolean;
    error: string;
  }>({ data: null, loading: true, error: "" });

  useEffect(() =>
    onSnapshot(
      doc(getFirebaseServices().db, "sumupIntegrations", account),
      (snapshot) => setState({
        data: snapshot.exists() ? (snapshot.data() as SumUpIntegration) : null,
        loading: false,
        error: "",
      }),
      (error) => setState({ data: null, loading: false, error: errorMessage(error) }),
    ), [account]);

  return state;
}

export function useSumUpTransactions(account: SumUpAccount, max = 50) {
  const [state, setState] = useState<{
    data: SumUpTransaction[];
    loading: boolean;
    error: string;
  }>({ data: [], loading: true, error: "" });

  useEffect(() =>
    onSnapshot(
      query(
        collection(getFirebaseServices().db, "sumupIntegrations", account, "transactions"),
        orderBy("timestamp", "desc"),
        limit(max),
      ),
      (snapshot) => setState({
        data: snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as SumUpTransaction),
        loading: false,
        error: "",
      }),
      (error) => setState({ data: [], loading: false, error: errorMessage(error) }),
    ), [account, max]);

  return state;
}

export async function requestSumUpSync(user: User) {
  const token = await user.getIdToken();
  const response = await fetch(
    "https://southamerica-west1-cds-administracion.cloudfunctions.net/sumupSyncNow",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "SumUp todavía no está conectado. Ejecuta el configurador SumUp.");
  }
  return body;
}
