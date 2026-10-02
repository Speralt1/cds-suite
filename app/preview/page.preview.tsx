import type { Metadata } from "next";
import { PreviewLogin } from "@/components/suite-preview/login";

export const metadata: Metadata = { title: "Ingresar · Vista previa CDS Suite" };

export default function Page() {
  return <PreviewLogin />;
}
