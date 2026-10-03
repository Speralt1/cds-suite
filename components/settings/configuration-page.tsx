"use client";

// Configuración › General y › Finanzas e integraciones. La subnav del módulo y
// la guardia viven en app/(private)/configuracion/layout.tsx; aquí se repite
// SettingsGuard como defensa por si el componente se monta en otra ruta.

import { FinanceSettingsPanel } from "./finance-settings-panel";
import { SettingsGuard } from "./settings-guard";
import { PageHeading } from "./settings-ui";

function GeneralSettings() {
  return (
    <section className="panel settings-info-panel">
      <div className="section-heading">
        <div>
          <h2>Configuración general</h2>
          <p>Valores operativos actuales de CDS Suite.</p>
        </div>
      </div>
      <dl className="settings-general-grid">
        <div>
          <dt>Nombre</dt>
          <dd>Casa de Salvación</dd>
        </div>
        <div>
          <dt>Moneda</dt>
          <dd>CLP</dd>
        </div>
        <div>
          <dt>Zona horaria</dt>
          <dd>Hora de Chile continental</dd>
        </div>
      </dl>
      <p className="mt-5 text-xs leading-6 text-muted">
        Estos valores se muestran como referencia. No requieren edición en esta
        versión.
      </p>
    </section>
  );
}

/** /configuracion: General. */
export function ConfigurationPage() {
  return (
    <SettingsGuard>
      <PageHeading title="Configuración" subtitle="Datos generales de la iglesia en CDS Suite." />
      <GeneralSettings />
    </SettingsGuard>
  );
}

/** /configuracion/finanzas: categorías financieras e integraciones (panel actual, sin cambios). */
export function FinanceConfigurationPage() {
  return (
    <SettingsGuard>
      <PageHeading
        title="Finanzas e integraciones"
        subtitle="Categorías de ingresos y gastos, y métodos de pago."
      />
      <FinanceSettingsPanel />
    </SettingsGuard>
  );
}
