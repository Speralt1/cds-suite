"use client";

// Shell global de CDS Suite (18a §G, 18b §1, 18 §10 R1/R7). Mismo export y ruta.
// - ≥1280: sidebar oscura de 240 px; 768–1279: rail de 72 px (mismo DOM,
//   compactado por CSS, con tooltips); <768: top bar + barra inferior solo con
//   los módulos permitidos (≤4, sin "Más"). La cuenta y "Cerrar sesión" viven
//   en el avatar de la top bar, que abre la hoja "Cuenta".
// - La navegación lista MÓDULOS; las secciones viven en la subnav de cada
//   módulo dentro del contenido (FinanceNav sin cambios). Integrantes no existe.
// - Funciona sin AccessProvider (solo "Finanzas", como antes) y conserva el
//   skip link, <main id="main-content">, el botón "Cerrar sesión" y un único
//   role="alert" para el error de logout.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  CalendarDays,
  ChartColumn,
  LoaderCircle,
  LogOut,
  Settings,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-provider";
import { getAuthErrorMessage } from "@/lib/auth/errors";
import { useOptionalAccess } from "@/lib/auth/access-provider";
import { useAccessModel } from "@/lib/access/model";
import { modulesFor, type ModuleDef, type ModuleIconName } from "@/lib/access/modules";
import { moduleOfPath } from "@/lib/access/routes";
import { useAreas } from "@/lib/calendar/areas-client";
import type { ModuleId } from "@/lib/shared/types";
import { NoModulesScreen } from "./no-modules";
import { NoticeProvider, NoticeRegion } from "./notice";
import { Sheet } from "./sheet";

const ICONS: Record<ModuleIconName, LucideIcon> = {
  Wallet,
  CalendarDays,
  ChartColumn,
  Settings,
};

/**
 * Etiqueta corta solo para la barra inferior en pantallas muy angostas (<360 px),
 * donde "Configuración" no cabe en una columna. El nombre accesible es el completo.
 */
const BAR_SHORT_LABEL: Partial<Record<ModuleId, string>> = { settings: "Ajustes" };

/** Sin AccessProvider el shell muestra solo Finanzas (comportamiento previo). */
const FALLBACK_MODULES: readonly ModuleId[] = ["finance"];

export function SuiteBrand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/inicio"
      aria-label="Casa de Salvación · CDS Suite"
      className="flex min-h-11 items-center gap-2.5 rounded-lg px-2 md:max-xl:justify-center md:max-xl:px-0"
    >
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-side-accent text-xs font-bold tracking-wide text-side"
        aria-hidden="true"
      >
        CS
      </span>
      <span className={compact ? "sr-only" : "min-w-0 md:max-xl:sr-only"} aria-hidden="true">
        <span className="block text-sm leading-[18px] font-semibold text-white">Casa de Salvación</span>
        <span className="block text-xs leading-4 text-side-muted">CDS Suite</span>
      </span>
    </Link>
  );
}

interface Account {
  name: string;
  detail: string;
  initial: string;
}

function accountLine(position: string, areaNames: readonly string[]): string {
  const names = areaNames.filter(
    (n) => n.trim().toLocaleLowerCase("es") !== position.trim().toLocaleLowerCase("es"),
  );
  return [position, names.join(", ")].filter(Boolean).join(" · ");
}

function Avatar({ initial, className = "" }: { initial: string; className?: string }) {
  return (
    <span
      className={`flex size-8 shrink-0 items-center justify-center rounded-full bg-side-active text-xs font-semibold text-side-text ${className}`}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

function LogoutContent({ signingOut }: { signingOut: boolean }) {
  return signingOut ? (
    <LoaderCircle className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
  ) : (
    <LogOut className="size-4 shrink-0" aria-hidden="true" />
  );
}

function ModuleNav({ modules, active }: { modules: readonly ModuleDef[]; active: ModuleId | null }) {
  return (
    <nav aria-label="Módulos" className="mt-2">
      <ul className="grid gap-0.5 md:max-xl:justify-items-center md:max-xl:gap-1">
        {modules.map((m) => {
          const Icon = ICONS[m.icon];
          const current = m.id === active;
          return (
            <li key={m.id}>
              <Link
                href={m.href}
                aria-current={current ? "page" : undefined}
                className={`group relative flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors md:max-xl:size-12 md:max-xl:justify-center md:max-xl:px-0 ${
                  current
                    ? "bg-side-active text-white before:absolute before:top-2.5 before:left-0 before:h-5 before:w-[3px] before:rounded-sm before:bg-side-accent md:max-xl:before:top-3.5"
                    : "text-side-text hover:bg-side-hover hover:text-white"
                }`}
              >
                <Icon className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate md:max-xl:sr-only">{m.label}</span>
                <span
                  className="pointer-events-none absolute top-1/2 left-full z-50 ml-2.5 hidden -translate-y-1/2 rounded-md border border-[#2c463a] bg-side px-2 py-1 text-xs font-medium whitespace-nowrap text-white opacity-0 transition-opacity delay-300 group-hover:opacity-100 group-focus-visible:opacity-100 md:max-xl:block"
                  aria-hidden="true"
                >
                  {m.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

interface FrameProps {
  children: React.ReactNode;
  modules: readonly ModuleDef[];
  activeModule: ModuleId | null;
  account: Account;
}

function ShellFrame({ children, modules, activeModule, account }: FrameProps) {
  const { logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const activeLabel = modules.find((m) => m.id === activeModule)?.label ?? "CDS Suite";

  async function handleLogout() {
    setSigningOut(true);
    setError(null);
    try {
      await logout();
    } catch (err) {
      setError(getAuthErrorMessage(err));
      setSigningOut(false);
    }
  }

  // Un solo role="alert": en la hoja móvil si está abierta, si no en el pie.
  const errorAlert = (className: string) =>
    error ? (
      <p role="alert" className={className}>
        {error}
      </p>
    ) : null;

  return (
    <div className="min-h-dvh [--finance-nav-top:56px] md:[--finance-nav-top:0px]">
      <a className="skip-link" href="#main-content">
        Saltar al contenido
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-18 flex-col bg-side px-2.5 py-3 text-side-text md:flex xl:w-60 xl:overflow-y-auto xl:px-3 [&_:focus-visible]:outline-side-focus">
        <SuiteBrand />
        <ModuleNav modules={modules} active={activeModule} />
        <div className="mt-auto border-t border-side-line pt-3">
          <div className="flex items-center gap-2.5 px-2 md:max-xl:justify-center md:max-xl:px-0" title={account.name}>
            <Avatar initial={account.initial} />
            <div className="min-w-0 md:max-xl:hidden">
              <p className="truncate text-[13px] leading-[18px] font-medium text-white">{account.name}</p>
              {account.detail && (
                <p className="truncate text-xs leading-4 text-side-muted" title={account.detail}>
                  {account.detail}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            className="group relative mt-2 flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-side-text hover:bg-side-hover hover:text-white disabled:opacity-60 md:max-xl:justify-center md:max-xl:px-0"
            onClick={handleLogout}
            disabled={signingOut}
          >
            <LogoutContent signingOut={signingOut} />
            <span className="md:max-xl:sr-only">{signingOut ? "Cerrando…" : "Cerrar sesión"}</span>
            <span
              className="pointer-events-none absolute top-1/2 left-full z-50 ml-2.5 hidden -translate-y-1/2 rounded-md border border-[#2c463a] bg-side px-2 py-1 text-xs font-medium whitespace-nowrap text-white opacity-0 transition-opacity delay-300 group-hover:opacity-100 group-focus-visible:opacity-100 md:max-xl:block"
              aria-hidden="true"
            >
              Cerrar sesión
            </span>
          </button>
          {!accountOpen &&
            errorAlert(
              "mt-2 px-2 text-xs leading-5 text-[#f4b4b4] md:max-xl:fixed md:max-xl:bottom-4 md:max-xl:left-20 md:max-xl:z-50 md:max-xl:w-64 md:max-xl:rounded-lg md:max-xl:bg-white md:max-xl:p-3 md:max-xl:text-danger md:max-xl:shadow-lg",
            )}
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 bg-side pr-2 pl-3 text-white md:hidden [&_:focus-visible]:outline-side-focus">
        <SuiteBrand compact />
        <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">{activeLabel}</p>
        <button
          type="button"
          className="flex size-11 items-center justify-center rounded-full"
          aria-label="Cuenta"
          aria-haspopup="dialog"
          onClick={() => setAccountOpen(true)}
        >
          <Avatar initial={account.initial} />
        </button>
      </header>

      <div className="min-w-0 pb-[calc(64px+env(safe-area-inset-bottom))] md:ml-18 md:pb-0 xl:ml-60">
        <NoticeRegion />
        <main id="main-content" className="mx-auto max-w-7xl px-6 py-9 sm:px-8 lg:px-12 lg:py-12">
          {children}
        </main>
      </div>

      <nav
        aria-label="Barra de módulos"
        className="fixed inset-x-0 bottom-0 z-40 grid h-[calc(64px+env(safe-area-inset-bottom))] border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
        style={{ gridTemplateColumns: `repeat(${modules.length}, minmax(0, 1fr))` }}
      >
        {modules.map((m) => {
          const Icon = ICONS[m.icon];
          const current = m.id === activeModule;
          const short = BAR_SHORT_LABEL[m.id];
          return (
            <Link
              key={m.id}
              href={m.href}
              aria-label={m.label}
              aria-current={current ? "page" : undefined}
              className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] leading-[14px] font-medium ${current ? "text-primary" : "text-muted"}`}
            >
              <span
                className={`flex h-7 w-14 max-w-full items-center justify-center rounded-full ${current ? "bg-primary-soft" : ""}`}
                aria-hidden="true"
              >
                <Icon className="size-[22px]" strokeWidth={1.75} />
              </span>
              <span className={`max-w-full truncate whitespace-nowrap ${short ? "max-[359px]:hidden" : ""}`} aria-hidden="true">
                {m.label}
              </span>
              {short && (
                <span className="hidden max-w-full truncate whitespace-nowrap max-[359px]:block" aria-hidden="true">
                  {short}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {accountOpen && (
        <Sheet title="Cuenta" onClose={() => setAccountOpen(false)}>
          <div className="flex items-center gap-3 px-2 pt-1 pb-3">
            <Avatar initial={account.initial} className="size-10 bg-primary-soft text-primary" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{account.name}</p>
              {account.detail && <p className="truncate text-xs text-muted">{account.detail}</p>}
            </div>
          </div>
          <button
            type="button"
            className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-60"
            onClick={handleLogout}
            disabled={signingOut}
          >
            <LogoutContent signingOut={signingOut} />
            {signingOut ? "Cerrando…" : "Cerrar sesión"}
          </button>
          {errorAlert("mt-2 px-3 text-sm text-danger")}
        </Sheet>
      )}
    </div>
  );
}

function AreaNames({
  ids,
  children,
}: {
  ids: readonly string[];
  children: (names: string[]) => React.ReactNode;
}) {
  const { areas } = useAreas();
  const names = ids
    .map((id) => areas.find((a) => a.id === id)?.name)
    .filter((n): n is string => !!n);
  return children(names);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const access = useOptionalAccess();
  const model = useAccessModel();

  if (access && model.home.kind === "no-modules") return <NoModulesScreen />;

  const modules = modulesFor(access ? model.modules : FALLBACK_MODULES);
  const pathModule = moduleOfPath(pathname);
  const activeModule = modules.some((m) => m.id === pathModule) ? pathModule : null;
  const name = access?.displayName?.trim() || user?.email || "Tu cuenta";
  const position = model.profile?.position ?? "";
  const frame = (areaNames: readonly string[]) => (
    <ShellFrame
      modules={modules}
      activeModule={activeModule}
      account={{ name, detail: accountLine(position, areaNames), initial: (name[0] || "U").toUpperCase() }}
    >
      {children}
    </ShellFrame>
  );
  // Los nombres de las áreas solo se leen si hay áreas y permiso de calendario.
  const withAreas = model.areaIds.length > 0 && model.can("calendar.read");

  return (
    <NoticeProvider>
      {withAreas ? <AreaNames ids={model.areaIds}>{frame}</AreaNames> : frame([])}
    </NoticeProvider>
  );
}
