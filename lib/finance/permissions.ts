import type { AccessUser, Role } from "./types";
export const ROLES: Role[] = ["admin", "pastor", "finance", "leader"];
export const canSeeDetails = (role?: Role) =>
  role === "admin" || role === "pastor" || role === "finance";
export const canSeePastoral = (role?: Role) =>
  role === "admin" || role === "pastor";
export const isAuthorized = (user: AccessUser | null) =>
  !!user && user.active === true && ROLES.includes(user.role);
