"use client";

// Configuración › Usuarios y permisos (18b §3.3–3.4). Es el MISMO panel
// productivo, evolucionado: crear usuario + correo para definir contraseña,
// reenviar acceso y quitar acceso se conservan; la lista pasa a ser compacta y
// de solo lectura, y el editor agrega rol base, cargo, permisos agrupados,
// áreas, módulo inicial y cuenta activa (payload v1, 18a §C.1).

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleCheck,
  CircleSlash,
  Lock,
  Mail,
  ShieldCheck,
  ShieldOff,
  UserPlus,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-provider";
import { getFirebaseServices } from "@/lib/firebase";
import { selectableAreas, areaById, type Area } from "@/lib/calendar/areas";
import { useAreas } from "@/lib/calendar/areas-client";
import { deriveLegacyRole } from "@/lib/shared/access";
import type { Permission } from "@/lib/shared/types";
import { settingsSaveError } from "@/lib/settings/errors";
import {
  HOME_MODULE_LABEL,
  MODULE_LABEL,
  PERMISSION_DESCRIPTION,
  PERMISSION_GROUPS,
  PERMISSION_LABEL,
  POSITION_PRESETS,
  POSITION_PRESET_NAMES,
  accessDraftFromUser,
  accessSummary,
  accessWarnings,
  applyPositionPreset,
  draftAllowedHomeModules,
  draftLanding,
  impliedPermissions,
  implyingPermission,
  isOnlyActiveAdmin,
  isPositionPreset,
  presetDiffers,
  sameAccessDraft,
  togglePermission,
  userListNotices,
  type AccessDraft,
  type ManagedUser,
  type ManagedUserLike,
  type PositionPresetName,
} from "@/lib/settings/users";
import {
  createManagedUser,
  resendPasswordSetup,
  setManagedUserActive,
  updateManagedUserAccess,
  useManagedUsers,
} from "@/lib/settings/users-client";
import { Modal, Notice } from "@/components/finance/shared";
import {
  AreaDot,
  AreaTag,
  InfoNote,
  LoadError,
  PageHeading,
  SettingsLoading,
  Switch,
  WarningBadge,
  WarningNote,
} from "./settings-ui";

const CUSTOM_POSITION = "__otro";

function AreaPicker({
  areas,
  value,
  onChange,
  describedBy,
}: {
  areas: readonly Area[];
  value: readonly string[];
  onChange: (ids: string[]) => void;
  describedBy?: string;
}) {
  const options = selectableAreas(areas, value);
  if (!options.length)
    return (
      <p className="text-[13px] text-muted">
        Aún no hay áreas activas.{" "}
        <Link className="text-primary underline" href="/configuracion/areas">
          Crear áreas
        </Link>
      </p>
    );
  return (
    <div className="flex flex-wrap gap-2" aria-describedby={describedBy}>
      {options.map((area) => {
        const on = value.includes(area.id);
        return (
          <label
            key={area.id}
            className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-[13px] font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${
              on ? "border-ink bg-canvas" : "border-line bg-white"
            }`}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={on}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, area.id] : value.filter((id) => id !== area.id))
              }
            />
            <AreaDot color={area.color} size={10} />
            <span>{area.name}</span>
            {!area.active && <span className="font-normal text-muted">(inactiva)</span>}
            {on && <Check size={14} aria-hidden="true" />}
          </label>
        );
      })}
    </div>
  );
}

// ---------- Alta ----------

function CreateUserForm({
  areas,
  onClose,
  onCreated,
}: {
  areas: readonly Area[];
  onClose: () => void;
  onCreated: (message: string, uid: string) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [position, setPosition] = useState<PositionPresetName>("Líder");
  const [areaIds, setAreaIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const preset = POSITION_PRESETS[position];
  const areasHelpId = useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError("");

    try {
      const { db, auth } = getFirebaseServices();
      const permissions = [...preset.permissions];

      const result = await createManagedUser(db, auth, {
        displayName,
        email,
        role: deriveLegacyRole(preset.baseRole, permissions),
        access: {
          baseRole: preset.baseRole,
          position,
          permissions,
          areaIds: preset.requiresAreas ? areaIds : [],
          homeModule: preset.homeModule,
        },
      });

      onCreated(
        result.resetEmailSent
          ? `Usuario creado correctamente. Firebase confirmó el envío del correo a ${email.trim().toLowerCase()} para que defina su contraseña.`
          : `El usuario fue creado, pero Firebase no pudo enviar el correo. ${result.resetEmailError || "Puedes intentar Reenviar acceso desde su ficha."}`,
        result.uid,
      );

      onClose();
    } catch (caught) {
      setError(settingsSaveError(caught));
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
            Cargo
            <select
              value={position}
              onChange={(event) => setPosition(event.target.value as PositionPresetName)}
            >
              {POSITION_PRESET_NAMES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <span className="field-help">
              Se cargan los permisos sugeridos para el cargo. Puedes ajustarlos después en «Revisar permisos».
            </span>
          </label>

          {preset.requiresAreas && (
            <div className="flex flex-col gap-2 text-xs font-medium">
              <span>Áreas</span>
              <AreaPicker areas={areas} value={areaIds} onChange={setAreaIds} describedBy={areasHelpId} />
              <span id={areasHelpId} className="field-help">
                Con «Gestionar actividades de sus áreas» podrá crear y editar actividades de estas áreas.
              </span>
            </div>
          )}

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

// ---------- Permisos ----------

function PermissionChecklist({
  draft,
  onToggle,
}: {
  draft: AccessDraft;
  onToggle: (perm: Permission, on: boolean) => void;
}) {
  const isAdmin = draft.baseRole === "admin";
  const implied = impliedPermissions(draft.permissions);
  return (
    <div className="space-y-5">
      {isAdmin && (
        <InfoNote>Administración tiene todos los permisos, incluida la configuración.</InfoNote>
      )}
      {PERMISSION_GROUPS.map((group) => (
        <fieldset key={group.id} className="min-w-0">
          <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            {group.label}
          </legend>
          <ul>
            {group.permissions.map((perm) => {
              const id = `perm-${perm.replace(/\./g, "-")}`;
              const locked = perm === "settings.manage";
              const via = !isAdmin && !locked && implied.has(perm) ? implyingPermission(perm, draft.permissions) : null;
              const checked = isAdmin || (!locked && (draft.permissions.includes(perm) || implied.has(perm)));
              const disabled = isAdmin || locked || !!via;
              const note = locked
                ? isAdmin
                  ? "Incluido por el rol base Administrador."
                  : "Solo administradores (rol base)."
                : isAdmin
                  ? "Incluido por el rol base Administrador."
                  : via
                    ? `Incluido por «${PERMISSION_LABEL[via]}».`
                    : null;
              return (
                <li key={perm} className="flex min-h-11 items-start gap-3 py-2">
                  <input
                    type="checkbox"
                    id={id}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-primary)]"
                    checked={checked}
                    disabled={disabled}
                    aria-describedby={`${id}-d${note ? ` ${id}-n` : ""}`}
                    onChange={(e) => onToggle(perm, e.target.checked)}
                  />
                  <label htmlFor={id} className={`min-w-0 ${disabled ? "cursor-default" : "cursor-pointer"}`}>
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {locked && <Lock size={13} aria-hidden="true" />}
                      {PERMISSION_LABEL[perm]}
                    </span>
                    <span id={`${id}-d`} className="block text-xs text-muted">
                      {PERMISSION_DESCRIPTION[perm]}
                    </span>
                    {note && (
                      <span id={`${id}-n`} className="block text-xs font-medium text-primary">
                        {note}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
          {group.note && <p className="mt-1 text-xs text-muted">{group.note}</p>}
        </fieldset>
      ))}
    </div>
  );
}

// ---------- Editor ----------

function landingText(draft: AccessDraft): string {
  const landing = draftLanding(draft);
  if (landing.kind === "module") return MODULE_LABEL[landing.module];
  if (landing.kind === "no-modules") return "Aún no tiene módulos";
  return "No podrá ingresar (cuenta inactiva)";
}

function RemoveAccessDialog({
  name,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  name: string;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title={`¿Quitar el acceso de ${name}?`} onClose={onCancel} busy={busy}>
      <div className="space-y-3 p-6 text-sm leading-6">
        <p>
          Ya no podrá entrar a CDS Suite, pero se conservará su historial. Puedes devolverle el acceso después.
        </p>
        <Notice error={error} />
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <button type="button" className="button-secondary" data-autofocus disabled={busy} onClick={onCancel}>
            Volver
          </button>
          <button type="button" className="button-danger" disabled={busy} onClick={onConfirm}>
            <ShieldOff size={16} aria-hidden="true" />
            {busy ? "Quitando…" : "Quitar acceso"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function UserEditor({
  account,
  users,
  areas,
  currentUid,
  onClose,
  onSaved,
}: {
  account: ManagedUser;
  users: readonly ManagedUserLike[];
  areas: readonly Area[];
  currentUid: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const saved = useMemo(() => accessDraftFromUser(account), [account]);
  const [draft, setDraft] = useState<AccessDraft>(saved);
  const [customPosition, setCustomPosition] = useState(() => !isPositionPreset(saved.position));
  const [pendingPreset, setPendingPreset] = useState<PositionPresetName | null>(null);
  const [confirmHome, setConfirmHome] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const ids = {
    name: useId(),
    active: useId(),
    admin: useId(),
    position: useId(),
    areas: useId(),
    home: useId(),
  };

  const self = account.id === currentUid;
  const onlyAdmin = isOnlyActiveAdmin(users, account.id);
  const savedAdmin = saved.baseRole === "admin";
  const lockAdmin = savedAdmin && (self || onlyAdmin);
  const lockActive = saved.active && (self || (savedAdmin && onlyAdmin));
  const legacy = account.accessSchemaVersion !== 1;

  const warnings = accessWarnings(draft, areas);
  const allowedHome = draftAllowedHomeModules(draft);
  const landing = draftLanding(draft);
  const homeInvalid = allowedHome.length > 0 && !allowedHome.includes(draft.homeModule);
  const resolvedHome =
    landing.kind === "module" && (landing.module === "finance" || landing.module === "calendar") ? landing.module : null;
  const dirty = !sameAccessDraft(draft, saved);
  const summary = accessSummary({ ...draft, active: true });
  const scopedAreas = draft.baseRole !== "admin" && !draft.permissions.includes("calendar.events.manage_all");

  const set = (patch: Partial<AccessDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSuccess("");
    setConfirmHome(false);
  };

  function choosePosition(value: string) {
    if (value === CUSTOM_POSITION) {
      setCustomPosition(true);
      setPendingPreset(null);
      set({ position: isPositionPreset(draft.position) ? "" : draft.position });
      return;
    }
    if (!isPositionPreset(value)) return;
    setCustomPosition(false);
    set({ position: value });
    // Nunca en silencio: los permisos sugeridos se aplican solo si se confirma.
    setPendingPreset(presetDiffers(draft, value) ? value : null);
  }

  async function persist(next: AccessDraft) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await updateManagedUserAccess(getFirebaseServices().db, currentUid, account.id, next, users);
      onSaved(`Cambios de ${next.displayName.trim()} guardados.`);
      onClose();
    } catch (caught) {
      setError(settingsSaveError(caught));
    } finally {
      setBusy(false);
    }
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !dirty) return;
    if (homeInvalid && resolvedHome && draft.active) {
      setConfirmHome(true);
      return;
    }
    void persist(draft);
  }

  async function resendAccess() {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await resendPasswordSetup(getFirebaseServices().auth, account.email);
      setSuccess("Correo para definir/restablecer contraseña enviado.");
    } catch (caught) {
      setError(settingsSaveError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function removeAccess() {
    if (self || busy) return;
    setBusy(true);
    setError("");
    try {
      await setManagedUserActive(getFirebaseServices().db, currentUid, account, false, users);
      setConfirmRemove(false);
      onSaved("Acceso eliminado correctamente.");
      onClose();
    } catch (caught) {
      setError(settingsSaveError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={account.displayName} onClose={onClose} busy={busy}>
      <form onSubmit={save} className="flex flex-col">
        <div className="space-y-6 p-6">
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <span className="break-all">{account.email}</span>
            <StatusBadge active={draft.active} />
            {self && <span className="status-pill mt-0">Tu cuenta</span>}
          </div>

          <section aria-label="Resumen del acceso" className="space-y-1 rounded-[12px] bg-primary-soft px-4 py-3 text-[13px] text-primary">
            <p>
              <strong className="font-semibold">Verá:</strong> {summary.length ? summary.join(" · ") : "ningún módulo"}
            </p>
            <p>
              <strong className="font-semibold">Entrará a:</strong> {landingText(draft)}
            </p>
          </section>

          {legacy && (
            <InfoNote>Esta cuenta usa el formato anterior de permisos. Al guardar se conserva el mismo acceso.</InfoNote>
          )}

          {(warnings.length > 0 || onlyAdmin || self) && (
            <div className="space-y-2">
              {warnings.map((w) => (
                <WarningNote key={w.kind}>{w.text}</WarningNote>
              ))}
              {onlyAdmin && !self && (
                <WarningNote>
                  Es el único administrador activo; no se puede desactivar ni quitarle el rol de administrador.
                </WarningNote>
              )}
              {self && (
                <p className="field-help">
                  Por seguridad no puedes quitarte el rol administrador ni desactivar tu propia cuenta.
                </p>
              )}
            </div>
          )}

          <fieldset disabled={busy} className="space-y-6">
            <section aria-labelledby={`${ids.active}-h`} className="space-y-3">
              <h3 id={`${ids.active}-h`} className="text-[15px] font-semibold">
                Acceso
              </h3>
              <label className="flex flex-col gap-1.5 text-xs font-medium" htmlFor={ids.name}>
                Nombre
                <input
                  id={ids.name}
                  className="form-input min-h-[46px] text-base"
                  value={draft.displayName}
                  maxLength={120}
                  onChange={(e) => set({ displayName: e.target.value })}
                />
              </label>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Cuenta activa</p>
                  <p id={`${ids.active}-d`} className="text-xs text-muted">
                    {lockActive
                      ? self
                        ? "No puedes desactivar tu propia cuenta."
                        : "Es el único administrador activo; no se puede desactivar."
                      : draft.active
                        ? "Puede ingresar a CDS Suite."
                        : "No podrá ingresar hasta que la actives."}
                  </p>
                </div>
                <Switch
                  checked={draft.active}
                  onChange={(value) => set({ active: value })}
                  label="Cuenta activa"
                  disabled={lockActive || busy}
                  describedBy={`${ids.active}-d`}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Administrador (rol base)</p>
                  <p id={`${ids.admin}-d`} className="text-xs text-muted">
                    {lockAdmin
                      ? self
                        ? "No puedes quitarte el rol administrador."
                        : "Es el único administrador activo; no se le puede quitar."
                      : draft.baseRole === "admin"
                        ? "Tiene todos los permisos, incluida la configuración."
                        : "Accede solo con los permisos marcados abajo."}
                  </p>
                </div>
                <Switch
                  checked={draft.baseRole === "admin"}
                  onChange={(value) => set({ baseRole: value ? "admin" : "standard" })}
                  label="Administrador (rol base)"
                  disabled={lockAdmin || busy}
                  describedBy={`${ids.admin}-d`}
                />
              </div>
            </section>

            <section aria-labelledby={`${ids.position}-h`} className="space-y-4">
              <h3 id={`${ids.position}-h`} className="text-[15px] font-semibold">
                Cargo, áreas y módulo inicial
              </h3>
              <div className="flex flex-col gap-1.5 text-xs font-medium">
                <label htmlFor={ids.position}>Cargo</label>
                <select
                  id={ids.position}
                  className="form-input min-h-[46px] text-base"
                  value={customPosition ? CUSTOM_POSITION : draft.position}
                  aria-describedby={`${ids.position}-help`}
                  onChange={(e) => choosePosition(e.target.value)}
                >
                  {!customPosition && !isPositionPreset(draft.position) && (
                    <option value={draft.position}>{draft.position || "Sin cargo"}</option>
                  )}
                  {POSITION_PRESET_NAMES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                  <option value={CUSTOM_POSITION}>Otro cargo…</option>
                </select>
                {customPosition && (
                  <input
                    aria-label="Nombre del cargo"
                    className="form-input min-h-[46px] text-base"
                    value={draft.position}
                    maxLength={60}
                    placeholder="Ej.: Coordinación de jóvenes"
                    onChange={(e) => set({ position: e.target.value })}
                  />
                )}
                <span id={`${ids.position}-help`} className="font-normal text-muted">
                  Al cambiar el cargo se proponen sus permisos; nada cambia sin tu confirmación.
                </span>
              </div>

              {pendingPreset && (
                <div
                  role="group"
                  aria-label={`Permisos sugeridos para ${pendingPreset}`}
                  className="space-y-3 rounded-[12px] border border-line bg-canvas p-4 text-[13px]"
                >
                  <p>
                    <strong>¿Aplicar los permisos sugeridos para {pendingPreset}?</strong> Se reemplazarán
                    {POSITION_PRESETS[pendingPreset].baseRole !== draft.baseRole ? " el rol base," : ""} los permisos
                    marcados y el módulo inicial ({HOME_MODULE_LABEL[POSITION_PRESETS[pendingPreset].homeModule]}).
                  </p>
                  {POSITION_PRESETS[pendingPreset].baseRole === "standard" && lockAdmin && (
                    <p className="text-xs text-muted">El rol base Administrador se mantiene: no se puede quitar aquí.</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="button-secondary" onClick={() => setPendingPreset(null)}>
                      Mantener los actuales
                    </button>
                    <button
                      type="button"
                      className="button-primary"
                      onClick={() => {
                        const next = applyPositionPreset(draft, pendingPreset);
                        set(lockAdmin ? { ...next, baseRole: "admin" } : next);
                        setPendingPreset(null);
                      }}
                    >
                      Aplicar sugeridos
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2 text-xs font-medium">
                <span id={`${ids.areas}-l`}>Áreas asignadas</span>
                <div role="group" aria-labelledby={`${ids.areas}-l`}>
                  <AreaPicker
                    areas={areas}
                    value={draft.areaIds}
                    onChange={(areaIds) => set({ areaIds })}
                    describedBy={`${ids.areas}-h`}
                  />
                </div>
                <span id={`${ids.areas}-h`} className="font-normal text-muted">
                  {scopedAreas
                    ? "Con «Gestionar actividades de sus áreas» podrá crear y editar actividades de estas áreas."
                    : "Gestiona todas las actividades: las áreas son informativas."}
                </span>
              </div>

              <div className="flex flex-col gap-1.5 text-xs font-medium">
                <label htmlFor={ids.home}>Módulo inicial</label>
                <select
                  id={ids.home}
                  className="form-input min-h-[46px] text-base"
                  value={homeInvalid || !allowedHome.length ? "" : draft.homeModule}
                  disabled={!allowedHome.length}
                  aria-describedby={`${ids.home}-h`}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === "finance" || value === "calendar") set({ homeModule: value });
                  }}
                >
                  {!allowedHome.length && <option value="">Sin módulos permitidos</option>}
                  {homeInvalid && (
                    <option value="" disabled>
                      Elige un módulo permitido
                    </option>
                  )}
                  {allowedHome.map((module) => (
                    <option key={module} value={module}>
                      {HOME_MODULE_LABEL[module]}
                    </option>
                  ))}
                </select>
                <div id={`${ids.home}-h`} className="space-y-0.5 font-normal">
                  <p className="flex items-center gap-1 text-[13px]">
                    <ArrowRight size={14} aria-hidden="true" /> Al ingresar abrirá:{" "}
                    <strong className="font-semibold">{landingText({ ...draft, active: true })}</strong>
                  </p>
                  <p className="text-muted">Solo se ofrecen los módulos que puede ver.</p>
                </div>
              </div>
            </section>

            <section aria-labelledby="perm-h" className="space-y-3">
              <h3 id="perm-h" className="text-[15px] font-semibold">
                Permisos
              </h3>
              <PermissionChecklist
                draft={draft}
                onToggle={(perm, on) => set({ permissions: togglePermission(draft.permissions, perm, on) })}
              />
            </section>
          </fieldset>

          {confirmHome && resolvedHome && (
            <div role="group" aria-label="Confirmar módulo inicial" className="space-y-3 rounded-[12px] border border-line bg-canvas p-4 text-[13px]">
              <p>
                El módulo inicial ({HOME_MODULE_LABEL[draft.homeModule]}) ya no está permitido. Se guardará{" "}
                <strong>{HOME_MODULE_LABEL[resolvedHome]}</strong> como módulo inicial.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="button-secondary" onClick={() => setConfirmHome(false)} disabled={busy}>
                  Volver
                </button>
                <button
                  type="button"
                  className="button-primary"
                  disabled={busy}
                  onClick={() => void persist({ ...draft, homeModule: resolvedHome })}
                >
                  Guardar con {HOME_MODULE_LABEL[resolvedHome]}
                </button>
              </div>
            </div>
          )}

          <Notice error={confirmRemove ? "" : error} success={success} />
        </div>

        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-line bg-white px-6 py-4">
          {!self && (
            <button type="button" className="button-secondary" disabled={busy} onClick={resendAccess}>
              <Mail size={16} aria-hidden="true" />
              Reenviar acceso
            </button>
          )}
          {!self && saved.active && (
            <button
              type="button"
              className="button-danger"
              disabled={busy || lockActive}
              onClick={() => {
                setError("");
                setConfirmRemove(true);
              }}
            >
              <ShieldOff size={16} aria-hidden="true" />
              Quitar acceso
            </button>
          )}
          <span className="ml-auto flex flex-wrap gap-3">
            <button type="button" className="button-secondary" disabled={busy} onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="button-primary" disabled={busy || !dirty}>
              {busy ? "Guardando…" : "Guardar cambios"}
            </button>
          </span>
        </div>
      </form>
      {confirmRemove && (
        <RemoveAccessDialog
          name={account.displayName}
          busy={busy}
          error={error}
          onCancel={() => {
            setConfirmRemove(false);
            setError("");
          }}
          onConfirm={() => void removeAccess()}
        />
      )}
    </Modal>
  );
}

// ---------- Lista ----------

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1 text-[13px] text-primary">
      <CircleCheck size={14} aria-hidden="true" /> Activo
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[13px] text-muted">
      <CircleSlash size={14} aria-hidden="true" /> Sin acceso
    </span>
  );
}

function AreasCell({ ids, areas }: { ids: readonly string[]; areas: readonly Area[] }) {
  const list = ids.map((id) => areaById(areas, id)).filter((a): a is Area => !!a);
  if (!list.length) return <span className="text-muted">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((area) => (
        <AreaTag key={area.id} name={area.name} color={area.color} inactive={!area.active} />
      ))}
    </span>
  );
}

function homeCell(draft: AccessDraft): React.ReactNode {
  const landing = draftLanding({ ...draft, active: true });
  if (landing.kind !== "module") return <span className="text-muted">—</span>;
  if (!landing.invalidConfigured) return HOME_MODULE_LABEL[draft.homeModule];
  return (
    <span>
      <s className="text-muted">{HOME_MODULE_LABEL[landing.invalidConfigured]}</s> → {MODULE_LABEL[landing.module]}
      <span className="sr-only"> (su módulo inicial ya no está permitido)</span>
    </span>
  );
}

function UsersList({
  users,
  areas,
  currentUid,
  onEdit,
}: {
  users: readonly ManagedUser[];
  areas: readonly Area[];
  currentUid: string;
  onEdit: (id: string) => void;
}) {
  const rows = users.map((account) => ({
    account,
    draft: accessDraftFromUser(account),
    notices: userListNotices(account, areas),
  }));
  const withNotices = rows.filter((r) => r.notices.length).length;

  return (
    <div className="panel p-0">
      <p className="border-b border-line px-5 py-3 text-[13px] text-muted">
        {users.length} {users.length === 1 ? "usuario" : "usuarios"}
        {withNotices > 0 && ` · ${withNotices} con avisos`}
      </p>

      <table className="hidden w-full table-fixed text-left text-sm lg:table">
        <caption className="sr-only">Usuarios y permisos</caption>
        <thead className="text-xs text-muted">
          <tr className="border-b border-line">
            <th scope="col" className="px-5 py-3 font-medium">Usuario</th>
            <th scope="col" className="w-32 px-3 py-3 font-medium">Cargo</th>
            <th scope="col" className="w-48 px-3 py-3 font-medium">Áreas</th>
            <th scope="col" className="w-32 px-3 py-3 font-medium">Módulo inicial</th>
            <th scope="col" className="w-28 px-3 py-3 font-medium">Estado</th>
            <th scope="col" className="w-44 px-3 py-3 font-medium">Avisos</th>
            <th scope="col" className="w-24 px-3 py-3">
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ account, draft, notices }) => (
            <tr key={account.id} className="border-b border-line align-top last:border-b-0">
              <td className="px-5 py-3">
                <p className="break-words font-medium">
                  {account.displayName}
                  {account.id === currentUid && <span className="status-pill ml-2">Tu cuenta</span>}
                </p>
                <p className="break-all text-xs text-muted">{account.email}</p>
              </td>
              <td className="px-3 py-3">
                {draft.position || <span className="text-muted">—</span>}
                {draft.baseRole === "admin" && (
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                    <ShieldCheck size={12} aria-hidden="true" /> Administrador
                  </span>
                )}
              </td>
              <td className="px-3 py-3">
                <AreasCell ids={draft.areaIds} areas={areas} />
              </td>
              <td className="px-3 py-3">{draft.active ? homeCell(draft) : <span className="text-muted">—</span>}</td>
              <td className="px-3 py-3">
                <StatusBadge active={draft.active} />
              </td>
              <td className="px-3 py-3">
                {notices.length ? (
                  <span className="flex flex-col items-start gap-1">
                    {notices.map((n) => (
                      <WarningBadge key={n}>{n}</WarningBadge>
                    ))}
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => onEdit(account.id)}
                  aria-label={`Editar ${account.displayName}`}
                >
                  Editar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="lg:hidden" aria-label="Usuarios y permisos">
        {rows.map(({ account, draft, notices }) => {
          const areaNames = draft.areaIds.map((id) => areaById(areas, id)?.name).filter(Boolean);
          return (
            <li key={account.id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left"
                onClick={() => onEdit(account.id)}
                aria-label={`Editar ${account.displayName}`}
              >
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block break-words font-medium">
                    {account.displayName}
                    {account.id === currentUid && <span className="status-pill ml-2">Tu cuenta</span>}
                  </span>
                  <span className="block text-xs text-muted">
                    {draft.position || "Sin cargo"}
                    {draft.baseRole === "admin" ? " · Administrador" : ""}
                    {areaNames.length ? ` · ${areaNames.join(", ")}` : ""}
                  </span>
                  <span className="block text-xs text-muted">
                    {draft.active ? "Activo" : "Sin acceso"}
                  </span>
                  {notices.length > 0 && (
                    <span className="flex flex-wrap gap-1 pt-1">
                      {notices.map((n) => (
                        <WarningBadge key={n}>{n}</WarningBadge>
                      ))}
                    </span>
                  )}
                </span>
                <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-muted" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function UsersContent({ onRetry }: { onRetry: () => void }) {
  const { user } = useAuth();
  const users = useManagedUsers();
  const { areas } = useAreas();
  const [create, setCreate] = useState(false);
  const [success, setSuccess] = useState("");
  const [reviewUid, setReviewUid] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId ? (users.data.find((u) => u.id === editingId) ?? null) : null;

  const openEditor = (id: string) => {
    setSuccess("");
    setReviewUid(null);
    setEditingId(id);
  };

  return (
    <>
      <PageHeading
        title="Usuarios y permisos"
        subtitle="Define quién puede entrar a CDS Suite, qué ve, qué puede hacer y en qué módulo entra."
        action={
          <button type="button" className="button-primary" onClick={() => setCreate(true)}>
            <UserPlus size={17} aria-hidden="true" />
            Agregar usuario
          </button>
        }
      />

      <div className="notice settings-auth-notice">
        <strong>Cuentas de acceso</strong>
        <p>
          Los usuarios nuevos reciben un correo para definir su contraseña.
          Quitar acceso no elimina su historial y puede revertirse después.
        </p>
      </div>

      <Notice success={success} />
      {reviewUid && (
        <p className="-mt-2 mb-4">
          <button type="button" className="text-sm font-medium text-primary underline" onClick={() => openEditor(reviewUid)}>
            Revisar permisos
          </button>
        </p>
      )}

      {users.loading ? (
        <SettingsLoading label="Cargando usuarios…" />
      ) : users.error ? (
        <LoadError message={users.error} onRetry={onRetry} />
      ) : users.data.length && user ? (
        <UsersList users={users.data} areas={areas} currentUid={user.uid} onEdit={openEditor} />
      ) : (
        <div className="panel empty">No hay usuarios autorizados para mostrar.</div>
      )}

      {create && (
        <CreateUserForm
          areas={areas}
          onClose={() => setCreate(false)}
          onCreated={(message, uid) => {
            setSuccess(message);
            setReviewUid(uid);
          }}
        />
      )}

      {editing && user && (
        <UserEditor
          key={editing.id}
          account={editing}
          users={users.data}
          areas={areas}
          currentUid={user.uid}
          onClose={() => setEditingId(null)}
          onSaved={(message) => {
            setSuccess(message);
            setReviewUid(null);
          }}
        />
      )}
    </>
  );
}

export function UsersPermissionsPanel() {
  const [attempt, setAttempt] = useState(0);
  return <UsersContent key={attempt} onRetry={() => setAttempt((n) => n + 1)} />;
}
