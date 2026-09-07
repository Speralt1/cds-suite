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

export interface ManagedUserCreate {
  displayName: string;
  email: string;
  role: Role;
}

function normalizeDisplayName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function validateManagedUserCreate(input: ManagedUserCreate) {
  const displayName = normalizeDisplayName(input.displayName);
  const email = input.email.trim().toLowerCase();

  if (!displayName || displayName.length > 120) {
    throw new Error("El nombre debe tener entre 1 y 120 caracteres.");
  }

  if (
    !email ||
    email.length > 160 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error("Ingresa un correo electrónico válido.");
  }

  if (!(input.role in ROLE_LABELS)) {
    throw new Error("Selecciona un rol válido.");
  }

  return {
    displayName,
    email,
    role: input.role,
  };
}

export function validateManagedUserUpdate(
  currentUid: string,
  targetUid: string,
  update: ManagedUserUpdate,
) {
  const displayName = normalizeDisplayName(update.displayName);

  if (!displayName || displayName.length > 120) {
    throw new Error("El nombre debe tener entre 1 y 120 caracteres.");
  }

  if (targetUid === currentUid && (!update.active || update.role !== "admin")) {
    throw new Error(
      "No puedes desactivar tu propia cuenta ni quitarte el rol administrador.",
    );
  }

  return { ...update, displayName };
}
