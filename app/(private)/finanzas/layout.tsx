import { FinanceNav } from "@/components/finance/shared";
import { FinanceDataCacheProvider } from "@/lib/finance/hooks";
export default function FinanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <FinanceDataCacheProvider>
      <h1 className="mb-3 text-xl font-semibold">Finanzas</h1>
      <FinanceNav />
      <div className="mt-6">{children}</div>
    </FinanceDataCacheProvider>
  );
}
