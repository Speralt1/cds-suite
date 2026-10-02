import type { Metadata } from "next";
import { NewPersonScreen } from "@/components/suite-preview/members/person-form";

export const metadata: Metadata = { title: "Nueva persona · Vista previa CDS Suite" };

export default function Page() {
  return <NewPersonScreen />;
}
