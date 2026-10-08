"use client";

// "Sin módulos" (18b §1.5): cuenta activa sin ningún permiso de módulo.
// Pantalla completa sin sidebar ni barra inferior, sin redirecciones.

import { useState } from "react";
import { LoaderCircle, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-provider";
import { getAuthErrorMessage } from "@/lib/auth/errors";

export const NO_MODULES_TITLE = "Aún no tienes módulos asignados";
export const NO_MODULES_BODY =
  "Tu cuenta está activa, pero todavía no tiene permisos. Pide al administrador que te asigne un módulo.";

export function NoModulesScreen() {
  const { logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-12"
    >
      <span
        className="flex size-10 items-center justify-center rounded-xl bg-side text-sm font-bold text-side-accent"
        aria-hidden="true"
      >
        CS
      </span>
      <h1 className="mt-6 text-3xl font-medium tracking-tight">{NO_MODULES_TITLE}</h1>
      <p className="mt-4 leading-7 text-muted">{NO_MODULES_BODY}</p>
      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="button"
        className="mt-8 inline-flex min-h-11 items-center gap-2 self-start rounded-[10px] border border-line bg-white px-5 text-sm font-semibold text-ink hover:bg-canvas disabled:opacity-60"
        onClick={handleLogout}
        disabled={signingOut}
      >
        {signingOut ? (
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <LogOut className="size-4" aria-hidden="true" />
        )}
        {signingOut ? "Cerrando…" : "Cerrar sesión"}
      </button>
    </main>
  );
}
