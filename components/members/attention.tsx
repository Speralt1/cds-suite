"use client";

// "Necesitan atención": una fila por persona con su motivo principal, "+n" y
// una CTA con verbo (16a §F, 16b §9.2). Cola compacta (Inicio) y agrupada por
// tipo de alerta (/integrantes/consolidacion/atencion).

import Link from "next/link";
import { ArrowRight, CircleCheck } from "lucide-react";
import { EmptyState, PageHeader, Skeleton } from "@/components/calendar/ui";
import { ALERT_LABEL, ATTENTION_PRIORITY, attentionQueue, type AttentionRow, type PersonView } from "@/lib/members/consolidation";
import type { AlertType } from "@/lib/members/types";
import { useMembers } from "@/lib/members/use-members";
import { ATTENTION_HREF, PRIVACY_NOTE, alertReason, personHref, plural } from "./model";
import { MemberActions, useMemberActions } from "./sheets";
import { ALERT_VIS, AlertIcon, DerivedBadges } from "./vocab";
import { LoadErrorState } from "./status";

type Group = Exclude<AlertType, "posible_duplicado_correo">;

const GROUP_LABEL: Record<Group, string> = {
  sin_responsable: "Sin responsable",
  sin_primer_contacto: "Sin primer contacto",
  seguimiento_vencido: "Seguimiento vencido",
  volvio: "Volvieron sin seguimiento",
  varios_dias_sin_volver: "Varios días sin volver",
  posible_duplicado_telefono: "Posibles duplicados",
};

const groupOf = (t: AlertType): Group => (t === "posible_duplicado_correo" ? "posible_duplicado_telefono" : t);

/** CTA de la fila: abre el sheet que corresponde (o la ficha para Revisar / solo lectura). */
export function AttentionCta({ row, v }: { row: AttentionRow; v: PersonView }) {
  const m = useMembers();
  const { open } = useMemberActions();
  const t = row.primary.type;
  const integrated = v.person.lifecycleStage === "integrante";
  if (!m.canManage || integrated || t === "posible_duplicado_telefono" || t === "posible_duplicado_correo")
    return (
      <Link
        href={personHref(row.personId)}
        className="button-secondary mem-btn-sm"
        aria-label={`${m.canManage ? row.cta : "Ver ficha"}: ${v.person.fullName}`}
      >
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
    <button type="button" className="button-secondary mem-btn-sm" onClick={onClick} aria-label={`${row.cta}: ${v.person.fullName}`}>
      {row.cta}
    </button>
  );
}

export function AttentionRowItem({ row, v }: { row: AttentionRow; v: PersonView }) {
  const m = useMembers();
  const reason = alertReason(row.primary, v, m.today);
  const others = row.others;
  return (
    <li className="mem-att-row" data-person={row.personId}>
      <AlertIcon type={row.primary.type} />
      <div className="mem-att-body">
        <p className="mem-att-name">
          <Link href={personHref(row.personId)} className="mem-person-link">
            {v.person.fullName}
          </Link>
          <DerivedBadges kinds={v.badges.filter((b) => b !== "volvio" || row.primary.type !== "volvio")} />
        </p>
        <p className="mem-att-reason">
          <strong>{reason.strong}</strong> · {reason.rest}
          {others.length > 0 && (
            <>
              {" "}
              <span className="mem-badge mem-tone-neutral mem-more" title={others.map((a) => ALERT_LABEL[a.type]).join(", ")}>
                <span aria-hidden="true">+{plural(others.length, "alerta", "alertas")}</span>
                <span className="mem-sr">{`Además: ${others.map((a) => ALERT_LABEL[a.type]).join(", ")}`}</span>
              </span>
            </>
          )}
        </p>
      </div>
      <div className="mem-att-cta">
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
      <ul className="mem-att-list" aria-label="Personas que necesitan atención">
        {shown.map((r) => {
          const v = m.views.get(r.personId);
          return v ? <AttentionRowItem key={r.personId} row={r} v={v} /> : null;
        })}
      </ul>
      {rows.length > shown.length && (
        <Link className="mem-link mem-see-all" href={ATTENTION_HREF}>
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
          <section className="mem-att-group" key={g} aria-labelledby={`mem-att-${g}`}>
            <h3 className="mem-att-group-head" id={`mem-att-${g}`}>
              <Icon size={13} aria-hidden="true" />
              {GROUP_LABEL[g]} <span className="mem-count">({list.length})</span>
            </h3>
            <ul className="mem-att-list">
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
  const rows = attentionQueue(m.alerts);
  let body: React.ReactNode;
  if (m.error) body = <LoadErrorState />;
  else if (m.loading)
    body = (
      <div className="mem-skel-rows" aria-busy="true" aria-label="Cargando">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} h={56} />
        ))}
      </div>
    );
  else if (rows.length) body = <AttentionGroups rows={rows} />;
  else body = <EmptyState icon={CircleCheck} title="Todo al día" body="Nadie necesita atención ahora." />;
  return (
    <div className="mem-att-page">
      <PageHeader
        title="Necesitan atención"
        subtitle={
          !m.loading && !m.error && rows.length
            ? `${plural(rows.length, "persona necesita", "personas necesitan")} una acción. Cada una aparece una vez, en su motivo más urgente.`
            : "Personas con alertas, por prioridad."
        }
      />
      <section className="panel mem-panel" aria-label="Personas que necesitan atención">
        {body}
      </section>
      <p className="mem-help mem-page-note">{PRIVACY_NOTE}</p>
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
