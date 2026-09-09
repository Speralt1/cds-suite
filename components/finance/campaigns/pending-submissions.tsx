"use client";

import { useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-provider";
import { getFirebaseServices } from "@/lib/firebase";
import { clp, errorMessage } from "@/lib/finance/formatters";
import type { Campaign } from "@/lib/campaigns/client";
import { ReceiptPreviewButton } from "./receipt-preview-button";
import {
  reviewCampaignSubmission,
  useCampaignSubmissions,
} from "@/lib/campaigns/public-client";

export function PendingCampaignSubmissions({
  campaign,
}: {
  campaign: Campaign;
}) {
  const { user } = useAuth();
  const submissions = useCampaignSubmissions(campaign.id);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const pending = useMemo(
    () =>
      submissions.data.filter(
        (item) => item.status === "pending",
      ),
    [submissions.data],
  );


  async function review(
    id: string,
    decision: "approved" | "rejected",
  ) {
    if (!user || busy) return;

    setBusy(id);
    setError("");

    try {
      await reviewCampaignSubmission(
        getFirebaseServices().db,
        user.uid,
        campaign.id,
        id,
        decision,
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="mt-8">
      <div className="section-heading">
        <div>
          <h2>Aportes pendientes</h2>
          <p>
            Transferencias informadas desde el link público.
          </p>
        </div>

        {pending.length > 0 && (
          <span className="status-pill">
            {pending.length} pendiente
            {pending.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {(error || submissions.error) && (
        <p className="notice error">
          {error || submissions.error}
        </p>
      )}

      {!submissions.loading && pending.length === 0 ? (
        <div className="empty-state">
          No hay aportes pendientes de revisión.
        </div>
      ) : (
        <div className="campaign-contributions">
          {pending.map((item) => (
            <div
              key={item.id}
              className="campaign-pending-row"
            >
              <div>
                <strong>{item.name}</strong>
                <p>
                  {item.date} · Transferencia
                </p>

                {item.note && (
                  <p className="campaign-pending-note">
                    {item.note}
                  </p>
                )}

                {item.receiptPath && (
                  <ReceiptPreviewButton
                    receiptPath={item.receiptPath}
                  />
                )}
              </div>

              <strong className="campaign-pending-amount">
                {clp(item.amount)}
              </strong>

              <div className="campaign-pending-actions">
                <button
                  type="button"
                  className="button-secondary"
                  disabled={!!busy}
                  onClick={() =>
                    void review(item.id, "rejected")
                  }
                >
                  <X size={16} />
                  Rechazar
                </button>

                <button
                  type="button"
                  className="button-primary"
                  disabled={!!busy}
                  onClick={() =>
                    void review(item.id, "approved")
                  }
                >
                  <Check size={16} />
                  Aprobar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
