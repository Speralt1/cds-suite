"use client";

// Inicio de Consolidación (16b §9.2): exactamente 3 indicadores, "Necesitan
// atención" y 4 secciones con nombres. En móvil, Atención va primero.

import Link from "next/link";
import { AlarmClock, ArrowRight, Cake, ChevronRight, CircleCheck, MessageCircle, Plus, UserPlus, Users, PhoneMissed, type LucideIcon } from "lucide-react";
import { dashboard, nextBirthday } from "@/lib/suite-preview/consolidation";
import { compareLocal, dayLabel, daysBetween, firstOfMonth, parseYmd } from "@/lib/suite-preview/dates";
import type { Person } from "@/lib/suite-preview/types";
import { shortDate } from "@/lib/finance-preview/format";
import { EmptyState, ErrorState, Panel, Skeleton, SkeletonRows } from "@/components/finance-preview/ui";
import { PageHeader } from "../primitives";
import { replaceQueryParam, useQueryParam } from "../use-query";
import { AttentionQueueList } from "./attention";
import { C_BASE, agoText, peopleHref, personHref, relDay, shortName, visitOrdinal } from "./model";
import { MemberActions, useMemberActions } from "./sheets";
import { useMembers } from "./use-members";
import { PersonStatusBadge } from "./vocab";

const MAX_ROWS = 5;

function NewPersonButton({ inHeader }: { inHeader?: boolean }) {
  const m = useMembers();
  if (!m.canManage) return null;
  // En móvil la barra inferior ya ofrece "+ Nueva".
  return (
    <Link href={m.hrefFor(`${C_BASE}/nueva`)} className={`fx-btn fx-btn-primary${inHeader ? " fx-hide-mobile" : ""}`}>
      <Plus size={16} aria-hidden="true" /> Nueva persona
    </Link>
  );
}

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
  const m = useMembers();
  return (
    <section className="sx-tiles" aria-labelledby="sx-tiles-title" style={{ gridArea: "tiles" }}>
      <h2 id="sx-tiles-title" className="sx-tiles-title">
        En números
      </h2>
      <ul className="sx-tiles-list">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <li key={t.id}>
              <Link href={m.hrefFor(t.href)} className="sx-tile" data-indicator={t.id} aria-label={`${t.label}: ${t.value}. ${t.context}. Ver personas`}>
                <span className="sx-tile-label">
                  <Icon size={16} aria-hidden="true" />
                  {t.label}
                </span>
                <span className="sx-tile-value">{t.value}</span>
                <span className={`sx-tile-context${t.ok ? " is-ok" : ""}`}>
                  {t.ok && <CircleCheck size={14} aria-hidden="true" />}
                  {t.context}
                </span>
                <span className="sx-tile-link">
                  Ver personas <ArrowRight size={14} aria-hidden="true" />
                </span>
                <ChevronRight size={18} className="sx-tile-chevron" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SeeAll({ href, label = "Ver todos" }: { href: string; label?: string }) {
  const m = useMembers();
  return (
    <Link className="fx-link sx-see-all" href={m.hrefFor(href)}>
      {label} <ArrowRight size={14} aria-hidden="true" />
    </Link>
  );
}

function PersonLink({ p }: { p: Person }) {
  const m = useMembers();
  return (
    <Link href={m.hrefFor(personHref(p.id))} className="sx-person-link">
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
    <section className="fx-panel sx-dash-panel" aria-labelledby={`sx-dash-${id}`} style={{ gridArea: area }}>
      <div className="sx-dash-head">
        <h2 className="fx-h2" id={`sx-dash-${id}`}>
          {title} <span className="fx-count">({count})</span>
        </h2>
        {subtitle && <p className="fx-help">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function isLeapDay(p: Person) {
  return !!p.birthDate && p.birthDate.slice(5) === "02-29";
}

function DashboardContent() {
  const m = useMembers();
  const { open } = useMemberActions();
  const estado = useQueryParam("estado");
  const d = dashboard(m.state, m.now, m.state.settings);

  const header = (
    <PageHeader
      title="Consolidación"
      subtitle={`Personas nuevas y su acompañamiento · ${dayLabel(m.today)}`}
      actions={<NewPersonButton inHeader />}
    />
  );

  if (estado === "cargando")
    return (
      <>
        {header}
        <div className="sx-tiles-skel" aria-busy="true" aria-label="Cargando">
          <Skeleton h={96} />
          <Skeleton h={96} />
          <Skeleton h={96} />
        </div>
        <Panel>
          <SkeletonRows rows={5} h={64} />
        </Panel>
      </>
    );
  if (estado === "error")
    return (
      <>
        {header}
        <Panel>
          <ErrorState title="No pudimos cargar Consolidación" onRetry={() => replaceQueryParam("estado", null)} />
        </Panel>
      </>
    );
  if (estado === "vacio")
    return (
      <>
        {header}
        <Panel>
          <EmptyState
            icon={Users}
            title="Aún no hay personas en Consolidación"
            body="Registra a quienes visitan la iglesia por primera vez."
            action={m.canManage ? <NewPersonButton /> : undefined}
          />
        </Panel>
      </>
    );

  const firstContact = m.alerts.filter((a) => a.type === "sin_primer_contacto");
  const oldestFirst = firstContact.map((a) => a.since).sort(compareLocal)[0];
  const overdue = m.alerts.filter((a) => a.type === "seguimiento_vencido");
  const oldestOverdue = overdue.map((a) => a.since).sort(compareLocal)[0];
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
      label: "Sin primer contacto",
      icon: PhoneMissed,
      value: d.withoutFirstContact,
      context: d.withoutFirstContact ? `La más antigua llegó ${agoText(oldestFirst, m.today)}` : "Todo al día",
      ok: !d.withoutFirstContact,
      href: peopleHref({ alerta: "sin_primer_contacto" }),
    },
    {
      id: "vencidos",
      label: "Seguimientos vencidos",
      icon: AlarmClock,
      value: d.overdueFollowUps,
      context: d.overdueFollowUps ? `Desde el ${shortDate(oldestOverdue)}` : "Todo al día",
      ok: !d.overdueFollowUps,
      href: peopleHref({ alerta: "vencido" }),
    },
  ];

  const leapDay = m.state.persons.filter(
    (p) => isLeapDay(p) && !p.doNotContact && p.lifecycleStage === "en_consolidacion" && !d.birthdays.some((b) => b.person.id === p.id),
  );
  const returnedAlert = new Set(m.alerts.filter((a) => a.type === "volvio").map((a) => a.personId));

  return (
    <>
      {header}
      <div className="sx-dash">
        <CountTiles tiles={tiles} />

        <SectionPanel id="atencion" title="Necesitan atención" count={d.attention.length} area="att">
          <AttentionQueueList rows={d.attention} max={MAX_ROWS} />
        </SectionPanel>

        <SectionPanel id="cumpleanos" title="Cumpleaños próximos" count={d.birthdays.length} subtitle="Próximos 14 días." area="bday">
          {d.birthdays.length ? (
            <ul className="sx-mini-list">
              {d.birthdays.slice(0, MAX_ROWS).map((b) => {
                const leap = isLeapDay(b.person) && b.date.slice(5) === "02-28";
                return (
                  <li key={b.person.id} className="sx-mini-row">
                    <span className={`sx-mini-date${b.inDays === 0 ? " is-today" : ""}`}>
                      {b.inDays === 0 ? "hoy" : shortDate(b.date)}
                      {leap && <span className="sx-mini-note"> (nació el 29)</span>}
                    </span>
                    <span className="sx-mini-main">
                      <PersonLink p={b.person} />
                      <span className="sx-mini-sub">cumple {b.turns}</span>
                    </span>
                    {!b.person.doNotContact && (
                      <button
                        type="button"
                        className="fx-btn fx-btn-secondary fx-btn-sm sx-mini-btn"
                        aria-label={`Saludar por WhatsApp a ${b.person.fullName}`}
                        onClick={() => m.whatsapp(b.person)}
                      >
                        <MessageCircle size={14} aria-hidden="true" /> WhatsApp
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="sx-mini-empty">Nadie cumple años en los próximos 14 días.</p>
          )}
          {leapDay.length > 0 && (
            <div className="sx-leap">
              <p className="fx-section-label">
                <Cake size={12} aria-hidden="true" /> Fechas especiales
              </p>
              {leapDay.map((p) => {
                const nb = nextBirthday(p.birthDate, m.today)!;
                const shifted = nb.date.slice(5) === "02-28";
                return (
                  <p key={p.id} className="sx-leap-row">
                    <PersonLink p={p} /> nació un 29 de febrero.{" "}
                    {shifted
                      ? `En ${parseYmd(nb.date).y} no hay 29: su cumpleaños se celebra el ${shortDate(nb.date)} (nació el 29) y cumple ${nb.turns}.`
                      : `Su próximo cumpleaños es el ${shortDate(nb.date)} y cumple ${nb.turns}.`}
                  </p>
                );
              })}
            </div>
          )}
          {d.birthdays.length > MAX_ROWS && <SeeAll href={peopleHref({ alerta: "cumpleanos" })} />}
        </SectionPanel>

        <SectionPanel id="nuevos" title="Nuevos recientes" count={d.recentNew.length} subtitle="Ingresos de los últimos 14 días." area="new">
          {d.recentNew.length ? (
            <ul className="sx-mini-list">
              {d.recentNew.slice(0, MAX_ROWS).map((p) => (
                <li key={p.id} className="sx-mini-row">
                  <span className="sx-mini-date">{relDay(p.entryDate, m.today)}</span>
                  <span className="sx-mini-main">
                    <PersonLink p={p} />
                  </span>
                  <PersonStatusBadge status={p.consolidationStatus} className="sx-mini-badge" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="sx-mini-empty">No hubo ingresos en los últimos 14 días.</p>
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
            <ul className="sx-mini-list">
              {d.pendingFollowUps.slice(0, MAX_ROWS).map((f) => (
                <li key={f.person.id} className="sx-mini-row">
                  <span className={`sx-mini-date${f.date === m.today ? " is-today" : ""}`}>{relDay(f.date, m.today)}</span>
                  <span className="sx-mini-main">
                    <Link href={m.hrefFor(personHref(f.person.id))} className="sx-person-link">
                      {f.text}
                    </Link>
                    <span className="sx-mini-sub">
                      {f.person.fullName} · {f.ownerUid ? shortName(m.state.users.find((u) => u.uid === f.ownerUid)?.displayName ?? "—") : "Sin asignar"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sx-mini-empty">No hay acciones para los próximos 7 días.</p>
          )}
          {d.pendingFollowUps.length > MAX_ROWS && <SeeAll href={peopleHref({ orden: "proxima" })} />}
        </SectionPanel>

        <SectionPanel id="volvieron" title="Volvieron" count={d.returned.length} subtitle="Visitas no primeras de los últimos 7 días." area="ret">
          {d.returned.length ? (
            <ul className="sx-mini-list">
              {d.returned.slice(0, MAX_ROWS).map((r) => {
                const v = m.views.get(r.person.id)!;
                return (
                  <li key={r.person.id} className="sx-mini-row">
                    <span className={`sx-mini-date${daysBetween(r.date, m.today) === 0 ? " is-today" : ""}`}>{relDay(r.date, m.today)}</span>
                    <span className="sx-mini-main">
                      <PersonLink p={r.person} />
                      <span className="sx-mini-sub">{visitOrdinal(v.stats.visitCount)}</span>
                    </span>
                    {returnedAlert.has(r.person.id) && m.canManage && (
                      <button
                        type="button"
                        className="fx-btn fx-btn-secondary fx-btn-sm sx-mini-btn"
                        aria-label={`Agradecer: ${r.person.fullName}`}
                        onClick={() => open("followup", r.person.id, "agradecer")}
                      >
                        Agradecer
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="sx-mini-empty">Nadie volvió en los últimos 7 días.</p>
          )}
          {d.returned.length > MAX_ROWS && <SeeAll href={peopleHref({ etiqueta: "volvieron" })} />}
        </SectionPanel>
      </div>
      <p className="fx-help sx-page-note">Datos personales de uso pastoral. Solo los ve el equipo de Consolidación.</p>
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
