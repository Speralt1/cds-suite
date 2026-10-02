"use client";

// SuiteProvider: estado global de la preview de CDS Suite (perfil simulado,
// store en memoria, toasts y aviso de acceso). Vive en app/preview/layout.tsx y
// envuelve Finanzas, los módulos nuevos y la página pública.
//
// - El perfil viene de `?perfil=` (sin él: Administración). Se "fija" en memoria
//   y KeepProfileInUrl lo repone en la URL al navegar (nunca en rutas públicas
//   ni en el ingreso). Sin almacenamiento del navegador.
// - dispatch(action, label) aplica el reducer puro (lib/suite-preview/store) con
//   el perfil simulado como actor y muestra "{label}. Simulación: no se guardó nada."
// - La navegación la ejecuta AccessGate (único lugar con useRouter): navigate()
//   y switchProfile() solo publican un `navRequest`.

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { effectivePermissions, landingLabel, resolveInitialModule } from "@/lib/suite-preview/access";
import { DEMO_NOW } from "@/lib/suite-preview/clock";
import { DEFAULT_PROFILE_SLUG, simulatorLabel } from "@/lib/suite-preview/fixtures";
import { isLoginPath, isPublicPath, normalizePath, PROFILE_PARAM, withProfile } from "@/lib/suite-preview/routes";
import { applyAction, initialSuiteState, type ActionResult, type SuiteAction, type SuiteActionInput, type SuiteState } from "@/lib/suite-preview/store";
import type { AccessProfile, Permission } from "@/lib/suite-preview/types";
import { SuiteToastContext, simulationMessage, type SuiteToastValue } from "./toast-context";
import { notifyQueryChange, useHydrated, useQueryParam } from "./use-query";

export interface AccessNoticeState {
  text: string;
  /** Ruta (sin query) donde se muestra; se limpia al salir de ella. */
  forPath: string;
}

export interface SuiteContextValue {
  /** URL leída tras hidratar (el HTML estático siempre es false). */
  ready: boolean;
  /** Slug del perfil simulado ("admin" si falta ?perfil). */
  profileId: string;
  /** null si ?perfil no corresponde a ningún perfil demo. */
  profile: AccessProfile | null;
  eff: ReadonlySet<Permission>;
  state: SuiteState;
  /** Aplica una acción con el perfil simulado como actor y muestra el toast. */
  dispatch: (action: SuiteActionInput, label?: string) => ActionResult;
  toast: (message: string, undo?: () => void) => void;
  simulate: (what?: string, undo?: () => void) => void;
  notice: AccessNoticeState | null;
  setNotice: (n: AccessNoticeState | null) => void;
  /** Cambia el perfil y navega a su módulo inicial (toast incluido). */
  switchProfile: (slug: string) => void;
  /** Navegación cliente (replace) conservando el perfil. La ejecuta AccessGate. */
  navigate: (href: string) => void;
  navRequest: { href: string; id: number } | null;
  /** href interno con `?perfil=` del perfil actual. */
  hrefFor: (href: string) => string;
  resetDemo: () => void;
  pathname: string;
}

const SuiteContext = createContext<SuiteContextValue | null>(null);

interface ToastState {
  id: number;
  message: string;
  undo?: () => void;
  tone: "info" | "error";
}

export function SuiteProvider({ children }: { children: React.ReactNode }) {
  const pathname = normalizePath(usePathname() ?? "/preview");
  const ready = useHydrated();
  const urlPerfil = useQueryParam(PROFILE_PARAM);

  const [state, setState] = useState<SuiteState>(initialSuiteState);
  const stateRef = useRef(state);
  const commit = useCallback((next: SuiteState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // ---- perfil ----
  const [chosen, setChosen] = useState<string | null>(null);
  const known = (slug: string | null) => !!slug && state.users.some((u) => u.uid === slug);
  // Fija en memoria el perfil de la URL la primera vez (patrón "derivar del render").
  if (chosen === null && ready && known(urlPerfil)) setChosen(urlPerfil);
  const profileId = chosen ?? (ready ? urlPerfil : null) ?? DEFAULT_PROFILE_SLUG;
  const profile = state.users.find((u) => u.uid === profileId) ?? null;
  const eff = useMemo(() => (profile ? effectivePermissions(profile) : new Set<Permission>()), [profile]);

  // ---- aviso de acceso: se limpia al salir de su ruta ----
  const [notice, setNotice] = useState<AccessNoticeState | null>(null);
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    if (notice && lastPath === notice.forPath && pathname !== notice.forPath) setNotice(null);
  }

  // ---- navegación (la ejecuta AccessGate) ----
  const [navRequest, setNavRequest] = useState<{ href: string; id: number } | null>(null);
  const navSeq = useRef(0);
  const navigate = useCallback((href: string) => {
    navSeq.current += 1;
    setNavRequest({ href, id: navSeq.current });
  }, []);

  // ---- toasts (región única role="status") ----
  const [current, setCurrent] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastSeq = useRef(0);
  const show = useCallback((message: string, undo?: () => void, tone: ToastState["tone"] = "info") => {
    if (timer.current) clearTimeout(timer.current);
    toastSeq.current += 1;
    setCurrent({ id: toastSeq.current, message, undo, tone });
    timer.current = setTimeout(() => setCurrent(null), undo ? 6000 : 5000);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const toast = useCallback((message: string, undo?: () => void) => show(message, undo), [show]);
  const simulate = useCallback((what?: string, undo?: () => void) => show(simulationMessage(what), undo), [show]);

  const dispatch = useCallback(
    (action: SuiteActionInput, label?: string): ActionResult => {
      const full = (action.type === "demo/reset" ? action : { ...action, by: profileId }) as SuiteAction;
      const result = applyAction(stateRef.current, full, DEMO_NOW);
      if (result.ok) {
        commit(result.state);
        show(simulationMessage(label));
      } else {
        show(result.error, undefined, "error");
      }
      return result;
    },
    [commit, profileId, show],
  );

  const hrefFor = useCallback((href: string) => withProfile(href, profileId), [profileId]);

  const switchProfile = useCallback(
    (slug: string) => {
      const target = stateRef.current.users.find((u) => u.uid === slug);
      if (!target) return;
      setChosen(slug);
      const landing = resolveInitialModule(target);
      show(
        landing.kind === "module"
          ? `Ahora ves CDS como ${simulatorLabel(target)}. ${landingLabel(landing).replace(/^Entra a/, "Entraste a")}.`
          : `Ahora ves CDS como ${simulatorLabel(target)}. ${landingLabel(landing)}.`,
      );
      if (landing.kind === "module") navigate(withProfile(landing.href, slug));
    },
    [navigate, show],
  );

  const resetDemo = useCallback(() => {
    commit(initialSuiteState());
    show("Demo reiniciada: se restauraron los datos de demostración.");
  }, [commit, show]);

  // ---- KeepProfileInUrl ----
  const profileValid = !!profile;
  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    const current = url.searchParams.get(PROFILE_PARAM);
    if (isPublicPath(url.pathname) || isLoginPath(url.pathname)) {
      if (current === null) return;
      url.searchParams.delete(PROFILE_PARAM);
    } else {
      if (!profileValid || current === profileId) return;
      url.searchParams.set(PROFILE_PARAM, profileId);
    }
    window.history.replaceState(window.history.state, "", url);
    notifyQueryChange();
  }, [ready, pathname, profileId, profileValid]);

  const toastValue = useMemo<SuiteToastValue>(() => ({ toast, simulate }), [toast, simulate]);
  const value = useMemo<SuiteContextValue>(
    () => ({
      ready,
      profileId,
      profile,
      eff,
      state,
      dispatch,
      toast,
      simulate,
      notice,
      setNotice,
      switchProfile,
      navigate,
      navRequest,
      hrefFor,
      resetDemo,
      pathname,
    }),
    [ready, profileId, profile, eff, state, dispatch, toast, simulate, notice, switchProfile, navigate, navRequest, hrefFor, resetDemo, pathname],
  );

  return (
    <SuiteContext.Provider value={value}>
      <SuiteToastContext.Provider value={toastValue}>
        {children}
        <div className="fx fx-toast-host" lang="es-CL">
          <div className="fx-toast-region" role="status" aria-live="polite">
            {current && (
              <div
                className={`fx-toast ${current.tone === "error" ? "sx-toast-error" : ""}`}
                key={current.id}
                onMouseEnter={() => timer.current && clearTimeout(timer.current)}
                onFocus={() => timer.current && clearTimeout(timer.current)}
                onMouseLeave={() => {
                  timer.current = setTimeout(() => setCurrent(null), 3000);
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4M12 8h.01" />
                </svg>
                <span>{current.message}</span>
                {current.undo && (
                  <button
                    type="button"
                    onClick={() => {
                      current.undo?.();
                      setCurrent(null);
                    }}
                  >
                    Deshacer
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </SuiteToastContext.Provider>
    </SuiteContext.Provider>
  );
}

/** Contexto de la suite (lanza fuera de SuiteProvider). */
export function useSuite(): SuiteContextValue {
  const ctx = useContext(SuiteContext);
  if (!ctx) throw new Error("useSuite debe usarse dentro de SuiteProvider");
  return ctx;
}

/** null fuera de SuiteProvider (p. ej. el test de PR #3 que renderiza FinancialShell solo). */
export function useSuiteOptional(): SuiteContextValue | null {
  return useContext(SuiteContext);
}
