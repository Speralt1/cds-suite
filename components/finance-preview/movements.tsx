"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, Download, Lock, Search, SlidersHorizontal, SearchX } from "lucide-react";
import { clp, shortDate, timeOf } from "@/lib/finance-preview/format";
import { auditFor, TITHE_PROFILES } from "@/lib/finance-preview/fixtures";
import {
  categoryLabel,
  groupMovements,
  METHOD_LABEL,
  NO_FILTERS,
  rowActions,
  SOURCE_ORDER,
  totalsStrip,
  type MovementEntry,
  type MovementFilters,
} from "@/lib/finance-preview/selectors";
import type { DemoTransaction } from "@/lib/finance-preview/types";
import { usePreview } from "./context";
import { EmptyState, MoneyAmount, ProposalPill, Sheet, StatusBadge } from "./ui";

// ---------- Filtros ----------

const TYPE_OPTIONS = [
  ["all", "Tipo: todos"],
  ["income", "Entradas"],
  ["expense", "Salidas"],
] as const;
const METHOD_OPTIONS = [
  ["all", "Método: todos"],
  ["cash", "Efectivo"],
  ["card", "Tarjeta"],
  ["transfer", "Transferencia"],
  ["other", "Otro"],
] as const;
const STATUS_OPTIONS = [
  ["all", "Estado: todos"],
  ["active", "Activos"],
  ["voided", "Anulados"],
] as const;

function Chip({
  label,
  value,
  options,
  onChange,
  active,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (v: string) => void;
  active: boolean;
}) {
  return (
    <label className={`fx-chip ${active ? "is-active" : ""}`}>
      <span className="fx-sr">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <ChevronDown size={14} aria-hidden="true" />
    </label>
  );
}

const SOURCE_OPTIONS: readonly (readonly [string, string])[] = [
  ["all", "Fuente: todas"],
  ...SOURCE_ORDER.map((s) => [s, s] as const),
  ...["Servicios básicos", "Mantención", "Compras y materiales", "Ministerio Niños", "Música y Producción"].map(
    (s) => [s, s] as const,
  ),
];

export function activeFilterCount(f: MovementFilters) {
  return (["type", "source", "method", "status"] as const).filter((k) => f[k] !== "all").length;
}

function RadioGroup({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (v: string) => void;
}) {
  return (
    <fieldset className="fx-radio-group">
      <legend>{legend}</legend>
      {options.map(([v, l]) => (
        <label className="fx-radio" key={v}>
          <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />
          {v === "all" ? "Todos" : l}
        </label>
      ))}
    </fieldset>
  );
}

function FilterRadios({ f, set }: { f: MovementFilters; set: (f: MovementFilters) => void }) {
  return (
    <div className="fx-filter-stack">
      <RadioGroup legend="Tipo" name="fx-f-type" value={f.type} options={TYPE_OPTIONS} onChange={(v) => set({ ...f, type: v as MovementFilters["type"] })} />
      <RadioGroup legend="Fuente o categoría" name="fx-f-source" value={f.source} options={SOURCE_OPTIONS} onChange={(v) => set({ ...f, source: v })} />
      <RadioGroup legend="Método" name="fx-f-method" value={f.method} options={METHOD_OPTIONS} onChange={(v) => set({ ...f, method: v as MovementFilters["method"] })} />
      <RadioGroup legend="Estado" name="fx-f-status" value={f.status} options={STATUS_OPTIONS} onChange={(v) => set({ ...f, status: v as MovementFilters["status"] })} />
    </div>
  );
}

function FilterFields({ f, set }: { f: MovementFilters; set: (f: MovementFilters) => void }) {
  return (
    <>
      <Chip label="Tipo" value={f.type} options={TYPE_OPTIONS} active={f.type !== "all"} onChange={(v) => set({ ...f, type: v as MovementFilters["type"] })} />
      <Chip label="Fuente o categoría" value={f.source} options={SOURCE_OPTIONS} active={f.source !== "all"} onChange={(v) => set({ ...f, source: v })} />
      <Chip label="Método" value={f.method} options={METHOD_OPTIONS} active={f.method !== "all"} onChange={(v) => set({ ...f, method: v as MovementFilters["method"] })} />
      <Chip label="Estado" value={f.status} options={STATUS_OPTIONS} active={f.status !== "all"} onChange={(v) => set({ ...f, status: v as MovementFilters["status"] })} />
    </>
  );
}

export function FilterToolbar({
  filters,
  onChange,
  resultCount,
}: {
  filters: MovementFilters;
  onChange: (f: MovementFilters) => void;
  resultCount: number;
}) {
  const { simulate } = usePreview();
  const [sheet, setSheet] = useState(false);
  const n = activeFilterCount(filters);
  return (
    <div className="fx-toolbar" role="search">
      <label className="fx-search">
        <span className="fx-sr">Buscar movimientos</span>
        <Search size={16} aria-hidden="true" />
        <input
          className="fx-input"
          type="search"
          placeholder="Buscar descripción o monto"
          value={filters.q}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
        />
      </label>
      <FilterFields f={filters} set={onChange} />
      {n > 0 && (
        <button type="button" className="fx-btn fx-btn-ghost fx-btn-sm fx-hide-mobile" onClick={() => onChange({ ...NO_FILTERS, q: filters.q })}>
          Limpiar filtros
        </button>
      )}
      <div className="fx-toolbar-end">
        <button type="button" className="fx-btn fx-btn-secondary fx-show-mobile-only" onClick={() => setSheet(true)}>
          <SlidersHorizontal size={16} aria-hidden="true" /> Filtros{n ? ` (${n})` : ""}
        </button>
        <button type="button" className="fx-btn fx-btn-secondary fx-hide-mobile" onClick={() => simulate("Exportar movimientos")}>
          <Download size={16} aria-hidden="true" /> Exportar
        </button>
      </div>
      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="Filtros"
        labelId="fx-filters-title"
        footer={
          <>
            <button type="button" className="fx-btn fx-btn-secondary" onClick={() => onChange({ ...NO_FILTERS, q: filters.q })}>
              Limpiar
            </button>
            <button type="button" className="fx-btn fx-btn-primary" onClick={() => setSheet(false)}>
              Ver {resultCount} {resultCount === 1 ? "registro" : "registros"}
            </button>
          </>
        }
      >
        <FilterRadios f={filters} set={onChange} />
      </Sheet>
    </div>
  );
}

export function TotalsStrip({ items }: { items: readonly DemoTransaction[] }) {
  const t = totalsStrip(items);
  return (
    <div className="fx-strip">
      <span>
        Entradas<strong>{clp(t.income)}</strong>
      </span>
      <span>
        Salidas<strong>{clp(-t.expense)}</strong>
      </span>
      <span>
        Resultado del filtro<strong>{clp(t.net)}</strong>
      </span>
      <span>
        <strong style={{ marginLeft: 0 }}>{t.count.toLocaleString("es-CL")}</strong> registros activos
        {t.voided ? ` · ${t.voided} ${t.voided === 1 ? "anulado (no suma)" : "anulados (no suman)"}` : ""}
      </span>
      <span className="fx-sr" aria-live="polite">
        {t.count} registros coinciden con los filtros
      </span>
    </div>
  );
}

// ---------- Tabla ----------

function txStatus(t: DemoTransaction) {
  if (t.status === "voided") return <StatusBadge status={t.refund ? "refunded" : "voided"} />;
  if (t.possibleDuplicateOf) return <StatusBadge status="review" detail="posible duplicado" />;
  if (t.origin === "sumup") return <StatusBadge status="gross" />;
  return <span className="fx-help">Registrado</span>;
}

function TypeIcon({ type }: { type: DemoTransaction["type"] }) {
  return type === "income" ? (
    <ArrowDownLeft size={14} aria-label="Entrada" style={{ color: "var(--fx-success)", flexShrink: 0 }} />
  ) : (
    <ArrowUpRight size={14} aria-label="Salida" style={{ color: "var(--fx-ink)", flexShrink: 0 }} />
  );
}

function signed(t: DemoTransaction) {
  return t.type === "expense" ? -t.amount : t.amount;
}

function TxRow({
  t,
  onOpen,
  child,
  rowId,
}: {
  t: DemoTransaction;
  onOpen: (t: DemoTransaction) => void;
  child?: boolean;
  rowId?: string;
}) {
  const voided = t.status === "voided";
  return (
    <tr className={child ? "fx-child-row" : undefined} id={rowId}>
      <td className="fx-num" style={{ whiteSpace: "nowrap" }}>
        {child ? timeOf(`${t.date}T${t.time}`) : shortDate(t.date)}
      </td>
      <td>
        <button type="button" className="fx-row-btn" onClick={() => onOpen(t)}>
          <span className="fx-cell-main" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <TypeIcon type={t.type} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{child ? "Pago con tarjeta" : t.description}</span>
          </span>
          {!child && <span className="fx-cell-sub">{categoryLabel(t.category, t.type)}</span>}
        </button>
      </td>
      <td className="fx-hide-sm">{child ? "" : t.source === "tithe" ? "Diezmos" : categoryLabel(t.category, t.type)}</td>
      <td>{child ? "" : METHOD_LABEL[t.method]}</td>
      <td className="fx-hide-md">
        {child ? "" : t.origin === "sumup" ? (
          <span className="fx-origin">
            <Lock size={12} aria-hidden="true" /> SumUp
          </span>
        ) : (
          "Manual"
        )}
      </td>
      <td>{child && t.status === "active" ? "" : txStatus(t)}</td>
      <td className="is-num" style={{ fontWeight: child ? 400 : 500 }}>
        <MoneyAmount value={signed(t)} struck={voided} />
      </td>
    </tr>
  );
}

function GroupRows({
  entry,
  onOpen,
}: {
  entry: Extract<MovementEntry, { kind: "group" }>;
  onOpen: (t: DemoTransaction) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const n = entry.items.length;
  return (
    <tbody id={id}>
      <tr className="fx-group-row">
        <td className="fx-num" style={{ whiteSpace: "nowrap" }}>
          {shortDate(entry.date)}
        </td>
        <td>
          <span className="fx-cell-main" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <TypeIcon type="income" />
            {entry.label}
          </span>
          <span className="fx-cell-sub">
            {n} {n === 1 ? "pago" : "pagos"} con tarjeta ·{" "}
            <button
              type="button"
              className="fx-toggle"
              aria-expanded={open}
              aria-controls={id}
              onClick={() => setOpen((v) => !v)}
              style={{ height: 24, padding: "0 4px", marginLeft: -4 }}
            >
              {open ? `Ocultar ${n} pagos` : `Ver ${n} pagos`} <ChevronDown size={14} aria-hidden="true" />
            </button>
          </span>
        </td>
        <td className="fx-hide-sm">{entry.category}</td>
        <td>Tarjeta</td>
        <td className="fx-hide-md">
          <span className="fx-origin">
            <Lock size={12} aria-hidden="true" /> SumUp
          </span>
        </td>
        <td>{entry.status === "voided" ? <StatusBadge status="refunded" /> : <StatusBadge status="gross" />}</td>
        <td className="is-num" style={{ fontWeight: 600 }}>
          <MoneyAmount value={entry.amount} struck={entry.status === "voided"} />
        </td>
      </tr>
      {open && entry.items.map((t) => <TxRow key={t.id} t={t} onOpen={onOpen} child />)}
    </tbody>
  );
}

function MobileList({ entries, onOpen }: { entries: MovementEntry[]; onOpen: (t: DemoTransaction) => void }) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const days = [...new Set(entries.map((e) => (e.kind === "group" ? e.date : e.tx.date)))];
  return (
    <div className="fx-mobile-list">
      {days.map((d) => (
        <section key={d} aria-label={shortDate(d)}>
          <h3 className="fx-mlist-day">{shortDate(d)}</h3>
          <ul>
            {entries
              .filter((e) => (e.kind === "group" ? e.date : e.tx.date) === d)
              .map((e) =>
                e.kind === "group" ? (
                  <li key={e.key}>
                    <button
                      type="button"
                      className="fx-mlist-row"
                      aria-expanded={openGroup === e.key}
                      onClick={() => setOpenGroup((g) => (g === e.key ? null : e.key))}
                    >
                      <span className="fx-mlist-title">{e.label}</span>
                      <span className="fx-mlist-amount">
                        <MoneyAmount value={e.amount} struck={e.status === "voided"} />
                      </span>
                      <span className="fx-mlist-meta">
                        <span>
                          {e.items.length} pagos · Tarjeta · {openGroup === e.key ? "Ocultar" : "Ver pagos"}
                        </span>
                        {e.status === "voided" ? <StatusBadge status="refunded" /> : <StatusBadge status="gross" />}
                      </span>
                    </button>
                    {openGroup === e.key && (
                      <ul style={{ background: "var(--fx-surface-2)" }}>
                        {e.items.map((t) => (
                          <li key={t.id}>
                            <button type="button" className="fx-mlist-row" onClick={() => onOpen(t)} style={{ paddingLeft: 28, minHeight: 52 }}>
                              <span className="fx-mlist-title" style={{ fontSize: 14 }}>
                                Pago con tarjeta · {timeOf(`${t.date}T${t.time}`)}
                              </span>
                              <span className="fx-mlist-amount" style={{ fontSize: 14, fontWeight: 500 }}>
                                <MoneyAmount value={t.amount} struck={t.status === "voided"} />
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ) : (
                  <li key={e.key}>
                    <button type="button" className="fx-mlist-row" onClick={() => onOpen(e.tx)}>
                      <span className="fx-mlist-title">{e.tx.description}</span>
                      <span className="fx-mlist-amount">
                        <MoneyAmount value={signed(e.tx)} struck={e.tx.status === "voided"} />
                      </span>
                      <span className="fx-mlist-meta">
                        <span>
                          {categoryLabel(e.tx.category, e.tx.type)} · {METHOD_LABEL[e.tx.method]}
                        </span>
                        {(e.tx.status === "voided" || e.tx.possibleDuplicateOf) && txStatus(e.tx)}
                      </span>
                    </button>
                  </li>
                ),
              )}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Los grupos SumUp van en su propio <tbody> (aria-controls apunta ahí); las
 *  filas individuales consecutivas comparten uno. */
function chunkEntries(entries: MovementEntry[]) {
  const out: (
    | { kind: "group"; entry: Extract<MovementEntry, { kind: "group" }> }
    | { kind: "rows"; key: string; rows: DemoTransaction[] }
  )[] = [];
  for (const e of entries) {
    if (e.kind === "group") out.push({ kind: "group", entry: e });
    else {
      const last = out[out.length - 1];
      if (last?.kind === "rows") last.rows.push(e.tx);
      else out.push({ kind: "rows", key: `rows-${e.key}`, rows: [e.tx] });
    }
  }
  return out;
}

export function TransactionsTable({
  items,
  pageSize = 40,
  caption,
}: {
  items: readonly DemoTransaction[];
  pageSize?: number;
  caption: string;
}) {
  const [selected, setSelected] = useState<DemoTransaction | null>(null);
  const [page, setPage] = useState(0);
  const [sortAsc, setSortAsc] = useState(false);
  const entries = useMemo(() => {
    const e = groupMovements(items);
    return sortAsc ? [...e].reverse() : e;
  }, [items, sortAsc]);
  const pages = Math.max(1, Math.ceil(entries.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = entries.slice(current * pageSize, (current + 1) * pageSize);
  const sumUpCount = items.filter((t) => t.origin === "sumup").length;

  if (!entries.length)
    return (
      <EmptyState
        icon={SearchX}
        title="Ningún movimiento coincide con los filtros"
        body="Prueba con otra búsqueda o limpia los filtros."
      />
    );

  return (
    <>
      <div className="fx-table-wrap fx-desktop-table">
        <table className="fx-table fx-table-fixed">
          <caption className="fx-sr">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" aria-sort={sortAsc ? "ascending" : "descending"} style={{ width: 100 }}>
                <button type="button" onClick={() => setSortAsc((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 600, cursor: "pointer" }}>
                  Fecha <ChevronDown size={12} aria-hidden="true" style={{ transform: sortAsc ? "rotate(180deg)" : undefined }} />
                </button>
              </th>
              <th scope="col">Descripción</th>
              <th scope="col" className="fx-hide-sm" style={{ width: 128 }}>
                Fuente
              </th>
              <th scope="col" style={{ width: 108 }}>
                Método
              </th>
              <th scope="col" className="fx-hide-md" style={{ width: 92 }}>
                Origen
              </th>
              <th scope="col" style={{ width: 144 }}>
                Estado
              </th>
              <th scope="col" className="is-num" style={{ width: 128 }}>
                Monto
              </th>
            </tr>
          </thead>
          {chunkEntries(visible).map((chunk) =>
            chunk.kind === "group" ? (
              <GroupRows key={chunk.entry.key} entry={chunk.entry} onOpen={setSelected} />
            ) : (
              <tbody key={chunk.key}>
                {chunk.rows.map((t) => (
                  <TxRow key={t.id} t={t} onOpen={setSelected} />
                ))}
              </tbody>
            ),
          )}
        </table>
      </div>
      <MobileList entries={visible} onOpen={setSelected} />
      <div className="fx-pager">
        <span>
          Mostrando {current * pageSize + 1}–{Math.min((current + 1) * pageSize, entries.length)} de {entries.length} filas ·{" "}
          {items.length.toLocaleString("es-CL")} registros ({sumUpCount} pagos SumUp agrupados por día)
        </span>
        <span style={{ display: "flex", gap: 4 }}>
          <button type="button" className="fx-btn fx-btn-secondary fx-btn-sm" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Página anterior">
            ‹
          </button>
          <button type="button" className="fx-btn fx-btn-secondary fx-btn-sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} aria-label="Página siguiente">
            ›
          </button>
        </span>
      </div>
      <DetailSheet tx={selected} onClose={() => setSelected(null)} />
    </>
  );
}

// ---------- Detalle ----------

export function DetailSheet({ tx, onClose }: { tx: DemoTransaction | null; onClose: () => void }) {
  const { simulate } = usePreview();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (voiding) reasonRef.current?.focus();
  }, [voiding]);
  const actions = tx ? rowActions(tx) : [];
  const profile = tx?.profileId ? TITHE_PROFILES.find((p) => p.id === tx.profileId) : undefined;
  const close = () => {
    setVoiding(false);
    setReason("");
    setTouched(false);
    onClose();
  };

  return (
    <Sheet
      open={!!tx}
      onClose={close}
      labelId="fx-detail-title"
      title={tx ? (tx.origin === "sumup" ? `Pago SumUp · ${tx.category}` : tx.description) : ""}
      subtitle={tx ? `${shortDate(tx.date)} · ${tx.time}` : undefined}
      footer={
        tx && !voiding ? (
          <>
            {actions.includes("editar") && (
              <button type="button" className="fx-btn fx-btn-secondary" onClick={() => simulate("Editar movimiento")}>
                Editar
              </button>
            )}
            {actions.includes("anular") && (
              <button type="button" className="fx-btn fx-btn-danger" onClick={() => setVoiding(true)}>
                Anular {clp(tx.amount)}
              </button>
            )}
            {actions.includes("reclasificar") && (
              <button type="button" className="fx-btn fx-btn-secondary" onClick={() => simulate("Reclasificar pago SumUp")}>
                Reclasificar
              </button>
            )}
            {actions.includes("revisar") && (
              <button type="button" className="fx-btn fx-btn-secondary" onClick={() => simulate("Marcar para revisión")}>
                Marcar para revisión
              </button>
            )}
            {actions.length === 1 && <span className="fx-help">Movimiento anulado: solo lectura.</span>}
          </>
        ) : tx && voiding ? (
          <>
            <button type="button" className="fx-btn fx-btn-secondary" onClick={() => setVoiding(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="fx-btn fx-btn-danger"
              onClick={() => {
                setTouched(true);
                if (reason.trim().length < 3) return;
                close();
                simulate(`Anular ${clp(tx.amount)}`);
              }}
            >
              Confirmar anulación
            </button>
          </>
        ) : undefined
      }
    >
      {tx && (
        <>
          <div className="fx-sheet-section">
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <MoneyAmount value={signed(tx)} size="lg" struck={tx.status === "voided"} basis={tx.origin === "sumup" ? "bruto" : undefined} />
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {txStatus(tx)}
              {tx.origin === "sumup" && <StatusBadge status="sumupLocked" />}
            </div>
            {tx.status === "voided" && tx.voidReason && (
              <p className="fx-help-13" style={{ marginTop: 8 }}>
                Motivo: {tx.voidReason}
              </p>
            )}
          </div>

          {voiding && (
            <div className="fx-sheet-section">
              <h3 className="fx-h3">Anular movimiento</h3>
              <p className="fx-help-13">El movimiento no se borra: queda tachado, deja de sumar y conserva quién lo anuló y por qué.</p>
              <div className="fx-field">
                <label htmlFor="fx-void-reason">Motivo (obligatorio)</label>
                <textarea
                  id="fx-void-reason"
                  ref={reasonRef}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  aria-invalid={touched && reason.trim().length < 3}
                  aria-describedby={touched && reason.trim().length < 3 ? "fx-void-err" : undefined}
                />
                {touched && reason.trim().length < 3 && (
                  <p className="fx-error" id="fx-void-err" role="alert">
                    Escribe el motivo de la anulación (mínimo 3 caracteres).
                  </p>
                )}
              </div>
            </div>
          )}

          {tx.origin === "sumup" && (
            <div className="fx-sheet-section">
              <h3 className="fx-h3">Montos</h3>
              <dl className="fx-dl">
                <dt>Bruto cobrado</dt>
                <dd>
                  <MoneyAmount value={tx.amount} />
                </dd>
                <dt>Devolución</dt>
                <dd>{tx.refund ? <MoneyAmount value={-tx.amount} /> : clp(0)}</dd>
                <dt>Comisión SumUp</dt>
                <dd>
                  <StatusBadge status="feePending" />
                </dd>
              </dl>
              <p className="fx-help" style={{ marginTop: 8 }}>
                El líquido se mostrará cuando SumUp entregue la comisión real. No se estima.
              </p>
            </div>
          )}

          <div className="fx-sheet-section">
            <h3 className="fx-h3">Datos</h3>
            <dl className="fx-dl">
              <dt>Fecha</dt>
              <dd>
                {shortDate(tx.date)} {tx.date.slice(0, 4)}
              </dd>
              <dt>Tipo</dt>
              <dd>{tx.type === "income" ? "Entrada" : "Salida"}</dd>
              <dt>Fuente / categoría</dt>
              <dd>{categoryLabel(tx.category, tx.type)}</dd>
              <dt>Método</dt>
              <dd>{METHOD_LABEL[tx.method]}</dd>
              <dt>Origen</dt>
              <dd>{tx.origin === "sumup" ? "Importado de SumUp" : "Registro manual"}</dd>
              <dt>Registrado por</dt>
              <dd>{tx.createdBy}</dd>
              {profile && (
                <>
                  <dt>Ficha de diezmo</dt>
                  <dd>{profile.name}</dd>
                </>
              )}
            </dl>
          </div>

          <div className="fx-sheet-section">
            <h3 className="fx-h3">Historial</h3>
            <ol className="fx-timeline">
              {auditFor(tx).map((a) => (
                <li key={a.at + a.action}>
                  <strong style={{ fontWeight: 600 }}>{a.action}</strong> · {a.actor}
                  <br />
                  <span className="fx-help">
                    {shortDate(a.at)} {a.at.slice(0, 4)} · {a.at.slice(11, 16)}
                    {a.detail ? ` · ${a.detail}` : ""}
                  </span>
                </li>
              ))}
            </ol>
            <p className="fx-help" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              Cambios antes → después, con motivo <ProposalPill />
            </p>
          </div>
        </>
      )}
    </Sheet>
  );
}
