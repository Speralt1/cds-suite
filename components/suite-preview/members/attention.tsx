"use client";

// "Necesitan atención": una fila por persona con su motivo principal, "+n" y
// una CTA con verbo (16a §F, 16b §9.2). Cola compacta (Inicio) y agrupada por
// tipo de alerta (/consolidacion/atencion).

import Link from "next/link";
import { ArrowRight, CircleCheck } from "lucide-react";
import { ALERT_LABEL, ATTENTION_PRIORITY, attentionQueue, type AttentionRow } from "@/lib/suite-preview/consolidation";
import type { AlertType } from "@/lib/suite-preview/types";
import { EmptyState, ErrorState, Panel, SkeletonRows } from "@/components/finance-preview/ui";
import { PageHeader } from "../primitives";
import { replaceQueryParam, useQueryParam } from "../use-query";
import { C_BASE, alertReason, personHref, plural, type PersonView } from "./model";
import { MemberActions, useMemberActions } from "./sheets";
import { useMembers } from "./use-members";
import { ALERT_VIS, AlertIcon, DerivedBadges } from "./vocab";

type Group = Exclude<AlertType, "posible_duplicado_correo" | "cumpleanos_proximo">;

const GROUP_LABEL: Record<Group, string> = {
  sin_responsable: "Sin responsable",
  sin_primer_contacto: "Sin primer contacto",
  seguimiento_vencido: "Seguimiento vencido",
  volvio: "Volvieron sin seguimiento",
  varios_dias_sin_volver: "Varios días sin volver",
  posible_duplicado_telefono: "Posibles duplicados",
};

const groupOf = (t: AlertType): Group => (t === "posible_duplicado_correo" ? "posible_duplicado_telefono" : (t as Group));

/** CTA de la fila: abre el sheet que corresponde (o la ficha para Revisar). */
export function AttentionCta({ row, v }: { row: AttentionRow; v: PersonView }) {
  const m = useMembers();
  const { open } = useMemberActions();
  const t = row.primary.type;
  const href = m.hrefFor(personHref(row.personId));
  if (!m.canManage || t === "posible_duplicado_telefono" || t === "posible_duplicado_correo")
    return (
      <Link href={href} className="fx-btn fx-btn-secondary fx-btn-sm" aria-label={`${m.canManage ? row.cta : "Ver ficha"}: ${v.person.fullName}`}>
        {m.canManage ? row.cta : "Ver ficha"}
      </Link>
    );
  const onClick = () => {
    if (t === "sin_responsable") open("assign", row.personId);
    else if (t === "volvio") open("followup", row.personId, "agradecer");
    else if (t === "varios_dias_sin_volver") open("followup", row.personId, "invitar");
    else if (t === "sin_primer_contacto") open("followup", row.personId, "contactar");
    else open("followup", row.personId);
  };
  return (
    <button type="button" className="fx-btn fx-btn-secondary fx-btn-sm" onClick={onClick} aria-label={`${row.cta}: ${v.person.fullName}`}>
      {row.cta}
    </button>
  );
}

export function AttentionRowItem({ row, v }: { row: AttentionRow; v: PersonView }) {
  const m = useMembers();
  const reason = alertReason(row.primary, v, m.today);
  const others = row.others;
  return (
    <li className="sx-att-row" data-person={row.personId}>
      <AlertIcon type={row.primary.type} />
      <div className="sx-att-body">
        <p className="sx-att-name">
          <Link href={m.hrefFor(personHref(row.personId))} className="sx-person-link">
            {v.person.fullName}
          </Link>
          <DerivedBadges kinds={v.badges.filter((b) => b !== "volvio" || row.primary.type !== "volvio")} short />
        </p>
        <p className="sx-att-reason">
          <strong>{reason.strong}</strong> · {reason.rest}
          {others.length > 0 && (
            <>
              {" "}
              <span className="fx-badge fx-tone-neutral sx-more" title={others.map((a) => ALERT_LABEL[a.type]).join(", ")}>
                <span aria-hidden="true">+{plural(others.length, "alerta", "alertas")}</span>
                <span className="fx-sr">
                  {`Además: ${others.map((a) => ALERT_LABEL[a.type]).join(", ")}`}
                </span>
              </span>
            </>
          )}
        </p>
      </div>
      <div className="sx-att-cta">
        <AttentionCta row={row} v={v} />
      </div>
    </li>
  );
}

/** Lista compacta (Inicio): máx. `max` filas + "Ver las n →". */
export function AttentionQueueList({ rows, max }: { rows: AttentionRow[]; max?: number }) {
  const m = useMembers();
  const shown = max ? rows.slice(0, max) : rows;
  if (!rows.length) return <EmptyState icon={CircleCheck} title="Todo al día" body="Nadie necesita atención ahora." />;
  return (
    <>
      <ul className="sx-att-list" aria-label="Personas que necesitan atención">
        {shown.map((r) => {
          const v = m.views.get(r.personId);
          return v ? <AttentionRowItem key={r.personId} row={r} v={v} /> : null;
        })}
      </ul>
      {rows.length > shown.length && (
        <Link className="fx-link sx-see-all" href={m.hrefFor(`${C_BASE}/atencion`)}>
          Ver las {rows.length} <ArrowRight size={14} aria-hidden="true" />
        </Link>
      )}
    </>
  );
}

function AttentionGroups({ rows }: { rows: AttentionRow[] }) {
  const m = useMembers();
  const groups = [...new Set(ATTENTION_PRIORITY.map(groupOf))].filter((g) => rows.some((r) => groupOf(r.primary.type) === g));
  return (
    <div>
      {groups.map((g) => {
        const list = rows.filter((r) => groupOf(r.primary.type) === g);
        const Icon = ALERT_VIS[g].icon;
        return (
          <section className="sx-att-group" key={g} aria-labelledby={`sx-att-${g}`}>
            <h2 className="fx-att-group-head" id={`sx-att-${g}`}>
              <Icon size={13} aria-hidden="true" />
              {GROUP_LABEL[g]} <span className="fx-count">({list.length})</span>
            </h2>
            <ul className="sx-att-list">
              {list.map((r) => {
                const v = m.views.get(r.personId);
                return v ? <AttentionRowItem key={r.personId} row={r} v={v} /> : null;
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function AttentionContent() {
  const m = useMembers();
  const estado = useQueryParam("estado");
  const rows = estado === "vacio" ? [] : attentionQueue(m.alerts);
  return (
    <div className="sx-att-page">
      <PageHeader
        title="Necesitan atención"
        subtitle={
          estado === "cargando" || estado === "error"
            ? "Personas con alertas, por prioridad."
            : rows.length
              ? `${plural(rows.length, "persona necesita", "personas necesitan")} una acción. Cada una aparece una vez, en su motivo más urgente.`
              : "Personas con alertas, por prioridad."
        }
      />
      <Panel>
        {estado === "cargando" ? (
          <SkeletonRows rows={6} h={64} />
        ) : estado === "error" ? (
          <ErrorState title="No pudimos cargar Consolidación" onRetry={() => replaceQueryParam("estado", null)} />
        ) : rows.length ? (
          <AttentionGroups rows={rows} />
        ) : (
          <EmptyState icon={CircleCheck} title="Todo al día" body="Nadie necesita atención ahora." />
        )}
      </Panel>
      <p className="fx-help sx-page-note">
        Las alertas se calculan con los <Link className="fx-link" href={m.hrefFor(`${C_BASE}/ajustes`)}>parámetros de Ajustes</Link>. Resolver una
        alerta aquí es una simulación: nada se guarda.
      </p>
    </div>
  );
}

export function AttentionScreen() {
  return (
    <MemberActions>
      <AttentionContent />
    </MemberActions>
  );
}
