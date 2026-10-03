"use client";

// Subnav de Configuración (18 §10 R3): mismo estilo que Calendario y Reportes.
// Orden por uso (revisión de diseño): Áreas · Usuarios y permisos · Finanzas e
// integraciones · General. Las rutas no cambian.

import { ModuleSubnav, type ModuleSubnavItem } from "@/components/layout/module-subnav";

export const SETTINGS_NAV_ITEMS: readonly ModuleSubnavItem[] = [
  { href: "/configuracion/areas", label: "Áreas" },
  { href: "/configuracion/usuarios", label: "Usuarios y permisos" },
  { href: "/configuracion/finanzas", label: "Finanzas e integraciones" },
  { href: "/configuracion", label: "General" },
];

export function SettingsNav() {
  return <ModuleSubnav label="Configuración" items={SETTINGS_NAV_ITEMS} />;
}
