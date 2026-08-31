"use client";

import { FinanceWorkspace } from "@/components/finance/finance-workspace";

export default function FinancePage() {
  return (
    <>
      <div className="mb-9">
        <p className="mb-3 text-[10px] font-semibold tracking-[0.17em] text-primary">
          CASA DE SALVACIÓN
        </p>
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">
          Finanzas
        </h1>
        <p className="mt-4 text-sm leading-6 text-muted">
          Cuidamos los recursos. Acompañamos el propósito.
        </p>
      </div>
      <FinanceWorkspace />
    </>
  );
}
