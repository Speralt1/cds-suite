"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarCheck,
  Wallet,
  Bell,
  Plus,
  MoreHorizontal,
  Receipt,
} from "lucide-react";
import { cx } from "./format";

const NAV = [
  { href: "/preview/finanzas-2026", label: "Hoy", icon: CalendarCheck },
  {
    href: "/preview/finanzas-2026/movimientos",
    label: "Movimientos",
    icon: Receipt,
  },
  { href: "/preview/finanzas-2026/caja/cerrar", label: "Caja", icon: Wallet },
];

const MOBILE_NAV = [
  { href: "/preview/finanzas-2026", label: "Hoy", icon: CalendarCheck },
  { href: "/preview/finanzas-2026/caja/cerrar", label: "Caja", icon: Wallet },
  { href: "/preview/finanzas-2026/movimientos", label: "Movimientos", icon: Plus },
  { href: "/preview/finanzas-2026", label: "Atención", icon: Bell },
];

/**
 * AppShell del preview 2026: sidebar en desktop, bottom bar en móvil.
 * Componente puramente presentacional, sin lecturas de datos.
 */
export function AppShell2026({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="p26-scope lg:flex">
      <div className="p26-preview-banner" role="status">
        Vista previa con datos de ejemplo — nada de esto se guarda ni afecta
        Firestore.
      </div>
      <div className="lg:flex lg:flex-1">
        <aside
          className="hidden border-r p-4 lg:block lg:w-60 lg:shrink-0"
          style={{ borderColor: "var(--p26-line)" }}
        >
          <p className="mb-4 px-2 text-xs font-semibold tracking-wide text-[var(--p26-muted)]">
            FINANZAS 2026 (preview)
          </p>
          <nav aria-label="Navegación del preview" className="flex flex-col gap-1">
            {NAV.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex items-center gap-2 rounded-[var(--p26-radius-control)] px-3 py-2 text-sm",
                    active
                      ? "bg-[var(--p26-primary-soft)] font-medium text-[var(--p26-primary)]"
                      : "text-[var(--p26-ink)] hover:bg-[var(--p26-primary-soft)]",
                  )}
                >
                  <Icon size={16} aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main id="p26-main" className="flex-1 px-4 pb-20 pt-4 lg:px-8 lg:pb-8 lg:pt-6">
          {children}
        </main>
      </div>
      <nav
        aria-label="Navegación inferior"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-[var(--p26-surface)] lg:hidden"
        style={{ borderColor: "var(--p26-line)" }}
      >
        {MOBILE_NAV.map((item, i) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={`${item.href}-${i}`}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex flex-1 flex-col items-center gap-1 py-2 text-[11px]",
                active ? "text-[var(--p26-primary)]" : "text-[var(--p26-muted)]",
              )}
              style={{ minHeight: 44 }}
            >
              <Icon size={18} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
        <span className="sr-only">
          <MoreHorizontal aria-hidden="true" />
        </span>
      </nav>
    </div>
  );
}
