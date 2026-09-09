"use client";

import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type Firestore,
  type Timestamp,
} from "firebase/firestore";
import { getFirebaseServices } from "@/lib/firebase";
import { errorMessage } from "@/lib/finance/formatters";

export interface Campaign {
  id: string;
  slug: string;
  title: string;
  description: string;
  goalAmount: number;
  verifiedAmount: number;
  lifetimeVerifiedAmount: number;
  contributionCount: number;
  currentInstallment: number;
  totalInstallments: number;
  transferInstructions: string;
  isPublic: boolean;
  status: "active" | "closed";
  createdBy: string;
  createdAt: Timestamp | null;
  updatedBy: string;
  updatedAt: Timestamp | null;
}

export interface CampaignContribution {
  id: string;
  campaignId: string;
  name: string;
  amount: number;
  date: string;
  paymentMethod: "cash" | "transfer" | "card" | "other";
  note: string;
  publicName: boolean;
  source: "manual" | "public";
  status: "pending" | "approved" | "rejected";
  installmentNumber: number;
  receiptPath: string;
  createdBy: string;
  createdAt: Timestamp | null;
  reviewedBy: string;
  reviewedAt: Timestamp | null;
}

export function campaignSlug(title: string) {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

export function campaignProgress(campaign: Campaign) {
  if (!campaign.goalAmount) return 0;

  return Math.min(
    100,
    Math.max(
      0,
      (campaign.verifiedAmount / campaign.goalAmount) * 100,
    ),
  );
}

export function useCampaigns() {
  const [state, setState] = useState<{
    data: Campaign[];
    loading: boolean;
    error: string;
  }>({
    data: [],
    loading: true,
    error: "",
  });

  useEffect(() => {
    return onSnapshot(
      query(
        collection(getFirebaseServices().db, "fundraisingCampaigns"),
        orderBy("title"),
      ),
      (snapshot) => {
        setState({
          data: snapshot.docs.map(
            (item) =>
              ({
                id: item.id,
                ...item.data(),
              }) as Campaign,
          ),
          loading: false,
          error: "",
        });
      },
      (error) =>
        setState({
          data: [],
          loading: false,
          error: errorMessage(error),
        }),
    );
  }, []);

  return state;
}

export function useCampaignContributions(campaignId: string) {
  const [state, setState] = useState<{
    data: CampaignContribution[];
    loading: boolean;
    error: string;
  }>({
    data: [],
    loading: true,
    error: "",
  });

  useEffect(() => {
    if (!campaignId) return;

    return onSnapshot(
      query(
        collection(getFirebaseServices().db, "campaignContributions"),
        where("campaignId", "==", campaignId),
      ),
      (snapshot) => {
        const data = snapshot.docs
          .map(
            (item) =>
              ({
                id: item.id,
                ...item.data(),
              }) as CampaignContribution,
          )
          .sort((a, b) => {
            const ta = a.createdAt?.toMillis?.() ?? 0;
            const tb = b.createdAt?.toMillis?.() ?? 0;
            return tb - ta;
          });

        setState({
          data,
          loading: false,
          error: "",
        });
      },
      (error) =>
        setState({
          data: [],
          loading: false,
          error: errorMessage(error),
        }),
    );
  }, [campaignId]);

  if (!campaignId) {
    return {
      data: [],
      loading: false,
      error: "",
    };
  }

  return state;
}

export async function createCampaign(
  db: Firestore,
  uid: string,
  input: {
    title: string;
    description: string;
    goalAmount: number;
    currentInstallment: number;
    totalInstallments: number;
    transferInstructions: string;
  },
) {
  const title = input.title.trim().replace(/\s+/g, " ");
  const description = input.description.trim();
  const transferInstructions = input.transferInstructions.trim();

  if (!title || title.length > 120) {
    throw new Error("Ingresa un nombre válido para la campaña.");
  }

  if (!Number.isInteger(input.goalAmount) || input.goalAmount <= 0) {
    throw new Error("La meta debe ser un monto válido en pesos.");
  }

  if (
    input.currentInstallment < 0 ||
    input.totalInstallments < 0 ||
    input.currentInstallment > input.totalInstallments
  ) {
    throw new Error("Revisa la configuración de cuotas.");
  }

  const slug = campaignSlug(title);

  if (!slug) {
    throw new Error("No pudimos generar un identificador para la campaña.");
  }

  const ref = doc(db, "fundraisingCampaigns", slug);

  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(ref);

    if (existing.exists()) {
      throw new Error(
        "Ya existe una campaña con un nombre similar.",
      );
    }

    transaction.set(ref, {
      slug,
      title,
      description,
      goalAmount: input.goalAmount,
      verifiedAmount: 0,
      lifetimeVerifiedAmount: 0,
      contributionCount: 0,
      currentInstallment: input.currentInstallment,
      totalInstallments: input.totalInstallments,
      transferInstructions,
      isPublic: true,
      status: "active",
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
  });

  return slug;
}

export async function addManualContribution(
  db: Firestore,
  uid: string,
  campaign: Campaign,
  input: {
    name: string;
    amount: number;
    date: string;
    paymentMethod: CampaignContribution["paymentMethod"];
    note: string;
  },
) {
  const name =
    input.name.trim().replace(/\s+/g, " ") || "Aporte anónimo";

  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("Ingresa un monto válido.");
  }

  if (!input.date) {
    throw new Error("Selecciona la fecha del aporte.");
  }

  const contributionRef = doc(
    collection(db, "campaignContributions"),
  );

  const campaignRef = doc(
    db,
    "fundraisingCampaigns",
    campaign.id,
  );

  await runTransaction(db, async (transaction) => {
    const campaignSnapshot = await transaction.get(campaignRef);

    if (!campaignSnapshot.exists()) {
      throw new Error("La campaña ya no existe.");
    }

    const current = campaignSnapshot.data() as Campaign;

    if (current.status !== "active") {
      throw new Error("La campaña está cerrada.");
    }

    transaction.set(contributionRef, {
      campaignId: campaign.id,
      name,
      amount: input.amount,
      date: input.date,
      paymentMethod: input.paymentMethod,
      note: input.note.trim(),
      publicName: false,
      source: "manual",
      status: "approved",
      installmentNumber: current.currentInstallment,
      receiptPath: "",
      createdBy: uid,
      createdAt: serverTimestamp(),
      reviewedBy: uid,
      reviewedAt: serverTimestamp(),
    });

    transaction.update(campaignRef, {
      verifiedAmount:
        current.verifiedAmount + input.amount,
      lifetimeVerifiedAmount:
        current.lifetimeVerifiedAmount + input.amount,
      contributionCount:
        current.contributionCount + 1,
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
  });
}
