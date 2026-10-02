"use client";

// Ajustes de Consolidación (16b §9.9): parámetros de las alertas en solo lectura.

import { Compass, Lock } from "lucide-react";
import { SETTINGS_RANGES } from "@/lib/suite-preview/consolidation";
import type { AlertType, ConsolidationSettings } from "@/lib/suite-preview/types";
import { PageHeader } from "../primitives";
import { useMembers } from "./use-members";
import { ALERT_VIS, AlertIcon } from "./vocab";

const PARAMS: { key: keyof ConsolidationSettings; label: string; unit: (n: number) => string; help: string }[] = [
  {
    key: "firstContactMaxHours",
    label: "Horas máximas para el primer contacto",
    unit: (n) => `${n} h`,
    help: "Quien llega el domingo se contacta antes del miércoles, a tiempo para invitarlo al culto de mitad de semana.",
  },
  {
    key: "noReturnDays",
    label: "Días sin una nueva visita",
    unit: (n) => `${n} días`,
    help: "Equivale a 3 domingos sin venir. Después aparece «Varios días sin volver».",
  },
  {
    key: "birthdayLeadDays",
    label: "Anticipación de cumpleaños",
    unit: (n) => `${n} días`,
    help: "Abarca 2 domingos y deja tiempo para un saludo o una llamada.",
  },
  {
    key: "recentNewDays",
    label: "«Nuevo» durante",
    unit: (n) => `${n} días`,
    help: "Tiempo que una persona lleva el badge «Nuevo» desde su ingreso.",
  },
  {
    key: "returnedRecentDays",
    label: "«Volvió» durante",
    unit: (n) => `${n} días`,
    help: "Si volvió en este plazo y nadie la ha contactado después, aparece para agradecerle.",
  },
];

const RULES: { type: AlertType; text: string }[] = [
  { type: "sin_responsable", text: "Nadie del equipo de Consolidación está a cargo de su seguimiento." },
  { type: "sin_primer_contacto", text: "Pasaron más de 48 h desde su ingreso y aún no hay un contacto exitoso." },
  { type: "seguimiento_vencido", text: "La fecha de la próxima acción ya pasó." },
  { type: "volvio", text: "Volvió en los últimos 7 días y nadie la ha contactado después." },
  { type: "varios_dias_sin_volver", text: "Su última visita fue hace más de 21 días." },
  { type: "posible_duplicado_telefono", text: "Otra persona tiene el mismo teléfono o correo. Nunca impide registrar." },
  { type: "cumpleanos_proximo", text: "Cumple años en los próximos 14 días. El 29 de febrero se celebra el 28 en años no bisiestos." },
];

export function MembersSettingsScreen() {
  const m = useMembers();
  const s = m.state.settings;
  return (
    <div className="sx-settings">
      <PageHeader title="Ajustes de Consolidación" subtitle="Cuándo se activa cada alerta. Se aplican a todo el equipo." />
      <section className="fx-panel fx-panel-flush" aria-labelledby="sx-settings-alerts">
        <div className="fx-panel-head sx-settings-head">
          <h2 className="fx-h2" id="sx-settings-alerts">
            Alertas
          </h2>
          <div className="sx-settings-badges">
            <span className="fx-badge fx-tone-neutral">
              <Lock size={12} aria-hidden="true" /> Solo lectura en la vista previa
            </span>
            <span className="fx-badge fx-tone-proposal" title="Así funcionaría cuando exista; hoy no se puede cambiar.">
              <Compass size={12} aria-hidden="true" /> Configurable en una próxima etapa
            </span>
          </div>
        </div>
        <dl className="sx-param-list">
          {PARAMS.map((p) => {
            const [min, max] = SETTINGS_RANGES[p.key];
            return (
              <div className="sx-param" key={p.key}>
                <dt className="sx-param-label">{p.label}</dt>
                <dd className="sx-param-value">{p.unit(s[p.key])}</dd>
                <dd className="sx-param-help">
                  {p.help} <span className="sx-param-range">Rango posible: {min}–{p.unit(max)}.</span>
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section className="fx-panel" aria-labelledby="sx-settings-rules">
        <h2 className="fx-h2" id="sx-settings-rules">
          Cómo se calculan las alertas
        </h2>
        <p className="fx-help-13 sx-settings-intro">
          Solo para personas en consolidación activa. «No contactar» oculta todas las alertas salvo los posibles duplicados.
        </p>
        <ul className="sx-rule-list">
          {RULES.map((r) => (
            <li key={r.type}>
              <AlertIcon type={r.type} size={28} />
              <span>
                <span className="sx-rule-title">{r.type === "posible_duplicado_telefono" ? "Posible duplicado" : ALERT_VIS[r.type].label}</span>
                <span className="fx-help-13">{r.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
