import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth/auth-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "CDS Administración | Casa de Salvación",
    template: "%s | CDS Administración",
  },
  description: "Espacio de administración de Casa de Salvación.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
