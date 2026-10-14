"use client";

// Shell global de CDS Suite (18a §G, 18b §1, Design Lock 28 §C3). Mismo export y ruta.
// - ≥1280: sidebar oscura de 15rem, contraíble a rail de 4,5rem con la
//   hamburguesa (preferencia en localStorage cds.ui.sidebar; sin animar el ancho).
// - 1024–1279: rail fijo de 4,5rem con icono y ETIQUETA CORTA VISIBLE; la
//   hamburguesa abre el cajón modal con los nombres completos.
// - 768–1023: sin rail; barra superior oscura sticky con hamburguesa → cajón.
// - <768: barra superior oscura + barra inferior con los módulos permitidos
//   (≤4, sin "Más"); la hamburguesa abre el cajón.
// - Barra superior: <1024 oscura y sticky (hamburguesa · CS · módulo · Aa ·
//   avatar "Cuenta"); ≥1024 fila sobre canvas en la columna de contenido, no
//   sticky, con la hamburguesa a la izquierda y "Aa" a la derecha.
// - Orden de foco: skip link → hamburguesa → rail/sidebar → Aa → avatar → main.
//   Por eso la <aside> (position: fixed) vive en el DOM dentro del <header>
//   de la barra (landmarks anidados), entre la hamburguesa y "Aa".
// - La navegación lista MÓDULOS; las secciones viven en la subnav de cada
//   módulo dentro del contenido. Integrantes no existe.
// - Funciona sin AccessProvider (solo "Finanzas", como antes) y conserva el
//   skip link, <main id="main-content">, un único botón "Cerrar sesión" en el
//   DOM (el cajón y la hoja "Cuenta" solo se montan abiertos) y un único
//   role="alert" para el error de logout.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  CalendarDays,
  ChartColumn,
  LoaderCircle,
  LogOut,
  Menu,
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
import {
  applySidebarPref,
  applyTextSize,
  getSidebarPref,
  getTextSize,
  useMediaQuery,
  useSidebarPref,
  useTextSize,
} from "@/lib/ui/preferences";
import type { ModuleId } from "@/lib/shared/types";
import { NavDrawer } from "./nav-drawer";
import { NoModulesScreen } from "./no-modules";
import { NoticeProvider, NoticeRegion } from "./notice";
import { Sheet } from "./sheet";
import { TextSizeControl } from "./text-size-control";

const ICONS: Readonly<Record<ModuleIconName, LucideIcon>> = {
  Wallet,
  CalendarDays,
  ChartColumn,
  Settings,
};

/**
 * Etiqueta corta visible en el rail (1024–1279 o sidebar contraída) y en la
 * barra inferior en pantallas muy angostas (<360 px) o con texto al 110–125 %.
 * WCAG 2.5.3 (etiqueta en el nombre): el nombre accesible contiene la palabra
 * visible y el nombre completo, p. ej. "Ajustes · Configuración".
 */
const SHORT_LABEL: Partial<Record<ModuleId, string>> = { settings: "Ajustes" };

/** Nombre accesible del módulo cuando hay etiqueta corta (si no, el texto visible). */
export function moduleAccessibleName(id: ModuleId, label: string): string {
  const short = SHORT_LABEL[id];
  return short ? `${short} · ${label}` : label;
}

/** Sin AccessProvider el shell muestra solo Finanzas (comportamiento previo). */
const FALLBACK_MODULES: readonly ModuleId[] = ["finance"];

const WIDE_QUERY = "(min-width: 1280px)";

export function SuiteBrand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/inicio"
      aria-label="Casa de Salvación · CDS Suite"
      className={`app-brand${compact ? " is-compact" : ""}`}
    >
      <span className="app-brand-mark" aria-hidden="true">
        CS
      </span>
      <span className="app-brand-text" aria-hidden="true">
        <span className="app-brand-name">Casa de Salvación</span>
        <span className="app-brand-sub">CDS Suite</span>
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

function LogoutIcon({ signingOut }: { signingOut: boolean }) {
  return signingOut ? (
    <LoaderCircle className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
  ) : (
    <LogOut className="size-4 shrink-0" aria-hidden="true" />
  );
}

function ModuleNav({ modules, active }: { modules: readonly ModuleDef[]; active: ModuleId | null }) {
  return (
    <nav aria-label="Módulos" className="app-nav">
      <ul className="app-nav-list">
        {modules.map((m) => {
          const Icon = ICONS[m.icon];
          const current = m.id === active;
          return (
            <li key={m.id}>
              <Link
                href={m.href}
                aria-current={current ? "page" : undefined}
                aria-label={SHORT_LABEL[m.id] ? moduleAccessibleName(m.id, m.label) : undefined}
                className="app-nav-link"
              >
                <Icon className="app-nav-icon" strokeWidth={1.75} aria-hidden="true" />
                <span className="app-nav-label">{m.label}</span>
                <span className="app-nav-short" aria-hidden="true">
                  {SHORT_LABEL[m.id] ?? m.label}
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
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  // El cajón se abre "en" una ruta: al navegar (otra ruta) o pasar a ≥1280
  // queda cerrado sin efectos extra.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const [sidebar, setSidebar] = useSidebarPref();
  const [textSize] = useTextSize();
  const wide = useMediaQuery(WIDE_QUERY);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  // Al pasar a ≥1280 (p. ej. rotar un iPad Pro) se olvida el cajón abierto:
  // si no, volvería a abrirse solo al regresar a <1280.
  const [prevWide, setPrevWide] = useState(wide);
  if (prevWide !== wide) {
    setPrevWide(wide);
    if (wide) setDrawerPath(null);
  }
  const drawerOpen = drawerPath === pathname && !wide;
  const activeLabel = modules.find((m) => m.id === activeModule)?.label ?? "CDS Suite";
  const collapsed = sidebar === "collapsed";

  // El script previo al pintado ya fijó los atributos; se re-aplican antes de
  // pintar por si React los limpió (remontaje de Strict Mode en desarrollo).
  // Se lee el valor guardado y no el del hook: durante la hidratación el hook
  // devuelve el valor del servidor ("normal"/"expanded") y pintaría un parpadeo.
  useLayoutEffect(() => applyTextSize(getTextSize()), [textSize]);
  useLayoutEffect(() => applySidebarPref(getSidebarPref()), [sidebar]);

  // El foco vuelve a la hamburguesa al desmontarse el cajón (NavDrawer).
  const closeDrawer = useCallback(() => setDrawerPath(null), []);

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

  // Un solo role="alert": en el cajón o en la hoja "Cuenta" si están abiertos,
  // si no en el pie de la barra lateral.
  const alertIn: "drawer" | "sheet" | "footer" = drawerOpen ? "drawer" : accountOpen ? "sheet" : "footer";
  const errorAlert = (where: typeof alertIn, className: string) =>
    error && alertIn === where ? (
      <p role="alert" className={className}>
        {error}
      </p>
    ) : null;

  const hamburgerProps = wide
    ? {
        "aria-label": collapsed ? "Expandir barra lateral" : "Contraer barra lateral",
        "aria-expanded": !collapsed,
        "aria-controls": "app-sidebar",
        onClick: () => setSidebar(collapsed ? "expanded" : "collapsed"),
      }
    : {
        "aria-label": "Abrir menú de navegación",
        "aria-haspopup": "dialog" as const,
        "aria-expanded": drawerOpen,
        onClick: () => setDrawerPath(pathname),
      };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Saltar al contenido
      </a>

      <header className="app-topbar">
        <div className="app-topbar-inner">
          <button ref={hamburgerRef} type="button" className="app-hamburger" {...hamburgerProps}>
            <Menu className="size-6" strokeWidth={1.75} aria-hidden="true" />
          </button>
          <span className="app-topbar-brand">
            <SuiteBrand compact />
          </span>
          <p className="app-topbar-title">{activeLabel}</p>

          <aside id="app-sidebar" className="app-sidebar">
            <SuiteBrand />
            <ModuleNav modules={modules} active={activeModule} />
            <div className="app-account">
              <div className="app-account-row" title={account.name}>
                <Avatar initial={account.initial} />
                <div className="app-account-text">
                  <p className="truncate text-[0.8125rem] leading-[1.125rem] font-medium text-white">{account.name}</p>
                  {account.detail && (
                    <p className="truncate text-xs leading-4 text-side-muted" title={account.detail}>
                      {account.detail}
                    </p>
                  )}
                </div>
              </div>
              <button type="button" className="app-logout" onClick={handleLogout} disabled={signingOut}>
                <LogoutIcon signingOut={signingOut} />
                <span className="app-logout-label">{signingOut ? "Cerrando…" : "Cerrar sesión"}</span>
              </button>
              {errorAlert("footer", "app-logout-error")}
            </div>
          </aside>

          <TextSizeControl className="app-topbar-textsize" />
          <button
            type="button"
            className="app-topbar-account"
            aria-label="Cuenta"
            aria-haspopup="dialog"
            onClick={() => setAccountOpen(true)}
          >
            <Avatar initial={account.initial} />
          </button>
        </div>
      </header>

      <div className="app-content">
        <NoticeRegion />
        <main id="main-content" className="mx-auto max-w-7xl px-6 py-9 md:px-8 lg:pt-6 lg:pb-12 xl:px-12">
          {children}
        </main>
      </div>

      <nav
        aria-label="Barra de módulos"
        className="fixed inset-x-0 bottom-0 z-40 grid h-[calc(var(--bottombar-h)+env(safe-area-inset-bottom))] border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
        style={{ gridTemplateColumns: `repeat(${modules.length}, minmax(0, 1fr))` }}
      >
        {modules.map((m) => {
          const Icon = ICONS[m.icon];
          const current = m.id === activeModule;
          const short = SHORT_LABEL[m.id];
          return (
            <Link
              key={m.id}
              href={m.href}
              aria-label={moduleAccessibleName(m.id, m.label)}
              aria-current={current ? "page" : undefined}
              className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-[0.6875rem] leading-[0.875rem] font-medium ${current ? "text-primary" : "text-muted"}`}
            >
              <span
                className={`flex h-7 w-14 max-w-full items-center justify-center rounded-full ${current ? "bg-primary-soft" : ""}`}
                aria-hidden="true"
              >
                <Icon className="size-[1.375rem]" strokeWidth={1.75} />
              </span>
              <span
                className={`max-w-full truncate whitespace-nowrap ${short ? "bar-label-full max-[359px]:hidden" : ""}`}
                aria-hidden="true"
              >
                {m.label}
              </span>
              {short && (
                <span className="bar-label-short hidden max-w-full truncate whitespace-nowrap max-[359px]:block" aria-hidden="true">
                  {short}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {drawerOpen && (
        <NavDrawer
          modules={modules}
          active={activeModule}
          icons={ICONS}
          brand={<SuiteBrand />}
          onClosed={closeDrawer}
          returnFocusRef={hamburgerRef}
          footer={
            <>
              <div className="app-drawer-account">
                <Avatar initial={account.initial} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{account.name}</p>
                  {account.detail && <p className="truncate text-xs text-side-muted">{account.detail}</p>}
                </div>
              </div>
              <button type="button" className="app-drawer-logout" onClick={handleLogout} disabled={signingOut}>
                <LogoutIcon signingOut={signingOut} />
                {signingOut ? "Cerrando…" : "Cerrar sesión"}
              </button>
              {errorAlert("drawer", "mt-2 rounded-lg bg-white px-3 py-2 text-sm text-danger")}
            </>
          }
        />
      )}

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
            <LogoutIcon signingOut={signingOut} />
            {signingOut ? "Cerrando…" : "Cerrar sesión"}
          </button>
          {errorAlert("sheet", "mt-2 px-3 text-sm text-danger")}
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
