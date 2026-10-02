"use client";

// Configuración › Usuarios y permisos (16b §10.2, 16a §B).
// AccessProfile = Rol base + Cargo + Permisos + Áreas + Módulo inicial.
// Lista con avisos y editor en sheet (520 px; bottom sheet de alto completo en
// móvil) abierto con ?id= (deep link). El checklist muestra los permisos
// implicados marcados y deshabilitados; "Administrar configuración" nunca es
// editable (solo existe con el rol base de administrador). Guardar aplica
// user/update y el simulador "Ver como" y la navegación lo reflejan en la sesión.

import { useId, useMemo, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleSlash,
  Info,
  Lock,
  ShieldCheck,
  TriangleAlert,
  UserCog,
  UserRoundCog,
} from "lucide-react";
import {
  CARGO_PRESETS,
  INITIAL_MODULE_LABEL,
  PERMISSION_DESCRIPTION,
  PERMISSION_GROUPS,
  PERMISSION_LABEL,
  allowedInitialModules,
  effectivePermissions,
  implyingPermission,
  landingModuleName,
  resolveInitialModule,
  validateProfileChange,
  visibleModules,
  visibleModulesSummary,
} from "@/lib/suite-preview/access";
import { activeAreas, areaById } from "@/lib/suite-preview/areas";
import { initialsOf } from "@/lib/suite-preview/fixtures";
import { CARGOS, type AccessProfile, type Area, type Cargo, type InitialModule, type Permission } from "@/lib/suite-preview/types";
import { Callout, EmptyState, ErrorState, Panel, Sheet } from "@/components/finance-preview/ui";
import { AreaChip, AreaSwatch, PageHeader, areaStyle } from "../primitives";
import { useSuite } from "../provider";
import { useQueryParam } from "../use-query";
import { NoticeBadge, SettingsSkeleton, Switch, setUrlParam, useScreenState } from "./common";

// ---------- reglas de presentación (puras) ----------

const INITIAL_ERROR = "El módulo inicial no está permitido para estos permisos.";

/** Avisos de un perfil guardado (badges de la lista). */
export function userNotices(p: AccessProfile): { kind: "no-areas" | "fallback" | "no-modules"; text: string }[] {
  const out: { kind: "no-areas" | "fallback" | "no-modules"; text: string }[] = [];
  if (!p.active) return out;
  const eff = effectivePermissions(p);
  const landing = resolveInitialModule(p);
  if (landing.kind === "no-modules") out.push({ kind: "no-modules", text: "Sin módulos asignados" });
  if (eff.has("calendar.events.manage_assigned") && !eff.has("calendar.events.manage_all") && !p.areaIds.length)
    out.push({ kind: "no-areas", text: "Sin áreas asignadas" });
  if (landing.kind === "module" && landing.invalidInitial)
    out.push({ kind: "fallback", text: `Módulo inicial no permitido · abrirá ${landingModuleName(landing.module)}` });
  return out;
}

function sameProfile(a: AccessProfile, b: AccessProfile): boolean {
  const norm = (p: AccessProfile) =>
    JSON.stringify({ ...p, permissions: [...p.permissions].sort(), areaIds: [...p.areaIds].sort() });
  return norm(a) === norm(b);
}

function presetDiffers(p: AccessProfile, cargo: Cargo): boolean {
  const preset = CARGO_PRESETS[cargo];
  const a = [...p.permissions].sort().join();
  const b = [...preset.permissions].sort().join();
  return p.baseRole !== preset.baseRole || a !== b || p.initialModule !== preset.initialModule;
}

function onlyActiveAdmin(users: readonly AccessProfile[], uid: string): boolean {
  const admins = users.filter((u) => u.active && u.baseRole === "admin");
  return admins.length === 1 && admins[0].uid === uid;
}

// ---------- piezas ----------

function Avatar({ p }: { p: AccessProfile }) {
  return (
    <span className={`sx-set-user-avatar${p.active ? "" : " is-off"}`} aria-hidden="true">
      {initialsOf(p)}
    </span>
  );
}

function StatusBadgeUser({ active }: { active: boolean }) {
  return active ? (
    <NoticeBadge icon={CircleCheck} tone="success">
      Activo
    </NoticeBadge>
  ) : (
    <NoticeBadge icon={CircleSlash} tone="neutral">
      Inactivo
    </NoticeBadge>
  );
}

function UserNotices({ p }: { p: AccessProfile }) {
  const notices = userNotices(p);
  if (!notices.length) return null;
  return (
    <span className="sx-set-user-notices">
      {notices.map((n) => (
        <NoticeBadge key={n.kind} icon={TriangleAlert} tone="warning">
          {n.text}
        </NoticeBadge>
      ))}
    </span>
  );
}

function AreasCell({ p, areas }: { p: AccessProfile; areas: readonly Area[] }) {
  const list = p.areaIds.map((id) => areaById(areas, id)).filter((a): a is Area => !!a);
  if (!list.length) return <span className="sx-set-muted">—</span>;
  return (
    <span className="sx-set-user-areas">
      {list.map((a) => (
        <AreaChip key={a.id} area={a} />
      ))}
    </span>
  );
}

function initialCell(p: AccessProfile): React.ReactNode {
  const landing = resolveInitialModule(p);
  if (landing.kind !== "module") return <span className="sx-set-muted">—</span>;
  if (!landing.invalidInitial) return INITIAL_MODULE_LABEL[p.initialModule];
  return (
    <span className="sx-set-initial-fallback">
      <s className="sx-set-muted">{INITIAL_MODULE_LABEL[p.initialModule]}</s> <ArrowRight size={12} aria-hidden="true" />{" "}
      {landingModuleName(landing.module)}
      <span className="fx-sr"> (su módulo inicial ya no está permitido)</span>
    </span>
  );
}

/** Explicación del modelo de acceso + adaptación de los 4 roles actuales. */
function AccessModelPanel() {
  const [open, setOpen] = useState(false);
  const steps: [string, string][] = [
    ["Rol base", "Administrador (todo) o estándar."],
    ["Cargo", "Etiqueta que propone permisos."],
    ["Permisos", "Qué puede ver y hacer."],
    ["Áreas", "Qué actividades gestiona."],
    ["Módulo inicial", "Dónde entra al ingresar."],
  ];
  return (
    <Panel className="sx-set-model">
      <div className="sx-set-model-head">
        <span className="sx-set-model-icon" aria-hidden="true">
          <ShieldCheck size={18} />
        </span>
        <div style={{ minWidth: 0 }}>
          <h2 className="fx-h2">Cómo se define el acceso</h2>
          <p className="fx-help-13">Cada persona ve solo los módulos que le corresponden y entra directo al suyo.</p>
        </div>
      </div>
      <ol className="sx-set-model-steps">
        {steps.map(([t, d], i) => (
          <li key={t}>
            <span className="sx-set-model-num" aria-hidden="true">
              {i + 1}
            </span>
            <span>
              <strong>{t}</strong>
              <span className="fx-help">{d}</span>
            </span>
          </li>
        ))}
      </ol>
      <button type="button" className="fx-toggle sx-set-model-toggle" aria-expanded={open} aria-controls="sx-set-model-roles" onClick={() => setOpen((v) => !v)}>
        Cómo se adaptan los roles actuales de CDS <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <ul className="sx-set-model-roles" id="sx-set-model-roles">
          <li>
            <strong>Administrador</strong>
            <span>Rol base administrador · cargo Administración. Entra a Finanzas, como hoy.</span>
          </li>
          <li>
            <strong>Pastor</strong>
            <span>Cargo Pastor: todo menos Configuración. Conserva Finanzas como módulo inicial hasta que lo cambie.</span>
          </li>
          <li>
            <strong>Finanzas</strong>
            <span>Cargo Finanzas: Finanzas completo, Calendario en lectura y Reportes.</span>
          </li>
          <li>
            <strong>Líder</strong>
            <span>Cargo Líder: resumen financiero y sus actividades. Sin áreas hasta que se las asignes; mientras, solo lee el calendario.</span>
          </li>
        </ul>
      )}
    </Panel>
  );
}

// ---------- checklist de permisos ----------

function PermissionChecklist({ draft, onToggle }: { draft: AccessProfile; onToggle: (perm: Permission, on: boolean) => void }) {
  const isAdmin = draft.baseRole === "admin";
  const eff = effectivePermissions({ ...draft, active: true });
  return (
    <div className="sx-set-perms">
      {isAdmin && (
        <Callout tone="info" icon={ShieldCheck}>
          <p>
            <strong>Tiene acceso completo.</strong> El rol base de administrador incluye todos los permisos, también la
            configuración.
          </p>
        </Callout>
      )}
      {PERMISSION_GROUPS.map((g) => (
        <fieldset key={g.id} className="sx-set-perm-group">
          <legend className="sx-set-perm-group-label">{g.label}</legend>
          <ul>
            {g.permissions.map((perm) => {
              const id = `sx-set-perm-${perm.replace(/\./g, "-")}`;
              const locked = perm === "settings.manage";
              const via = isAdmin || locked ? null : implyingPermission(perm, draft.permissions);
              const checked = isAdmin || eff.has(perm);
              const disabled = isAdmin || locked || !!via;
              const note = locked
                ? isAdmin
                  ? "Incluido por el rol base de administrador."
                  : "Solo administradores (rol base)."
                : isAdmin
                  ? "Incluido por el rol base de administrador."
                  : via
                    ? `Incluido por «${PERMISSION_LABEL[via]}».`
                    : null;
              return (
                <li key={perm} className={`sx-set-perm${disabled ? " is-disabled" : ""}${locked ? " is-locked" : ""}`}>
                  <input
                    type="checkbox"
                    id={id}
                    checked={checked}
                    disabled={disabled}
                    aria-describedby={`${id}-d${note ? ` ${id}-n` : ""}`}
                    onChange={(e) => onToggle(perm, e.target.checked)}
                  />
                  <label htmlFor={id} className="sx-set-perm-text">
                    <span className="sx-set-perm-label">
                      {locked && <Lock size={13} aria-hidden="true" />}
                      {PERMISSION_LABEL[perm]}
                    </span>
                    <span className="sx-set-perm-desc" id={`${id}-d`}>
                      {PERMISSION_DESCRIPTION[perm]}
                    </span>
                    {note && (
                      <span className="sx-set-perm-note" id={`${id}-n`}>
                        {note}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}

// ---------- editor ----------

function UserEditor({ user, onClose }: { user: AccessProfile; onClose: () => void }) {
  const suite = useSuite();
  const { state, dispatch, profileId } = suite;
  const [draft, setDraft] = useState<AccessProfile>(() => structuredClone(user));
  const [pendingPreset, setPendingPreset] = useState<Cargo | null>(null);
  const cargoId = useId();
  const initialId = useId();
  const areasId = useId();

  const isSelf = user.uid === profileId;
  const lastAdmin = onlyActiveAdmin(state.users, user.uid);
  const lockAdmin = user.baseRole === "admin" && (isSelf || lastAdmin);
  const lockActive = user.active && (isSelf || (user.baseRole === "admin" && lastAdmin));

  const { errors: rawErrors, warnings: rawWarnings } = validateProfileChange(profileId, state.users, draft, state.areas);
  const landing = resolveInitialModule(draft);
  const allowed = allowedInitialModules(draft);
  const initialInvalid = draft.active && visibleModules(draft).length > 0 && !allowed.includes(draft.initialModule);
  const errors = rawErrors.filter((e) => e !== INITIAL_ERROR);
  const warnings = [...rawWarnings];
  if (draft.active && landing.kind === "no-modules")
    warnings.push("Sin módulos: al ingresar verá «Aún no tienes módulos asignados».");
  const dirty = !sameProfile(draft, user);
  const blocked = errors.length > 0 || initialInvalid;
  const summary = visibleModulesSummary(draft);
  const eff = effectivePermissions({ ...draft, active: true });
  const areaOptions = useMemo(() => {
    const act = activeAreas(state.areas);
    const extra = draft.areaIds
      .map((id) => areaById(state.areas, id))
      .filter((a): a is Area => !!a && !a.active);
    return [...act, ...extra];
  }, [state.areas, draft.areaIds]);

  const set = (patch: Partial<AccessProfile>) => setDraft((d) => ({ ...d, ...patch }));

  const togglePerm = (perm: Permission, on: boolean) =>
    setDraft((d) => ({
      ...d,
      permissions: on ? [...d.permissions.filter((x) => x !== perm), perm] : d.permissions.filter((x) => x !== perm),
    }));

  const applyPreset = (cargo: Cargo) => {
    const preset = CARGO_PRESETS[cargo];
    setDraft((d) => ({ ...d, cargo, baseRole: preset.baseRole, permissions: [...preset.permissions], initialModule: preset.initialModule }));
    setPendingPreset(null);
  };

  const save = () => {
    if (!dirty || blocked) return;
    const res = dispatch({ type: "user/update", profile: draft }, `Cambios de ${draft.displayName} guardados`);
    if (res.ok) onClose();
  };

  const landingLine =
    landing.kind === "module"
      ? landingModuleName(landing.module)
      : landing.kind === "no-modules"
        ? "Aún no tiene módulos"
        : "No podrá ingresar (cuenta inactiva)";

  return (
    <Sheet
      open
      onClose={onClose}
      title={user.displayName}
      subtitle={
        <span className="sx-set-user-sub">
          <span>{user.email}</span>
          <StatusBadgeUser active={draft.active} />
          {isSelf && <span className="fx-help">· Eres tú</span>}
        </span>
      }
      labelId="sx-set-user-editor-title"
      footer={
        <>
          {dirty && blocked && (
            <p className="sx-set-foot-hint">
              <CircleAlert size={14} aria-hidden="true" />
              {initialInvalid ? "Elige un módulo inicial permitido para guardar." : errors[0]}
            </p>
          )}
          <button type="button" className="fx-btn fx-btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="fx-btn fx-btn-primary"
            onClick={save}
            disabled={!dirty || blocked}
            aria-describedby={blocked ? "sx-set-user-blockers" : undefined}
          >
            Guardar cambios
          </button>
        </>
      }
    >
      <div className="sx-set-user-editor">
        <section className="sx-set-user-summary" aria-label="Resumen del acceso">
          <p>
            <span className="sx-set-user-summary-k">Verá:</span>{" "}
            {summary.length ? summary.join(" · ") : <span>ningún módulo</span>}
          </p>
          {!dirty && user.active && user.uid !== profileId && (
            <button type="button" className="fx-btn fx-btn-ghost fx-btn-sm sx-set-user-viewas" onClick={() => suite.switchProfile(user.uid)}>
              <UserRoundCog size={14} aria-hidden="true" /> Ver como este perfil
            </button>
          )}
        </section>

        {(errors.length > 0 || warnings.length > 0) && (
          <div className="sx-set-user-alerts" id="sx-set-user-blockers">
            {errors.map((e) => (
              <Callout key={e} tone="danger" icon={CircleAlert}>
                <p role="alert">{e}</p>
              </Callout>
            ))}
            {warnings.map((w) => (
              <Callout key={w} tone="warning" icon={TriangleAlert}>
                <p>{w}</p>
              </Callout>
            ))}
          </div>
        )}

        <section className="fx-sheet-section" aria-labelledby="sx-set-ue-access">
          <h3 className="fx-h3" id="sx-set-ue-access">
            Acceso
          </h3>
          <div className="sx-set-toggle-row">
            <div>
              <p className="sx-set-toggle-title">Cuenta activa</p>
              <p className="sx-set-field-help" id="sx-set-ue-active-d">
                {lockActive
                  ? isSelf
                    ? "No puedes desactivar tu propia cuenta."
                    : "Es el único administrador activo; no se puede desactivar."
                  : draft.active
                    ? "Puede ingresar a CDS."
                    : "No podrá ingresar hasta que la actives."}
              </p>
            </div>
            <Switch checked={draft.active} onChange={(v) => set({ active: v })} label="Cuenta activa" disabled={lockActive} describedBy="sx-set-ue-active-d" />
          </div>
          <div className="sx-set-toggle-row">
            <div>
              <p className="sx-set-toggle-title">Administrador (rol base)</p>
              <p className="sx-set-field-help" id="sx-set-ue-admin-d">
                {lockAdmin
                  ? isSelf
                    ? "No puedes quitarte el acceso de administrador."
                    : "Es el único administrador activo; no se le puede quitar."
                  : draft.baseRole === "admin"
                    ? "Tiene acceso completo, incluida la configuración."
                    : "Accede solo con los permisos marcados abajo."}
              </p>
            </div>
            <Switch
              checked={draft.baseRole === "admin"}
              onChange={(v) => set({ baseRole: v ? "admin" : "standard" })}
              label="Administrador (rol base)"
              disabled={lockAdmin}
              describedBy="sx-set-ue-admin-d"
            />
          </div>
        </section>

        <section className="fx-sheet-section" aria-labelledby="sx-set-ue-cargo">
          <h3 className="fx-h3" id="sx-set-ue-cargo">
            Cargo, áreas y módulo inicial
          </h3>
          <div className="fx-field">
            <label htmlFor={cargoId}>Cargo</label>
            <select
              id={cargoId}
              className="fx-select"
              value={draft.cargo}
              aria-describedby={`${cargoId}-h`}
              onChange={(e) => {
                const cargo = e.target.value as Cargo;
                set({ cargo });
                setPendingPreset(presetDiffers(draft, cargo) ? cargo : null);
              }}
            >
              {CARGOS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <p className="sx-set-field-help" id={`${cargoId}-h`}>
              Al cambiar el cargo se proponen sus permisos; nada cambia sin tu confirmación.
            </p>
          </div>
          {pendingPreset && (
            <div className="sx-set-preset-confirm" role="group" aria-label={`Permisos sugeridos para ${pendingPreset}`}>
              <p>
                <strong>¿Aplicar los permisos sugeridos para {pendingPreset}?</strong> Se reemplazarán{" "}
                {CARGO_PRESETS[pendingPreset].baseRole !== draft.baseRole ? "el rol base, " : ""}los permisos marcados y el módulo
                inicial ({INITIAL_MODULE_LABEL[CARGO_PRESETS[pendingPreset].initialModule]}).
              </p>
              <div className="sx-set-preset-actions">
                <button type="button" className="fx-btn fx-btn-secondary fx-btn-sm" onClick={() => setPendingPreset(null)}>
                  Mantener los actuales
                </button>
                <button type="button" className="fx-btn fx-btn-primary fx-btn-sm" onClick={() => applyPreset(pendingPreset)}>
                  Aplicar permisos del cargo
                </button>
              </div>
            </div>
          )}

          <fieldset className="sx-set-field-set" aria-describedby={`${areasId}-h`}>
            <legend className="sx-set-field-label">Áreas asignadas</legend>
            <div className="sx-set-area-picks">
              {areaOptions.map((a) => {
                const on = draft.areaIds.includes(a.id);
                return (
                  <label key={a.id} className={`sx-set-area-pick${on ? " is-on" : ""}`} style={areaStyle(a.color)}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) =>
                        set({ areaIds: e.target.checked ? [...draft.areaIds, a.id] : draft.areaIds.filter((x) => x !== a.id) })
                      }
                    />
                    <AreaSwatch color={a.color} size={10} />
                    <span>{a.name}</span>
                    {!a.active && <span className="sx-area-inactive">(inactiva)</span>}
                  </label>
                );
              })}
            </div>
            <p className="sx-set-field-help" id={`${areasId}-h`}>
              {eff.has("calendar.events.manage_all") || draft.baseRole === "admin"
                ? "Gestiona todas las actividades: las áreas son informativas."
                : "Con «Gestionar actividades de sus áreas» podrá crear y editar las actividades de estas áreas."}
            </p>
          </fieldset>

          <div className="fx-field">
            <label htmlFor={initialId}>Módulo inicial</label>
            <select
              id={initialId}
              className="fx-select"
              value={initialInvalid ? "" : draft.initialModule}
              disabled={!allowed.length}
              aria-invalid={initialInvalid || undefined}
              aria-describedby={`${initialId}-h`}
              onChange={(e) => set({ initialModule: e.target.value as InitialModule })}
            >
              {initialInvalid && (
                <option value="" disabled>
                  Elige un módulo permitido
                </option>
              )}
              {!allowed.length && <option value="">Sin módulos permitidos</option>}
              {allowed.map((m) => (
                <option key={m} value={m}>
                  {INITIAL_MODULE_LABEL[m]}
                </option>
              ))}
            </select>
            <div id={`${initialId}-h`}>
              {initialInvalid ? (
                <p className="fx-error" role="alert">
                  <CircleAlert size={14} aria-hidden="true" /> {INITIAL_MODULE_LABEL[draft.initialModule]} ya no está permitido. Elige
                  un módulo permitido para guardar.
                </p>
              ) : (
                <p className="sx-set-landing-line">
                  <ArrowRight size={14} aria-hidden="true" /> Al ingresar abrirá: <strong>{landingLine}</strong>
                </p>
              )}
              <p className="sx-set-field-help">Solo se ofrecen los módulos que puede ver.</p>
            </div>
          </div>
        </section>

        <section className="fx-sheet-section" aria-labelledby="sx-set-ue-perms">
          <h3 className="fx-h3" id="sx-set-ue-perms">
            Permisos
          </h3>
          <PermissionChecklist draft={draft} onToggle={togglePerm} />
        </section>
      </div>
    </Sheet>
  );
}

// ---------- pantalla ----------

export function UsersScreen() {
  const { state } = useSuite();
  const { state: screen, clear } = useScreenState();
  const openId = useQueryParam("id");
  const users = state.users;
  const editing = openId ? users.find((u) => u.uid === openId) ?? null : null;
  const open = (uid: string) => setUrlParam("id", uid);
  const close = () => setUrlParam("id", null);
  const withNotices = users.filter((u) => userNotices(u).length).length;

  let body: React.ReactNode;
  if (screen === "cargando") body = <SettingsSkeleton />;
  else if (screen === "error") body = <ErrorState title="No pudimos cargar los usuarios" onRetry={clear} />;
  else if (screen === "vacio")
    body = <EmptyState icon={UserCog} title="Solo hay un administrador" body="Siempre queda al menos un administrador activo." />;
  else
    body = (
      <div className="sx-set-cq">
        <table className="fx-table fx-table-fixed sx-set-table sx-set-users-table">
          <caption className="fx-sr">Usuarios y permisos</caption>
          <colgroup>
            <col />
            <col style={{ width: 124 }} />
            <col className="sx-set-col-areas" style={{ width: 216 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 104 }} />
            <col style={{ width: 84 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Usuario</th>
              <th scope="col">Cargo</th>
              <th scope="col" className="sx-set-col-areas">
                Áreas
              </th>
              <th scope="col">Módulo inicial</th>
              <th scope="col">Estado</th>
              <th scope="col">
                <span className="fx-sr">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.uid} className={u.active ? "" : "is-inactive"}>
                <td>
                  <span className="sx-set-user-cell">
                    <Avatar p={u} />
                    <span className="sx-set-user-cell-text">
                      <button type="button" className="sx-set-user-name" onClick={() => open(u.uid)}>
                        {u.displayName}
                      </button>
                      <span className="fx-cell-sub">{u.email}</span>
                      {u.areaIds.length > 0 && (
                        <span className="sx-set-user-areas-inline">
                          <AreasCell p={u} areas={state.areas} />
                        </span>
                      )}
                      <UserNotices p={u} />
                    </span>
                  </span>
                </td>
                <td>
                  {u.cargo}
                  {u.baseRole === "admin" && <span className="sx-set-role-sub">Administrador</span>}
                </td>
                <td className="sx-set-col-areas">
                  <AreasCell p={u} areas={state.areas} />
                </td>
                <td>{initialCell(u)}</td>
                <td>
                  <StatusBadgeUser active={u.active} />
                </td>
                <td>
                  <button type="button" className="fx-btn fx-btn-ghost fx-btn-sm" onClick={() => open(u.uid)} aria-label={`Editar ${u.displayName}`}>
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="sx-set-list" aria-label="Usuarios y permisos">
          {users.map((u) => {
            const landing = resolveInitialModule(u);
            const areaNames = u.areaIds.map((id) => areaById(state.areas, id)?.name).filter(Boolean);
            return (
              <li key={u.uid}>
                <button type="button" className={`sx-set-row sx-set-user-row${u.active ? "" : " is-inactive"}`} onClick={() => open(u.uid)}>
                  <Avatar p={u} />
                  <span className="sx-set-row-text">
                    <span className="sx-set-row-title">{u.displayName}</span>
                    <span className="sx-set-row-meta">
                      {u.cargo}
                      {areaNames.length ? ` · ${areaNames.join(", ")}` : ""}
                    </span>
                    <span className="sx-set-row-meta">
                      {landing.kind === "module" ? `Abre ${landingModuleName(landing.module)}` : "Sin módulo de entrada"} ·{" "}
                      {u.active ? "Activo" : "Inactivo"}
                    </span>
                    <UserNotices p={u} />
                  </span>
                  <ChevronRight size={18} aria-hidden="true" className="sx-set-row-chevron" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );

  return (
    <>
      <PageHeader
        title="Usuarios y permisos"
        subtitle="Define qué ve cada persona, qué puede hacer y en qué módulo entra."
      />
      <AccessModelPanel />
      <Panel flush className="sx-set-panel">
        {!screen && (
          <div className="sx-set-panel-head">
            <p className="fx-help-13">
              <span className="fx-num">{users.length}</span> usuarios
              {withNotices > 0 && (
                <>
                  {" "}
                  · <span className="fx-num">{withNotices}</span> con avisos
                </>
              )}
            </p>
            <NoticeBadge icon={Info} tone="neutral">
              Los cambios se reflejan en «Ver como»
            </NoticeBadge>
          </div>
        )}
        {body}
      </Panel>
      {editing && !screen && <UserEditor key={editing.uid} user={editing} onClose={close} />}
    </>
  );
}
