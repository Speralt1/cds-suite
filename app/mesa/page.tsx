import type { Metadata } from "next";
import { PublicTable } from "@/components/public-table/public-table";
import "@/components/public-table/public-table.css";

// Mesa pública de «Ve por los tuyos» (doc 40 · H4): sin shell ni AccessProvider.
// El enlace es /mesa#<edición>.<mesa>.<token>; el fragmento no llega al servidor.
export const metadata: Metadata = {
  title: { absolute: "Mesa · Ve por los tuyos | Casa de Salvación" },
  description: "Registro de la mesa en el evento Ve por los tuyos.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <PublicTable />;
}
