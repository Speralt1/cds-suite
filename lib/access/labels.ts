// Copy de permisos y cargos para la UI (18b §3.3–3.4). Lenguaje simple, es-CL:
// nunca se muestran los identificadores internos de los permisos.

import { LEGACY_ROLE_ACCESS } from "@/lib/shared/access";
import type { BaseRole, HomeModule, Permission } from "@/lib/shared/types";

export const PERMISSION_LABEL: Readonly<Record<Permission, string>> = {
  "finance.summary.read": "Ver resumen financiero",
  "finance.details.read": "Ver detalle financiero",
  "finance.records.manage": "Registrar y editar movimientos",
  "finance.pastoral.manage": "Seguimiento pastoral en diezmos",
  "calendar.read": "Ver calendario",
  "calendar.events.manage_assigned": "Gestionar actividades de sus áreas",
  "calendar.events.publish_assigned": "Publicar actividades de sus áreas",
  "calendar.events.manage_all": "Gestionar todas las actividades y el enlace público",
  "settings.manage": "Administrar configuración",
};

export const PERMISSION_DESCRIPTION: Readonly<Record<Permission, string>> = {
  "finance.summary.read": "Cifras generales del período, sin movimientos ni nombres.",
  "finance.details.read": "Movimientos, ofrendas, diezmos, campañas y reportes.",
  "finance.records.manage": "Crear, corregir y anular registros financieros.",
  "finance.pastoral.manage": "Ver y escribir notas pastorales de diezmantes.",
  "calendar.read": "Ver todas las actividades, incluidas las de Solo equipo.",
  "calendar.events.manage_assigned": "Crear, editar, cancelar y eliminar actividades de las áreas asignadas.",
  "calendar.events.publish_assigned":
    "Marcar como Pública una actividad de sus áreas para que aparezca en el calendario compartido.",
  "calendar.events.manage_all": "Cualquier área, publicar y administrar el enlace compartido.",
  "settings.manage": "Solo usuarios con rol Administrador.",
};

export interface PermissionGroup {
  label: string;
  permissions: readonly Permission[];
  /** Nota única bajo el grupo. */
  note?: string;
}

/** Grupos del editor de permisos (Integrantes no existe en este slice). */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    label: "Finanzas",
    permissions: ["finance.summary.read", "finance.details.read", "finance.records.manage", "finance.pastoral.manage"],
  },
  {
    label: "Calendario",
    permissions: [
      "calendar.read",
      "calendar.events.manage_assigned",
      "calendar.events.publish_assigned",
      "calendar.events.manage_all",
    ],
    note: "Los reportes se muestran según lo que la persona puede ver.",
  },
  { label: "Sistema", permissions: ["settings.manage"] },
];

export const BASE_ROLE_LABEL: Readonly<Record<BaseRole, string>> = {
  admin: "Administrador",
  standard: "Estándar",
};

export interface PositionPreset {
  position: string;
  baseRole: BaseRole;
  /** Permisos guardables sugeridos (sin cierre; nunca `settings.manage`). */
  permissions: readonly Permission[];
  homeModule: HomeModule;
  /** El cargo propone gestionar actividades: conviene asignar áreas. */
  requiresAreas: boolean;
}

/**
 * Cargos sugeridos. Solo pre-llenan el editor: el cargo es texto libre y nada
 * cambia sin confirmación. Los cuatro primeros son el mapeo legacy exacto.
 */
export const POSITION_PRESETS: readonly PositionPreset[] = [
  {
    position: LEGACY_ROLE_ACCESS.admin.position,
    baseRole: "admin",
    permissions: [],
    homeModule: LEGACY_ROLE_ACCESS.admin.homeModule,
    requiresAreas: false,
  },
  {
    position: LEGACY_ROLE_ACCESS.pastor.position,
    baseRole: "standard",
    permissions: LEGACY_ROLE_ACCESS.pastor.permissions,
    homeModule: LEGACY_ROLE_ACCESS.pastor.homeModule,
    requiresAreas: false,
  },
  {
    position: LEGACY_ROLE_ACCESS.finance.position,
    baseRole: "standard",
    permissions: LEGACY_ROLE_ACCESS.finance.permissions,
    homeModule: LEGACY_ROLE_ACCESS.finance.homeModule,
    requiresAreas: false,
  },
  {
    position: LEGACY_ROLE_ACCESS.leader.position,
    baseRole: "standard",
    permissions: LEGACY_ROLE_ACCESS.leader.permissions,
    homeModule: LEGACY_ROLE_ACCESS.leader.homeModule,
    requiresAreas: true,
  },
  {
    position: "Diácono",
    baseRole: "standard",
    permissions: ["finance.summary.read", "calendar.read", "calendar.events.manage_assigned"],
    homeModule: "calendar",
    requiresAreas: true,
  },
];
