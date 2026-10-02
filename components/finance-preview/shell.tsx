"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { longDate, capitalize } from "@/lib/finance-preview/format";
import { DEMO_TODAY } from "@/lib/finance-preview/fixtures";
import {
  AVAILABLE_MONTHS,
  parsePeriod,
  periodKey,
  periodRangeNote,
  periodTitle,
  shiftMonth,
  type Period,
} from "@/lib/finance-preview/selectors";
import { SuiteShell } from "@/components/suite-preview/shell";
import { notifyQueryChange } from "@/components/suite-preview/use-query";
import { PreviewProvider, usePreview } from "./context";
import { BASE, REGISTER_ACTIONS } from "./nav";
import { ProposalPill } from "./ui";

// El shell global vive en components/suite-preview/shell.tsx (SuiteShell).
// FinancialShell conserva su export y su firma (contrato del test de PR #3) y
// compone SuiteShell: Finanzas pasa a ser un módulo más de CDS Suite.
// La navegación de Finanzas (BASE, NAV_GROUPS) vive en ./nav y se re-exporta aquí.
export { BASE, NAV_GROUPS, REGISTER_ACTIONS } from "./nav";

function KeepPeriodInUrl({ pathname }: { pathname: string }) {
  const { period, setPeriod } = usePreview();
  const periodRef = useRef(period);
  useEffect(() => {
    periodRef.current = period;
  }, [period]);
  // Al navegar con Link: si el destino trae ?periodo= válido se adopta; si no
  // trae, se repone el período visible para que la URL siga describiéndolo.
  useEffect(() => {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get("periodo");
    const current = periodKey(periodRef.current);
    if (raw && raw !== current && periodKey(parsePeriod(raw)) === raw) {
      setPeriod(parsePeriod(raw));
      return;
    }
    if (raw === current) return;
    url.searchParams.set("periodo", current);
    window.history.replaceState(null, "", url);
    notifyQueryChange();
  }, [pathname, setPeriod]);
  return null;
}

export function FinancialShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? BASE;
  return (
    <PreviewProvider>
      <KeepPeriodInUrl pathname={pathname} />
      <SuiteShell>{children}</SuiteShell>
    </PreviewProvider>
  );
}

// ---------- Header + período ----------

export function PeriodSelector({ allowYear = true }: { allowYear?: boolean }) {
  const { period, setPeriod } = usePreview();
  const prev = shiftMonth(period, -1);
  const next = shiftMonth(period, 1);
  const range = periodRangeNote(period);
  const years = [...new Set(AVAILABLE_MONTHS.map((m) => m.slice(0, 4)))];

  return (
    <div className="fx-period" role="group" aria-label="Período">
      {allowYear && (
        <div className="fx-segmented">
          <button
            type="button"
            aria-pressed={period.view === "month"}
            onClick={() => {
              if (period.view === "month") return;
              const last = AVAILABLE_MONTHS.filter((m) => m.startsWith(String(period.year))).at(-1)!;
              setPeriod({ view: "month", year: Number(last.slice(0, 4)), month: Number(last.slice(5)) });
            }}
          >
            Mes
          </button>
          <button
            type="button"
            aria-pressed={period.view === "year"}
            onClick={() => setPeriod({ view: "year", year: period.year })}
          >
            Año
          </button>
        </div>
      )}
      <div className="fx-stepper">
        {period.view === "month" ? (
          <>
            <button type="button" aria-label="Mes anterior" disabled={!prev} onClick={() => prev && setPeriod(prev)}>
              <ChevronLeft size={18} />
            </button>
            <label className="fx-stepper-label">
              <span className="fx-sr">Mes</span>
              <select
                value={periodKey(period)}
                onChange={(e) => {
                  const [y, m] = e.target.value.split("-").map(Number);
                  setPeriod({ view: "month", year: y, month: m });
                }}
              >
                {AVAILABLE_MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {periodTitle({ view: "month", year: Number(m.slice(0, 4)), month: Number(m.slice(5)) })}
                    {m === DEMO_TODAY.slice(0, 7) ? " · en curso" : ""}
                  </option>
                ))}
              </select>
              {range && <small>{range.split(" · ")[0]}</small>}
            </label>
            <button type="button" aria-label="Mes siguiente" disabled={!next} onClick={() => next && setPeriod(next)}>
              <ChevronRight size={18} />
            </button>
          </>
        ) : (
          <label className="fx-stepper-label" style={{ minWidth: 120 }}>
            <span className="fx-sr">Año</span>
            <select value={period.year} onChange={(e) => setPeriod({ view: "year", year: Number(e.target.value) })}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            {range && <small>{range}</small>}
          </label>
        )}
      </div>
    </div>
  );
}

export function RegisterMenu() {
  const { simulate } = usePreview();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="fx-menu fx-hide-mobile" ref={ref}>
      <button
        type="button"
        className="fx-btn fx-btn-primary"
        aria-expanded={open}
        aria-controls="fx-register-list"
        onClick={() => setOpen((v) => !v)}
      >
        <Plus size={16} aria-hidden="true" /> Registrar <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="fx-menu-list" id="fx-register-list">
          {REGISTER_ACTIONS.map((a) => (
            <button
              key={a}
              type="button"
              className="fx-menu-item"
              onClick={() => {
                setOpen(false);
                simulate(a);
              }}
            >
              {a}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function FinancialHeader({
  title,
  subtitle,
  proposal,
  period = true,
  allowYear = true,
  primary = "register",
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  proposal?: boolean;
  period?: boolean;
  allowYear?: boolean;
  primary?: "register" | "none";
  actions?: React.ReactNode;
}) {
  return (
    <header className="fx-header">
      <div className="fx-header-text">
        <h1 className="fx-h1">
          {title}
          {proposal && <ProposalPill />}
        </h1>
        {subtitle && <p className="fx-subtitle">{subtitle}</p>}
      </div>
      <div className="fx-header-actions">
        {period && <PeriodSelector allowYear={allowYear} />}
        {actions}
        {primary === "register" && <RegisterMenu />}
      </div>
    </header>
  );
}

export const TODAY_LABEL = capitalize(longDate(DEMO_TODAY).replace(/ de 2026$/, ""));
export type { Period };
