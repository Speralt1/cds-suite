import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/lib/auth/auth-provider";
import { PwaRegister } from "@/components/pwa-register";
import { PREPAINT_SCRIPT } from "@/lib/ui/prepaint";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "CDS Administración",
  title: {
    default: "CDS Administración | Casa de Salvación",
    template: "%s | CDS Administración",
  },
  description: "Espacio de administración de Casa de Salvación.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    title: "CDS",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#285b45",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: el script previo al pintado fija
    // data-text-size y data-sidebar en <html> antes de hidratar (Design Lock 28).
    <html lang="es-CL" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREPAINT_SCRIPT }} />
      </head>
      <body>
        <PwaRegister />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
