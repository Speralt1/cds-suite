import { FinanceNav } from "@/components/finance/shared";
import { FinanceDataCacheProvider } from "@/lib/finance/hooks";
export default function FinanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <FinanceDataCacheProvider>
      <div className="mb-7">
        <p className="eyebrow">CASA DE SALVACIÓN</p>
        <h1 className="mt-2 text-3xl font-medium sm:text-4xl">Finanzas</h1>
        <p className="mt-3 text-sm text-muted">
          Cuidamos los recursos. Acompañamos el propósito.
        </p>
      </div>
      <FinanceNav />
      <div className="mt-7">{children}</div>
    </FinanceDataCacheProvider>
  );
}
