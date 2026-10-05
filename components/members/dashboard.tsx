"use client";

// Inicio de Consolidación (16b §9.2): exactamente 3 indicadores, "Necesitan
// atención" y 3 secciones con nombre (Nuevos recientes, Seguimientos
// pendientes, Volvieron). En móvil, Atención va primero. Sin cumpleaños (V1).

import Link from "next/link";
import { AlarmClock, ArrowRight, ChevronRight, CircleCheck, PhoneMissed, Plus, UserPlus, Users, type LucideIcon } from "lucide-react";
import { EmptyState, PageHeader, Skeleton } from "@/components/calendar/ui";
import { dashboard } from "@/lib/members/consolidation";
import { dayLabel, firstOfMonth } from "@/lib/shared/dates";
import type { Person } from "@/lib/members/types";
import { useMembers } from "@/lib/members/use-members";
import { AttentionQueueList } from "./attention";
import { NEW_PERSON_HREF, PRIVACY_NOTE, agoText, peopleHref, personHref, relDay, shortDate, shortName, visitOrdinal } from "./model";
import { MemberActions, useMemberActions } from "./sheets";
import { LoadErrorState } from "./status";
import { PersonStatusBadge } from "./vocab";

const MAX_ROWS = 5;

interface TileDef {
  id: string;
  label: string;
  icon: LucideIcon;
  value: number;
  context: string;
  ok: boolean;
  href: string;
}

function CountTiles({ tiles }: { tiles: TileDef[] }) {
  return (
    <section className="mem-tiles" aria-labelledby="mem-tiles-title" style={{ gridArea: "tiles" }}>
      <h2 id="mem-tiles-title" className="mem-tiles-title">
        En números
      </h2>
      <ul className="mem-tiles-list">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <li key={t.id}>
              <Link href={t.href} className="mem-tile" data-indicator={t.id} aria-label={`${t.label}: ${t.value}. ${t.context}. Ver personas`}>
                <span className="mem-tile-label">
                  <Icon size={16} aria-hidden="true" />
                  {t.label}
                </span>
                <span className="mem-tile-value">{t.value}</span>
                <span className={`mem-tile-context${t.ok ? " is-ok" : ""}`}>
                  {t.ok && <CircleCheck size={14} aria-hidden="true" />}
                  {t.context}
                </span>
                <span className="mem-tile-link">
                  Ver personas <ArrowRight size={14} aria-hidden="true" />
                </span>
                <ChevronRight size={18} className="mem-tile-chevron" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SeeAll({ href, label = "Ver todos" }: { href: string; label?: string }) {
  return (
    <Link className="mem-link mem-see-all" href={href}>
      {label} <ArrowRight size={14} aria-hidden="true" />
    </Link>
  );
}

function PersonLink({ p }: { p: Person }) {
  return (
    <Link href={personHref(p.id)} className="mem-person-link">
      {p.fullName}
    </Link>
  );
}

function SectionPanel({
  id,
  title,
  count,
  subtitle,
  area,
  children,
}: {
  id: string;
  title: string;
  count: number;
  subtitle?: string;
  area: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel mem-panel mem-dash-panel" aria-labelledby={`mem-dash-${id}`} style={{ gridArea: area }}>
      <div className="mem-dash-head">
        <h2 className="mem-h2" id={`mem-dash-${id}`}>
          {title} <span className="mem-count">({count})</span>
        </h2>
        {subtitle && <p className="mem-help">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function DashboardContent() {
  const m = useMembers();
  const { open } = useMemberActions();
  const header = <PageHeader title="Consolidación" subtitle={`Personas nuevas y su acompañamiento · ${dayLabel(m.today)}`} />;

  if (m.error)
    return (
      <>
        {header}
        <section className="panel mem-panel">
          <LoadErrorState />
        </section>
      </>
    );
  if (m.loading)
    return (
      <>
        {header}
        <div className="mem-tiles-skel" aria-busy="true" aria-label="Cargando">
          <Skeleton h={96} />
          <Skeleton h={96} />
          <Skeleton h={96} />
        </div>
        <section className="panel mem-panel">
          <div className="mem-skel-rows">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} h={56} />
            ))}
          </div>
        </section>
      </>
    );
  if (!m.persons.length)
    return (
      <>
        {header}
        <section className="panel mem-panel">
          <EmptyState
            icon={Users}
            title="Aún no hay personas en Consolidación"
            body="Registra a quienes visitan la iglesia por primera vez."
            action={
              m.canManage ? (
                <Link href={NEW_PERSON_HREF} className="button-primary">
                  <Plus size={16} aria-hidden="true" /> Registrar persona
                </Link>
              ) : undefined
            }
          />
        </section>
      </>
    );

  const d = dashboard(m.persons, m.alerts, m.today);
  const tiles: TileDef[] = [
    {
      id: "nuevos",
      label: "Nuevos del mes",
      icon: UserPlus,
      value: d.newThisMonth,
      context: d.newThisMonth ? `Ingresaron desde el ${shortDate(firstOfMonth(m.today))}` : "Aún no hay ingresos este mes",
      ok: false,
      href: peopleHref({ etiqueta: "nuevos_mes", etapa: "todas" }),
    },
    {
      id: "sin-primer-contacto",
      label: "Sin primer contacto (+48 h)",
      icon: PhoneMissed,
      value: d.withoutFirstContact,
      context: d.oldestWithoutFirstContact ? `La más antigua llegó ${agoText(d.oldestWithoutFirstContact, m.today)}` : "Todo al día",
      ok: !d.withoutFirstContact,
      href: peopleHref({ alerta: "sin_primer_contacto" }),
    },
    {
      id: "vencidos",
      label: "Seguimientos vencidos",
      icon: AlarmClock,
      value: d.overdueFollowUps,
      context: d.oldestOverdue ? `Desde el ${shortDate(d.oldestOverdue)}` : "Todo al día",
      ok: !d.overdueFollowUps,
      href: peopleHref({ alerta: "vencido" }),
    },
  ];
  const returnedAlert = new Set(m.alerts.filter((a) => a.type === "volvio").map((a) => a.personId));

  return (
    <>
      {header}
      <div className="mem-dash">
        <CountTiles tiles={tiles} />

        <SectionPanel id="atencion" title="Necesitan atención" count={d.attention.length} area="att">
          <AttentionQueueList rows={d.attention} max={MAX_ROWS} />
        </SectionPanel>

        <SectionPanel id="nuevos" title="Nuevos recientes" count={d.recentNew.length} subtitle="Ingresos de los últimos 14 días." area="new">
          {d.recentNew.length ? (
            <ul className="mem-mini-list">
              {d.recentNew.slice(0, MAX_ROWS).map((p) => (
                <li key={p.id} className="mem-mini-row">
                  <span className="mem-mini-date">{relDay(p.entryDate, m.today)}</span>
                  <span className="mem-mini-main">
                    <PersonLink p={p} />
                  </span>
                  <PersonStatusBadge status={p.consolidationStatus} className="mem-mini-badge" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mem-mini-empty">No hubo ingresos en los últimos 14 días.</p>
          )}
          {d.recentNew.length > MAX_ROWS && <SeeAll href={peopleHref({ etiqueta: "nuevos" })} />}
        </SectionPanel>

        <SectionPanel
          id="pendientes"
          title="Seguimientos pendientes"
          count={d.pendingFollowUps.length}
          subtitle="Próximos 7 días. Los vencidos están en Necesitan atención."
          area="pend"
        >
          {d.pendingFollowUps.length ? (
            <ul className="mem-mini-list">
              {d.pendingFollowUps.slice(0, MAX_ROWS).map((f) => (
                <li key={f.person.id} className="mem-mini-row">
                  <span className={`mem-mini-date${f.date === m.today ? " is-today" : ""}`}>{relDay(f.date, m.today)}</span>
                  <span className="mem-mini-main">
                    <Link href={personHref(f.person.id)} className="mem-person-link">
                      {f.text}
                    </Link>
                    <span className="mem-mini-sub">
                      {f.person.fullName} · {f.ownerUid ? shortName(m.ownerName(f.ownerUid) ?? "Responsable sin acceso") : "Sin responsable"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mem-mini-empty">No hay acciones para los próximos 7 días.</p>
          )}
          {d.pendingFollowUps.length > MAX_ROWS && <SeeAll href={peopleHref({ orden: "proxima" })} />}
        </SectionPanel>

        <SectionPanel id="volvieron" title="Volvieron" count={d.returned.length} subtitle="Visitas no primeras de los últimos 7 días." area="ret">
          {d.returned.length ? (
            <ul className="mem-mini-list">
              {d.returned.slice(0, MAX_ROWS).map((r) => (
                <li key={r.person.id} className="mem-mini-row">
                  <span className={`mem-mini-date${r.date === m.today ? " is-today" : ""}`}>{relDay(r.date, m.today)}</span>
                  <span className="mem-mini-main">
                    <PersonLink p={r.person} />
                    <span className="mem-mini-sub">{visitOrdinal(r.person.projection.visitCount)}</span>
                  </span>
                  {returnedAlert.has(r.person.id) && m.canManage && (
                    <button
                      type="button"
                      className="button-secondary mem-btn-sm"
                      aria-label={`Agradecer: ${r.person.fullName}`}
                      onClick={() => open("followup", r.person.id, "agradecer")}
                    >
                      Agradecer
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mem-mini-empty">Nadie volvió en los últimos 7 días.</p>
          )}
          {d.returned.length > MAX_ROWS && <SeeAll href={peopleHref({ etiqueta: "volvieron" })} />}
        </SectionPanel>
      </div>
      <p className="mem-help mem-page-note">{PRIVACY_NOTE}</p>
    </>
  );
}

export function ConsolidationDashboardScreen() {
  return (
    <MemberActions>
      <DashboardContent />
    </MemberActions>
  );
}
