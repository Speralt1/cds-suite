"use client";

import { Construction } from "lucide-react";
import { EmptyState, Panel } from "@/components/finance-preview/ui";
import { SX_PREVIEW_SENTINEL } from "@/lib/suite-preview/sentinel";
import { PageHeader } from "./primitives";

/**
 * Pantalla provisoria de un módulo. Los módulos se reemplazan así: en el
 * page.preview.tsx correspondiente, cambiar `<ModulePlaceholder …/>` por la
 * pantalla real (ver docs del Builder en el reporte de fundación).
 */
export function ModulePlaceholder({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <Panel>
        <EmptyState
          icon={Construction}
          title="En construcción en esta preview"
          body="Esta pantalla se construye en el siguiente paso de la misión. La navegación y los permisos ya funcionan."
        />
      </Panel>
    </>
  );
}

/** Placeholder de la página pública (sin shell, sin perfil, sin datos internos). */
export function PublicPlaceholder() {
  return (
    <div className="fx sx sx-public" lang="es-CL" data-suite-preview={SX_PREVIEW_SENTINEL}>
      <main id="fx-main" className="sx-center" tabIndex={-1}>
        <h1 className="fx-h1">Casa de Salvación · Calendario</h1>
        <p className="sx-center-body">En construcción en esta preview.</p>
      </main>
    </div>
  );
}
