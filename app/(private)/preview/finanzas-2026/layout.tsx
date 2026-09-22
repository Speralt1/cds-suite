"use client";

import Link from "next/link";
import { useAccess } from "@/lib/auth/access-provider";
import { AppShell2026 } from "@/components/preview2026/app-shell-2026";
import "@/components/preview2026/tokens.css";

/**
 * Gate de acceso del preview 2026: solo admin.
 * Hereda AuthGuard + AccessProvider de app/(private)/layout.tsx, así que este
 * archivo (y todo lo que cuelga de él) no necesita ni debe importar
 * firebase/firestore directamente — ver Gate §5 del Design Lock.
 */
export default function Preview2026Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = useAccess();
  if (access.role !== "admin") {
    return (
      <div className="panel empty">
        <h1>Esta vista previa solo está disponible para administradores.</h1>
        <p className="mt-2">
          Es un borrador de diseño con datos de ejemplo, no una pantalla en
          producción.
        </p>
        <Link className="button-secondary mt-5" href="/dashboard">
          Volver al dashboard
        </Link>
      </div>
    );
  }
  return <AppShell2026>{children}</AppShell2026>;
}
