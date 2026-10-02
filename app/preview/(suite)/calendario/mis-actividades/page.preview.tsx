import type { Metadata } from "next";
import { MyActivitiesScreen } from "@/components/suite-preview/calendar/my-activities";

export const metadata: Metadata = { title: "Mis actividades · Vista previa CDS Suite" };

export default function Page() {
  return <MyActivitiesScreen />;
}
