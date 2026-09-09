import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ofrendar | Casa de Salvación",
  description: "Realiza tu aporte a Casa de Salvación mediante transferencia o pago online.",
  openGraph: {
    type: "website",
    title: "Ofrendar | Casa de Salvación",
    description: "Realiza tu aporte a Casa de Salvación de forma simple y transparente.",
    images: [
      {
        url: "https://cds-administracion.web.app/icon-512.png?v=3",
        width: 512,
        height: 512,
        alt: "Ofrendar en Casa de Salvación",
      },
    ],
  },
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
