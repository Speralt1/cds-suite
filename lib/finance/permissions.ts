// Compatibilidad con los helpers por rol. La autorización vive en
// lib/shared/access (`can`); estos wrappers conservan su firma y delegan en
// `can({ role, active: true }, …)`, con resultados idénticos para los 4 roles.
import { can } from "../shared/access";
import type { AccessUser, Role } from "./types";
export const ROLES: Role[] = ["admin", "pastor", "finance", "leader"];
/** @deprecated Usa `can(access, "finance.details.read")` de `@/lib/shared/access`. */
export const canSeeDetails = (role?: Role) =>
  can({ role, active: true }, "finance.details.read");
/** @deprecated Usa `can(access, "finance.pastoral.manage")` de `@/lib/shared/access`. */
export const canSeePastoral = (role?: Role) =>
  can({ role, active: true }, "finance.pastoral.manage");
/**
 * Cuenta habilitada para entrar: activa y con un rol válido (los documentos v1
 * siempre llevan `role`, lo exigen las reglas). "Sin módulos" lo resuelve RouteGuard.
 */
export const isAuthorized = (user: AccessUser | null) =>
  !!user && user.active === true && ROLES.includes(user.role);
