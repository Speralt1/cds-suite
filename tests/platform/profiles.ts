// Perfiles de prueba compartidos por los tests de acceso del cliente
// (legacy de 4 roles + combinaciones v1). Datos ficticios.
import type { ModuleId, UserAccessDoc } from "@/lib/shared/types";

export const v1 = (over: Record<string, unknown> = {}): UserAccessDoc & Record<string, unknown> => ({
  accessSchemaVersion: 1,
  role: "leader",
  active: true,
  baseRole: "standard",
  permissions: [],
  areaIds: [],
  homeModule: "calendar",
  position: "",
  ...over,
});

export interface TestProfile {
  name: string;
  doc: UserAccessDoc | null;
  modules: ModuleId[];
  /** Módulo inicial esperado (href) o el tipo de pantalla. */
  home: string | "no-modules" | "inactive";
}

export const PROFILES: readonly TestProfile[] = [
  { name: "legacy admin", doc: { role: "admin", active: true }, modules: ["finance", "calendar", "members", "reports", "settings"], home: "/finanzas" },
  { name: "legacy pastor", doc: { role: "pastor", active: true }, modules: ["finance", "calendar", "reports"], home: "/finanzas" },
  { name: "legacy finance", doc: { role: "finance", active: true }, modules: ["finance", "calendar", "reports"], home: "/finanzas" },
  { name: "legacy leader", doc: { role: "leader", active: true }, modules: ["finance", "calendar", "reports"], home: "/calendario" },
  { name: "legacy inactive", doc: { role: "admin", active: false }, modules: [], home: "inactive" },
  { name: "legacy invalid role", doc: { role: "inventado", active: true }, modules: [], home: "no-modules" },
  { name: "sin documento", doc: null, modules: [], home: "inactive" },
  {
    name: "v1 admin",
    doc: v1({ role: "admin", baseRole: "admin", homeModule: "finance", position: "Administración" }),
    modules: ["finance", "calendar", "members", "reports", "settings"],
    home: "/finanzas",
  },
  {
    name: "v1 pastor (inicio calendario)",
    doc: v1({
      role: "pastor",
      position: "Pastor",
      homeModule: "calendar",
      permissions: [
        "finance.summary.read",
        "finance.details.read",
        "finance.records.manage",
        "finance.pastoral.manage",
        "calendar.read",
        "calendar.events.manage_all",
      ],
    }),
    modules: ["finance", "calendar", "reports"],
    home: "/calendario",
  },
  {
    name: "v1 líder con áreas",
    doc: v1({
      position: "Líder",
      permissions: ["finance.summary.read", "calendar.events.manage_assigned"],
      areaIds: ["jovenes"],
    }),
    modules: ["finance", "calendar", "reports"],
    home: "/calendario",
  },
  {
    name: "v1 líder que publica",
    doc: v1({ position: "Líder", permissions: ["calendar.events.publish_assigned", "calendar.events.manage_assigned"], areaIds: ["alabanza"] }),
    modules: ["calendar", "reports"],
    home: "/calendario",
  },
  { name: "v1 solo calendario", doc: v1({ permissions: ["calendar.read"] }), modules: ["calendar", "reports"], home: "/calendario" },
  {
    name: "v1 solo resumen financiero",
    doc: v1({ permissions: ["finance.summary.read"], homeModule: "finance" }),
    modules: ["finance"],
    home: "/finanzas",
  },
  {
    name: "v1 detalle financiero sin calendario",
    doc: v1({ role: "leader", permissions: ["finance.details.read"], homeModule: "finance" }),
    modules: ["finance", "reports"],
    home: "/finanzas",
  },
  {
    name: "v1 inicio configurado no permitido",
    doc: v1({ permissions: ["calendar.read"], homeModule: "finance" }),
    modules: ["calendar", "reports"],
    home: "/calendario",
  },
  { name: "v1 sin módulos", doc: v1({ permissions: [] }), modules: [], home: "no-modules" },
  {
    name: "v1 settings.manage guardado sin admin",
    doc: v1({ permissions: ["settings.manage"] }),
    modules: [],
    home: "no-modules",
  },
  { name: "v1 inactivo", doc: v1({ active: false, permissions: ["calendar.read"] }), modules: [], home: "inactive" },
];

export const profile = (name: string): TestProfile => {
  const found = PROFILES.find((p) => p.name === name);
  if (!found) throw new Error(`perfil desconocido: ${name}`);
  return found;
};
