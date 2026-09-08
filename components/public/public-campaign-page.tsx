"use client";

import { useState } from "react";
import { Copy, CheckCircle2 } from "lucide-react";
import { usePathname } from "next/navigation";
import { getFirebaseServices } from "@/lib/firebase";
import {
  submitPublicContribution,
  usePublicCampaign,
} from "@/lib/campaigns/public-client";
import { clp, errorMessage, today } from "@/lib/finance/formatters";

export function PublicCampaignPage() {
  const pathname = usePathname();
  const slug =
    pathname.split("/").filter(Boolean)[1] || "";

  const campaign = usePublicCampaign(slug);

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [publicName, setPublicName] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  if (campaign.loading) {
    return (
      <main className="public-campaign-shell">
        <p>Cargando campaña…</p>
      </main>
    );
  }

  if (!campaign.data) {
    return (
      <main className="public-campaign-shell">
        <div className="public-campaign-card">
          <p className="eyebrow">CASA DE SALVACIÓN</p>
          <h1>Campaña no disponible</h1>
          <p>{campaign.error}</p>
        </div>
      </main>
    );
  }

  const data = campaign.data;

  const progress = data.goalAmount
    ? Math.min(
        100,
        (data.verifiedAmount / data.goalAmount) * 100,
      )
    : 0;

  const missing = Math.max(
    0,
    data.goalAmount - data.verifiedAmount,
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (busy) return;

    setBusy(true);
    setError("");
    setSuccess(false);

    try {
      await submitPublicContribution(
        getFirebaseServices().db,
        data.id,
        {
          name,
          amount: Number(amount),
          date,
          publicName,
          note,
        },
      );

      setName("");
      setAmount("");
      setNote("");
      setSuccess(true);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function copyTransferData() {
    if (!data.transferInstructions) return;

    await navigator.clipboard.writeText(
      data.transferInstructions,
    );

    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className="public-campaign-shell">
      <header className="public-campaign-brand">
        <div className="public-campaign-logo">CDS</div>
        <div>
          <strong>Casa de Salvación</strong>
          <span>Campaña de recursos</span>
        </div>
      </header>

      <section className="public-campaign-hero">
        <p className="eyebrow">
          {data.totalInstallments > 0
            ? `CUOTA ${data.currentInstallment} DE ${data.totalInstallments}`
            : "CAMPAÑA"}
        </p>

        <h1>{data.title}</h1>

        {data.description && <p>{data.description}</p>}

        <div className="public-campaign-total">
          <strong>{clp(data.verifiedAmount)}</strong>
          <span>
            recaudados de {clp(data.goalAmount)}
          </span>
        </div>

        <div className="public-progress">
          <span style={{ width: `${progress}%` }} />
        </div>

        <div className="public-progress-meta">
          <strong>
            {progress.toFixed(1).replace(".0", "")}%
          </strong>
          <span>Faltan {clp(missing)}</span>
        </div>

        <div className="public-campaign-stats">
          <div>
            <span>Meta</span>
            <strong>{clp(data.goalAmount)}</strong>
          </div>

          <div>
            <span>Recaudado</span>
            <strong>{clp(data.verifiedAmount)}</strong>
          </div>

          <div>
            <span>Aportes verificados</span>
            <strong>{data.contributionCount}</strong>
          </div>
        </div>
      </section>

      {data.transferInstructions && (
        <section className="public-campaign-card">
          <div className="public-section-heading">
            <div>
              <p className="eyebrow">APORTAR</p>
              <h2>Datos para transferencia</h2>
            </div>

            <button
              type="button"
              className="button-secondary"
              onClick={copyTransferData}
            >
              <Copy size={16} />
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>

          <pre className="transfer-data">
            {data.transferInstructions}
          </pre>
        </section>
      )}

      <section className="public-campaign-card">
        <p className="eyebrow">¿YA REALIZASTE TU APORTE?</p>
        <h2>Infórmanos tu transferencia</h2>

        <p className="public-form-intro">
          Tu aporte será revisado por el equipo de Finanzas.
          Solo después de ser verificado se sumará al avance
          público de la campaña.
        </p>

        {success ? (
          <div className="public-success">
            <CheckCircle2 size={28} />
            <div>
              <strong>¡Gracias por tu aporte!</strong>
              <p>
                Lo recibimos y quedó pendiente de verificación.
              </p>
            </div>
          </div>
        ) : (
          <form className="public-campaign-form" onSubmit={submit}>
            <label>
              Nombre
              <input
                required
                value={name}
                maxLength={120}
                placeholder="Tu nombre"
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <label>
              Monto depositado
              <input
                required
                inputMode="numeric"
                pattern="[0-9]+"
                value={amount}
                placeholder="0"
                onChange={(e) =>
                  setAmount(
                    e.target.value.replace(/\D/g, ""),
                  )
                }
              />
            </label>

            <label>
              Fecha del depósito
              <input
                required
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>

            <label>
              Referencia o comentario (opcional)
              <textarea
                rows={2}
                maxLength={300}
                value={note}
                placeholder="Ej. Transferencia Banco Estado"
                onChange={(e) => setNote(e.target.value)}
              />
            </label>

            <label className="public-checkbox">
              <input
                type="checkbox"
                checked={publicName}
                onChange={(e) =>
                  setPublicName(e.target.checked)
                }
              />
              <span>
                Autorizo que mi nombre pueda aparecer públicamente
                asociado a este aporte.
              </span>
            </label>

            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}

            <button
              className="button-primary"
              disabled={busy || data.status !== "active"}
            >
              {busy ? "Enviando…" : "Enviar aporte"}
            </button>

            <p className="public-receipt-note">
              El comprobante como imagen lo agregaremos en la
              siguiente etapa. Ningún aporte se suma automáticamente.
            </p>
          </form>
        )}
      </section>

      <footer className="public-campaign-footer">
        Casa de Salvación · Transparencia de campaña
      </footer>
    </main>
  );
}
