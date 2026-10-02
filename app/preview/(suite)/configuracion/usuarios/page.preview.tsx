import type { Metadata } from "next";
import { UsersScreen } from "@/components/suite-preview/settings/users-screen";

export const metadata: Metadata = { title: "Usuarios y permisos · Vista previa CDS Suite" };

export default function Page() {
  return <UsersScreen />;
}
