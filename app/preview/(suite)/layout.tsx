import { PreviewProvider } from "@/components/finance-preview/context";
import { SuiteShell } from "@/components/suite-preview/shell";

// Módulos nuevos de la preview (Calendario, Integrantes, Reportes, Configuración)
// dentro del shell global. PreviewProvider queda por fuera de SuiteShell para
// que las pantallas reutilizadas de Finanzas (período, simulate) funcionen.
// El gate notFound() vive en app/preview/layout.tsx.

export default function SuiteModulesLayout({ children }: { children: React.ReactNode }) {
  return (
    <PreviewProvider>
      <SuiteShell>{children}</SuiteShell>
    </PreviewProvider>
  );
}
