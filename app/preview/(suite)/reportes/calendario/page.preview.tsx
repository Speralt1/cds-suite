import type { Metadata } from "next";
import { CalendarReport } from "@/components/suite-preview/reports/calendar-report";

export const metadata: Metadata = { title: "Reporte de calendario · Vista previa CDS Suite" };

export default function Page() {
  return <CalendarReport />;
}
