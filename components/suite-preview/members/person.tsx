"use client";

// Ficha de persona (16b §9.4): header con acciones, próxima acción, alertas,
// datos (tri-estado explícito) e historial derivado (más nuevo primero).

import Link from "next/link";
import { useState } from "react";
import {
  AlarmClock,
  ArrowLeft,
  ArrowRightLeft,
  BellOff,
  CalendarPlus,
  CircleCheck,
  CircleSlash,
  Ellipsis,
  MapPin,
  MessageCircle,
  MessageSquarePlus,
  Phone,
  Star,
  UserPlus,
  UserSearch,
  Users,
  type LucideIcon,
} from "lucide-react";
import { CLOSED_REASON_LABEL, STATUS_LABEL, TRISTATE_LABEL, timeline } from "@/lib/suite-preview/consolidation";
import { numericYmd } from "@/lib/suite-preview/dates";
import type { ClosedReason, ConsolidationStatus, FollowUpType, PersonChange, TimelineItem, TriState } from "@/lib/suite-preview/types";
import { shortDate } from "@/lib/finance-preview/format";
import { Callout, EmptyState, ErrorState, Panel, Skeleton } from "@/components/finance-preview/ui";
import { replaceQueryParam, useQueryParam } from "../use-query";
import { C_BASE, firstName, plural, relDay, shortDateYear, userName, type PersonView } from "./model";
import { MemberActions, useMemberActions } from "./sheets";
import { useMembers, type MembersModel } from "./use-members";
import { ALERT_VIS, AlertIcon, DerivedBadges, PersonStatusBadge, TriStateValue } from "./vocab";

const FU_ICON: Record<FollowUpType, LucideIcon> = { whatsapp: MessageCircle, llamada: Phone, presencial: Users, otro: Ellipsis };

type TimelineFilter = "todo" | "visit" | "followup" | "change";
const FILTERS: { id: TimelineFilter; label: string; short: string }[] = [
  { id: "todo", label: "Todo", short: "Todo" },
  { id: "visit", label: "Visitas", short: "Visitas" },
  { id: "followup", label: "Seguimientos", short: "Seg." },
  { id: "change", label: "Cambios", short: "Cambios" },
];

function BackLink() {
  const m = useMembers();
  return (
    <Link href={m.hrefFor(`${C_BASE}/personas`)} className="fx-link sx-back">
      <ArrowLeft size={16} aria-hidden="true" /> Personas
    </Link>
  );
}

function changeText(c: PersonChange, m: MembersModel): { title: string; fromTo?: [string, string] } {
  switch (c.field) {
    case "status":
      return {
        title: "Cambio de estado",
        fromTo: [STATUS_LABEL[c.from as ConsolidationStatus] ?? "—", STATUS_LABEL[c.to as ConsolidationStatus] ?? "—"],
      };
    case "owner":
      return {
        title: "Cambio de responsable",
        fromTo: [userName(c.from, m.state.users) ?? "Sin asignar", userName(c.to, m.state.users) ?? "Sin asignar"],
      };
    case "stage":
      return { title: c.to === "integrante" ? "Pasó a ser integrante" : "Volvió a Consolidación", fromTo: ["En consolidación", "Integrante"] };
    case "faithConfession":
      return { title: "Confesión de fe", fromTo: [TRISTATE_LABEL[c.from as TriState] ?? "—", TRISTATE_LABEL[c.to as TriState] ?? "—"] };
    case "baptized":
      return { title: "Bautizado", fromTo: [TRISTATE_LABEL[c.from as TriState] ?? "—", TRISTATE_LABEL[c.to as TriState] ?? "—"] };
    case "doNotContact":
      return { title: c.to === "true" ? "Marcada como No contactar" : "Se quitó No contactar" };
  }
}

function TimelineEntry({ item, m, flash }: { item: TimelineItem; m: MembersModel; flash: boolean }) {
  const by = item.by ? userName(item.by, m.state.users) : null;
  const date = item.at.slice(0, 10);
  let Icon: LucideIcon = MapPin;
  let tone = "neutral";
  let title: React.ReactNode = item.title;
  let meta: string[] = [];
  let quote: string | undefined;
  let extra: React.ReactNode = null;

  if (item.kind === "created") {
    Icon = UserPlus;
    tone = "info";
    title = "Registro de la persona";
    if (by) meta = [`Registró ${by}`];
  } else if (item.kind === "visit") {
    const v = m.state.visits.find((x) => x.id === item.id);
    Icon = item.isFirstVisit ? Star : MapPin;
    tone = item.isFirstVisit ? "success" : "neutral";
    title = (
      <>
        {item.isFirstVisit ? "Primera visita" : "Visita"}
        {v?.activityLabel ? ` · ${v.activityLabel}` : ""}
      </>
    );
    if (by) meta.push(`Registrada por ${by}`);
    quote = v?.note;
    if (item.voided) extra = <span className="sx-tl-voided">Anulada: {v?.voidReason ?? "registrada por error"}</span>;
  } else if (item.kind === "followup") {
    const f = m.state.followUps.find((x) => x.id === item.id);
    Icon = f ? FU_ICON[f.type] : MessageCircle;
    tone = f?.result === "contactado" ? "info" : f?.result === "no_desea_contacto" ? "danger" : "neutral";
    title = `Seguimiento · ${item.title}`;
    if (by) meta.push(`Por ${by}`);
    quote = f?.note;
    if (f?.nextAction)
      extra = (
        <span className="sx-tl-next">
          Próxima acción: {f.nextAction}
          {f.nextActionDate ? ` · ${shortDate(f.nextActionDate)}` : ""}
          {f.ownerUid ? ` · ${userName(f.ownerUid, m.state.users) ?? ""}` : ""}
        </span>
      );
  } else {
    const c = m.state.personChanges.find((x) => x.id === item.id);
    Icon = ArrowRightLeft;
    tone = "review";
    if (c) {
      const t = changeText(c, m);
      title = t.fromTo ? (
        <>
          {t.title}: {t.fromTo[0]} <span aria-hidden="true">→</span>
          <span className="fx-sr"> a </span> {t.fromTo[1]}
        </>
      ) : (
        t.title
      );
      if (by) meta.push(`Por ${by}`);
      if (c.reason) extra = <span className="sx-tl-reason">Motivo: {c.reason}</span>;
    }
  }

  return (
    <li className={`sx-tl-item${flash ? " sx-flash" : ""}${item.voided ? " is-voided" : ""}${item.isFirstVisit ? " is-first" : ""}`} data-kind={item.kind}>
      <time className="sx-tl-date" dateTime={date}>
        {shortDate(date)}
      </time>
      <span className={`sx-tl-icon fx-tone-${tone}`} aria-hidden="true">
        <Icon size={14} />
      </span>
      <div className="sx-tl-body">
        <p className="sx-tl-title">{title}</p>
        {meta.length > 0 && <p className="fx-help">{meta.join(" · ")}</p>}
        {quote && <p className="sx-tl-quote">“{quote}”</p>}
        {extra}
      </div>
    </li>
  );
}

function PersonTimeline({ personId }: { personId: string }) {
  const m = useMembers();
  const [filter, setFilter] = useState<TimelineFilter>("todo");
  const items = timeline(personId, m.state);
  // Ids vistos al abrir la ficha: lo nuevo se resalta 1,2 s (16b §14).
  const [seen] = useState(() => new Set(items.map((i) => i.id)));
  const shown = filter === "todo" ? items : items.filter((i) => i.kind === filter || (filter === "visit" && i.kind === "created"));
  return (
    <section className="fx-panel sx-tl-panel" aria-labelledby="sx-tl-title">
      <div className="sx-tl-head">
        <h2 className="fx-h2" id="sx-tl-title">
          Historial <span className="fx-count">({items.length})</span>
        </h2>
        <div className="fx-segmented sx-tl-filter" role="group" aria-label="Filtrar historial">
          {FILTERS.map((f) => (
            // aria-label: en móvil el texto largo se oculta con CSS y el corto es decorativo.
            <button key={f.id} type="button" aria-pressed={filter === f.id} aria-label={f.label} onClick={() => setFilter(f.id)}>
              <span className="sx-tl-filter-long">{f.label}</span>
              <span className="sx-tl-filter-short" aria-hidden="true">
                {f.short}
              </span>
            </button>
          ))}
        </div>
      </div>
      {shown.length ? (
        <ol className="sx-tl" aria-label="Historial, del más nuevo al más antiguo">
          {shown.map((i) => (
            <TimelineEntry key={i.id} item={i} m={m} flash={!seen.has(i.id)} />
          ))}
        </ol>
      ) : (
        <p className="sx-mini-empty">Sin registros de este tipo.</p>
      )}
    </section>
  );
}

function NextActionCard({ v }: { v: PersonView }) {
  const m = useMembers();
  const { open } = useMemberActions();
  const actionable = m.canManage && v.person.lifecycleStage === "en_consolidacion";
  return (
    <section className="fx-panel sx-next" aria-labelledby="sx-next-title">
      <h2 className="fx-h2" id="sx-next-title">
        Próxima acción
      </h2>
      {v.next ? (
        <div className="sx-next-body">
          <span className={`sx-next-icon ${v.nextOverdue ? "fx-tone-warning" : "fx-tone-info"}`} aria-hidden="true">
            <AlarmClock size={18} />
          </span>
          <div className="sx-next-text">
            <p className="sx-next-title">{v.next.text}</p>
            <p className="fx-help-13">
              {v.next.date ? (
                v.nextOverdue ? (
                  <span className="sx-overdue">Vencida · era para el {shortDate(v.next.date)}</span>
                ) : (
                  relDay(v.next.date, m.today)
                )
              ) : (
                "Sin fecha"
              )}
              {" · "}
              {userName(v.next.ownerUid, m.state.users) ?? "Sin responsable"}
            </p>
          </div>
          {actionable && (
            <button type="button" className="fx-btn fx-btn-secondary fx-btn-sm" onClick={() => open("followup", v.person.id)}>
              Registrar seguimiento
            </button>
          )}
        </div>
      ) : (
        <div className="sx-next-body">
          <span className="sx-next-icon fx-tone-neutral" aria-hidden="true">
            <AlarmClock size={18} />
          </span>
          <div className="sx-next-text">
            <p className="sx-next-title">Sin próxima acción</p>
            <p className="fx-help-13">Se define al registrar un seguimiento.</p>
          </div>
          {actionable && (
            <button type="button" className="fx-btn fx-btn-secondary fx-btn-sm" onClick={() => open("followup", v.person.id)}>
              Registrar seguimiento
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function AlertsPanel({ v }: { v: PersonView }) {
  if (v.person.doNotContact)
    return (
      <Panel title="Alertas" className="sx-alerts-panel">
        <p className="fx-help-13">Con No contactar no se muestran alertas, salvo posibles duplicados.</p>
        {v.alerts.length > 0 && <AlertList v={v} />}
      </Panel>
    );
  return (
    <Panel
      title={
        <>
          Alertas <span className="fx-count">({v.alerts.length})</span>
        </>
      }
      className="sx-alerts-panel"
    >
      {v.alerts.length ? (
        <AlertList v={v} />
      ) : (
        <p className="sx-ok-line">
          <CircleCheck size={16} aria-hidden="true" /> Sin alertas activas.
        </p>
      )}
    </Panel>
  );
}

function AlertList({ v }: { v: PersonView }) {
  return (
    <ul className="sx-alert-list">
      {v.alerts.map((a) => (
        <li key={a.type}>
          <AlertIcon type={a.type} size={28} />
          <span>
            <span className="sx-alert-list-title">{ALERT_VIS[a.type].label}</span>
            <span className="fx-help">{a.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function DataPanel({ v }: { v: PersonView }) {
  const m = useMembers();
  const { open } = useMemberActions();
  const p = v.person;
  const rows: [string, React.ReactNode][] = [
    ["Teléfono", <span className="fx-num" key="t">{v.phone}</span>],
    ["Correo", p.email ?? <span className="sx-muted">—</span>],
    [
      "Nacimiento",
      p.birthDate ? (
        `${numericYmd(p.birthDate)} (${v.age} años)`
      ) : (
        <span className="sx-muted" key="b">
          — · Edad desconocida
        </span>
      ),
    ],
    ["Ingreso", shortDateYear(p.entryDate)],
    ["Confesión de fe", <TriStateValue value={p.faithConfession} key="f" />],
    ["Bautizado", <TriStateValue value={p.baptized} key="ba" />],
    ["Visitas", `${v.stats.visitCount}${v.stats.lastVisitDate ? ` · última ${relDay(v.stats.lastVisitDate, m.today)}` : ""}`],
    [
      "Responsable",
      <span className="sx-dd-owner" key="o">
        {v.ownerValid ? v.ownerName : p.followUpOwnerUid ? `${v.ownerName} (sin acceso)` : <span className="sx-owner-missing">Sin asignar</span>}
        {m.canManage && p.lifecycleStage === "en_consolidacion" && (
          <button
            type="button"
            className="fx-toggle sx-dd-btn"
            aria-label={`${p.followUpOwnerUid && v.ownerValid ? "Cambiar" : "Asignar"} responsable de ${p.fullName}`}
            onClick={() => open("assign", p.id)}
          >
            {p.followUpOwnerUid && v.ownerValid ? "Cambiar" : "Asignar"}
          </button>
        )}
      </span>,
    ],
    ["Estado", <PersonStatusBadge status={p.consolidationStatus} key="s" />],
    ["Etapa", p.lifecycleStage === "integrante" ? "Integrante" : "En consolidación"],
  ];
  if (p.integrationAreaId) rows.push(["Se integra en", m.state.areas.find((a) => a.id === p.integrationAreaId)?.name ?? "—"]);
  if (p.closedReason && p.consolidationStatus === "sin_continuidad") rows.push(["Motivo de cierre", CLOSED_REASON_LABEL[p.closedReason as ClosedReason]]);
  return (
    <section className="fx-panel sx-data" aria-labelledby="sx-data-title">
      <details open className="sx-data-details">
        <summary>
          <h2 className="fx-h2" id="sx-data-title">
            Datos
          </h2>
        </summary>
        <dl className="sx-dl">
          {rows.map(([k, val]) => (
            <div className="sx-dl-row" key={k}>
              <dt>{k}</dt>
              <dd>{val}</dd>
            </div>
          ))}
        </dl>
        {p.initialNotes && (
          <div className="sx-notes">
            <p className="sx-dl-label">Notas iniciales</p>
            <p className="sx-notes-text">{p.initialNotes}</p>
          </div>
        )}
        {v.badges.includes("menor") && <p className="fx-help sx-minor-note">Menor de edad: contacta a través de un adulto responsable.</p>}
      </details>
    </section>
  );
}

function PersonHeader({ v }: { v: PersonView }) {
  const m = useMembers();
  const { open } = useMemberActions();
  const p = v.person;
  const integrated = p.lifecycleStage === "integrante";
  const manage = m.canManage && !integrated;
  return (
    <header className="sx-ph">
      <div className="sx-ph-text">
        <h1 className="fx-h1 sx-ph-name">{p.fullName}</h1>
        <div className="sx-ph-badges">
          <DerivedBadges kinds={v.badges} />
          <PersonStatusBadge status={p.consolidationStatus} />
        </div>
        <p className="fx-subtitle">
          {v.age === null ? "Edad desconocida" : `${v.age} años`} · Ingresó el {shortDateYear(p.entryDate)} ·{" "}
          {plural(v.stats.visitCount, "visita", "visitas")} · Responsable: {v.ownerValid ? v.ownerName : "Sin asignar"}
        </p>
      </div>
      <div className="sx-ph-actions">
        {manage && (
          <button type="button" className="fx-btn fx-btn-primary" aria-label={`Registrar visita a ${p.fullName}`} onClick={() => open("visit", p.id)}>
            <CalendarPlus size={16} aria-hidden="true" />
            <span className="sx-ph-long">Registrar visita</span>
            <span className="sx-ph-short" aria-hidden="true">
              Visita
            </span>
          </button>
        )}
        {manage && (
          <button
            type="button"
            className="fx-btn fx-btn-secondary"
            aria-label={`Registrar seguimiento de ${p.fullName}`}
            onClick={() => open("followup", p.id)}
          >
            <MessageSquarePlus size={16} aria-hidden="true" />
            <span className="sx-ph-long">Registrar seguimiento</span>
            <span className="sx-ph-short" aria-hidden="true">
              Seguimiento
            </span>
          </button>
        )}
        {!p.doNotContact && (
          <button type="button" className="fx-btn fx-btn-secondary" onClick={() => m.whatsapp(p)}>
            <MessageCircle size={16} aria-hidden="true" /> WhatsApp
          </button>
        )}
        {manage && (
          <button type="button" className="fx-btn fx-btn-secondary" onClick={() => open("status", p.id)}>
            <ArrowRightLeft size={16} aria-hidden="true" />
            {p.consolidationStatus === "sin_continuidad" ? "Reabrir" : "Cambiar estado"}
          </button>
        )}
      </div>
    </header>
  );
}

function Banners({ v }: { v: PersonView }) {
  const m = useMembers();
  const p = v.person;
  const name = firstName(p.fullName);
  const changes = m.state.personChanges.filter((c) => c.personId === p.id);
  const stageAt = changes.filter((c) => c.field === "stage" && c.to === "integrante").at(-1)?.at;
  const dncAt = changes.filter((c) => c.field === "doNotContact" && c.to === "true").at(-1)?.at;
  return (
    <>
      {p.lifecycleStage === "integrante" && (
        <Callout tone="success" icon={CircleCheck}>
          <p>
            <strong>{name} es integrante{stageAt ? ` desde el ${numericYmd(stageAt.slice(0, 10))}` : ""}.</strong> Su historial de Consolidación se
            conserva. Esta ficha queda en solo lectura: las próximas acciones se harán desde Integrantes.
          </p>
        </Callout>
      )}
      {p.consolidationStatus === "sin_continuidad" && (
        <Callout tone="neutral" icon={CircleSlash}>
          <p>
            <strong>Seguimiento cerrado: Sin continuidad</strong>
            {p.closedReason ? ` (motivo: ${CLOSED_REASON_LABEL[p.closedReason].toLowerCase()})` : ""}. Si vuelve, al registrar su visita se sugerirá
            reabrir el seguimiento.
          </p>
        </Callout>
      )}
      {p.doNotContact && (
        <Callout tone="neutral" icon={BellOff}>
          <p>
            Pidió no recibir contacto{dncAt ? ` (${numericYmd(dncAt.slice(0, 10))})` : ""}. No se muestran WhatsApp ni alertas.
          </p>
        </Callout>
      )}
    </>
  );
}

function PersonContent() {
  const m = useMembers();
  const id = useQueryParam("id");
  const estado = useQueryParam("estado");
  const v = id ? m.views.get(id) : undefined;

  if (estado === "cargando")
    return (
      <div aria-busy="true" aria-label="Cargando">
        <BackLink />
        <Skeleton h={28} w={260} style={{ marginTop: 12 }} />
        <Skeleton h={16} w={380} style={{ marginTop: 10 }} />
        <div className="sx-person-grid" style={{ marginTop: 24 }}>
          <Skeleton h={220} />
          <Skeleton h={220} />
        </div>
      </div>
    );
  if (estado === "error")
    return (
      <>
        <BackLink />
        <Panel className="sx-mt">
          <ErrorState title="No pudimos cargar la ficha" onRetry={() => replaceQueryParam("estado", null)} />
        </Panel>
      </>
    );
  if (!v)
    return (
      <>
        <BackLink />
        <Panel className="sx-mt">
          <EmptyState
            icon={UserSearch}
            title="No encontramos esta persona."
            body="Puede que el enlace esté incompleto o que la persona se haya registrado en otra sesión de la vista previa."
            action={
              <Link href={m.hrefFor(`${C_BASE}/personas`)} className="fx-btn fx-btn-secondary">
                Volver a Personas
              </Link>
            }
          />
        </Panel>
      </>
    );

  return (
    <div className="sx-person" data-person={v.person.id}>
      <BackLink />
      <PersonHeader v={v} />
      <div className="sx-banners">
        <Banners v={v} />
      </div>
      <div className="sx-person-grid">
        <div className="sx-person-main">
          <NextActionCard v={v} />
          <PersonTimeline key={v.person.id} personId={v.person.id} />
        </div>
        <div className="sx-person-side">
          <DataPanel v={v} />
          <AlertsPanel v={v} />
        </div>
      </div>
      <p className="fx-help sx-page-note">Datos personales de uso pastoral. Solo los ve el equipo de Consolidación.</p>
    </div>
  );
}

export function PersonScreen() {
  return (
    <MemberActions>
      <PersonContent />
    </MemberActions>
  );
}

