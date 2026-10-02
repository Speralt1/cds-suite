"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ChartColumn,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Ellipsis,
  FlaskConical,
  HandCoins,
  HandHeart,
  Inbox,
  LayoutDashboard,
  Plus,
  Scale,
  Settings,
  Target,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { DEMO_USER, FX_PREVIEW_SENTINEL } from "@/lib/finance-preview/fixtures";
import { longDate, capitalize } from "@/lib/finance-preview/format";
import { DEMO_TODAY } from "@/lib/finance-preview/fixtures";
import {
  AVAILABLE_MONTHS,
  attentionItems,
  periodKey,
  periodRangeNote,
  periodTitle,
  shiftMonth,
  type Period,
} from "@/lib/finance-preview/selectors";
import { PreviewProvider, usePreview } from "./context";
import { ProposalPill, Sheet } from "./ui";

export const BASE = "/preview/finanzas-2026";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: boolean;
}

export const NAV_GROUPS: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: BASE, label: "Hoy", icon: LayoutDashboard },
      { href: `${BASE}/atencion`, label: "Atención", icon: Inbox, badge: true },
      { href: `${BASE}/movimientos`, label: "Movimientos", icon: ArrowLeftRight },
      { href: `${BASE}/caja`, label: "Caja", icon: Wallet },
      { href: `${BASE}/conciliacion`, label: "Conciliación", icon: Scale },
    ],
  },
  {
    label: "Fuentes",
    items: [
      { href: `${BASE}/ofrendas`, label: "Ofrendas", icon: HandCoins },
      { href: `${BASE}/diezmos`, label: "Diezmos", icon: HandHeart },
      { href: `${BASE}/cafeteria`, label: "Cafetería", icon: Coffee },
      { href: `${BASE}/campanas`, label: "Campañas", icon: Target },
    ],
  },
  { label: "Análisis", items: [{ href: `${BASE}/reportes`, label: "Reportes", icon: ChartColumn }] },
  { label: "Sistema", items: [{ href: `${BASE}/configuracion`, label: "Configuración", icon: Settings }] },
];

const ATTENTION_COUNT = attentionItems().length;

function isActive(pathname: string, href: string) {
  const path = pathname.replace(/\/$/, "") || "/";
  if (href === BASE) return path === BASE || path === `${BASE}/hoy`;
  return path === href || path.startsWith(`${href}/`);
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="fx-brand">
      <span className="fx-brand-mark" aria-hidden="true">
        CS
      </span>
      {!compact && (
        <span className="fx-brand-text">
          <span className="fx-brand-name" style={{ display: "block" }}>
            Casa de Salvación
          </span>
          <span className="fx-brand-sub" style={{ display: "block" }}>
            Finanzas
          </span>
        </span>
      )}
    </div>
  );
}

function Sidebar({ pathname }: { pathname: string }) {
  return (
    <aside className="fx-sidebar">
      <Brand />
      <nav aria-label="Finanzas">
        {NAV_GROUPS.map((group, gi) => (
          <div className="fx-nav-group" key={gi}>
            {group.label && (
              <h2 className="fx-nav-label" id={`fx-nav-${gi}`}>
                {group.label}
              </h2>
            )}
            <ul className="fx-nav-list" aria-labelledby={group.label ? `fx-nav-${gi}` : undefined}>
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                const count = item.badge ? ATTENTION_COUNT : 0;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="fx-nav-link"
                      aria-current={active ? "page" : undefined}
                      aria-label={count ? `${item.label}, ${count} pendientes` : item.label}
                    >
                      <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                      <span className="fx-nav-text">{item.label}</span>
                      {count > 0 && (
                        <span className="fx-nav-badge" aria-hidden="true">
                          {count}
                        </span>
                      )}
                      <span className="fx-nav-tip" aria-hidden="true">
                        {item.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="fx-side-footer" title={`${DEMO_USER.role} (demo)`}>
        <span className="fx-avatar" aria-hidden="true">
          TD
        </span>
        <span className="fx-side-text">
          <span className="fx-side-user" style={{ display: "block" }}>
            {DEMO_USER.role} (demo)
          </span>
          <span className="fx-side-org" style={{ display: "block" }}>
            Casa de Salvación
          </span>
        </span>
      </div>
    </aside>
  );
}

export const REGISTER_ACTIONS = [
  "Registrar efectivo",
  "Registrar diezmo",
  "Registrar gasto",
  "Otro movimiento",
] as const;

function MobileNav({ pathname }: { pathname: string }) {
  const { simulate } = usePreview();
  const [sheet, setSheet] = useState<"none" | "register" | "more">("none");
  const tabs: NavItem[] = [NAV_GROUPS[0].items[0], NAV_GROUPS[0].items[2]];
  const moreItems = NAV_GROUPS.map((g, i) => ({
    ...g,
    items: i === 0 ? g.items.filter((it) => !["Hoy", "Movimientos", "Atención"].includes(it.label)) : g.items,
  }));
  const moreActive = moreItems.some((g) => g.items.some((it) => isActive(pathname, it.href)));
  const attention = NAV_GROUPS[0].items[1];

  const tab = (item: NavItem) => {
    const Icon = item.icon;
    const active = isActive(pathname, item.href);
    return (
      <Link key={item.href} href={item.href} className="fx-tab" aria-current={active ? "page" : undefined}>
        <span className="fx-tab-icon" aria-hidden="true">
          <Icon size={22} strokeWidth={1.75} />
        </span>
        {item.label}
      </Link>
    );
  };

  return (
    <>
      <div className="fx-banner-mobile" role="note">
        <FlaskConical size={13} aria-hidden="true" /> Vista previa · datos de demostración
      </div>
      <header className="fx-topbar">
        <span className="fx-brand-mark" aria-hidden="true">
          CS
        </span>
        <span className="fx-brand-name">Casa de Salvación</span>
        <span className="fx-topbar-end">
          <span className="fx-demo-pill">Demo</span>
          <button type="button" className="fx-topbar-btn" aria-label="Más secciones y cuenta" onClick={() => setSheet("more")}>
            <span className="fx-avatar" aria-hidden="true">
              TD
            </span>
          </button>
        </span>
      </header>
      <nav className="fx-bottombar" aria-label="Navegación principal">
        {tabs.map(tab)}
        <button type="button" className="fx-tab fx-tab-plus" onClick={() => setSheet("register")}>
          <span className="fx-tab-icon" aria-hidden="true">
            <Plus size={22} />
          </span>
          Registrar
        </button>
        <Link
          href={attention.href}
          className="fx-tab"
          aria-current={isActive(pathname, attention.href) ? "page" : undefined}
          aria-label={`Atención, ${ATTENTION_COUNT} pendientes`}
        >
          <span className="fx-tab-icon" aria-hidden="true">
            <Inbox size={22} strokeWidth={1.75} />
          </span>
          {ATTENTION_COUNT > 0 && (
            <span className="fx-nav-badge" aria-hidden="true">
              {ATTENTION_COUNT}
            </span>
          )}
          <span aria-hidden="true">Atención</span>
        </Link>
        <button
          type="button"
          className="fx-tab"
          aria-current={moreActive ? "page" : undefined}
          onClick={() => setSheet("more")}
        >
          <span className="fx-tab-icon" aria-hidden="true">
            <Ellipsis size={22} />
          </span>
          Más
        </button>
      </nav>

      <Sheet open={sheet === "register"} onClose={() => setSheet("none")} title="Registrar" labelId="fx-register-title">
        {REGISTER_ACTIONS.map((a) => (
          <button
            key={a}
            type="button"
            className="fx-sheet-row"
            onClick={() => {
              setSheet("none");
              simulate(a);
            }}
          >
            <Plus size={18} aria-hidden="true" /> {a}
          </button>
        ))}
      </Sheet>

      <Sheet open={sheet === "more"} onClose={() => setSheet("none")} title="Más secciones" labelId="fx-more-title">
        <nav aria-label="Más secciones">
          {moreItems.map((g, gi) => (
            <div key={gi} style={{ marginTop: gi ? 12 : 0 }}>
              {g.label && <p className="fx-section-label">{g.label}</p>}
              {g.items.map((it) => {
                const Icon = it.icon;
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    className="fx-sheet-row"
                    aria-current={isActive(pathname, it.href) ? "page" : undefined}
                    onClick={() => setSheet("none")}
                  >
                    <Icon size={20} strokeWidth={1.75} aria-hidden="true" /> {it.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <p className="fx-help" style={{ marginTop: 16 }}>
          {DEMO_USER.role} (demo) · Casa de Salvación
        </p>
      </Sheet>
    </>
  );
}

export function FinancialShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? BASE;
  return (
    <div className="fx" lang="es-CL" data-preview={FX_PREVIEW_SENTINEL}>
      <PreviewProvider>
        <a className="fx-skip" href="#fx-main">
          Saltar al contenido
        </a>
        <div className="fx-shell">
          <Sidebar pathname={pathname} />
          <div className="fx-column">
            <MobileNav pathname={pathname} />
            <div className="fx-banner" role="note">
              <FlaskConical size={14} aria-hidden="true" />
              <span>
                <strong>Vista previa · datos de demostración.</strong> Nada de lo que hagas aquí se guarda.
              </span>
            </div>
            <main id="fx-main" className="fx-main" tabIndex={-1}>
              {children}
            </main>
          </div>
        </div>
      </PreviewProvider>
    </div>
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
                  </option>
                ))}
              </select>
              {range && <small>{range}</small>}
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
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Plus size={16} aria-hidden="true" /> Registrar <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="fx-menu-list" role="menu">
          {REGISTER_ACTIONS.map((a) => (
            <button
              key={a}
              type="button"
              role="menuitem"
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
