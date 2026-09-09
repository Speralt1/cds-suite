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
} from "@/lib/offerings/client";
import { Empty, FinancePageHeader, Loading, Modal, Notice } from "@/components/finance/shared";

const SUMUP_SPLIT_START_DATE = "2026-09-09";
const SUMUP_LEGACY_CATEGORY =
  "SumUp histórico sin separar";

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

function sumFinanceDay(
  items: FinanceTransaction[],
  date: string,
  category: string,
  paymentMethod: "cash" | "card",
) {
  const period = date.slice(0, 7);
  const day = String(Number(date.slice(8, 10)));

  return items.reduce((sum, item) => {
    if (
      item.status !== "active" ||
      item.type !== "income" ||
      item.period !== period ||
      item.day !== day ||
      item.category !== category ||
      item.paymentMethod !== paymentMethod
    ) {
      return sum;
    }

    return sum + item.amount;
  }, 0);
}

function sumFinanceMonth(
  items: FinanceTransaction[],
  category: string,
  paymentMethod: "cash" | "card",
) {
  return items.reduce((sum, item) => {
    if (
      item.status !== "active" ||
      item.type !== "income" ||
      item.category !== category ||
      item.paymentMethod !== paymentMethod
    ) {
      return sum;
    }

    return sum + item.amount;
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
  loading,
  onDateChange,
  onClose,
}: {
  area: CashArea;
  date: string;
  existing?: FinanceTransaction;
  loading: boolean;
  onDateChange: (date: string) => void;
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
    if (!user || busy || loading) return;

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
        <fieldset disabled={busy || loading}>
          <label>
            Fecha correspondiente
            <input
              type="date"
              min={SUMUP_SPLIT_START_DATE}
              max="2099-12-31"
              value={date}
              required
              onChange={(e) =>
                onDateChange(e.target.value)
              }
            />
            <span className="field-help">
              Puedes registrar hoy el efectivo de un día anterior.
            </span>
          </label>

          <div className="notice success">
            <p>
              Se registrará como ingreso de {label} en efectivo
              correspondiente al {date} y se sumará automáticamente
              a Finanzas.
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
              placeholder={area === "offerings" ? "Ej. Servicio domingo AM" : "Ej. Ventas domingo AM"}
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

          <button className="button-primary" disabled={busy || loading}>
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

  const separationActive =
    selectedDate >= SUMUP_SPLIT_START_DATE;

  const offeringCardDay = sumFinanceDay(
    financeTransactions.data,
    selectedDate,
    "Ofrendas",
    "card",
  );

  const cafeCardDay = sumFinanceDay(
    financeTransactions.data,
    selectedDate,
    "Cafetería",
    "card",
  );

  const legacyCardDay = sumFinanceDay(
    financeTransactions.data,
    selectedDate,
    SUMUP_LEGACY_CATEGORY,
    "card",
  );

  const legacyCardMonth = sumFinanceMonth(
    financeTransactions.data,
    SUMUP_LEGACY_CATEGORY,
    "card",
  );

  const separatedOfferingTransactions =
    transactions.data.filter((item) => {
      const stamp = item.timestamp?.toDate();
      return stamp
        ? dateKeyChile(stamp) >=
            SUMUP_SPLIT_START_DATE
        : false;
    });

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
      const backfilled = Array.isArray(result.results)
        ? result.results.some(
            (item: { fullHistory?: boolean }) =>
              item.fullHistory === true,
          )
        : false;

      setSyncMessage(
        backfilled
          ? `Histórico SumUp conciliado · ${reviewed} pagos revisados. La separación Ofrendas/Cafetería comienza el 09/09/2026.`
          : `Sincronización completa · ${reviewed} pagos físicos revisados.`,
      );
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

      <div className="notice success sumup-cutoff-notice">
        <strong>
          Separación oficial desde el 09/09/2026
        </strong>
        <p>
          Los pagos SumUp anteriores se conservan
          completos, pero como “SumUp histórico sin
          separar”. No se atribuyen retroactivamente a
          Ofrendas ni Cafetería.
        </p>
      </div>

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
      ) : separationActive ? (
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
      ) : (
        <div className="daily-cash-grid daily-cash-grid-single">
          <div className="panel daily-cash-card">
            <div className="daily-cash-heading">
              <div>
                <span className="eyebrow">
                  HISTÓRICO SUMUP
                </span>
                <h3>Sin separación</h3>
              </div>
              <CreditCard size={21} />
            </div>

            <div className="daily-cash-lines">
              <div>
                <span>
                  <CreditCard size={15} />
                  Tarjeta SumUp · día
                </span>
                <strong>{clp(legacyCardDay)}</strong>
              </div>

              <div>
                <span>Total del mes</span>
                <strong>{clp(legacyCardMonth)}</strong>
              </div>
            </div>

            <div className="daily-cash-total">
              <span>Total conocido del día</span>
              <strong>{clp(legacyCardDay)}</strong>
            </div>

            <p className="field-help">
              Hasta el 08/09/2026 ambas operaciones
              usaban la misma cuenta SumUp. Conservamos
              el ingreso total, sin inventar cuánto
              correspondía a Ofrendas o Cafetería.
            </p>
          </div>
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
        <div className="section-heading"><div><h2>Últimas ofrendas por tarjeta física</h2><p>Solo se consideran como Ofrendas los cobros realizados desde el 09/09/2026 en la cuenta SumUp de Ofrendas.</p></div></div>
        {transactions.loading ? <Loading /> : separatedOfferingTransactions.length ? (
          <div className="campaign-contributions">
            {separatedOfferingTransactions.map((item) => (
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
          key={`${cashArea}-${selectedDate}-${
            (cashArea === "offerings" ? offeringCash : cafeCash)?.id || "new"
          }`}
          area={cashArea}
          date={selectedDate}
          existing={cashArea === "offerings" ? offeringCash : cafeCash}
          loading={financeTransactions.loading}
          onDateChange={setSelectedDate}
          onClose={() => setCashArea(null)}
        />
      )}
    </>
  );
}
