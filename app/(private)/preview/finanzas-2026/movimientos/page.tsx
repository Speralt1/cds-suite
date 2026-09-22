"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { MoneyAmount } from "@/components/preview2026/money-amount";
import { StatusBadge, type StatusKey } from "@/components/preview2026/status-badge";
import {
  MOVEMENTS,
  type Movement,
  type MovementSource,
  type MovementType,
} from "@/components/preview2026/fixtures";
import { formatDateShort } from "@/components/preview2026/format";

type SavedView = {
  id: string;
  label: string;
  filter: (m: Movement) => boolean;
};

const SAVED_VIEWS: SavedView[] = [
  { id: "hoy", label: "Hoy", filter: (m) => m.date === "2026-09-21" },
  { id: "mes", label: "Este mes", filter: () => true },
  { id: "ofrendas", label: "Ofrendas", filter: (m) => m.source === "ofrendas" },
  { id: "cafeteria", label: "Cafetería", filter: (m) => m.source === "cafeteria" },
  { id: "anulados", label: "Anulados", filter: (m) => m.status === "anulado" },
];

const TYPE_OPTIONS: { value: MovementType | "all"; label: string }[] = [
  { value: "all", label: "Todos los tipos" },
  { value: "income", label: "Ingreso" },
  { value: "expense", label: "Egreso" },
];
const SOURCE_OPTIONS: { value: MovementSource | "all"; label: string }[] = [
  { value: "all", label: "Todas las fuentes" },
  { value: "ofrendas", label: "Ofrendas" },
  { value: "cafeteria", label: "Cafetería" },
];
const STATUS_OPTIONS: { value: StatusKey | "all"; label: string }[] = [
  { value: "all", label: "Todos los estados" },
  { value: "pendiente", label: "Pendiente" },
  { value: "conciliado", label: "Conciliado" },
  { value: "con-diferencia", label: "Con diferencia" },
  { value: "requiere-revision", label: "Requiere revisión" },
  { value: "anulado", label: "Anulado" },
  { value: "reembolsado", label: "Reembolsado" },
];

export default function Preview2026MovimientosPage() {
  return (
    <Suspense fallback={null}>
      <Preview2026MovimientosContent />
    </Suspense>
  );
}

function Preview2026MovimientosContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [type, setType] = useState<MovementType | "all">("all");
  const [source, setSource] = useState<MovementSource | "all">("all");
  const [status, setStatus] = useState<StatusKey | "all">(
    (searchParams?.get("estado") as StatusKey | null) ?? "all",
  );
  const [search, setSearch] = useState("");
  const [savedViewId, setSavedViewId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Movement | null>(null);

  function applyStatus(next: StatusKey | "all") {
    setStatus(next);
    setSavedViewId(null);
    const params = new URLSearchParams(searchParams?.toString());
    if (next === "all") params.delete("estado");
    else params.set("estado", next);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  const filtered = useMemo(() => {
    const savedView = SAVED_VIEWS.find((v) => v.id === savedViewId);
    return MOVEMENTS.filter((m) => {
      if (savedView && !savedView.filter(m)) return false;
      if (type !== "all" && m.type !== type) return false;
      if (source !== "all" && m.source !== source) return false;
      if (status !== "all" && m.status !== status) return false;
      if (
        search &&
        !m.description.toLowerCase().includes(search.toLowerCase())
      )
        return false;
      return true;
    });
  }, [savedViewId, type, source, status, search]);

  const totals = useMemo(() => {
    const entradas = filtered
      .filter((m) => m.amount > 0)
      .reduce((sum, m) => sum + m.amount, 0);
    const salidas = filtered
      .filter((m) => m.amount < 0)
      .reduce((sum, m) => sum + m.amount, 0);
    return { entradas, salidas, neto: entradas + salidas, n: filtered.length };
  }, [filtered]);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-medium">Movimientos</h1>

      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Vistas guardadas">
        {SAVED_VIEWS.map((view) => (
          <button
            key={view.id}
            type="button"
            onClick={() => setSavedViewId(view.id === savedViewId ? null : view.id)}
            className="p26-badge p26-badge--neutral"
            aria-pressed={savedViewId === view.id}
            style={
              savedViewId === view.id
                ? { background: "var(--p26-primary-soft)", color: "var(--p26-primary)" }
                : undefined
            }
          >
            {view.label}
          </button>
        ))}
      </div>

      <div
        className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--p26-radius-control)] border p-2"
        style={{ borderColor: "var(--p26-line)" }}
      >
        <label className="sr-only" htmlFor="p26-filter-search">
          Buscar
        </label>
        <input
          id="p26-filter-search"
          type="search"
          placeholder="Buscar descripción…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-[var(--p26-radius-control)] border px-2 py-1 text-sm"
          style={{ borderColor: "var(--p26-line-strong)" }}
        />
        <label className="sr-only" htmlFor="p26-filter-type">
          Tipo
        </label>
        <select
          id="p26-filter-type"
          value={type}
          onChange={(e) => setType(e.target.value as MovementType | "all")}
          className="rounded-[var(--p26-radius-control)] border px-2 py-1 text-sm"
          style={{ borderColor: "var(--p26-line-strong)" }}
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="p26-filter-source">
          Fuente
        </label>
        <select
          id="p26-filter-source"
          value={source}
          onChange={(e) => setSource(e.target.value as MovementSource | "all")}
          className="rounded-[var(--p26-radius-control)] border px-2 py-1 text-sm"
          style={{ borderColor: "var(--p26-line-strong)" }}
        >
          {SOURCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="p26-filter-status">
          Estado
        </label>
        <select
          id="p26-filter-status"
          value={status}
          onChange={(e) => applyStatus(e.target.value as StatusKey | "all")}
          className="rounded-[var(--p26-radius-control)] border px-2 py-1 text-sm"
          style={{ borderColor: "var(--p26-line-strong)" }}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div
        data-testid="p26-totals-strip"
        className="mb-3 flex flex-wrap gap-6 rounded-[var(--p26-radius-control)] px-3 py-2 text-sm"
        style={{ background: "var(--p26-canvas)" }}
      >
        <span>
          Entradas <MoneyAmount value={totals.entradas} />
        </span>
        <span>
          Salidas <MoneyAmount value={totals.salidas} />
        </span>
        <span>
          Neto <MoneyAmount value={totals.neto} />
        </span>
        <span>{totals.n} movimientos</span>
      </div>

      {/* Tabla densa (desktop) */}
      <table className="p26-table hidden md:table" aria-label="Movimientos">
        <thead>
          <tr>
            <th scope="col">Fecha</th>
            <th scope="col">Descripción</th>
            <th scope="col">Fuente</th>
            <th scope="col">Método</th>
            <th scope="col">Origen</th>
            <th scope="col">Estado</th>
            <th scope="col" className="p26-num">
              Monto
            </th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((m) => (
            <tr
              key={m.id}
              onClick={() => setSelected(m)}
              style={{ cursor: "pointer" }}
            >
              <td>{formatDateShort(m.date)}</td>
              <td>
                {m.description}
                <span className="ml-2 text-xs text-[var(--p26-muted)]">
                  {m.category}
                </span>
              </td>
              <td className="capitalize">{m.source}</td>
              <td className="capitalize">{m.method}</td>
              <td>{m.origin === "sumup" ? "🔒 SumUp" : "Manual"}</td>
              <td>
                <StatusBadge status={m.status} />
              </td>
              <td className="p26-num">
                <MoneyAmount value={m.amount} basis={m.basis} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6}>Entradas − Salidas = Neto</td>
            <td className="p26-num">
              <MoneyAmount value={totals.neto} />
            </td>
          </tr>
        </tfoot>
      </table>

      {/* Lista de 2 líneas (móvil) */}
      <ul className="md:hidden">
        {filtered.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => setSelected(m)}
              className="flex w-full flex-col gap-0.5 border-b py-2 text-left"
              style={{ borderColor: "var(--p26-line)" }}
            >
              <span className="flex items-center justify-between text-sm">
                <span>{m.description}</span>
                <MoneyAmount value={m.amount} basis={m.basis} />
              </span>
              <span className="flex items-center justify-between text-xs text-[var(--p26-muted)]">
                <span>
                  {formatDateShort(m.date)} · {m.source}
                </span>
                <StatusBadge status={m.status} />
              </span>
            </button>
          </li>
        ))}
      </ul>

      {selected && (
        <div
          role="dialog"
          aria-label={`Detalle de ${selected.description}`}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col overflow-y-auto border-l bg-[var(--p26-surface)] p-5 shadow-lg"
          style={{ borderColor: "var(--p26-line)" }}
        >
          <button
            type="button"
            onClick={() => setSelected(null)}
            aria-label="Cerrar detalle"
            className="self-end p-2"
          >
            <X size={18} aria-hidden="true" />
          </button>
          <h2 className="text-lg font-medium">{selected.description}</h2>
          <StatusBadge status={selected.status} className="mt-2 self-start" />
          <dl className="mt-4 flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <dt>Bruto</dt>
              <dd>
                <MoneyAmount value={selected.amount} basis="bruto" />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Comisión</dt>
              <dd>—</dd>
            </div>
            <div className="flex justify-between">
              <dt>Líquido</dt>
              <dd>— (comisión no disponible)</dd>
            </div>
            <div className="flex justify-between">
              <dt>Fuente</dt>
              <dd className="capitalize">{selected.source}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Origen</dt>
              <dd>{selected.origin === "sumup" ? "SumUp (importado)" : "Manual"}</dd>
            </div>
          </dl>
          {selected.origin !== "sumup" && (
            <button type="button" className="p26-button p26-button--secondary mt-4 self-start">
              Editar
            </button>
          )}
          {selected.origin === "sumup" && (
            <div className="mt-4 flex gap-2">
              <button type="button" className="p26-button p26-button--secondary">
                Reclasificar
              </button>
              <button type="button" className="p26-button p26-button--ghost">
                Marcar para revisión
              </button>
            </div>
          )}
          <h3 className="mt-6 text-sm font-semibold">Historial</h3>
          <ul className="mt-2 flex flex-col gap-3 text-sm">
            <li>
              <p>
                <strong>{selected.createdBy}</strong> creó el movimiento.
              </p>
              <p className="text-xs text-[var(--p26-muted)]">
                {formatDateShort(selected.date)}
              </p>
            </li>
            {selected.reason && (
              <li>
                <p>
                  <strong>{selected.createdBy}</strong>: {selected.status} — antes → después
                </p>
                <p className="text-xs text-[var(--p26-muted)]">
                  Motivo: {selected.reason}
                </p>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
