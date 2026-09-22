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

export type SumUpSyncStatus =
  | "completed"
  | "partial"
  | "already_running"
  | "skipped_locked"
  | "abandoned"
  | "failed";

export type SumUpSyncErrorClass =
  | "auth_error"
  | "rate_limited"
  | "provider_client_error"
  | "provider_unavailable"
  | "config_error";

export interface SumUpSyncCounts {
  fetched: number;
  created: number;
  updated: number;
  voided: number;
  reactivated: number;
  unchanged: number;
  review: number;
  chargebacks: number;
  ignored: Record<string, number>;
}

export interface SumUpSyncAccountResult {
  account: SumUpAccount;
  runId: string | null;
  status: SumUpSyncStatus;
  counts: SumUpSyncCounts;
  errorClass: SumUpSyncErrorClass | null;
}

export interface SumUpSyncResponse {
  ok: boolean;
  results: SumUpSyncAccountResult[];
}

/** Response is always JSON from the backend (S1.7). A non-JSON body only
 *  happens if the request never reached the function (proxy/network layer),
 *  so we never surface that raw text to the person using the app. */
export async function requestSumUpSync(user: User): Promise<SumUpSyncResponse> {
  const token = await user.getIdToken();
  const response = await fetch(
    "/api/sumup-sync",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    },
  );
  const raw = await response.text();
  let body: Partial<SumUpSyncResponse> & { error?: string } = {};
  let parsed = false;

  try {
    if (raw) {
      body = JSON.parse(raw) as Partial<SumUpSyncResponse> & { error?: string };
      parsed = true;
    }
  } catch {
    body = {};
  }

  if (!response.ok) {
    const backendError = typeof body.error === "string" ? body.error : "";
    throw new Error(
      backendError ||
        (parsed
          ? `No se pudo sincronizar SumUp (HTTP ${response.status}).`
          : `No se pudo contactar el servicio de sincronización (HTTP ${response.status}).`),
    );
  }

  if (!parsed || !Array.isArray(body.results)) {
    throw new Error("La sincronización respondió con un formato inesperado.");
  }

  return { ok: body.ok !== false, results: body.results };
}

const SYNC_STATUS_LABEL: Record<SumUpSyncStatus, string> = {
  completed: "Completado",
  partial: "Parcial — continúa automáticamente",
  already_running: "Ya en curso",
  skipped_locked: "Ya en curso",
  abandoned: "Interrumpido — se reintentará",
  failed: "Error",
};

const SYNC_ERROR_CLASS_LABEL: Record<SumUpSyncErrorClass, string> = {
  auth_error: "credenciales inválidas",
  rate_limited: "límite de solicitudes de SumUp",
  provider_client_error: "solicitud rechazada por SumUp",
  provider_unavailable: "SumUp no respondió a tiempo",
  config_error: "configuración de la cuenta",
};

const SYNC_ACCOUNT_LABEL: Record<SumUpAccount, string> = {
  offerings: "Ofrendas",
  cafeteria: "Cafetería",
};

/** Turns one account's sync result into a short, human Spanish status line. Never HTML, never raw backend text. */
export function describeSumUpSyncResult(result: SumUpSyncAccountResult): string {
  const label = SYNC_STATUS_LABEL[result.status] || "Estado desconocido";
  const account = SYNC_ACCOUNT_LABEL[result.account] || result.account;
  if (result.status === "failed" && result.errorClass) {
    return `${account}: error — ${SYNC_ERROR_CLASS_LABEL[result.errorClass] || "error desconocido"}.`;
  }
  if (result.status === "completed") {
    const total = result.counts.created + result.counts.updated + result.counts.voided + result.counts.reactivated;
    return `${account}: ${label} · ${total} cambios de ${result.counts.fetched} revisados.`;
  }
  return `${account}: ${label}.`;
}
