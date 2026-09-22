"use client";

import { useState } from "react";
import {
  Banknote,
  CircleCheck,
  CircleDashed,
  CloudOff,
  CreditCard,
  ExternalLink,
  RefreshCw,
  Settings2,
  TriangleAlert,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-provider";
import { useAccess } from "@/lib/auth/access-provider";
import { canSeeDetails } from "@/lib/finance/permissions";
import { clp, errorMessage, today } from "@/lib/finance/formatters";
import { useTransactions } from "@/lib/finance/hooks";
import { buildMonthCalendar, SPLIT } from "@/lib/finance/insights";
import { WORSHIP_WEEKDAYS } from "@/lib/finance/constants";
import type { FinanceTransaction, PeriodSelection } from "@/lib/finance/types";
import { findActiveDailyCash, type CashArea } from "@/lib/offerings/cash";
import {
  describeSumUpSyncResult,
  requestSumUpSync,
  saveGivingSettings,
  useGivingSettings,
  useSumUpIntegration,
  type GivingSettings,
  type SumUpIntegration,
} from "@/lib/offerings/client";
import { Empty, FinancePageHeader, Loading, Modal, Notice } from "@/components/finance/shared";
import { CashModal } from "@/components/finance/offerings/cash-modal";

const SUMUP_LEGACY_CATEGORY = "SumUp histórico sin separar";
const SPLIT_MONTH = SPLIT.slice(0, 7); // "2026-09"

function periodFromDate(date: string): PeriodSelection {
  const [year, month] = date.slice(0, 7).split("-").map(Number);
  return { year, month, view: "month" };
}

function shiftDate(date: string, deltaDays: number) {
  const d = new Date(`${date}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
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

function formatSyncTime(value?: { toDate: () => Date } | null) {
  const d = value?.toDate?.();
  if (!d || !Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(d)
    .replace(",", "");
}

function IntegrationLine({
  offerings,
  cafeteria,
  syncing,
  onSync,
}: {
  offerings: SumUpIntegration | null;
  cafeteria: SumUpIntegration | null;
  syncing: boolean;
  onSync: () => void;
}) {
  function part(label: string, data: SumUpIntegration | null) {
    const ok = data?.lastSyncStatus === "ok" || data?.lastSyncStatus === "partial";
    return (
      <span className="integration-line-part">
        {ok ? (
          <CircleCheck size={13} aria-hidden="true" />
        ) : (
          <CloudOff size={13} aria-hidden="true" />
        )}
        {`SumUp ${label}: ${ok ? "✓ Conectado" : data ? "Con error" : "Sin configurar"}`}
        {data?.lastSyncAt ? ` · ${formatSyncTime(data.lastSyncAt)}` : ""}
        {!ok && data?.lastError ? ` · ${data.lastError}` : ""}
      </span>
    );
  }
  return (
    <p className="integration-line">
      {part("Ofrendas", offerings)}
      <span className="integration-line-sep"> · </span>
      {part("Cafetería", cafeteria)}
      <button
        type="button"
        className="button-ghost integration-line-sync"
        disabled={syncing}
        onClick={onSync}
      >
        <RefreshCw size={14} aria-hidden="true" />
        {syncing ? "Sincronizando…" : "Sincronizar ahora"}
      </button>
    </p>
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

function AreaCard({
  title,
  dayLabel,
  monthLabel,
  monthSuffix,
  cardDay,
  cashDay,
  cardMonth,
  cashMonth,
  existingCash,
  onCash,
}: {
  title: string;
  dayLabel: string;
  monthLabel: string;
  monthSuffix: string;
  cardDay: number;
  cashDay: number;
  cardMonth: number;
  cashMonth: number;
  existingCash?: FinanceTransaction;
  onCash: () => void;
}) {
  const missingDayCash = cardDay > 0 && cashDay === 0;
  return (
    <div className="panel offering-area-card">
      <h3>{title}</h3>

      <div className="offering-area-block">
        <span className="offering-area-block-label">Día · {dayLabel}</span>
        <div className="offering-area-line">
          <span><CreditCard size={14} aria-hidden="true" />Tarjeta SumUp (bruto)</span>
          <strong className="tabular-nums">{clp(cardDay)}</strong>
        </div>
        <div className="offering-area-line">
          <span><Banknote size={14} aria-hidden="true" />Efectivo</span>
          {missingDayCash ? (
            <strong className="tabular-nums text-warning offering-area-warning">
              <TriangleAlert size={14} aria-hidden="true" />
              Falta efectivo
            </strong>
          ) : (
            <strong className="tabular-nums">{clp(cashDay)}</strong>
          )}
        </div>
        <div className="offering-area-line offering-area-total">
          <span>Total del día</span>
          <strong className="tabular-nums">{clp(cardDay + cashDay)}</strong>
        </div>
      </div>

      <div className="offering-area-block">
        <span className="offering-area-block-label">
          Mes · {monthLabel}
          {monthSuffix}
        </span>
        <div className="offering-area-line">
          <span><CreditCard size={14} aria-hidden="true" />Tarjeta SumUp (bruto)</span>
          <strong className="tabular-nums">{clp(cardMonth)}</strong>
        </div>
        <div className="offering-area-line">
          <span><Banknote size={14} aria-hidden="true" />Efectivo</span>
          <strong className="tabular-nums">{clp(cashMonth)}</strong>
        </div>
        <div className="offering-area-line offering-area-total">
          <span>Total del mes</span>
          <strong className="tabular-nums">{clp(cardMonth + cashMonth)}</strong>
        </div>
      </div>

      <button
        type="button"
        className={existingCash ? "button-secondary" : "button-primary"}
        onClick={onCash}
      >
        <Banknote size={16} aria-hidden="true" />
        {existingCash ? `Editar efectivo · ${clp(existingCash.amount)}` : "Registrar efectivo"}
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

  const offeringCash = findActiveDailyCash(
    financeTransactions.data,
    "offerings",
    selectedDate,
  );

  const cafeCash = findActiveDailyCash(
    financeTransactions.data,
    "cafeteria",
    selectedDate,
  );

  const separationActive = selectedDate >= SPLIT;

  const offeringCardDay = sumFinanceDay(financeTransactions.data, selectedDate, "Ofrendas", "card");
  const cafeCardDay = sumFinanceDay(financeTransactions.data, selectedDate, "Cafetería", "card");
  const offeringCardMonth = sumFinanceMonth(financeTransactions.data, "Ofrendas", "card");
  const offeringCashMonth = sumFinanceMonth(financeTransactions.data, "Ofrendas", "cash");
  const cafeCardMonth = sumFinanceMonth(financeTransactions.data, "Cafetería", "card");
  const cafeCashMonth = sumFinanceMonth(financeTransactions.data, "Cafetería", "cash");
  const legacyCardDay = sumFinanceDay(financeTransactions.data, selectedDate, SUMUP_LEGACY_CATEGORY, "card");
  const legacyCardMonth = sumFinanceMonth(financeTransactions.data, SUMUP_LEGACY_CATEGORY, "card");

  const monthHasLegacyDays = selectedDate.slice(0, 7) <= SPLIT_MONTH;
  const monthIncludesSplit = selectedDate.slice(0, 7) === SPLIT_MONTH;

  const dayLabel = new Date(`${selectedDate}T12:00:00.000Z`).toLocaleDateString("es-CL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const monthLabel = new Date(`${selectedDate}T12:00:00.000Z`).toLocaleDateString("es-CL", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const calendar = buildMonthCalendar(
    financeTransactions.data,
    periodFromDate(selectedDate).year,
    periodFromDate(selectedDate).month,
    today(),
    WORSHIP_WEEKDAYS,
  );
  const monthDaysRows = calendar.days
    .map((day) => ({
      day,
      offeringsCard: sumFinanceDay(financeTransactions.data, day.date, "Ofrendas", "card"),
      offeringsCash: sumFinanceDay(financeTransactions.data, day.date, "Ofrendas", "cash"),
      cafeCard: sumFinanceDay(financeTransactions.data, day.date, "Cafetería", "card"),
      cafeCash: sumFinanceDay(financeTransactions.data, day.date, "Cafetería", "cash"),
    }))
    .filter(
      (row) =>
        row.offeringsCard > 0 ||
        row.offeringsCash > 0 ||
        row.cafeCard > 0 ||
        row.cafeCash > 0 ||
        (row.day.isWorshipDay && row.day.date <= today()),
    )
    .reverse();

  async function sync() {
    if (!user || syncing) return;
    setSyncing(true);
    setSyncError("");
    setSyncMessage("");
    try {
      const result = await requestSumUpSync(user);
      const lines = result.results.map(describeSumUpSyncResult).join(" ");
      const allFailed = result.results.length > 0 && result.results.every((item) => item.status === "failed");
      if (allFailed) setSyncError(lines);
      else setSyncMessage(lines);
    } catch (error) {
      setSyncError(errorMessage(error));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <FinancePageHeader
        title="Ofrendas y Cafetería"
        subtitle="Tarjeta SumUp (bruto) y efectivo, por día y por mes."
      />

      <Notice error={syncError || settings.error || financeTransactions.error || offeringsIntegration.error || cafeIntegration.error} success={syncMessage} />

      <div className="offering-date-bar">
        <button
          type="button"
          className="button-secondary"
          aria-label="Día anterior"
          onClick={() => setSelectedDate((d) => shiftDate(d, -1))}
        >
          ‹
        </button>
        <label>
          Fecha
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="button-secondary"
          aria-label="Día siguiente"
          onClick={() => setSelectedDate((d) => shiftDate(d, 1))}
        >
          ›
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={() => setSelectedDate(today())}
        >
          Hoy
        </button>
      </div>

      {monthHasLegacyDays && legacyCardMonth > 0 && (
        <p className="field-help offering-legacy-line">
          Hasta el 08/09/2026 SumUp no separaba áreas: {clp(legacyCardMonth)}{" "}
          quedó como &ldquo;SumUp histórico sin separar&rdquo;.
        </p>
      )}

      {financeTransactions.loading ? (
        <Loading />
      ) : separationActive ? (
        <>
          <div className="offering-area-grid">
            <AreaCard
              title="Ofrendas"
              dayLabel={dayLabel}
              monthLabel={monthLabel}
              monthSuffix={monthIncludesSplit ? " (desde 09/09)" : ""}
              cardDay={offeringCardDay}
              cashDay={offeringCash?.amount || 0}
              cardMonth={offeringCardMonth}
              cashMonth={offeringCashMonth}
              existingCash={offeringCash}
              onCash={() => setCashArea("offerings")}
            />
            <AreaCard
              title="Cafetería"
              dayLabel={dayLabel}
              monthLabel={monthLabel}
              monthSuffix={monthIncludesSplit ? " (desde 09/09)" : ""}
              cardDay={cafeCardDay}
              cashDay={cafeCash?.amount || 0}
              cardMonth={cafeCardMonth}
              cashMonth={cafeCashMonth}
              existingCash={cafeCash}
              onCash={() => setCashArea("cafeteria")}
            />
          </div>
          <p className="field-help mt-3">
            Montos SumUp en bruto: la comisión aún no está disponible.
          </p>
        </>
      ) : (
        <div className="panel offering-area-card">
          <h3>Histórico SumUp</h3>
          <div className="offering-area-block">
            <span className="offering-area-block-label">Sin separación</span>
            <div className="offering-area-line">
              <span><CreditCard size={14} aria-hidden="true" />Tarjeta SumUp · bruto del día</span>
              <strong className="tabular-nums">{clp(legacyCardDay)}</strong>
            </div>
            <div className="offering-area-line offering-area-total">
              <span>Total del mes</span>
              <strong className="tabular-nums">{clp(legacyCardMonth)}</strong>
            </div>
          </div>
          <p className="field-help">
            Hasta el 08/09/2026 ambas operaciones usaban la misma cuenta
            SumUp. Conservamos el ingreso total, sin inventar cuánto
            correspondía a Ofrendas o Cafetería.
          </p>
        </div>
      )}

      <section className="mt-8">
        <div className="section-heading">
          <h2>Días del mes</h2>
        </div>
        {financeTransactions.loading ? (
          <Loading />
        ) : monthDaysRows.length ? (
          <div className="offering-days-table-wrap">
            <table className="offering-days-table">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Ofrendas SumUp</th>
                  <th scope="col">Ofrendas efectivo</th>
                  <th scope="col">Cafetería SumUp</th>
                  <th scope="col">Cafetería efectivo</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {monthDaysRows.map(({ day, offeringsCard, offeringsCash, cafeCard, cafeCash }) => (
                  <tr
                    key={day.date}
                    className={day.date === selectedDate ? "is-selected" : undefined}
                  >
                    <td>
                      <button type="button" className="offering-day-link" onClick={() => setSelectedDate(day.date)}>
                        {day.date.slice(8, 10)}-{day.date.slice(5, 7)}-{day.date.slice(0, 4)}
                      </button>
                    </td>
                    <td className="tabular-nums">{offeringsCard ? clp(offeringsCard) : "—"}</td>
                    <td className="tabular-nums">{offeringsCash ? clp(offeringsCash) : "—"}</td>
                    <td className="tabular-nums">{cafeCard ? clp(cafeCard) : "—"}</td>
                    <td className="tabular-nums">{cafeCash ? clp(cafeCash) : "—"}</td>
                    <td>
                      {day.missingCashAreas.length ? (
                        <span className="status-inline text-warning">
                          <TriangleAlert size={13} aria-hidden="true" />
                          {day.missingCashAreas.length === 2
                            ? "Falta efectivo · 2 áreas"
                            : `Falta efectivo · ${day.missingCashAreas[0]}`}
                        </span>
                      ) : day.noRecords ? (
                        <span className="status-inline text-muted">
                          <CircleDashed size={13} aria-hidden="true" />
                          Sin registros
                        </span>
                      ) : (
                        <span className="status-inline text-muted">
                          <CircleCheck size={13} aria-hidden="true" />
                          OK
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Sin ingresos de Ofrendas ni Cafetería en este mes.</Empty>
        )}
      </section>

      <IntegrationLine
        offerings={offeringsIntegration.data}
        cafeteria={cafeIntegration.data}
        syncing={syncing}
        onSync={() => void sync()}
      />

      <section className="panel offering-public-panel mt-4">
        <div><span className="eyebrow">LINK PÚBLICO</span><h2>Página pública de ofrendas · /ofrendar</h2></div>
        <div className="flex gap-2">
          <a className="button-secondary" href="/ofrendar" target="_blank" rel="noreferrer"><ExternalLink size={16} />Ver página</a>
          <button className="button-secondary" type="button" onClick={() => setConfiguring(true)}><Settings2 size={16} />Configurar</button>
        </div>
      </section>

      {configuring && <GivingSettingsModal current={settings.data} onClose={() => setConfiguring(false)} />}

      {cashArea && (
        <CashModal
          key={`${cashArea}-${selectedDate}-${
            (cashArea === "offerings" ? offeringCash : cafeCash)?.id || "new"
          }`}
          area={cashArea}
          date={selectedDate}
          allTransactionsForDay={financeTransactions.data}
          loading={financeTransactions.loading}
          onAreaChange={setCashArea}
          onDateChange={setSelectedDate}
          onClose={() => setCashArea(null)}
        />
      )}
    </>
  );
}
