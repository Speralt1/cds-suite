"use client";

// Modelo de acceso del cliente (18a §A.2, §B.4) sobre lib/shared/access.
// Acepta tanto el documento v1 como el legacy `{ role, active }` (los mocks de
// los tests existentes y los usuarios aún no migrados).

import { useMemo } from "react";
import { useOptionalAccess } from "@/lib/auth/access-provider";
import {
  modulesForPermissions,
  normalizeAccess,
  profilePermissions,
  resolveHome,
  sortPermissions,
  type Landing,
} from "@/lib/shared/access";
import type { AccessProfile, ModuleId, Permission, UserAccessDoc } from "@/lib/shared/types";

export type { Landing };

export interface AccessModel {
  /** Permisos efectivos (cierre aplicado; ∅ si no hay perfil o está inactivo). */
  perms: ReadonlySet<Permission>;
  /** Áreas asignadas (solo v1; legacy → []). */
  areaIds: string[];
  /** Módulos visibles, en el orden de la navegación. */
  modules: ModuleId[];
  /** Aterrizaje resuelto (módulo inicial, "no-modules" o "inactive"). */
  home: Landing;
  /** `active | permisos efectivos | áreas | módulo inicial`: cambia ⇔ cambia el acceso. */
  fingerprint: string;
  /** Perfil normalizado (null si no hay documento). */
  profile: AccessProfile | null;
  active: boolean;
  can(permission: Permission): boolean;
  canAny(permissions: readonly Permission[]): boolean;
}

export function accessFingerprint(
  profile: AccessProfile | null,
  perms: ReadonlySet<Permission>,
): string {
  if (!profile) return "none";
  return [
    profile.active ? "1" : "0",
    sortPermissions(perms).join(","),
    [...profile.areaIds].sort().join(","),
    profile.homeModule ?? "",
  ].join("|");
}

/** Modelo de acceso puro para un `users/{uid}` (v1 o legacy). */
export function accessModel(user: UserAccessDoc | null | undefined): AccessModel {
  const profile = normalizeAccess(user);
  const perms: ReadonlySet<Permission> = profilePermissions(profile);
  const active = !!profile?.active;
  return {
    perms,
    areaIds: active && profile ? [...profile.areaIds] : [],
    modules: modulesForPermissions(perms),
    home: resolveHome(user),
    fingerprint: accessFingerprint(profile, perms),
    profile,
    active,
    can: (permission) => perms.has(permission),
    canAny: (permissions) => permissions.some((p) => perms.has(p)),
  };
}

/**
 * Modelo de acceso del usuario actual. Fuera de `AccessProvider` devuelve el
 * modelo vacío (sin permisos ni módulos).
 */
export function useAccessModel(): AccessModel {
  const access = useOptionalAccess();
  return useMemo(() => accessModel(access), [access]);
}
