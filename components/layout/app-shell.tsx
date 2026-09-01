"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Wallet,
  LogOut,
  LoaderCircle,
  ArrowUpRight,
  Settings,
} from "lucide-react";
import { Brand } from "@/components/layout/brand";
import { useAuth } from "@/lib/auth/auth-provider";
import { getAuthErrorMessage } from "@/lib/auth/errors";
import { useOptionalAccess } from "@/lib/auth/access-provider";

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/finanzas", label: "Finanzas", icon: Wallet },
  { href: "/configuracion", label: "Configuración", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const access = useOptionalAccess();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout() {
    setIsSigningOut(true);
    setError(null);
    try {
      await logout();
    } catch (error) {
      setError(getAuthErrorMessage(error));
      setIsSigningOut(false);
    }
  }

  return (
    <div className="min-h-dvh lg:flex">
      <a className="skip-link" href="#main-content">
        Saltar al contenido
      </a>
      <aside className="border-b border-line bg-white lg:fixed lg:inset-y-0 lg:flex lg:w-68 lg:flex-col lg:border-r lg:border-b-0">
        <div className="px-5 py-5 lg:px-7 lg:py-9">
          <Brand />
        </div>
        <div className="px-4 lg:mt-5 lg:px-5">
          <p className="mb-3 hidden px-3 text-[10px] font-semibold tracking-[0.17em] text-muted lg:block">
            ESPACIO DE TRABAJO
          </p>
          <nav
            className="app-main-nav flex gap-2 lg:flex-col"
            aria-label="Navegación principal"
          >
            {navigation
              .filter(
                ({ href }) =>
                  href !== "/configuracion" || access?.role === "admin",
              )
              .map(({ href, label, icon: Icon }) => {
                const active =
                  pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`flex flex-1 items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors lg:flex-none ${active ? "bg-primary-soft text-primary" : "text-muted hover:bg-canvas hover:text-ink"}`}
                  >
                    <Icon className="size-[18px]" aria-hidden="true" />
                    {label}
                    {active && (
                      <span
                        className="ml-auto size-1.5 rounded-full bg-primary"
                        aria-hidden="true"
                      />
                    )}
                  </Link>
                );
              })}
          </nav>
        </div>
        <div className="mt-4 px-5 pb-4 lg:mt-auto lg:px-6 lg:pb-7">
          <div className="mb-6 hidden rounded-2xl border border-line bg-canvas p-4 lg:block">
            <ArrowUpRight
              className="mb-3 size-5 text-primary"
              aria-hidden="true"
            />
            <p className="text-sm font-medium">Un mismo propósito.</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Un espacio para organizar y acompañar nuestra comunidad.
            </p>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line pt-4 lg:block">
            <div className="flex min-w-0 items-center gap-3 lg:mb-4">
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sand text-xs font-semibold text-primary"
                aria-hidden="true"
              >
                {(user?.email?.[0] || "U").toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium">Tu cuenta</p>
                <p
                  className="max-w-40 truncate text-xs text-muted"
                  title={user?.email || undefined}
                >
                  {user?.email}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="flex shrink-0 items-center gap-2 rounded-lg min-h-11 px-2 py-2 text-xs font-medium text-muted hover:bg-canvas hover:text-ink disabled:opacity-60 lg:w-full"
              onClick={handleLogout}
              disabled={isSigningOut}
            >
              {isSigningOut ? (
                <LoaderCircle
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <LogOut className="size-4" aria-hidden="true" />
              )}
              {isSigningOut ? "Cerrando…" : "Cerrar sesión"}
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      </aside>
      <div className="min-w-0 flex-1 lg:ml-68">
        <header className="flex h-19 items-center justify-between border-b border-line bg-white/70 px-6 lg:px-12">
          <p className="text-xs text-muted">
            Mi espacio <span className="mx-3 text-line">/</span>
            <span className="font-medium text-ink">
              {pathname.startsWith("/finanzas")
                ? "Finanzas"
                : pathname.startsWith("/configuracion")
                  ? "Configuración"
                  : "Dashboard"}
            </span>
          </p>
          <span className="rounded-full border border-line bg-white px-3 py-1 text-[10px] font-medium tracking-wide text-muted">
            CDS Suite · V0.2
          </span>
        </header>
        <main
          id="main-content"
          className="mx-auto max-w-7xl px-6 py-9 sm:px-8 lg:px-12 lg:py-12"
        >
          {children}
        </main>
        <footer className="mx-auto max-w-7xl px-6 py-7 text-xs text-muted sm:px-8 lg:px-12">
          Casa de Salvación <span className="mx-2 text-line">/</span> Juntos, al
          servicio de nuestra comunidad.
        </footer>
      </div>
    </div>
  );
}
