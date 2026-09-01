"use client";

import Link from "next/link";
import { useAccess } from "@/lib/auth/access-provider";

export function SettingsGuard({ children }: { children: React.ReactNode }) {
  const access = useAccess();
  if (access.role !== "admin")
    return (
      <div className="panel empty">
        <h1>Configuración solo está disponible para administradores.</h1>
        <p className="mt-2">
          Tu acceso actual no permite consultar ni modificar estos ajustes.
        </p>
        <Link className="button-secondary mt-5" href="/dashboard">
          Volver al dashboard
        </Link>
      </div>
    );
  return children;
}
