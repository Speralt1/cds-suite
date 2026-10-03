"use client";

// Configuración › Áreas (18b §3.2). Lista con color + nombre + estado (y uso
// cuando hay datos del calendario), editor en el Modal productivo con SOLO los
// colores libres y vista previa, y activar/desactivar explicando la consecuencia.

import { useId, useState } from "react";
import { Ban, Check, ChevronRight, CircleCheck, Plus, Tags } from "lucide-react";
import { Modal, Notice } from "@/components/finance/shared";
import { useAuth } from "@/lib/auth/auth-provider";
import { getFirebaseServices } from "@/lib/firebase";
import {
  AREA_DESCRIPTION_MAX,
  AREA_NAME_MAX,
  AREA_PALETTE,
  activityCount,
  areaVar,
  freeColors,
  inactiveOwnerOfColor,
  validateArea,
  type Area,
  type AreaColor,
  type AreaErrors,
} from "@/lib/calendar/areas";
import {
  AreaValidationError,
  createArea,
  setAreaActive,
  updateArea,
  useAreas,
} from "@/lib/calendar/areas-client";
import { settingsSaveError } from "@/lib/settings/errors";
import {
  AreaDot,
  FieldError,
  InfoNote,
  LoadError,
  PageHeading,
  SettingsLoading,
  Switch,
  WarningNote,
} from "./settings-ui";

export type AreaUsageMap = ReadonlyMap<string, { responsible: number; participant: number }>;

const DEACTIVATE_BASE = "No se podrá elegir en actividades nuevas.";
const DEACTIVATE_LEADERS = "Los líderes de esta área ya no podrán editarlas.";

function deactivateConsequence(usage: { responsible: number } | undefined): string {
  if (!usage) return `${DEACTIVATE_BASE} Sus actividades conservan su nombre y color. ${DEACTIVATE_LEADERS}`;
  if (!usage.responsible) return `${DEACTIVATE_BASE} Las actividades donde participa conservan su nombre y color.`;
  const n = usage.responsible;
  return `${DEACTIVATE_BASE} ${n === 1 ? "Su actividad conserva" : `Sus ${n} actividades conservan`} su nombre y color. ${DEACTIVATE_LEADERS}`;
}

/** "Así se verá: [▌ 19:00 Reunión de Jóvenes]". */
function EventPreview({ name, color }: { name: string; color: AreaColor }) {
  const label = name.trim() || "Nueva área";
  return (
    <div className="rounded-[12px] border border-line bg-canvas p-3">
      <p className="text-xs font-medium text-muted">Así se verá:</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span
          className="inline-flex max-w-full items-center gap-2 rounded-[8px] border-l-4 py-1.5 pl-2 pr-3 text-[13px]"
          style={{ borderColor: areaVar(color, "swatch"), background: areaVar(color, "soft"), color: areaVar(color, "ink") }}
        >
          <span className="font-semibold tabular-nums">19:00</span>
          <span className="truncate">Reunión de {label}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: areaVar(color, "ink") }}>
          <AreaDot color={color} size={10} />
          {label} · {AREA_PALETTE[color].label}
        </span>
      </div>
    </div>
  );
}

function ColorPicker({
  options,
  value,
  onChange,
  error,
  freedBy,
}: {
  options: AreaColor[];
  value: AreaColor | null;
  onChange: (color: AreaColor) => void;
  error?: string;
  freedBy: { color: AreaColor; owner: string }[];
}) {
  const legendId = useId();
  const helpId = useId();
  return (
    <fieldset className="min-w-0" aria-describedby={helpId}>
      <legend id={legendId} className="mb-2 text-xs font-medium">
        Color
      </legend>
      {options.length ? (
        <div role="radiogroup" aria-labelledby={legendId} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {options.map((color) => {
            const checked = value === color;
            return (
              <label
                key={color}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border px-3 py-2 text-[13px] font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${
                  checked ? "border-ink bg-canvas" : "border-line bg-white"
                }`}
              >
                <input
                  type="radio"
                  name="area-color"
                  value={color}
                  checked={checked}
                  onChange={() => onChange(color)}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-white"
                  style={{ background: areaVar(color, "swatch") }}
                >
                  {checked && <Check size={16} strokeWidth={3} />}
                </span>
                <span>{AREA_PALETTE[color].label}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <WarningNote>Todos los colores están en uso. Desactiva un área para liberar el suyo.</WarningNote>
      )}
      <div id={helpId} className="mt-2 space-y-1 text-xs text-muted">
        {options.length > 0 && <p>Los demás colores están en uso por otras áreas activas.</p>}
        {freedBy.map(({ color, owner }) => (
          <p key={color}>
            {AREA_PALETTE[color].label}: libre (lo usaba {owner}, inactiva).
          </p>
        ))}
      </div>
      {error && (
        <div className="mt-2">
          <FieldError>{error}</FieldError>
        </div>
      )}
    </fieldset>
  );
}

function AreaEditor({
  editing,
  activate = false,
  areas,
  actorUid,
  onClose,
  onSaved,
}: {
  editing: Area | null;
  activate?: boolean;
  areas: readonly Area[];
  actorUid: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const nameId = useId();
  const descId = useId();
  const saveHelpId = useId();
  const willBeActive = activate || (editing?.active ?? true);
  const free = freeColors(areas, editing?.id);
  // Un área inactiva puede conservar su color aunque hoy lo use otra activa.
  const options =
    editing && !willBeActive && !free.includes(editing.color) ? [editing.color, ...free] : free;
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [color, setColor] = useState<AreaColor | null>(() =>
    editing && options.includes(editing.color) ? editing.color : (options[0] ?? null),
  );
  const [tried, setTried] = useState(false);
  const [serverErrors, setServerErrors] = useState<AreaErrors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const input = { id: editing?.id, name, description, color, active: willBeActive };
  const errors: AreaErrors = tried ? { ...validateArea(input, areas), ...serverErrors } : {};
  const noColors = !options.length;
  const freedBy = options
    .filter((c) => c !== editing?.color)
    .map((c) => ({ color: c, owner: inactiveOwnerOfColor(areas, c, editing?.id)?.name ?? "" }))
    .filter((x) => x.owner);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setTried(true);
    setServerErrors({});
    setError("");
    if (!color) return;
    if (Object.keys(validateArea(input, areas)).length) return;
    setBusy(true);
    try {
      const { db } = getFirebaseServices();
      const clean = { name, description, color };
      if (editing) {
        await updateArea(db, actorUid, editing.id, { ...clean, active: willBeActive }, areas);
        onSaved(activate ? `Área «${name.trim()}» activada.` : "Cambios guardados.");
      } else {
        await createArea(db, actorUid, clean, areas);
        onSaved(`Área «${name.trim()}» creada.`);
      }
      onClose();
    } catch (caught) {
      if (caught instanceof AreaValidationError) setServerErrors(caught.errors);
      else setError(settingsSaveError(caught));
    } finally {
      setBusy(false);
    }
  }

  const title = editing ? (activate ? `Activar ${editing.name}` : `Editar ${editing.name}`) : "Nueva área";

  return (
    <Modal title={title} onClose={onClose} busy={busy}>
      <form className="space-y-5 p-6" onSubmit={save} noValidate>
        <p className="text-[13px] text-muted">El color de cada actividad viene de su área responsable.</p>
        {activate && editing && (
          <InfoNote>
            Su color ({AREA_PALETTE[editing.color].label}) o su nombre lo usa otra área activa. Revisa los datos para
            activarla.
          </InfoNote>
        )}
        <fieldset disabled={busy} className="space-y-5">
          <label className="flex flex-col gap-1.5 text-xs font-medium" htmlFor={nameId}>
            Nombre
            <input
              id={nameId}
              data-autofocus
              className="form-input min-h-[46px] text-base"
              value={name}
              maxLength={AREA_NAME_MAX}
              required
              aria-invalid={!!errors.name || undefined}
              aria-describedby={errors.name ? `${nameId}-err` : undefined}
              placeholder="Ej.: Matrimonios jóvenes"
              onChange={(e) => setName(e.target.value)}
            />
            {errors.name && <FieldError id={`${nameId}-err`}>{errors.name}</FieldError>}
          </label>

          <label className="flex flex-col gap-1.5 text-xs font-medium" htmlFor={descId}>
            <span>
              Descripción <span className="font-normal text-muted">(opcional)</span>
            </span>
            <textarea
              id={descId}
              className="form-input min-h-[72px] text-base"
              rows={2}
              value={description}
              maxLength={AREA_DESCRIPTION_MAX}
              aria-describedby={`${descId}-count`}
              placeholder="Qué hace el área o quiénes participan"
              onChange={(e) => setDescription(e.target.value)}
            />
            <span id={`${descId}-count`} className="text-right text-xs font-normal text-muted">
              {description.length}/{AREA_DESCRIPTION_MAX}
            </span>
            {errors.description && <FieldError>{errors.description}</FieldError>}
          </label>

          <ColorPicker options={options} value={color} onChange={setColor} error={errors.color} freedBy={freedBy} />

          {color && <EventPreview name={name} color={color} />}
        </fieldset>

        <Notice error={error} />

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
          {noColors && (
            <p id={saveHelpId} className="mr-auto text-xs text-muted">
              Para guardar necesitas un color libre.
            </p>
          )}
          <button type="button" className="button-secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            className="button-primary"
            disabled={busy || noColors}
            aria-describedby={noColors ? saveHelpId : undefined}
          >
            {busy ? "Guardando…" : editing ? (activate ? "Activar área" : "Guardar cambios") : "Crear área"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeactivateDialog({
  area,
  usage,
  areas,
  actorUid,
  onClose,
  onDone,
}: {
  area: Area;
  usage: { responsible: number; participant: number } | undefined;
  areas: readonly Area[];
  actorUid: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await setAreaActive(getFirebaseServices().db, actorUid, area, false, areas);
      onDone(`Área «${area.name}» desactivada.`);
      onClose();
    } catch (caught) {
      setError(settingsSaveError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`¿Desactivar ${area.name}?`} onClose={onClose} busy={busy}>
      <div className="space-y-3 p-6 text-sm leading-6">
        <p>{deactivateConsequence(usage)}</p>
        <p className="text-xs text-muted">Puedes volver a activarla cuando quieras.</p>
        <Notice error={error} />
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <button type="button" className="button-secondary" data-autofocus disabled={busy} onClick={onClose}>
            Volver
          </button>
          <button type="button" className="button-danger" disabled={busy} onClick={confirm}>
            {busy ? "Desactivando…" : "Desactivar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Estado con ícono + texto: check solo para activa; inactiva con ícono "prohibido" en gris. */
function StatusText({ active, className = "text-[13px]" }: { active: boolean; className?: string }) {
  return active ? (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <CircleCheck size={14} aria-hidden="true" className="shrink-0 text-primary" /> Activa
    </span>
  ) : (
    <span className={`inline-flex items-center gap-1 text-muted ${className}`}>
      <Ban size={14} aria-hidden="true" className="shrink-0" /> Inactiva
    </span>
  );
}

function usageLine(usage: { responsible: number; participant: number } | undefined): string | null {
  if (!usage) return null;
  const main = activityCount(usage.responsible);
  return usage.participant ? `${main} · participa en ${usage.participant}` : main;
}

type EditorState = { area: Area | null; activate: boolean; n: number };

function AreasContent({ usage, onRetry }: { usage?: AreaUsageMap | null; onRetry: () => void }) {
  const { user } = useAuth();
  const { areas, loading, error } = useAreas();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirm, setConfirm] = useState<Area | null>(null);
  const [success, setSuccess] = useState("");
  const [actionError, setActionError] = useState("");
  const [toggling, setToggling] = useState<string | null>(null);
  const actorUid = user?.uid ?? "";
  const activeCount = areas.filter((a) => a.active).length;
  const inactiveCount = areas.length - activeCount;

  const open = (area: Area | null, activate = false) => {
    setSuccess("");
    setActionError("");
    setEditor((current) => ({ area, activate, n: (current?.n ?? 0) + 1 }));
  };

  async function toggle(area: Area) {
    setSuccess("");
    setActionError("");
    if (area.active) {
      setConfirm(area);
      return;
    }
    // Reactivar: si su nombre o color choca con otra área activa, se revisa en el editor.
    const conflicts = validateArea(
      { id: area.id, name: area.name, description: area.description, color: area.color, active: true },
      areas,
    );
    if (Object.keys(conflicts).length) {
      open(area, true);
      return;
    }
    setToggling(area.id);
    try {
      await setAreaActive(getFirebaseServices().db, actorUid, area, true, areas);
      setSuccess(`Área «${area.name}» activada.`);
    } catch (caught) {
      setActionError(settingsSaveError(caught));
    } finally {
      setToggling(null);
    }
  }

  const newButton = (
    <button type="button" className="button-primary" onClick={() => open(null)} disabled={loading || !!error}>
      <Plus size={17} aria-hidden="true" />
      Nueva área
    </button>
  );

  let body: React.ReactNode;
  if (loading) body = <SettingsLoading label="Cargando áreas…" />;
  else if (error) body = <LoadError message="No pudimos cargar las áreas." onRetry={onRetry} />;
  else if (!areas.length)
    body = (
      <div className="panel empty flex flex-col items-center gap-3">
        <Tags size={28} aria-hidden="true" className="text-muted" />
        <h3 className="text-lg font-medium text-ink">Aún no hay áreas</h3>
        <p>Crea la primera para organizar el calendario.</p>
        {newButton}
      </div>
    );
  else
    body = (
      <div className="panel p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3 text-[13px] text-muted">
          <p>
            {activeCount} {activeCount === 1 ? "activa" : "activas"} · {inactiveCount}{" "}
            {inactiveCount === 1 ? "inactiva" : "inactivas"}
          </p>
          <p>Cada color se usa en una sola área activa.</p>
        </div>

        <table className="hidden w-full table-fixed text-left text-sm md:table">
          <caption className="sr-only">Áreas de la iglesia</caption>
          <thead className="text-xs text-muted">
            <tr className="border-b border-line">
              <th scope="col" className="px-5 py-3 font-medium">Área</th>
              <th scope="col" className="px-3 py-3 font-medium">Descripción</th>
              {usage && (
                <th scope="col" className="w-44 px-3 py-3 font-medium">
                  Actividades próximas
                </th>
              )}
              <th scope="col" className="w-40 px-3 py-3 font-medium">Estado</th>
              <th scope="col" className="w-24 px-3 py-3">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {areas.map((area) => (
              <tr key={area.id} className="border-b border-line last:border-b-0">
                <td className="px-5 py-3">
                  <span className={`flex min-w-0 items-center gap-2.5 font-medium ${area.active ? "" : "text-muted"}`}>
                    <AreaDot color={area.color} size={16} square />
                    <span className="truncate">{area.name}</span>
                    <span className="sr-only">· color {AREA_PALETTE[area.color].label}</span>
                  </span>
                </td>
                <td className="px-3 py-3 text-muted">
                  <span className="line-clamp-2">{area.description || "—"}</span>
                </td>
                {usage && <td className="px-3 py-3 tabular-nums">{usageLine(usage.get(area.id) ?? { responsible: 0, participant: 0 })}</td>}
                <td className="px-3 py-1">
                  <span className="flex items-center gap-1">
                    <Switch
                      checked={area.active}
                      disabled={toggling === area.id}
                      onChange={() => void toggle(area)}
                      label={`${area.name}: área activa`}
                    />
                    <StatusText active={area.active} />
                  </span>
                </td>
                <td className="px-3 py-1 text-right">
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => open(area)}
                    aria-label={`Editar ${area.name}`}
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <ul className="md:hidden" aria-label="Áreas de la iglesia">
          {areas.map((area) => {
            const line = usage ? usageLine(usage.get(area.id) ?? { responsible: 0, participant: 0 }) : null;
            return (
              <li key={area.id} className="flex items-center gap-1 border-b border-line pr-2 last:border-b-0">
                <button
                  type="button"
                  className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left"
                  onClick={() => open(area)}
                  aria-label={`Editar ${area.name}`}
                >
                  <AreaDot color={area.color} size={20} square />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate font-medium ${area.active ? "" : "text-muted"}`}>{area.name}</span>
                    <span className="flex flex-wrap items-center gap-x-1 text-xs text-muted">
                      {line && <span>{line} ·</span>}
                      <StatusText active={area.active} className="text-xs" />
                    </span>
                  </span>
                  <ChevronRight size={18} aria-hidden="true" className="text-muted" />
                </button>
                <Switch
                  checked={area.active}
                  disabled={toggling === area.id}
                  onChange={() => void toggle(area)}
                  label={`${area.name}: área activa`}
                />
              </li>
            );
          })}
        </ul>
      </div>
    );

  return (
    <>
      <PageHeading
        title="Áreas"
        subtitle="Organizan el calendario y los permisos de los líderes. El color de cada actividad viene de su área."
        action={areas.length > 0 ? newButton : undefined}
      />
      <Notice error={actionError} success={success} />
      {body}
      {editor && (
        <AreaEditor
          key={editor.n}
          editing={editor.area}
          activate={editor.activate}
          areas={areas}
          actorUid={actorUid}
          onClose={() => setEditor(null)}
          onSaved={setSuccess}
        />
      )}
      {confirm && (
        <DeactivateDialog
          area={confirm}
          usage={usage ? (usage.get(confirm.id) ?? { responsible: 0, participant: 0 }) : undefined}
          areas={areas}
          actorUid={actorUid}
          onClose={() => setConfirm(null)}
          onDone={setSuccess}
        />
      )}
    </>
  );
}

/**
 * Panel de Áreas. `usage` (opcional): actividades próximas por área; sin él la
 * columna no se muestra y el aviso de desactivar no da cifras.
 */
export function AreasPanel({ usage }: { usage?: AreaUsageMap | null }) {
  const [attempt, setAttempt] = useState(0);
  return <AreasContent key={attempt} usage={usage} onRetry={() => setAttempt((n) => n + 1)} />;
}
