"use client";

// Configuración › Áreas (16b §10.1). Lista con color + nombre + estado y uso,
// editor en sheet de 440 con selector de SOLO los colores libres y vista previa
// del chip de actividad. Desactivar pide confirmación y explica la consecuencia.

import { useId, useState } from "react";
import { Check, ChevronRight, CircleAlert, CircleCheck, CircleSlash, Info, Plus, Tags, TriangleAlert } from "lucide-react";
import {
  AREA_PALETTE,
  areaUsage,
  freeColors,
  inactiveOwnerOfColor,
  sortAreas,
  validateArea,
} from "@/lib/suite-preview/areas";
import type { Area, AreaColor } from "@/lib/suite-preview/types";
import { Callout, EmptyState, ErrorState, Panel, Sheet } from "@/components/finance-preview/ui";
import { AreaChip, AreaSwatch, PageHeader, areaStyle } from "../primitives";
import { useSuite } from "../provider";
import { NoticeBadge, SettingsSkeleton, Switch, useScreenState } from "./common";

const DEACTIVATE_CONSEQUENCE = "No se podrá elegir para actividades nuevas; las existentes conservan nombre y color.";

function usageText(n: { responsible: number; participant: number }): string {
  const main = `${n.responsible} ${n.responsible === 1 ? "actividad" : "actividades"}`;
  return n.participant ? `${main} · participa en ${n.participant}` : main;
}

/** "Así se verá": chip de mes + AreaChip con el color elegido. */
function EventPreview({ name, color }: { name: string; color: AreaColor }) {
  const label = name.trim() || "Nueva área";
  return (
    <div className="sx-set-area-preview" aria-label={`Vista previa: actividad de ${label} con color ${AREA_PALETTE[color].label}`}>
      <span className="sx-set-area-preview-label">Así se verá:</span>
      <div className="sx-set-area-preview-row" aria-hidden="true">
        <span className="sx-set-ev-chip" style={areaStyle(color)}>
          <span className="sx-set-ev-chip-time">19:00</span>
          <span className="sx-set-ev-chip-title">Reunión de {label}</span>
        </span>
        <AreaChip area={{ name: label, color }} />
      </div>
    </div>
  );
}

function ColorPicker({
  areas,
  editing,
  value,
  onChange,
  error,
}: {
  areas: readonly Area[];
  editing: Area | null;
  value: AreaColor | null;
  onChange: (c: AreaColor) => void;
  error?: string;
}) {
  const legendId = useId();
  const helpId = useId();
  const free = freeColors(areas, editing?.id);
  const options = editing && !free.includes(editing.color) ? [editing.color, ...free] : free;
  const freedBy = options
    .map((c) => ({ c, owner: inactiveOwnerOfColor(areas, c, editing?.id) }))
    .filter((x) => x.owner && x.c !== editing?.color);
  return (
    <fieldset className="sx-set-field-set" aria-describedby={helpId}>
      <legend id={legendId} className="sx-set-field-label">
        Color <span aria-hidden="true">*</span>
      </legend>
      {options.length ? (
        <div className="sx-set-color-grid" role="radiogroup" aria-labelledby={legendId}>
          {options.map((c) => {
            const tone = AREA_PALETTE[c];
            const checked = value === c;
            return (
              <label key={c} className={`sx-set-color-opt${checked ? " is-checked" : ""}`} style={areaStyle(c)}>
                <input
                  type="radio"
                  name="area-color"
                  value={c}
                  checked={checked}
                  onChange={() => onChange(c)}
                  className="fx-sr"
                />
                <span className="sx-set-color-swatch" aria-hidden="true">
                  {checked && <Check size={18} strokeWidth={3} />}
                </span>
                <span className="sx-set-color-name">{tone.label}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <Callout tone="warning" icon={TriangleAlert}>
          <p>Todos los colores están en uso. Desactiva un área para liberar el suyo.</p>
        </Callout>
      )}
      <div id={helpId} className="sx-set-field-help">
        {options.length > 0 && <p>Los demás colores están en uso por otras áreas activas.</p>}
        {freedBy.map(({ c, owner }) => (
          <p key={c}>
            {AREA_PALETTE[c].label}: libre (lo usaba {owner!.name}, inactiva).
          </p>
        ))}
      </div>
      {error && (
        <p className="fx-error" role="alert">
          <CircleAlert size={14} aria-hidden="true" /> {error}
        </p>
      )}
    </fieldset>
  );
}

function AreaEditor({ editing, activate, onClose }: { editing: Area | null; activate?: boolean; onClose: () => void }) {
  const { state, dispatch } = useSuite();
  const nameId = useId();
  const descId = useId();
  const activeId = useId();
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [active, setActive] = useState(activate ? true : (editing?.active ?? true));
  const [color, setColor] = useState<AreaColor | null>(() => {
    const free = freeColors(state.areas, editing?.id);
    if (!editing) return free[0] ?? null;
    return activate && !free.includes(editing.color) ? (free[0] ?? null) : editing.color;
  });
  const [tried, setTried] = useState(false);

  const input = { id: editing?.id, name, description, color: color ?? ("" as AreaColor), active };
  const errors = tried ? validateArea(input, state.areas) : {};
  const noColors = !color;
  const usage = editing ? areaUsage(editing.id, state.events) : null;
  const deactivating = !!editing?.active && !active;

  const save = () => {
    setTried(true);
    if (!color) return;
    const errs = validateArea(input, state.areas);
    if (Object.keys(errs).length) return;
    const res = dispatch(
      { type: "area/upsert", area: { id: editing?.id, name, description, color, active } },
      editing ? `Área «${name.trim()}» actualizada` : `Área «${name.trim()}» creada`,
    );
    if (res.ok) onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={editing ? `Editar ${editing.name}` : "Nueva área"}
      subtitle="El color de cada actividad viene de su área responsable."
      labelId="sx-set-area-editor-title"
      footer={
        <>
          <button type="button" className="fx-btn fx-btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="fx-btn fx-btn-primary" onClick={save} disabled={noColors} aria-disabled={noColors || undefined}>
            {editing ? "Guardar cambios" : "Crear área"}
          </button>
        </>
      }
    >
      <div className="sx-set-area-editor">
        {activate && editing && (
          <Callout tone="info" icon={Info}>
            <p>
              Su color ({AREA_PALETTE[editing.color].label}) lo usa otra área activa. Elige uno libre para activarla.
            </p>
          </Callout>
        )}
        <div className="fx-field">
          <label htmlFor={nameId}>
            Nombre <span aria-hidden="true">*</span>
          </label>
          <input
            id={nameId}
            className="fx-input"
            value={name}
            maxLength={60}
            required
            aria-required="true"
            aria-invalid={!!errors.name || undefined}
            aria-describedby={errors.name ? `${nameId}-err` : undefined}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej.: Matrimonios jóvenes"
          />
          {errors.name && (
            <p className="fx-error" id={`${nameId}-err`} role="alert">
              <CircleAlert size={14} aria-hidden="true" /> {errors.name}
            </p>
          )}
        </div>
        <div className="fx-field">
          <label htmlFor={descId}>
            Descripción <span className="sx-set-optional">(opcional)</span>
          </label>
          <textarea
            id={descId}
            value={description}
            maxLength={220}
            rows={2}
            aria-invalid={!!errors.description || undefined}
            aria-describedby={`${descId}-count`}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Qué hace el área o quiénes participan"
          />
          <p className={`sx-set-field-count${description.length > 200 ? " is-over" : ""}`} id={`${descId}-count`}>
            {description.length}/200
          </p>
          {errors.description && (
            <p className="fx-error" role="alert">
              <CircleAlert size={14} aria-hidden="true" /> {errors.description}
            </p>
          )}
        </div>

        <ColorPicker areas={state.areas} editing={editing} value={color} onChange={setColor} error={errors.color} />

        {color && <EventPreview name={name} color={color} />}

        <div className="sx-set-toggle-row">
          <div>
            <p className="sx-set-toggle-title" id={`${activeId}-t`}>
              {active ? "Activa" : "Inactiva"}
            </p>
            <p className="sx-set-field-help" id={`${activeId}-d`}>
              {active ? "Se puede elegir como responsable o participante de actividades." : DEACTIVATE_CONSEQUENCE}
            </p>
          </div>
          <Switch checked={active} onChange={setActive} label="Área activa" describedBy={`${activeId}-d`} />
        </div>
        {deactivating && usage && usage.responsible > 0 && (
          <Callout tone="warning" icon={TriangleAlert}>
            <p>
              Sus {usageText(usage).replace(/ · .*/, "")} conservan su nombre y color. Los líderes de esta área ya no podrán
              editarlas.
            </p>
          </Callout>
        )}
      </div>
    </Sheet>
  );
}

function DeactivateDialog({ area, onClose }: { area: Area; onClose: () => void }) {
  const { state, dispatch } = useSuite();
  const usage = areaUsage(area.id, state.events);
  return (
    <Sheet
      open
      variant="center"
      onClose={onClose}
      title={`¿Desactivar ${area.name}?`}
      labelId="sx-set-area-deactivate-title"
      footer={
        <>
          <button type="button" className="fx-btn fx-btn-secondary" onClick={onClose}>
            Volver
          </button>
          <button
            type="button"
            className="fx-btn fx-btn-primary"
            onClick={() => {
              const res = dispatch({ type: "area/setActive", id: area.id, active: false }, `Área «${area.name}» desactivada`);
              if (res.ok) onClose();
            }}
          >
            Desactivar
          </button>
        </>
      }
    >
      <div className="sx-set-confirm-body">
        <p>{DEACTIVATE_CONSEQUENCE}</p>
        {usage.responsible > 0 && (
          <p>
            Tiene {usageText(usage).replace(/ · .*/, "")} como responsable. Los líderes de esta área ya no podrán editarlas.
          </p>
        )}
        <p className="sx-set-field-help">Puedes volver a activarla cuando quieras.</p>
      </div>
    </Sheet>
  );
}

function StatusCell({ area, onToggle }: { area: Area; onToggle: (a: Area) => void }) {
  return (
    <span className="sx-set-status-cell">
      <Switch checked={area.active} onChange={() => onToggle(area)} label={`${area.name} activa`} />
      <span className={area.active ? "" : "sx-set-muted"}>{area.active ? "Activa" : "Inactiva"}</span>
    </span>
  );
}

export function AreasScreen() {
  const { state, dispatch } = useSuite();
  const { state: screen, clear } = useScreenState();
  const [editor, setEditor] = useState<{ area: Area | null; n: number; activate?: boolean } | null>(null);
  const [confirm, setConfirm] = useState<Area | null>(null);
  const areas = screen === "vacio" ? [] : sortAreas(state.areas);
  const activeCount = areas.filter((a) => a.active).length;
  const open = (area: Area | null, activate?: boolean) => setEditor({ area, n: (editor?.n ?? 0) + 1, activate });

  const toggle = (a: Area) => {
    if (a.active) {
      setConfirm(a);
      return;
    }
    // Reactivar: si otra área activa usa su color, se elige uno nuevo en el editor.
    if (state.areas.some((x) => x.active && x.id !== a.id && x.color === a.color)) {
      open(a, true);
      return;
    }
    dispatch({ type: "area/setActive", id: a.id, active: true }, `Área «${a.name}» activada`);
  };

  const newButton = (
    <button type="button" className="fx-btn fx-btn-primary" onClick={() => open(null)}>
      <Plus size={16} aria-hidden="true" /> Nueva área
    </button>
  );

  let body: React.ReactNode;
  if (screen === "cargando") body = <SettingsSkeleton />;
  else if (screen === "error")
    body = <ErrorState title="No pudimos cargar las áreas" onRetry={clear} />;
  else if (!areas.length)
    body = (
      <EmptyState icon={Tags} title="Aún no hay áreas" body="Crea la primera para organizar el calendario." action={newButton} />
    );
  else
    body = (
      <div className="sx-set-cq">
        <table className="fx-table fx-table-fixed sx-set-table sx-set-areas-table">
          <caption className="fx-sr">Áreas de la iglesia</caption>
          <colgroup>
            <col />
            <col className="sx-set-col-desc" />
            <col style={{ width: 168 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 96 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Área</th>
              <th scope="col" className="sx-set-col-desc">
                Descripción
              </th>
              <th scope="col">Actividades</th>
              <th scope="col">Estado</th>
              <th scope="col">
                <span className="fx-sr">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {areas.map((a) => {
              const usage = areaUsage(a.id, state.events);
              return (
                <tr key={a.id} className={a.active ? "" : "is-inactive"}>
                  <td>
                    <span className="sx-set-area-name-cell">
                      <AreaSwatch color={a.color} size={16} shape="square" />
                      <span className="sx-set-area-name">{a.name}</span>
                    </span>
                  </td>
                  <td className="sx-set-col-desc">
                    <span className="sx-set-clamp">{a.description || <span className="sx-set-muted">—</span>}</span>
                  </td>
                  <td>
                    <span className="sx-set-usage">
                      <span>
                        <span className="fx-num">{usage.responsible}</span> como responsable
                      </span>
                      {usage.participant > 0 && (
                        <span className="sx-set-usage-sub">
                          participa en <span className="fx-num">{usage.participant}</span>
                        </span>
                      )}
                    </span>
                  </td>
                  <td>
                    <StatusCell area={a} onToggle={toggle} />
                  </td>
                  <td>
                    <button type="button" className="fx-btn fx-btn-ghost fx-btn-sm" onClick={() => open(a)} aria-label={`Editar ${a.name}`}>
                      Editar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <ul className="sx-set-list" aria-label="Áreas de la iglesia">
          {areas.map((a) => {
            const usage = areaUsage(a.id, state.events);
            return (
              <li key={a.id}>
                <button type="button" className={`sx-set-row${a.active ? "" : " is-inactive"}`} onClick={() => open(a)}>
                  <AreaSwatch color={a.color} size={20} shape="square" />
                  <span className="sx-set-row-text">
                    <span className="sx-set-row-title">{a.name}</span>
                    <span className="sx-set-row-meta">
                      {usageText(usage)} ·{" "}
                      {a.active ? (
                        <span className="sx-set-inline-status">
                          <CircleCheck size={12} aria-hidden="true" /> Activa
                        </span>
                      ) : (
                        <span className="sx-set-inline-status is-off">
                          <CircleSlash size={12} aria-hidden="true" /> Inactiva
                        </span>
                      )}
                    </span>
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
        title="Áreas"
        subtitle="Organizan el calendario y los permisos de los líderes. El color de cada actividad viene de su área."
        actions={screen ? undefined : newButton}
      />
      <Panel flush className="sx-set-panel">
        {!screen && areas.length > 0 && (
          <div className="sx-set-panel-head">
            <p className="fx-help-13">
              <span className="fx-num">{activeCount}</span> activas · <span className="fx-num">{areas.length - activeCount}</span>{" "}
              {areas.length - activeCount === 1 ? "inactiva" : "inactivas"}
            </p>
            <NoticeBadge icon={Info} tone="neutral">
              Cada color se usa en una sola área activa
            </NoticeBadge>
          </div>
        )}
        {body}
      </Panel>
      {editor && <AreaEditor key={editor.n} editing={editor.area} activate={editor.activate} onClose={() => setEditor(null)} />}
      {confirm && <DeactivateDialog area={confirm} onClose={() => setConfirm(null)} />}
    </>
  );
}
