"use client";

import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
  type Timestamp,
} from "firebase/firestore";
import { getFirebaseServices } from "@/lib/firebase";
import { errorMessage } from "@/lib/finance/formatters";
import type { Campaign } from "./client";

export interface PublicCampaign {
  id: string;
  slug: string;
  title: string;
  description: string;
  goalAmount: number;
  verifiedAmount: number;
  contributionCount: number;
  currentInstallment: number;
  totalInstallments: number;
  transferInstructions: string;
  isPublic: boolean;
  status: "active" | "closed";
  updatedAt: Timestamp | null;
}

export interface CampaignSubmission {
  id: string;
  campaignId: string;
  name: string;
  amount: number;
  date: string;
  paymentMethod: "transfer";
  note: string;
  publicName: boolean;
  receiptPath: string;
  status: "pending" | "approved" | "rejected";
  createdAt: Timestamp | null;
  reviewedBy?: string;
  reviewedAt?: Timestamp | null;
}

function publicData(campaign: Campaign) {
  return {
    slug: campaign.slug,
    title: campaign.title,
    description: campaign.description,
    goalAmount: campaign.goalAmount,
    verifiedAmount: campaign.verifiedAmount,
    contributionCount: campaign.contributionCount,
    currentInstallment: campaign.currentInstallment,
    totalInstallments: campaign.totalInstallments,
    transferInstructions: campaign.transferInstructions,
    isPublic: campaign.isPublic,
    status: campaign.status,
    updatedAt: serverTimestamp(),
  };
}

export async function syncPublicCampaignView(
  db: Firestore,
  campaign: Campaign,
) {
  await setDoc(
    doc(db, "campaignPublicViews", campaign.slug),
    publicData(campaign),
  );
}

export function usePublicCampaign(slug: string) {
  const [state, setState] = useState<{
    data: PublicCampaign | null;
    loading: boolean;
    error: string;
  }>({
    data: null,
    loading: true,
    error: "",
  });

  useEffect(() => {
    if (!slug) {
      setState({
        data: null,
        loading: false,
        error: "Campaña no encontrada.",
      });
      return;
    }

    return onSnapshot(
      doc(getFirebaseServices().db, "campaignPublicViews", slug),
      (snapshot) => {
        setState({
          data: snapshot.exists()
            ? ({
                id: snapshot.id,
                ...snapshot.data(),
              } as PublicCampaign)
            : null,
          loading: false,
          error: snapshot.exists()
            ? ""
            : "Esta campaña no está disponible públicamente.",
        });
      },
      (error) =>
        setState({
          data: null,
          loading: false,
          error: errorMessage(error),
        }),
    );
  }, [slug]);

  return state;
}

export async function submitPublicContribution(
  db: Firestore,
  campaignId: string,
  input: {
    name: string;
    amount: number;
    date: string;
    publicName: boolean;
    note: string;
  },
) {
  const name = input.name.trim().replace(/\s+/g, " ");

  if (!name || name.length > 120) {
    throw new Error("Ingresa tu nombre.");
  }

  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("Ingresa un monto válido.");
  }

  if (!input.date) {
    throw new Error("Selecciona la fecha del depósito.");
  }

  await addDoc(collection(db, "campaignSubmissions"), {
    campaignId,
    name,
    amount: input.amount,
    date: input.date,
    paymentMethod: "transfer",
    note: input.note.trim(),
    publicName: input.publicName,
    receiptPath: "",
    status: "pending",
    createdAt: serverTimestamp(),
  });
}

export function useCampaignSubmissions(campaignId: string) {
  const [state, setState] = useState<{
    data: CampaignSubmission[];
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
        collection(getFirebaseServices().db, "campaignSubmissions"),
        where("campaignId", "==", campaignId),
      ),
      (snapshot) => {
        const data = snapshot.docs
          .map(
            (item) =>
              ({
                id: item.id,
                ...item.data(),
              }) as CampaignSubmission,
          )
          .sort(
            (a, b) =>
              (b.createdAt?.toMillis?.() ?? 0) -
              (a.createdAt?.toMillis?.() ?? 0),
          );

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

  return state;
}

export async function reviewCampaignSubmission(
  db: Firestore,
  uid: string,
  campaignId: string,
  submissionId: string,
  decision: "approved" | "rejected",
) {
  const campaignRef = doc(
    db,
    "fundraisingCampaigns",
    campaignId,
  );

  const publicRef = doc(
    db,
    "campaignPublicViews",
    campaignId,
  );

  const submissionRef = doc(
    db,
    "campaignSubmissions",
    submissionId,
  );

  const contributionRef = doc(
    collection(db, "campaignContributions"),
  );

  await runTransaction(db, async (transaction) => {
    const [campaignSnapshot, submissionSnapshot] =
      await Promise.all([
        transaction.get(campaignRef),
        transaction.get(submissionRef),
      ]);

    if (!campaignSnapshot.exists()) {
      throw new Error("La campaña ya no existe.");
    }

    if (!submissionSnapshot.exists()) {
      throw new Error("El aporte ya no existe.");
    }

    const campaign = {
      id: campaignSnapshot.id,
      ...campaignSnapshot.data(),
    } as Campaign;

    const submission = {
      id: submissionSnapshot.id,
      ...submissionSnapshot.data(),
    } as CampaignSubmission;

    if (submission.status !== "pending") {
      throw new Error("Este aporte ya fue revisado.");
    }

    if (decision === "rejected") {
      transaction.update(submissionRef, {
        status: "rejected",
        reviewedBy: uid,
        reviewedAt: serverTimestamp(),
      });

      return;
    }

    const verifiedAmount =
      campaign.verifiedAmount + submission.amount;

    const contributionCount =
      campaign.contributionCount + 1;

    transaction.set(contributionRef, {
      campaignId: campaign.id,
      name: submission.name,
      amount: submission.amount,
      date: submission.date,
      paymentMethod: "transfer",
      note: submission.note,
      publicName: submission.publicName,
      source: "public",
      status: "approved",
      installmentNumber: campaign.currentInstallment,
      receiptPath: submission.receiptPath,
      createdBy: uid,
      createdAt: serverTimestamp(),
      reviewedBy: uid,
      reviewedAt: serverTimestamp(),
    });

    transaction.update(campaignRef, {
      verifiedAmount,
      lifetimeVerifiedAmount:
        campaign.lifetimeVerifiedAmount +
        submission.amount,
      contributionCount,
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });

    transaction.set(publicRef, {
      ...publicData({
        ...campaign,
        verifiedAmount,
        contributionCount,
      }),
    });

    transaction.update(submissionRef, {
      status: "approved",
      reviewedBy: uid,
      reviewedAt: serverTimestamp(),
    });
  });
}
