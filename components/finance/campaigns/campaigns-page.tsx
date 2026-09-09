"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Copy,
  Plus,
  ReceiptText,
  Pencil,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-provider";
import { getFirebaseServices } from "@/lib/firebase";
import { useAccess } from "@/lib/auth/access-provider";
import { canSeeDetails } from "@/lib/finance/permissions";
import { clp, errorMessage, today } from "@/lib/finance/formatters";
import { PendingCampaignSubmissions } from "./pending-submissions";
import { ReceiptPreviewButton } from "./receipt-preview-button";
import {
  addManualContribution,
  campaignProgress,
  createCampaign,
  editCampaignContribution,
  voidCampaignContribution,
  useCampaignContributions,
  useCampaigns,
  type Campaign,
  type CampaignContribution,
} from "@/lib/campaigns/client";
import { syncPublicCampaignView } from "@/lib/campaigns/public-client";
import {
  Empty,
  Loading,
  Modal,
  Notice,
} from "@/components/finance/shared";

function CampaignProgress({ campaign }: { campaign: Campaign }) {
  const progress = campaignProgress(campaign);

  return (
    <>
      <div className="campaign-progress-heading">
        <strong>{clp(campaign.verifiedAmount)}</strong>
        <span>{progress.toFixed(1).replace(".0", "")}%</span>
      </div>

      <div
        className="campaign-progress"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${progress}%` }} />
      </div>

      <p className="campaign-goal">
        de {clp(campaign.goalAmount)}
      </p>
    </>
  );
}

function NewCampaignModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [goal, setGoal] = useState("");
  const [currentInstallment, setCurrentInstallment] =
    useState("6");
  const [totalInstallments, setTotalInstallments] =
    useState("12");
  const [transferInstructions, setTransferInstructions] =
    useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (!user || busy) return;

    setBusy(true);
    setError("");

    try {
      const id = await createCampaign(
        getFirebaseServices().db,
        user.uid,
        {
          title,
          description,
          goalAmount: Number(goal),
          currentInstallment: Number(currentInstallment),
          totalInstallments: Number(totalInstallments),
          transferInstructions,
        },
      );

      onCreated(id);
      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Nueva campaña"
      onClose={onClose}
      busy={busy}
    >
      <form className="finance-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            Nombre de la campaña
            <input
              required
              data-autofocus
              value={title}
              maxLength={120}
              placeholder="Ej. Pago deuda de luz"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          <label>
            Descripción
            <textarea
              rows={3}
              value={description}
              maxLength={600}
              placeholder="Explica brevemente el propósito de esta campaña."
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <label>
            Meta de la cuota actual
            <input
              required
              inputMode="numeric"
              pattern="[0-9]+"
              value={goal}
              placeholder="Ej. 1500000"
              onChange={(e) =>
                setGoal(e.target.value.replace(/\D/g, ""))
              }
            />
            <span className="field-help">
              Ingresa pesos enteros, sin puntos.
            </span>
          </label>

          <div className="form-grid">
            <label>
              Cuota actual
              <input
                type="number"
                min={0}
                value={currentInstallment}
                onChange={(e) =>
                  setCurrentInstallment(e.target.value)
                }
              />
            </label>

            <label>
              Total de cuotas
              <input
                type="number"
                min={0}
                value={totalInstallments}
                onChange={(e) =>
                  setTotalInstallments(e.target.value)
                }
              />
            </label>
          </div>

          <label>
            Datos para transferencia (opcional)
            <textarea
              rows={4}
              value={transferInstructions}
              maxLength={1000}
              placeholder={"Banco\nTipo de cuenta\nN° de cuenta\nRUT"}
              onChange={(e) =>
                setTransferInstructions(e.target.value)
              }
            />
          </label>

          <Notice error={error} />
        </fieldset>

        <div className="form-footer">
          <button
            type="button"
            className="button-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>

          <button
            className="button-primary"
            disabled={busy}
          >
            {busy ? "Creando…" : "Crear campaña"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AddContributionModal({
  campaign,
  onClose,
}: {
  campaign: Campaign;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [paymentMethod, setPaymentMethod] =
    useState<CampaignContribution["paymentMethod"]>("transfer");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (!user || busy) return;

    setBusy(true);
    setError("");

    try {
      await addManualContribution(
        getFirebaseServices().db,
        user.uid,
        campaign,
        {
          name,
          amount: Number(amount),
          date,
          paymentMethod,
          note,
        },
      );

      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Agregar pago verificado"
      onClose={onClose}
      busy={busy}
    >
      <form className="finance-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          <div className="notice success">
            <strong>{campaign.title}</strong>
            <p>
              {campaign.totalInstallments > 0
                ? `Este pago se asignará a la cuota ${campaign.currentInstallment} de ${campaign.totalInstallments}.`
                : "Este pago se sumará a la campaña."}
            </p>
          </div>

          <label>
            Nombre
            <input
              value={name}
              maxLength={120}
              placeholder="Nombre de la persona"
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label>
            Monto
            <input
              required
              data-autofocus
              inputMode="numeric"
              pattern="[0-9]+"
              value={amount}
              placeholder="0"
              onChange={(e) =>
                setAmount(e.target.value.replace(/\D/g, ""))
              }
            />
          </label>

          <div className="form-grid">
            <label>
              Fecha
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>

            <label>
              Método
              <select
                value={paymentMethod}
                onChange={(e) =>
                  setPaymentMethod(
                    e.target.value as CampaignContribution["paymentMethod"],
                  )
                }
              >
                <option value="transfer">Transferencia</option>
                <option value="cash">Efectivo</option>
                <option value="card">Tarjeta</option>
                <option value="other">Otro</option>
              </select>
            </label>
          </div>

          <label>
            Nota (opcional)
            <textarea
              rows={2}
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          <Notice error={error} />
        </fieldset>

        <div className="form-footer">
          <button
            type="button"
            className="button-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>

          <button
            className="button-primary"
            disabled={busy}
          >
            {busy ? "Guardando…" : "Agregar pago"}
          </button>
        </div>
      </form>
    </Modal>
  );
}


function EditContributionModal({
  campaign,
  contribution,
  onClose,
}: {
  campaign: Campaign;
  contribution: CampaignContribution;
  onClose: () => void;
}) {
  const { user } = useAuth();

  const [name, setName] = useState(
    contribution.name,
  );

  const [amount, setAmount] = useState(
    String(contribution.amount),
  );

  const [date, setDate] = useState(
    contribution.date,
  );

  const [paymentMethod, setPaymentMethod] =
    useState<CampaignContribution["paymentMethod"]>(
      contribution.paymentMethod,
    );

  const [note, setNote] = useState(
    contribution.note,
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(
    event: React.FormEvent,
  ) {
    event.preventDefault();

    if (!user || busy) return;

    setBusy(true);
    setError("");

    try {
      await editCampaignContribution(
        getFirebaseServices().db,
        user.uid,
        campaign.id,
        contribution.id,
        {
          name,
          amount: Number(amount),
          date,
          paymentMethod,
          note,
        },
      );

      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Editar aporte"
      onClose={onClose}
      busy={busy}
    >
      <form
        className="finance-form"
        onSubmit={submit}
      >
        <fieldset disabled={busy}>
          <label>
            Nombre
            <input
              value={name}
              maxLength={120}
              onChange={(e) =>
                setName(e.target.value)
              }
            />
          </label>

          <label>
            Monto
            <input
              required
              inputMode="numeric"
              pattern="[0-9]+"
              value={amount}
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

          <div className="form-grid">
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

            <label>
              Método
              <select
                value={paymentMethod}
                onChange={(e) =>
                  setPaymentMethod(
                    e.target
                      .value as CampaignContribution["paymentMethod"],
                  )
                }
              >
                <option value="transfer">
                  Transferencia
                </option>
                <option value="cash">
                  Efectivo
                </option>
                <option value="card">
                  Tarjeta
                </option>
                <option value="other">
                  Otro
                </option>
              </select>
            </label>
          </div>

          <label>
            Nota
            <textarea
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) =>
                setNote(e.target.value)
              }
            />
          </label>

          <Notice error={error} />
        </fieldset>

        <div className="form-footer">
          <button
            type="button"
            className="button-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>

          <button
            className="button-primary"
            disabled={busy}
          >
            {busy
              ? "Guardando…"
              : "Guardar cambios"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function VoidContributionModal({
  campaign,
  contribution,
  onClose,
}: {
  campaign: Campaign;
  contribution: CampaignContribution;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [reason, setReason] =
    useState("");
  const [busy, setBusy] =
    useState(false);
  const [error, setError] =
    useState("");

  async function submit(
    event: React.FormEvent,
  ) {
    event.preventDefault();

    if (!user || busy) return;

    setBusy(true);
    setError("");

    try {
      await voidCampaignContribution(
        getFirebaseServices().db,
        user.uid,
        campaign.id,
        contribution.id,
        reason,
      );

      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Eliminar aporte"
      onClose={onClose}
      busy={busy}
    >
      <form
        className="finance-form"
        onSubmit={submit}
      >
        <fieldset disabled={busy}>
          <div className="notice error">
            <strong>
              {contribution.name} ·{" "}
              {clp(contribution.amount)}
            </strong>

            <p>
              Este aporte se descontará de
              la campaña. El registro no se
              borrará físicamente para
              conservar la auditoría.
            </p>
          </div>

          <label>
            Motivo
            <textarea
              required
              data-autofocus
              rows={3}
              minLength={3}
              maxLength={300}
              value={reason}
              placeholder="Ej. Transferencia registrada por error"
              onChange={(e) =>
                setReason(e.target.value)
              }
            />
          </label>

          <Notice error={error} />
        </fieldset>

        <div className="form-footer">
          <button
            type="button"
            className="button-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>

          <button
            className="button-danger"
            disabled={busy}
          >
            {busy
              ? "Eliminando…"
              : "Eliminar aporte"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CampaignDetail({
  campaign,
  onBack,
}: {
  campaign: Campaign;
  onBack: () => void;
}) {
  const contributions = useCampaignContributions(campaign.id);
  const [add, setAdd] = useState(false);
  const [editing, setEditing] =
    useState<CampaignContribution | null>(null);
  const [voiding, setVoiding] =
    useState<CampaignContribution | null>(null);
  const [copied, setCopied] = useState(false);

  const publicUrl =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/campanas/${campaign.slug}`;

  async function copyPublicUrl() {
    if (!publicUrl) return;

    await syncPublicCampaignView(
      getFirebaseServices().db,
      campaign,
    );

    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);

    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <>
      <button
        type="button"
        className="button-secondary mb-5"
        onClick={onBack}
      >
        <ArrowLeft size={16} />
        Volver a campañas
      </button>

      <section className="panel campaign-detail">
        <div className="campaign-detail-heading">
          <div>
            <p className="eyebrow">
              {campaign.totalInstallments > 0
                ? `CUOTA ${campaign.currentInstallment} DE ${campaign.totalInstallments}`
                : "CAMPAÑA"}
            </p>
            <h2>{campaign.title}</h2>
            {campaign.description && (
              <p>{campaign.description}</p>
            )}
          </div>

          <button
            className="button-primary"
            type="button"
            onClick={() => setAdd(true)}
          >
            <Plus size={17} />
            Agregar pago
          </button>
        </div>

        <div className="campaign-detail-progress">
          <CampaignProgress campaign={campaign} />
        </div>

        <div className="campaign-metrics">
          <div>
            <span>Meta actual</span>
            <strong>{clp(campaign.goalAmount)}</strong>
          </div>

          <div>
            <span>Recaudado</span>
            <strong>{clp(campaign.verifiedAmount)}</strong>
          </div>

          <div>
            <span>Falta</span>
            <strong>
              {clp(
                Math.max(
                  0,
                  campaign.goalAmount -
                    campaign.verifiedAmount,
                ),
              )}
            </strong>
          </div>

          <div>
            <span>Pagos verificados</span>
            <strong>{campaign.contributionCount}</strong>
          </div>
        </div>

        <div className="campaign-public-link">
          <div>
            <strong>Link público</strong>
            <p>{publicUrl}</p>
          </div>

          <button
            type="button"
            className="button-secondary"
            onClick={copyPublicUrl}
          >
            <Copy size={16} />
            {copied ? "Copiado" : "Copiar"}
          </button>
        </div>
      </section>

      <PendingCampaignSubmissions campaign={campaign} />

      <section className="mt-8">
        <div className="section-heading">
          <div>
            <h2>Pagos registrados</h2>
            <p>
              Aportes verificados que forman parte de esta campaña.
            </p>
          </div>
        </div>

        <Notice error={contributions.error} />

        {contributions.loading ? (
          <Loading />
        ) : contributions.data.length ? (
          <div className="campaign-contributions">
            {contributions.data.map((item) => (
              <div
                className="campaign-contribution-row"
                key={item.id}
              >
                <div className="campaign-contribution-icon">
                  <ReceiptText size={18} />
                </div>

                <div>
                  <strong>{item.name}</strong>
                  <p>
                    {item.date}
                    {item.installmentNumber > 0
                      ? ` · Cuota ${item.installmentNumber}`
                      : ""}
                  </p>
                </div>

                <div className="campaign-contribution-amount">
                  <strong>{clp(item.amount)}</strong>

                  <span className="status-pill">
                    {item.status === "voided"
                      ? "Anulado"
                      : "Verificado"}
                  </span>

                  {item.receiptPath && (
                    <ReceiptPreviewButton
                      receiptPath={item.receiptPath}
                    />
                  )}

                  {item.status === "approved" && (
                    <div className="campaign-row-actions">
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() =>
                          setEditing(item)
                        }
                      >
                        <Pencil size={15} />
                        Editar
                      </button>

                      <button
                        type="button"
                        className="button-danger"
                        onClick={() =>
                          setVoiding(item)
                        }
                      >
                        <Trash2 size={15} />
                        Eliminar
                      </button>
                    </div>
                  )}

                  {item.status === "voided" &&
                    item.voidReason && (
                      <small className="campaign-void-reason">
                        {item.voidReason}
                      </small>
                    )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty>
            Todavía no has agregado pagos a esta campaña.
          </Empty>
        )}
      </section>

      {add && (
        <AddContributionModal
          campaign={campaign}
          onClose={() => setAdd(false)}
        />
      )}

      {editing && (
        <EditContributionModal
          campaign={campaign}
          contribution={editing}
          onClose={() => setEditing(null)}
        />
      )}

      {voiding && (
        <VoidContributionModal
          campaign={campaign}
          contribution={voiding}
          onClose={() => setVoiding(null)}
        />
      )}
    </>
  );
}

export function CampaignsPage() {
  const access = useAccess();
  const campaigns = useCampaigns();
  const [create, setCreate] = useState(false);
  const [selected, setSelected] = useState("");

  if (!canSeeDetails(access.role)) {
    return (
      <Empty>
        Esta sección está reservada para Administración,
        Pastor y Finanzas.
      </Empty>
    );
  }

  const selectedCampaign = campaigns.data.find(
    (campaign) => campaign.id === selected,
  );

  if (selectedCampaign) {
    return (
      <CampaignDetail
        campaign={selectedCampaign}
        onBack={() => setSelected("")}
      />
    );
  }

  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Campañas de recursos</h2>
          <p>
            Fondos destinados a necesidades y proyectos específicos.
          </p>
        </div>

        <button
          className="button-primary"
          type="button"
          onClick={() => setCreate(true)}
        >
          <Plus size={17} />
          Nueva campaña
        </button>
      </div>

      <Notice error={campaigns.error} />

      {campaigns.loading ? (
        <Loading />
      ) : campaigns.data.length ? (
        <div className="campaign-grid">
          {campaigns.data.map((campaign) => (
            <article
              className="campaign-card"
              key={campaign.id}
            >
              <div className="campaign-card-heading">
                <div>
                  {campaign.totalInstallments > 0 && (
                    <span className="status-pill">
                      Cuota {campaign.currentInstallment}/
                      {campaign.totalInstallments}
                    </span>
                  )}

                  <h3>{campaign.title}</h3>
                </div>

                <span
                  className={`status-pill ${
                    campaign.status === "closed"
                      ? "voided"
                      : ""
                  }`}
                >
                  {campaign.status === "active"
                    ? "Activa"
                    : "Cerrada"}
                </span>
              </div>

              <CampaignProgress campaign={campaign} />

              <button
                type="button"
                className="button-secondary campaign-manage-button"
                onClick={() => setSelected(campaign.id)}
              >
                Gestionar campaña
              </button>
            </article>
          ))}
        </div>
      ) : (
        <Empty>
          <h3>Aún no hay campañas.</h3>
          <p className="mt-2">
            Crea la campaña de la deuda de luz y carga los pagos
            que ya han realizado.
          </p>
        </Empty>
      )}

      {create && (
        <NewCampaignModal
          onClose={() => setCreate(false)}
          onCreated={setSelected}
        />
      )}
    </>
  );
}
