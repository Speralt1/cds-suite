"use client";

import { useState } from "react";
import { Banknote, CreditCard, ExternalLink, RefreshCw, Settings2, WalletCards } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-provider";
import { useAccess } from "@/lib/auth/access-provider";
import { getFirebaseServices } from "@/lib/firebase";
import { canSeeDetails } from "@/lib/finance/permissions";
import { clp, errorMessage, today } from "@/lib/finance/formatters";
import { useTransactions } from "@/lib/finance/hooks";
import type { FinanceTransaction, PeriodSelection } from "@/lib/finance/types";
import { cashTransactionId, saveDailyCash, type CashArea } from "@/lib/offerings/cash";
import {
  requestSumUpSync,
  saveGivingSettings,
  useGivingSettings,
  useSumUpIntegration,
  useSumUpTransactions,
  type GivingSettings,
  type SumUpIntegration,
  type SumUpTransaction,
} from "@/lib/offerings/client";
import { Empty, FinancePageHeader, Loading, Modal, Notice } from "@/components/finance/shared";

function dateKeyChile(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value || "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

function periodFromDate(date: string): PeriodSelection {
  const [year, month] = date.slice(0, 7).split("-").map(Number);
  return { year, month, view: "month" };
}

function sumSumUpDay(items: SumUpTransaction[], date: string) {
  return items.reduce((sum, item) => {
    const stamp = item.timestamp?.toDate();
    if (!stamp || dateKeyChile(stamp) !== date) return sum;
    return sum + Math.max(0, Number(item.netAmount || 0));
  }, 0);
}

function IntegrationCard({ title, data }: { title: string; data: SumUpIntegration | null }) {
  return (
    <div className="offering-integration-card">
      <span className="eyebrow">SUMUP FÍSICO</span>
      <h3>{title}</h3>
      <span className={data?.lastSyncStatus === "ok" ? "status-pill" : "status-pill status-voided"}>
        {data?.lastSyncStatus === "ok" ? "Conectado" : data ? "Con error" : "Sin configurar"}
      </span>
      <p>
        {data?.lastSyncAt
          ? `Última sincronización: ${data.lastSyncAt.toDate().toLocaleString("es-CL")}`
          : "Aún no hay una sincronización registrada."}
      </p>
      {data?.lastError && <p className="notice error">{data.lastError}</p>}
    </div>
  );
}

function GivingSettingsModal({ current, onClose }: { current: GivingSettings | null; onClose: () => void }) {
  const [title, setTitle] = useState(current?.title || "Ofrendar");
  const [intro, setIntro] = useState(current?.intro || "Tu aporte nos ayuda a seguir desarrollando la obra de Casa de Salvación.");
  const [transferEnabled, setTransferEnabled] = useState(current?.transferEnabled ?? true);
  const [transferInstructions, setTransferInstructions] = useState(current?.transferInstructions || "");
  const [onlineEnabled, setOnlineEnabled] = useState(current?.onlineEnabled ?? false);
  const [onlineLabel, setOnlineLabel] = useState(current?.onlineLabel || "Pagar online");
  const [onlineUrl, setOnlineUrl] = useState(current?.onlineUrl || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await saveGivingSettings({ title, intro, transferEnabled, transferInstructions, onlineEnabled, onlineLabel, onlineUrl });
      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Configurar página de ofrendas" onClose={onClose} busy={busy}>
      <form className="finance-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>Título<input required value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} /></label>
          <label>Mensaje<textarea rows={3} value={intro} maxLength={500} onChange={(e) => setIntro(e.target.value)} /></label>
          <label className="public-checkbox">
            <input type="checkbox" checked={transferEnabled} onChange={(e) => setTransferEnabled(e.target.checked)} />
            <span>Mostrar transferencia bancaria sin comisión</span>
          </label>
          <label>
            Datos de transferencia
            <textarea rows={6} value={transferInstructions} maxLength={1500} placeholder={"Nombre\nRUT\nBanco\nTipo de cuenta\nN° de cuenta\nCorreo"} onChange={(e) => setTransferInstructions(e.target.value)} />
          </label>
          <label className="public-checkbox">
            <input type="checkbox" checked={onlineEnabled} onChange={(e) => setOnlineEnabled(e.target.checked)} />
            <span>Activar un link de pago online</span>
          </label>
          <label>Texto del botón online<input value={onlineLabel} maxLength={80} onChange={(e) => setOnlineLabel(e.target.value)} /></label>
          <label>
            URL de pago online
            <input type="url" value={onlineUrl} maxLength={500} placeholder="https://..." onChange={(e) => setOnlineUrl(e.target.value)} />
            <span className="field-help">Aquí conectaremos Khipu/Webpay cuando habilitemos la pasarela.</span>
          </label>
          <Notice error={error} />
        </fieldset>
        <div className="form-footer">
          <button type="button" className="button-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="button-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}


function CashModal({
  area,
  date,
  existing,
  onClose,
}: {
  area: CashArea;
  date: string;
  existing?: FinanceTransaction;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const label = area === "offerings" ? "Ofrendas" : "Cafetería";
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [note, setNote] = useState(existing?.note || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!user || busy) return;

    setBusy(true);
    setError("");

    try {
      await saveDailyCash(
        getFirebaseServices().db,
        user.uid,
        area,
        date,
        Number(amount),
        note,
        existing,
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
      title={`${existing ? "Editar" : "Ingresar"} efectivo · ${label}`}
      onClose={onClose}
      busy={busy}
    >
      <form className="finance-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          <div className="notice success">
            <strong>{date}</strong>
            <p>
              Quedará registrado como ingreso de {label} en efectivo
              y se sumará automáticamente a Finanzas.
            </p>
          </div>

          <label>
            Efectivo recaudado
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

          <label>
            Nota (opcional)
            <textarea
              rows={2}
              value={note}
              maxLength={500}
              placeholder="Ej. Servicio domingo AM"
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

          <button className="button-primary" disabled={busy}>
            {busy
              ? "Guardando…"
              : existing
                ? "Actualizar efectivo"
                : "Registrar efectivo"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DailyCashCard({
  title,
  cardAmount,
  cashAmount,
  existingCash,
  onCash,
}: {
  title: string;
  cardAmount: number;
  cashAmount: number;
  existingCash?: FinanceTransaction;
  onCash: () => void;
}) {
  return (
    <div className="panel daily-cash-card">
      <div className="daily-cash-heading">
        <div>
          <span className="eyebrow">CAJA DEL DÍA</span>
          <h3>{title}</h3>
        </div>
        <WalletCards size={21} />
      </div>

      <div className="daily-cash-lines">
        <div>
          <span><CreditCard size={15} />Tarjeta SumUp</span>
          <strong>{clp(cardAmount)}</strong>
        </div>
        <div>
          <span><Banknote size={15} />Efectivo</span>
          <strong>{clp(cashAmount)}</strong>
        </div>
      </div>

      <div className="daily-cash-total">
        <span>Total del día</span>
        <strong>{clp(cardAmount + cashAmount)}</strong>
      </div>

      <button
        type="button"
        className={existingCash ? "button-secondary" : "button-primary"}
        onClick={onCash}
      >
        <Banknote size={16} />
        {existingCash ? "Editar efectivo" : "Ingresar efectivo"}
      </button>
    </div>
  );
}

export function OfferingsPage() {
  const access = useAccess();
  const { user } = useAuth();
  const settings = useGivingSettings();
  const offeringsIntegration = useSumUpIntegration("offerings");
  const cafeIntegration = useSumUpIntegration("cafeteria");
  const transactions = useSumUpTransactions("offerings", 1000);
  const cafeTransactions = useSumUpTransactions("cafeteria", 1000);
  const [selectedDate, setSelectedDate] = useState(today());
  const financeTransactions = useTransactions(
    periodFromDate(selectedDate),
    true,
    10000,
  );
  const [configuring, setConfiguring] = useState(false);
  const [cashArea, setCashArea] = useState<CashArea | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncError, setSyncError] = useState("");

  if (!canSeeDetails(access.role)) {
    return <Empty>Esta sección está reservada para Administración, Pastor y Finanzas.</Empty>;
  }

  const offeringCash = financeTransactions.data.find(
    (item) =>
      item.id === cashTransactionId("offerings", selectedDate) &&
      item.status === "active",
  );

  const cafeCash = financeTransactions.data.find(
    (item) =>
      item.id === cashTransactionId("cafeteria", selectedDate) &&
      item.status === "active",
  );

  const offeringCardDay = sumSumUpDay(transactions.data, selectedDate);
  const cafeCardDay = sumSumUpDay(cafeTransactions.data, selectedDate);

  const publicUrl =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/ofrendar`;

  async function sync() {
    if (!user || syncing) return;
    setSyncing(true);
    setSyncError("");
    setSyncMessage("");
    try {
      const result = await requestSumUpSync(user);
      const reviewed = Array.isArray(result.results)
        ? result.results.reduce((sum: number, item: { reviewed?: number }) => sum + Number(item.reviewed || 0), 0)
        : 0;
      setSyncMessage(`Sincronización completa · ${reviewed} pagos físicos revisados.`);
    } catch (error) {
      setSyncError(errorMessage(error));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <FinancePageHeader
        title="Ofrendas"
        subtitle="Transferencias, pagos online y tarjetas físicas en un solo lugar."
        aside={
          <div className="offering-header-actions">
            <button className="button-secondary" type="button" onClick={() => setConfiguring(true)}><Settings2 size={16} />Configurar</button>
            <button className="button-primary" type="button" disabled={syncing} onClick={() => void sync()}><RefreshCw size={16} />{syncing ? "Sincronizando…" : "Sincronizar SumUp"}</button>
          </div>
        }
      />

      <Notice error={syncError || settings.error || transactions.error || cafeTransactions.error || financeTransactions.error || offeringsIntegration.error || cafeIntegration.error} success={syncMessage} />

      <div className="daily-cash-toolbar">
        <div>
          <span className="eyebrow">CIERRE DIARIO</span>
          <h2>Caja del día</h2>
          <p>Tarjeta + efectivo, separado por área.</p>
        </div>

        <label className="daily-cash-date">
          Fecha
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </label>
      </div>

      {financeTransactions.loading ? (
        <Loading />
      ) : (
        <div className="daily-cash-grid">
          <DailyCashCard
            title="Ofrendas"
            cardAmount={offeringCardDay}
            cashAmount={offeringCash?.amount || 0}
            existingCash={offeringCash}
            onCash={() => setCashArea("offerings")}
          />

          <DailyCashCard
            title="Cafetería"
            cardAmount={cafeCardDay}
            cashAmount={cafeCash?.amount || 0}
            existingCash={cafeCash}
            onCash={() => setCashArea("cafeteria")}
          />
        </div>
      )}

      <section className="mt-8">
        <div className="section-heading"><div><h2>Integración SumUp</h2><p>Cada cuenta se concilia por separado para no mezclar ofrendas y ventas de cafetería.</p></div></div>
        <div className="offering-integrations-grid">
          <IntegrationCard title="Ofrendas" data={offeringsIntegration.data} />
          <IntegrationCard title="Cafetería" data={cafeIntegration.data} />
        </div>
      </section>

      <section className="mt-8">
        <div className="section-heading"><div><h2>Últimas ofrendas por tarjeta física</h2><p>Se importan desde la cuenta SumUp de Ofrendas y se registran automáticamente en Finanzas.</p></div></div>
        {transactions.loading ? <Loading /> : transactions.data.length ? (
          <div className="campaign-contributions">
            {transactions.data.map((item) => (
              <div className="campaign-contribution-row" key={item.id}>
                <div className="campaign-contribution-icon"><CreditCard size={18} /></div>
                <div>
                  <strong>{item.transactionCode || "Pago SumUp"}</strong>
                  <p>{item.timestamp ? item.timestamp.toDate().toLocaleString("es-CL") : ""}{item.cardType ? ` · ${item.cardType}` : ""}</p>
                </div>
                <div className="campaign-contribution-amount">
                  <strong>{clp(item.netAmount)}</strong>
                  <span className="status-pill">{item.status === "REFUNDED" ? "Reembolsado" : "Conciliado"}</span>
                </div>
              </div>
            ))}
          </div>
        ) : <Empty>Aún no hay pagos físicos de SumUp sincronizados. Conecta las dos cuentas con el configurador SumUp.</Empty>}
      </section>

      <section className="panel offering-public-panel mt-8">
        <div><span className="eyebrow">LINK PÚBLICO</span><h2>{settings.data?.title || "Ofrendar"}</h2><p>{publicUrl}</p></div>
        <a className="button-secondary" href="/ofrendar" target="_blank" rel="noreferrer"><ExternalLink size={16} />Ver página</a>
      </section>

      {configuring && <GivingSettingsModal current={settings.data} onClose={() => setConfiguring(false)} />}

      {cashArea && (
        <CashModal
          area={cashArea}
          date={selectedDate}
          existing={cashArea === "offerings" ? offeringCash : cafeCash}
          onClose={() => setCashArea(null)}
        />
      )}
    </>
  );
}
