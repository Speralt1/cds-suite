import { ReportsNav } from "@/components/reports/reports-nav";
import "@/components/reports/reports.css";

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <h1 className="mb-3 text-xl font-semibold">Reportes</h1>
      <ReportsNav />
      <div className="mt-6">{children}</div>
    </>
  );
}
