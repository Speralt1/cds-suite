import type { Metadata } from "next";
import { CalendarScreen } from "@/components/suite-preview/calendar/calendar-screen";

export const metadata: Metadata = { title: "Calendario · Vista previa CDS Suite" };

export default function Page() {
  return <CalendarScreen />;
}
