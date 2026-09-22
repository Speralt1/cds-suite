import { FinanceNav } from "@/components/finance/shared";
import { FinanceDataCacheProvider } from "@/lib/finance/hooks";
export default function FinanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <FinanceDataCacheProvider>
      <h1 className="mb-5 text-2xl font-medium">Finanzas</h1>
      <FinanceNav />
      <div className="mt-7">{children}</div>
    </FinanceDataCacheProvider>
  );
}
