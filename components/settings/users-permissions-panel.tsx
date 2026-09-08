"use client";

import { useState } from "react";
import { Mail, ShieldOff, UserPlus } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-provider";
import { getFirebaseServices } from "@/lib/firebase";
import { errorMessage } from "@/lib/finance/formatters";
import { ROLES } from "@/lib/finance/permissions";
import type { Role } from "@/lib/finance/types";
import {
  ROLE_LABELS,
  type ManagedUser,
} from "@/lib/settings/users";
import {
  createManagedUser,
  resendPasswordSetup,
  updateManagedUser,
  useManagedUsers,
} from "@/lib/settings/users-client";
import {
  Empty,
  Loading,
  Modal,
  Notice,
} from "@/components/finance/shared";

function CreateUserForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("leader");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError("");

    try {
      const { db, auth } = getFirebaseServices();

      const result = await createManagedUser(db, auth, {
        displayName,
        email,
        role,
      });

      onCreated(
        result.resetEmailSent
          ? `Usuario creado correctamente. Firebase confirmó el envío del correo a ${email.trim().toLowerCase()} para que defina su contraseña.`
          : `El usuario fue creado, pero Firebase no pudo enviar el correo. ${result.resetEmailError || "Puedes intentar Reenviar acceso desde su ficha."}`,
      );

      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Agregar usuario" onClose={onClose} busy={busy}>
      <form className="finance-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            Nombre
            <input
              autoFocus
              data-autofocus
              required
              maxLength={120}
              value={displayName}
              placeholder="Ej. Roberto Pérez"
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>

          <label>
            Correo electrónico
            <input
              required
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={160}
              value={email}
              placeholder="correo@ejemplo.cl"
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <label>
            Rol
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as Role)}
            >
              {ROLES.map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>

          <div className="notice settings-auth-notice">
            <strong>Acceso seguro</strong>
            <p>
              La persona recibirá un correo para definir su propia contraseña.
              Tú no necesitas conocerla ni guardarla.
            </p>
          </div>

          <Notice error={error} />
        </fieldset>

        <div className="form-footer">
          <button
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>

          <button className="button-primary" disabled={busy}>
            {busy ? "Creando…" : "Crear usuario"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

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

  async function removeAccess() {
    if (self || busy) return;

    const confirmed = window.confirm(
      `¿Quitar el acceso de ${account.displayName}? Ya no podrá entrar a CDS Suite, pero se conservará su historial.`,
    );

    if (!confirmed) return;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await updateManagedUser(
        getFirebaseServices().db,
        currentUid,
        account.id,
        {
          displayName,
          role,
          active: false,
        },
      );

      setActive(false);
      setSuccess("Acceso eliminado correctamente.");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function resendAccess() {
    if (busy) return;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await resendPasswordSetup(
        getFirebaseServices().auth,
        account.email,
      );

      setSuccess("Correo para definir/restablecer contraseña enviado.");
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
          <p className="mt-1 break-all text-xs text-muted">
            {account.email}
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {self && <span className="status-pill">Tu cuenta</span>}
          <span className={`status-pill ${active ? "" : "voided"}`}>
            {active ? "Activo" : "Sin acceso"}
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
            onChange={(event) =>
              setActive(event.target.value === "active")
            }
          >
            <option value="active">Activo</option>
            <option value="inactive">Sin acceso</option>
          </select>
        </label>
      </div>

      {self && (
        <p className="field-help">
          Por seguridad no puedes quitarte el rol administrador ni desactivar
          tu propia cuenta.
        </p>
      )}

      <Notice error={error} success={success} />

      <div className="user-settings-actions">
        {!self && (
          <button
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={resendAccess}
          >
            <Mail size={16} />
            Reenviar acceso
          </button>
        )}

        {!self && active && (
          <button
            type="button"
            className="button-danger"
            disabled={busy}
            onClick={removeAccess}
          >
            <ShieldOff size={16} />
            Quitar acceso
          </button>
        )}

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
  const [create, setCreate] = useState(false);
  const [success, setSuccess] = useState("");

  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Usuarios y permisos</h2>
          <p>
            Administra quién puede entrar a CDS Suite y qué nivel de acceso
            tiene.
          </p>
        </div>

        <button
          type="button"
          className="button-primary"
          onClick={() => setCreate(true)}
        >
          <UserPlus size={17} />
          Agregar usuario
        </button>
      </div>

      <div className="notice settings-auth-notice">
        <strong>Cuentas de acceso</strong>
        <p>
          Los usuarios nuevos reciben un correo para definir su contraseña.
          Quitar acceso no elimina su historial y puede revertirse después.
        </p>
      </div>

      <Notice error={users.error} success={success} />

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

      {create && (
        <CreateUserForm
          onClose={() => setCreate(false)}
          onCreated={setSuccess}
        />
      )}
    </>
  );
}
