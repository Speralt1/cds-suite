import type { AccessUser, Role } from "@/lib/finance/types";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  pastor: "Pastor",
  finance: "Finanzas",
  leader: "Líder",
};

export interface ManagedUser extends AccessUser {
  id: string;
}

export interface ManagedUserUpdate {
  displayName: string;
  role: Role;
  active: boolean;
}

export function validateManagedUserUpdate(
  currentUid: string,
  targetUid: string,
  update: ManagedUserUpdate,
) {
  const displayName = update.displayName.trim().replace(/\s+/g, " ");
  if (!displayName || displayName.length > 120)
    throw new Error("El nombre debe tener entre 1 y 120 caracteres.");
  if (targetUid === currentUid && (!update.active || update.role !== "admin"))
    throw new Error(
      "No puedes desactivar tu propia cuenta ni quitarte el rol administrador.",
    );
  return { ...update, displayName };
}
