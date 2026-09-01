"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth/auth-provider";
import { getFirebaseServices } from "@/lib/firebase";
import { errorMessage } from "@/lib/finance/formatters";
import { ROLES } from "@/lib/finance/permissions";
import type { Role } from "@/lib/finance/types";
import { ROLE_LABELS, type ManagedUser } from "@/lib/settings/users";
import {
  updateManagedUser,
  useManagedUsers,
} from "@/lib/settings/users-client";
import { Empty, Loading, Notice } from "@/components/finance/shared";

function UserRow({
  account,
  currentUid,
}: {
  account: ManagedUser;
  currentUid: string;
}) {
  const self = account.id === currentUid;
  const [displayName, setDisplayName] = useState(account.displayName);
  const [role, setRole] = useState<Role>(account.role);
  const [active, setActive] = useState(account.active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await updateManagedUser(
        getFirebaseServices().db,
        currentUid,
        account.id,
        { displayName, role, active },
      );
      setSuccess("Usuario actualizado correctamente.");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="user-settings-card" onSubmit={save}>
      <div className="user-settings-heading">
        <div className="min-w-0">
          <p className="break-words font-medium">{account.displayName}</p>
          <p className="mt-1 break-all text-xs text-muted">{account.email}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {self && <span className="status-pill">Tu cuenta</span>}
          <span className={`status-pill ${account.active ? "" : "voided"}`}>
            {account.active ? "Activo" : "Inactivo"}
          </span>
        </div>
      </div>
      <div className="user-settings-fields">
        <label>
          Nombre
          <input
            value={displayName}
            maxLength={120}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label>
          Rol
          <select
            value={role}
            disabled={self}
            onChange={(event) => setRole(event.target.value as Role)}
          >
            {ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Estado
          <select
            value={active ? "active" : "inactive"}
            disabled={self}
            onChange={(event) => setActive(event.target.value === "active")}
          >
            <option value="active">Activo</option>
            <option value="inactive">Inactivo</option>
          </select>
        </label>
      </div>
      {self && (
        <p className="field-help">
          Por seguridad no puedes quitarte el rol administrador ni desactivar tu
          propia cuenta.
        </p>
      )}
      <Notice error={error} success={success} />
      <div className="flex justify-end">
        <button className="button-secondary" disabled={busy}>
          {busy ? "Guardando…" : "Guardar cambios"}
        </button>
      </div>
    </form>
  );
}

export function UsersPermissionsPanel() {
  const { user } = useAuth();
  const users = useManagedUsers();
  return (
    <>
      <div className="notice settings-auth-notice">
        <strong>Cuentas de acceso</strong>
        <p>
          Aquí se administran nombre, rol y estado del documento de
          autorización. Las cuentas y contraseñas de Firebase Authentication
          continúan creándose manualmente en Firebase Console.
        </p>
      </div>
      <Notice error={users.error} />
      {users.loading ? (
        <Loading />
      ) : users.data.length && user ? (
        <div className="user-settings-list">
          {users.data.map((account) => (
            <UserRow
              key={`${account.id}:${account.displayName}:${account.role}:${account.active}`}
              account={account}
              currentUid={user.uid}
            />
          ))}
        </div>
      ) : (
        <Empty>No hay usuarios autorizados para mostrar.</Empty>
      )}
    </>
  );
}
