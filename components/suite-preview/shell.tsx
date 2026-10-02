"use client";

// SuiteShell: shell global de CDS Suite (16b §3.1–3.3, 16c A.2).
// - Sidebar ≥1280: marca + <nav "Módulos"> con los módulos visibles; el módulo
//   activo despliega sus secciones en una <nav "{Módulo}"> anidada.
// - Rail 768–1279: el mismo DOM, compactado por CSS (módulos, divisor, secciones).
// - Móvil <768: banner con "Ver como", top bar con selector de módulo, barra
//   inferior calculada por bottomTabs() y sheet "Más".
// Contrato con PR #3: usa SOLO usePathname de next/navigation y funciona sin
// SuiteProvider (Administración sin simular: navegación completa, sin simulador).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, Ellipsis, LogOut, Plus, RotateCcw, type LucideIcon } from "lucide-react";
import { MODULE_DESCRIPTION, MODULE_LABEL, can, visibleModules } from "@/lib/suite-preview/access";
import { DEMO_NOW } from "@/lib/suite-preview/clock";
import { attentionQueue, computeAlerts } from "@/lib/suite-preview/consolidation";
import { USERS, initialsOf } from "@/lib/suite-preview/fixtures";
import {
  MODULE_ICON,
  activeSectionId,
  bottomTabs,
  flatSections,
  moduleLinkHref,
  moduleSections,
  moreSections,
  type BottomTab,
  type NavSection,
} from "@/lib/suite-preview/modules";
import { moduleOfPath, normalizePath } from "@/lib/suite-preview/routes";
import { initialSuiteState, type SuiteState } from "@/lib/suite-preview/store";
import type { AccessProfile, Area, ModuleId } from "@/lib/suite-preview/types";
import { attentionItems } from "@/lib/finance-preview/selectors";
import { usePreviewOptional } from "@/components/finance-preview/context";
import { REGISTER_ACTIONS } from "@/components/finance-preview/nav";
import { Sheet } from "@/components/finance-preview/ui";
import { DesktopDemoBanner, MobileDemoBanner } from "./demo-banner";
import { ICONS } from "./icons";
import { useSuiteOptional } from "./provider";
import { AccessNotice, SuiteFrame } from "./screens";

const FINANCE_ATTENTION_COUNT = attentionItems().length;
const UNSIMULATED_ADMIN: AccessProfile = USERS.find((u) => u.uid === "admin")!;

interface ShellModel {
  pathname: string;
  profile: AccessProfile;
  simulated: boolean;
  modules: ModuleId[];
  activeModule: ModuleId | null;
  hrefFor: (href: string) => string;
  badge: (s: NavSection) => number;
  areas: readonly Area[];
}

function useShellModel(): ShellModel {
  const suite = useSuiteOptional();
  const pathname = normalizePath(usePathname() ?? "/preview/finanzas-2026");
  const fallbackState = useMemo<SuiteState | null>(() => (suite ? null : initialSuiteState()), [suite]);
  const state = suite?.state ?? fallbackState!;
  const profile = suite?.profile ?? UNSIMULATED_ADMIN;
  const modules = visibleModules(profile);
  const mod = moduleOfPath(pathname);
  const canMembers = can(profile, "members.consolidation.read");
  const membersCount = useMemo(
    () => (canMembers ? attentionQueue(computeAlerts(state, DEMO_NOW, state.settings)).length : 0),
    [canMembers, state],
  );
  return {
    pathname,
    profile,
    simulated: !!suite,
    modules,
    activeModule: mod && modules.includes(mod) ? mod : null,
    hrefFor: suite ? suite.hrefFor : (href: string) => href,
    badge: (s) =>
      s.badge === "finance-attention" && can(profile, "finance.details.read")
        ? FINANCE_ATTENTION_COUNT
        : s.badge === "members-attention" && canMembers
          ? membersCount
          : 0,
    areas: state.areas,
  };
}

function Brand() {
  return (
    <div className="fx-brand">
      <span className="fx-brand-mark" aria-hidden="true">
        CS
      </span>
      <span className="fx-brand-text">
        <span className="fx-brand-name" style={{ display: "block" }}>
          Casa de Salvación
        </span>
        <span className="fx-brand-sub" style={{ display: "block" }}>
          CDS Suite
        </span>
      </span>
    </div>
  );
}

function cargoLine(p: AccessProfile, areas: readonly Area[], simulated: boolean): string {
  if (!simulated) return "Casa de Salvación";
  const names = p.areaIds.map((id) => areas.find((a) => a.id === id)?.name).filter(Boolean);
  // "Consolidación · Consolidación" → solo el cargo.
  if (names.length === 1 && names[0]!.trim().toLocaleLowerCase("es") === p.cargo.trim().toLocaleLowerCase("es")) return p.cargo;
  return names.length ? `${p.cargo} · ${names.join(", ")}` : p.cargo;
}

function SectionLink({ s, model, active }: { s: NavSection; model: ShellModel; active: boolean }) {
  const Icon = ICONS[s.icon];
  const count = model.badge(s);
  return (
    <li className={s.shortcut ? "sx-section-shortcut" : undefined}>
      <Link
        href={model.hrefFor(s.href)}
        className="fx-nav-link sx-section-link"
        aria-current={active ? "page" : undefined}
        aria-label={count ? `${s.label}, ${count} pendientes` : s.label}
        title={s.shortcut ? `${s.label} (abre otro módulo)` : undefined}
      >
        <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
        <span className="fx-nav-text">{s.label}</span>
        {s.shortcut && <ArrowUpRight size={12} className="sx-shortcut-icon" aria-hidden="true" />}
        {count > 0 && (
          <span className="fx-nav-badge" aria-hidden="true">
            {count}
          </span>
        )}
        <span className="fx-nav-tip" aria-hidden="true">
          {s.label}
        </span>
      </Link>
    </li>
  );
}

function SuiteSidebar({ model }: { model: ShellModel }) {
  const { profile } = model;
  return (
    <aside className="fx-sidebar sx-sidebar">
      <Brand />
      <nav aria-label="Módulos" className="sx-modules">
        <ul className="sx-module-list">
          {model.modules.map((m) => {
            const active = m === model.activeModule;
            const groups = moduleSections(m, profile);
            const leaf = flatSections(groups).length === 1;
            const Icon = ICONS[MODULE_ICON[m]];
            const current = active ? activeSectionId(groups, model.pathname) : null;
            return (
              <li key={m} className={`sx-module${active ? " is-active" : ""}${leaf ? " is-leaf" : ""}`}>
                <Link
                  href={model.hrefFor(moduleLinkHref(m, profile))}
                  className="fx-nav-link sx-module-link"
                  aria-current={active ? (leaf ? "page" : "true") : undefined}
                >
                  <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                  <span className="fx-nav-text">{MODULE_LABEL[m]}</span>
                  {!leaf && <ChevronDown size={16} className="sx-module-chevron" aria-hidden="true" />}
                  <span className="fx-nav-tip" aria-hidden="true">
                    {MODULE_LABEL[m]}
                  </span>
                </Link>
                {active && !leaf && (
                  <nav aria-label={MODULE_LABEL[m]} className="sx-sections">
                    {groups.map((g, gi) => (
                      <div className={`sx-section-group${g.items.every((s) => s.shortcut) ? " is-shortcuts" : ""}`} key={gi}>
                        {g.label && (
                          <span className="sx-section-label" id={`sx-${m}-group-${gi}`}>
                            {g.label}
                          </span>
                        )}
                        <ul className="fx-nav-list" aria-labelledby={g.label ? `sx-${m}-group-${gi}` : undefined}>
                          {g.items.map((s) => (
                            <SectionLink key={s.id} s={s} model={model} active={current === s.id} />
                          ))}
                        </ul>
                      </div>
                    ))}
                  </nav>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="fx-side-footer" title={model.simulated ? `${profile.displayName} · ${profile.cargo}` : "Administración (demo)"}>
        <span className="fx-avatar" aria-hidden="true">
          {initialsOf(profile)}
        </span>
        <span className="fx-side-text">
          <span className="fx-side-user" style={{ display: "block" }}>
            {profile.displayName}
          </span>
          <span className="fx-side-org" style={{ display: "block" }}>
            {cargoLine(profile, model.areas, model.simulated)}
          </span>
        </span>
      </div>
    </aside>
  );
}

function TabIcon({ icon: Icon, shortcut }: { icon: LucideIcon; shortcut?: boolean }) {
  return (
    <span className="fx-tab-icon" aria-hidden="true">
      <Icon size={22} strokeWidth={1.75} />
      {shortcut && <ArrowUpRight size={10} className="sx-tab-shortcut" />}
    </span>
  );
}

function MobileChrome({ model }: { model: ShellModel }) {
  const suite = useSuiteOptional();
  const preview = usePreviewOptional();
  const [sheet, setSheet] = useState<"none" | "modules" | "more" | "account" | "register">("none");
  const close = () => setSheet("none");
  const { profile, activeModule } = model;
  const tabs: BottomTab[] = activeModule ? bottomTabs(activeModule, profile) : [{ kind: "more" }];
  const groups = activeModule ? moduleSections(activeModule, profile) : [];
  const current = activeModule ? activeSectionId(groups, model.pathname) : null;
  const more = activeModule ? moreSections(activeModule, profile) : [];
  const moreActive = more.some((g) => g.items.some((s) => s.id === current && !s.shortcut));
  const otherModules = model.modules.filter((m) => m !== activeModule);
  const simulate = (what: string) => (preview ?? suite)?.simulate(what);

  const tab = (t: BottomTab, i: number) => {
    switch (t.kind) {
      case "section":
        return (
          <Link
            key={t.section.id}
            href={model.hrefFor(t.section.href)}
            className="fx-tab"
            aria-current={current === t.section.id ? "page" : undefined}
          >
            <TabIcon icon={ICONS[t.section.icon]} />
            {t.section.label}
          </Link>
        );
      case "attention": {
        const count = model.badge(t.section);
        return (
          <Link
            key={t.section.id}
            href={model.hrefFor(t.section.href)}
            className="fx-tab"
            aria-current={current === t.section.id ? "page" : undefined}
            aria-label={count ? `${t.section.label}, ${count} pendientes` : t.section.label}
          >
            <TabIcon icon={ICONS[t.section.icon]} />
            {count > 0 && (
              <span className="fx-nav-badge" aria-hidden="true">
                {count}
              </span>
            )}
            <span aria-hidden="true">{t.section.label}</span>
          </Link>
        );
      }
      case "create":
        return t.href ? (
          <Link key={`create-${i}`} href={model.hrefFor(t.href)} className="fx-tab fx-tab-plus">
            <TabIcon icon={Plus} />
            {t.label}
          </Link>
        ) : (
          <button key={`create-${i}`} type="button" className="fx-tab fx-tab-plus" onClick={() => setSheet("register")}>
            <TabIcon icon={Plus} />
            {t.label}
          </button>
        );
      case "shortcut":
        return (
          <Link key={`short-${t.module}`} href={model.hrefFor(t.href)} className="fx-tab" aria-label={t.ariaLabel}>
            <TabIcon icon={ICONS[t.icon]} shortcut />
            <span aria-hidden="true">{t.label}</span>
          </Link>
        );
      case "more":
        return (
          <button
            key="more"
            type="button"
            className="fx-tab"
            aria-current={moreActive ? "page" : undefined}
            onClick={() => setSheet("more")}
          >
            <TabIcon icon={Ellipsis} />
            Más
          </button>
        );
    }
  };

  const account = (
    <div className="sx-account">
      <p className="sx-account-name">{profile.displayName}</p>
      <p className="fx-help">{cargoLine(profile, model.areas, model.simulated)}</p>
      {suite && (
        <button
          type="button"
          className="fx-sheet-row"
          onClick={() => {
            close();
            suite.resetDemo();
          }}
        >
          <RotateCcw size={18} aria-hidden="true" /> Reiniciar demo
        </button>
      )}
      <Link href="/preview" className="fx-sheet-row" onClick={close}>
        <LogOut size={18} aria-hidden="true" /> Cerrar sesión
      </Link>
    </div>
  );

  return (
    <>
      <MobileDemoBanner simulator={!!suite} />
      <header className="fx-topbar sx-topbar">
        <span className="fx-brand-mark" aria-hidden="true">
          CS
        </span>
        {model.modules.length > 1 ? (
          <button type="button" className="sx-module-switch" aria-haspopup="dialog" onClick={() => setSheet("modules")}>
            {activeModule ? MODULE_LABEL[activeModule] : "CDS Suite"}
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        ) : (
          <span className="sx-module-switch is-static">{activeModule ? MODULE_LABEL[activeModule] : "CDS Suite"}</span>
        )}
        <span className="fx-topbar-end">
          <span className="fx-demo-pill">Demo</span>
          <button type="button" className="fx-topbar-btn" aria-label="Cuenta" onClick={() => setSheet("account")}>
            <span className="fx-avatar" aria-hidden="true">
              {initialsOf(profile)}
            </span>
          </button>
        </span>
      </header>
      <nav
        className="fx-bottombar sx-bottombar"
        aria-label="Navegación principal"
        style={{ "--sx-tabs": tabs.length } as React.CSSProperties}
      >
        {tabs.map(tab)}
      </nav>

      <Sheet open={sheet === "modules"} onClose={close} title="Cambiar de módulo" labelId="sx-modules-title">
        <ul>
          {model.modules.map((m) => {
            const Icon = ICONS[MODULE_ICON[m]];
            return (
              <li key={m}>
                <Link
                  href={model.hrefFor(moduleLinkHref(m, profile))}
                  className="sx-module-row"
                  aria-current={m === activeModule ? "true" : undefined}
                  onClick={close}
                >
                  <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                  <span className="sx-module-row-text">
                    <span className="sx-module-row-name">{MODULE_LABEL[m]}</span>
                    <span className="fx-help-13">{MODULE_DESCRIPTION[m]}</span>
                  </span>
                  {m === activeModule && <Check size={18} aria-label="Módulo actual" />}
                </Link>
              </li>
            );
          })}
        </ul>
      </Sheet>

      <Sheet open={sheet === "account"} onClose={close} title="Cuenta" labelId="sx-account-title">
        {account}
      </Sheet>

      <Sheet open={sheet === "more"} onClose={close} title="Más" labelId="sx-more-title">
        {more.length > 0 && (
          <nav aria-label="Más secciones">
            {more.map((g, gi) => (
              <div key={gi} style={{ marginTop: gi ? 12 : 0 }}>
                {g.label && <p className="fx-section-label">{g.label}</p>}
                {g.items.map((s) => {
                  const Icon = ICONS[s.icon];
                  return (
                    <Link
                      key={s.id}
                      href={model.hrefFor(s.href)}
                      className="fx-sheet-row"
                      aria-current={current === s.id && !s.shortcut ? "page" : undefined}
                      onClick={close}
                    >
                      <Icon size={20} strokeWidth={1.75} aria-hidden="true" /> {s.label}
                      {s.shortcut && <ArrowUpRight size={12} aria-hidden="true" />}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        )}
        {otherModules.length > 0 && (
          <div style={{ marginTop: more.length ? 16 : 0 }}>
            <p className="fx-section-label">Otros módulos</p>
            {otherModules.map((m) => {
              const Icon = ICONS[MODULE_ICON[m]];
              return (
                <Link key={m} href={model.hrefFor(moduleLinkHref(m, profile))} className="fx-sheet-row" onClick={close}>
                  <Icon size={20} strokeWidth={1.75} aria-hidden="true" /> {MODULE_LABEL[m]}
                </Link>
              );
            })}
          </div>
        )}
        <div style={{ marginTop: 16 }}>
          <p className="fx-section-label">Cuenta</p>
          {account}
        </div>
      </Sheet>

      <Sheet open={sheet === "register"} onClose={close} title="Registrar" labelId="fx-register-title">
        {REGISTER_ACTIONS.map((a) => (
          <button
            key={a}
            type="button"
            className="fx-sheet-row"
            onClick={() => {
              close();
              simulate(a);
            }}
          >
            <Plus size={18} aria-hidden="true" /> {a}
          </button>
        ))}
      </Sheet>
    </>
  );
}

export function SuiteShell({ children }: { children: React.ReactNode }) {
  const model = useShellModel();
  return (
    <SuiteFrame>
      <a className="fx-skip" href="#fx-main">
        Saltar al contenido
      </a>
      <div className="fx-shell">
        <SuiteSidebar model={model} />
        <div className="fx-column">
          <MobileChrome model={model} />
          <DesktopDemoBanner simulator={model.simulated} />
          <AccessNotice />
          <main id="fx-main" className="fx-main" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </SuiteFrame>
  );
}

