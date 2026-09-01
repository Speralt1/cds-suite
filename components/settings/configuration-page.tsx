"use client";

import { useState } from "react";
import { FinanceSettingsPanel } from "./finance-settings-panel";
import { SettingsGuard } from "./settings-guard";
import { UsersPermissionsPanel } from "./users-permissions-panel";

type Section = "general" | "finance" | "users";

const sections: [Section, string][] = [
  ["general", "General"],
  ["finance", "Finanzas"],
  ["users", "Usuarios y permisos"],
];

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
          <dd>America/Santiago</dd>
        </div>
      </dl>
      <p className="mt-5 text-xs leading-6 text-muted">
        Estos valores se muestran como referencia. No requieren edición en esta
        versión.
      </p>
    </section>
  );
}

export function ConfigurationPage() {
  const [section, setSection] = useState<Section>("finance");
  return (
    <SettingsGuard>
      <div className="mb-7">
        <p className="eyebrow">ADMINISTRACIÓN</p>
        <h1 className="mt-2 text-3xl font-medium sm:text-4xl">Configuración</h1>
        <p className="mt-3 text-sm text-muted">
          Categorías financieras y permisos básicos de CDS Suite.
        </p>
      </div>
      <nav className="settings-nav" aria-label="Secciones de Configuración">
        {sections.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={section === value}
            onClick={() => setSection(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="settings-content">
        {section === "general" && <GeneralSettings />}
        {section === "finance" && <FinanceSettingsPanel />}
        {section === "users" && <UsersPermissionsPanel />}
      </div>
    </SettingsGuard>
  );
}
