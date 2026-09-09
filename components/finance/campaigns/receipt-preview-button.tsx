"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import { getBlob, ref } from "firebase/storage";
import { getFirebaseServices } from "@/lib/firebase";
import { errorMessage } from "@/lib/finance/formatters";
import { Modal } from "@/components/finance/shared";

export function ReceiptPreviewButton({
  receiptPath,
}: {
  receiptPath: string;
}) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function openReceipt() {
    if (!receiptPath || loading) return;

    setLoading(true);
    setError("");

    try {
      const { storage } = getFirebaseServices();

      const blob = await getBlob(
        ref(storage, receiptPath),
      );

      const objectUrl =
        URL.createObjectURL(blob);

      setUrl(objectUrl);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  function closeReceipt() {
    if (url) {
      URL.revokeObjectURL(url);
    }

    setUrl("");
  }

  return (
    <>
      <button
        type="button"
        className="campaign-receipt-link"
        onClick={() => void openReceipt()}
        disabled={loading}
      >
        <Eye size={15} />
        {loading
          ? "Cargando…"
          : "Ver comprobante"}
      </button>

      {error && (
        <p className="notice error">
          {error}
        </p>
      )}

      {url && (
        <Modal
          title="Comprobante"
          onClose={closeReceipt}
        >
          <div className="campaign-receipt-preview">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt="Comprobante de transferencia"
            />
          </div>
        </Modal>
      )}
    </>
  );
}
