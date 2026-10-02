import type { Metadata } from "next";
import { PersonScreen } from "@/components/suite-preview/members/person";

// Ficha por `?id=` (R2): el export estático no admite ids creados en la sesión.
export const metadata: Metadata = { title: "Ficha de persona · Vista previa CDS Suite" };

export default function Page() {
  return <PersonScreen />;
}
