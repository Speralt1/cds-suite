// GENERADO por scripts/build-shared.mjs desde lib/shared/types.ts — NO EDITAR.
"use strict";
// Tipos de dominio compartidos por el cliente (Next) y Functions (CommonJS
// generado en functions/shared por scripts/build-shared.mjs).
//
// Reglas de este directorio: TypeScript puro, solo imports relativos "./x",
// sin React, sin Firebase y sin APIs del navegador. Fechas y horas de eventos
// son de pared en America/Santiago ("YYYY-MM-DD" / "HH:mm"), nunca instantes.
Object.defineProperty(exports, "__esModule", { value: true });
exports.AREA_COLORS = exports.MAX_POSITION_LENGTH = exports.MAX_AREA_IDS = exports.MAX_STORED_PERMISSIONS = exports.HOME_MODULES = exports.LEGACY_ROLES = exports.BASE_ROLES = exports.STORABLE_PERMISSIONS = exports.PERMISSIONS = void 0;
// ---------- Acceso ----------
exports.PERMISSIONS = [
    "finance.summary.read",
    "finance.details.read",
    "finance.records.manage",
    "finance.pastoral.manage",
    "calendar.read",
    "calendar.events.manage_assigned",
    "calendar.events.manage_all",
    "calendar.events.publish_assigned",
    "settings.manage",
];
/** Permisos que se pueden guardar en `users/{uid}.permissions` (`settings.manage` solo vía baseRole admin). */
exports.STORABLE_PERMISSIONS = exports.PERMISSIONS.filter((p) => p !== "settings.manage");
exports.BASE_ROLES = ["admin", "standard"];
exports.LEGACY_ROLES = ["admin", "pastor", "finance", "leader"];
exports.HOME_MODULES = ["finance", "calendar"];
/** Límites del documento v1 (iguales a las reglas). */
exports.MAX_STORED_PERMISSIONS = 8;
exports.MAX_AREA_IDS = 20;
exports.MAX_POSITION_LENGTH = 60;
// ---------- Áreas ----------
exports.AREA_COLORS = [
    "azul",
    "indigo",
    "naranjo",
    "ambar",
    "frambuesa",
    "cafe",
    "teal",
    "pizarra",
    "verde",
    "carmin",
];
