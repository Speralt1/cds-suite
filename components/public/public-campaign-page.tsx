"use client";

import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  ImagePlus,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { getFirebaseServices } from "@/lib/firebase";
import {
  submitPublicContribution,
  usePublicCampaign,
} from "@/lib/campaigns/public-client";
import {
  clp,
  errorMessage,
  today,
} from "@/lib/finance/formatters";

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
  const [receipt, setReceipt] = useState<File | null>(
    null,
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [copied, setCopied] = useState(false);

  if (campaign.loading) {
    return (
      <main className="public-campaign-shell public-campaign-v2">
        <p>Cargando campaña…</p>
      </main>
    );
  }

  if (!campaign.data) {
    return (
      <main className="public-campaign-shell public-campaign-v2">
        <div className="public-campaign-card">
          <p className="eyebrow">
            CASA DE SALVACIÓN
          </p>
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
        (data.verifiedAmount /
          data.goalAmount) *
          100,
      )
    : 0;

  const missing = Math.max(
    0,
    data.goalAmount - data.verifiedAmount,
  );

  async function submit(
    event: React.FormEvent,
  ) {
    event.preventDefault();

    if (busy) return;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const services = getFirebaseServices();

      const result =
        await submitPublicContribution(
          services.db,
          services.storage,
          data.id,
          {
            name,
            amount: Number(amount),
            date,
            publicName,
            note,
            receipt,
          },
        );

      setName("");
      setAmount("");
      setNote("");
      setReceipt(null);

      setSuccess(
        result.receiptWarning ||
          "¡Gracias! Tu aporte quedó pendiente de verificación.",
      );
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

    setTimeout(() => {
      setCopied(false);
    }, 1500);
  }

  return (
    <main className="public-campaign-shell public-campaign-v2">
      <header className="public-campaign-brand public-brand-compact">
        <div className="public-campaign-logo">
          CDS
        </div>

        <div>
          <strong>Casa de Salvación</strong>
          <span>Campaña de recursos</span>
        </div>
      </header>

      {/* RESUMEN */}
      <section className="public-campaign-hero public-hero-compact">
        <p className="eyebrow">
          {data.totalInstallments > 0
            ? `CUOTA ${data.currentInstallment} DE ${data.totalInstallments}`
            : "CAMPAÑA"}
        </p>

        <h1>{data.title}</h1>

        <div className="public-main-progress">
          <div className="public-main-number">
            <strong>
              {clp(data.verifiedAmount)}
            </strong>

            <span>
              de {clp(data.goalAmount)}
            </span>
          </div>

          <div className="public-progress">
            <span
              style={{
                width: `${progress}%`,
              }}
            />
          </div>

          <div className="public-progress-meta">
            <strong>
              {progress
                .toFixed(1)
                .replace(".0", "")}
              %
            </strong>

            <span>
              Faltan {clp(missing)}
            </span>
          </div>

          <p className="public-contribution-count">
            {data.contributionCount}{" "}
            {data.contributionCount === 1
              ? "aporte verificado"
              : "aportes verificados"}
          </p>
        </div>
      </section>

      {/* FORMULARIO INMEDIATO */}
      <section className="public-campaign-card public-contribution-card">
        <div className="public-contribution-heading">
          <div>
            <p className="eyebrow">
              ¿YA APORTASTE?
            </p>
            <h2>Registra tu aporte</h2>
          </div>

          <span>Pendiente de verificación</span>
        </div>

        <p className="public-form-intro compact">
          Lo revisaremos antes de sumarlo al
          total de la campaña.
        </p>

        {success ? (
          <div className="public-success">
            <CheckCircle2 size={25} />
            <div>
              <strong>
                Aporte recibido
              </strong>
              <p>{success}</p>

              <button
                type="button"
                className="button-secondary public-another-contribution"
                onClick={() =>
                  setSuccess("")
                }
              >
                Registrar otro aporte
              </button>
            </div>
          </div>
        ) : (
          <form
            className="public-campaign-form public-form-compact"
            onSubmit={submit}
          >
            <label>
              Nombre
              <input
                required
                value={name}
                maxLength={120}
                placeholder="Tu nombre"
                onChange={(e) =>
                  setName(e.target.value)
                }
              />
            </label>

            <div className="public-form-row">
              <label>
                Monto
                <input
                  required
                  inputMode="numeric"
                  pattern="[0-9]+"
                  value={amount}
                  placeholder="$ 0"
                  onChange={(e) =>
                    setAmount(
                      e.target.value.replace(
                        /\D/g,
                        "",
                      ),
                    )
                  }
                />
              </label>

              <label>
                Fecha
                <input
                  required
                  type="date"
                  value={date}
                  onChange={(e) =>
                    setDate(e.target.value)
                  }
                />
              </label>
            </div>

            <label className="public-receipt-field">
              Comprobante{" "}
              <span>(opcional)</span>

              <div className="public-file-input">
                <ImagePlus size={20} />

                <div>
                  <strong>
                    {receipt
                      ? receipt.name
                      : "Subir comprobante"}
                  </strong>

                  <span>
                    Foto o captura · máximo
                    10 MB
                  </span>
                </div>

                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) =>
                    setReceipt(
                      e.target.files?.[0] ||
                        null,
                    )
                  }
                />
              </div>
            </label>

            <label>
              Comentario{" "}
              <span className="optional-label">
                (opcional)
              </span>

              <input
                maxLength={300}
                value={note}
                placeholder="Ej. Transferencia Banco Estado"
                onChange={(e) =>
                  setNote(e.target.value)
                }
              />
            </label>

            <label className="public-checkbox">
              <input
                type="checkbox"
                checked={publicName}
                onChange={(e) =>
                  setPublicName(
                    e.target.checked,
                  )
                }
              />

              <span>
                Mostrar mi nombre
                públicamente.
              </span>
            </label>

            {error && (
              <p
                className="notice error"
                role="alert"
              >
                {error}
              </p>
            )}

            <button
              className="button-primary public-submit"
              disabled={
                busy ||
                data.status !== "active"
              }
            >
              {busy
                ? "Enviando…"
                : "Enviar aporte"}
            </button>

            <p className="public-verification-note">
              Solo los aportes aprobados por
              Finanzas modifican el total.
            </p>
          </form>
        )}
      </section>

      {/* DATOS BANCARIOS PLEGABLES */}
      {data.transferInstructions && (
        <details className="public-transfer-details">
          <summary>
            <div>
              <span>
                ¿Aún no transfieres?
              </span>
              <strong>
                Ver datos bancarios
              </strong>
            </div>

            <ChevronDown size={20} />
          </summary>

          <div className="public-transfer-body">
            <button
              type="button"
              className="button-secondary"
              onClick={
                copyTransferData
              }
            >
              <Copy size={16} />
              {copied
                ? "Copiado"
                : "Copiar datos"}
            </button>

            <pre className="transfer-data">
              {
                data.transferInstructions
              }
            </pre>
          </div>
        </details>
      )}

      <footer className="public-campaign-footer">
        Casa de Salvación · Transparencia
        de campaña
      </footer>
    </main>
  );
}
