"use client";

// Cajón de navegación (Design Lock 28 §C3): <dialog> modal nativo a la
// izquierda, ancho --drawer-w, 100dvh, fondo `side`. Contiene la marca, los
// módulos con su nombre completo (filas de 3rem), la cuenta y "Cerrar sesión".
// - Se cierra con Esc, con el fondo, con "Cerrar menú" y al navegar.
// - El foco vuelve a la hamburguesa (`returnFocusRef`) al desmontarse por
//   cualquier motivo: cierre, navegación o paso a ≥1280.
// - Solo se monta abierto: así "Cerrar sesión" y el role="alert" del logout
//   no se duplican en el DOM.
// Movimiento: entra en 200ms ease-out y sale en 160ms; sin animación con
// prefers-reduced-motion (o sin matchMedia), donde se cierra al instante.

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { X, type LucideIcon } from "lucide-react";
import type { ModuleDef, ModuleIconName } from "@/lib/access/modules";
import type { ModuleId } from "@/lib/shared/types";

const EXIT_MS = 160;

function prefersInstantClose(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface NavDrawerProps {
  modules: readonly ModuleDef[];
  active: ModuleId | null;
  icons: Readonly<Record<ModuleIconName, LucideIcon>>;
  brand: React.ReactNode;
  footer: React.ReactNode;
  /** Se llama cuando el cajón terminó de cerrarse (el shell lo desmonta). */
  onClosed: () => void;
  /** Control que recibe el foco cuando el cajón se desmonta (la hamburguesa). */
  returnFocusRef: React.RefObject<HTMLElement | null>;
}

export function NavDrawer({ modules, active, icons, brand, footer, onClosed, returnFocusRef }: NavDrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const exitTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.hasAttribute("open")) {
      // Sin soporte de showModal (navegadores antiguos, jsdom): abierto no modal.
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    closeRef.current?.focus();
    const returnTo = returnFocusRef;
    return () => {
      window.clearTimeout(exitTimer.current);
      if (dialog?.hasAttribute("open")) {
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
      }
      returnTo.current?.focus();
    };
  }, [returnFocusRef]);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (prefersInstantClose()) {
      onClosed();
      return;
    }
    setClosing(true);
    window.clearTimeout(exitTimer.current);
    exitTimer.current = window.setTimeout(onClosed, EXIT_MS);
  }, [onClosed]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`app-drawer${closing ? " is-closing" : ""}`}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        // Clic en el fondo (fuera del panel) cierra.
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div className="app-drawer-panel">
        <div className="app-drawer-head">
          <h2 id={titleId} className="sr-only">
            Menú de navegación
          </h2>
          {brand}
          <button
            ref={closeRef}
            type="button"
            className="app-drawer-close"
            aria-label="Cerrar menú"
            onClick={requestClose}
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <nav aria-label="Módulos" className="app-drawer-nav">
          <ul>
            {modules.map((m) => {
              const Icon = icons[m.icon];
              const current = m.id === active;
              return (
                <li key={m.id}>
                  <Link
                    href={m.href}
                    aria-current={current ? "page" : undefined}
                    className="app-drawer-link"
                    onClick={requestClose}
                  >
                    <Icon className="app-drawer-icon" strokeWidth={1.75} aria-hidden="true" />
                    <span>{m.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="app-drawer-footer">{footer}</div>
      </div>
    </dialog>
  );
}
