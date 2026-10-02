import type { Metadata } from "next";
import { PeopleScreen } from "@/components/suite-preview/members/people";

export const metadata: Metadata = { title: "Personas · Vista previa CDS Suite" };

export default function Page() {
  return <PeopleScreen />;
}
