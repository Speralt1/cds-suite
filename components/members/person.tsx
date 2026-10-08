"use client";

// Ficha de persona (16b §9.4): header con acciones, próxima acción, alertas,
// datos operacionales e historial (más nuevo primero) leído en vivo de
// membersVisits / membersFollowUps / membersPersonChanges.
// El título de una actividad del calendario solo se lee con calendar.read.

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  AlarmClock,
  ArrowLeft,
  ArrowRightLeft,
  BellOff,
  CalendarPlus,
  CircleCheck,
  CircleSlash,
  Ellipsis,
  Info,
  MapPin,
  MessageCircle,
  MessageSquarePlus,
  Pencil,
  Phone,
  Star,
  UserPlus,
  UserSearch,
  Users,
  type LucideIcon,
} from "lucide-react";
import { EmptyState, ErrorState, InlineNotice, Skeleton } from "@/components/calendar/ui";
import { useQueryParam } from "@/components/calendar/use-query";
import {
  ARRIVAL_SOURCE_LABEL,
  CLOSED_REASON_LABEL,
  FOLLOW_UP_RESULT_LABEL,
  FOLLOW_UP_TYPE_LABEL,
  LIFECYCLE_LABEL,
  STATUS_LABEL,
  formatPhone,
  type ConsolidationStatus,
  type FollowUpType,
} from "@/lib/shared/members";
import { HISTORY_LIMIT, historyTruncated, useCalendarTitles, usePersonHistory } from "@/lib/members/client";
import { timeline, type PersonView } from "@/lib/members/consolidation";
import type { PersonChange, TimelineItem } from "@/lib/members/types";
import { useMembers, type MembersState } from "@/lib/members/use-members";
import { EditPersonSheet } from "./person-form";
import {
  CALENDAR_FALLBACK_TITLE,
  PEOPLE_HREF,
  PRIVACY_NOTE,
  firstName,
  numericYmd,
  plural,
  relDay,
  shortDate,
  shortDateYear,
} from "./model";
import { MemberActions, WhatsAppLink, useMemberActions } from "./sheets";
import { LoadErrorState } from "./status";
import { ALERT_VIS, AlertIcon, DerivedBadges, PersonStatusBadge } from "./vocab";

const FU_ICON: Record<FollowUpType, LucideIcon> = { whatsapp: MessageCircle, llamada: Phone, presencial: Users, otro: Ellipsis };

type TimelineFilter = "todo" | "visit" | "followup" | "change";
const FILTERS: { id: TimelineFilter; label: string; short: string }[] = [
  { id: "todo", label: "Todo", short: "Todo" },
  { id: "visit", label: "Visitas", short: "Visitas" },
  { id: "followup", label: "Seguimientos", short: "Seg." },
  { id: "change", label: "Cambios", short: "Cambios" },
];

const PROFILE_FIELD_LABEL: Record<string, string> = {
  fullName: "nombre",
  phoneE164: "teléfono",
  phone: "teléfono",
  email: "correo",
  arrivalSource: "cómo llegó",
  invitedBy: "invitado por",
};

const noopSubscribe = () => () => {};

/** false en el servidor y al hidratar; true después (la query solo existe en el cliente). */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

function BackLink() {
  return (
    <Link href={PEOPLE_HREF} className="mem-link mem-back">
      <ArrowLeft size={16} aria-hidden="true" /> Personas
    </Link>
  );
}

function ownerLabel(m: MembersState, uid: string | null | boolean): string {
  if (typeof uid !== "string" || !uid) return "Sin responsable";
  return m.ownerName(uid) ?? "Responsable sin acceso";
}

function changeText(c: PersonChange, m: MembersState): { title: string; fromTo?: [string, string] } {
  switch (c.action) {
    case "status_changed":
      return {
        title: "Cambio de estado",
        fromTo: [STATUS_LABEL[c.from as ConsolidationStatus] ?? "—", STATUS_LABEL[c.to as ConsolidationStatus] ?? "—"],
      };
    case "owner_changed":
      return { title: "Cambio de responsable", fromTo: [ownerLabel(m, c.from), ownerLabel(m, c.to)] };
    case "stage_changed":
      return { title: c.to === "integrante" ? "Pasó a ser integrante" : "Volvió a Consolidación" };
    case "do_not_contact_changed":
      return { title: c.to === true || c.to === "true" ? "Marcada como No contactar" : "Se quitó No contactar" };
    case "profile_updated": {
      const fields = [...new Set(c.changedFields.map((f) => PROFILE_FIELD_LABEL[f] ?? null).filter(Boolean))];
      return { title: fields.length ? `Datos actualizados: ${fields.join(", ")}` : "Datos actualizados" };
    }
    default:
      return { title: "Cambio registrado" };
  }
}

function TimelineEntry({
  item,
  m,
  flash,
  titles,
}: {
  item: TimelineItem;
  m: MembersState;
  flash: boolean;
  titles: Record<string, string | null>;
}) {
  const by = item.by ? m.ownerName(item.by) : null;
  let Icon: LucideIcon = MapPin;
  let tone = "neutral";
  let title: React.ReactNode;
  const meta: string[] = [];
  let quote: string | null = null;
  let extra: React.ReactNode = null;

  if (item.kind === "created") {
    Icon = UserPlus;
    tone = "info";
    title = "Registro de la persona";
    if (by) meta.push(`Registró ${by}`);
  } else if (item.kind === "visit") {
    const v = item.visit;
    Icon = item.isFirstVisit ? Star : MapPin;
    tone = item.isFirstVisit ? "success" : "neutral";
    const activity = v.calendarEventId ? (m.canReadCalendar ? (titles[v.calendarEventId] ?? CALENDAR_FALLBACK_TITLE) : CALENDAR_FALLBACK_TITLE) : null;
    title = (
      <>
        {item.isFirstVisit ? "Primera visita" : "Visita"}
        {activity ? ` · ${activity}` : ""}
      </>
    );
    if (by) meta.push(`Registrada por ${by}`);
    quote = v.note;
  } else if (item.kind === "followup") {
    const f = item.followUp;
    Icon = FU_ICON[f.type];
    tone = f.result === "contactado" ? "info" : f.result === "no_desea_contacto" ? "danger" : "neutral";
    title = `Seguimiento · ${FOLLOW_UP_TYPE_LABEL[f.type]} · ${FOLLOW_UP_RESULT_LABEL[f.result]}`;
    if (by) meta.push(`Por ${by}`);
    quote = f.note;
    if (f.nextAction)
      extra = (
        <span className="mem-tl-next">
          Próxima acción: {f.nextAction}
          {f.nextActionDate ? ` · ${shortDate(f.nextActionDate)}` : ""}
          {f.ownerUid ? ` · ${ownerLabel(m, f.ownerUid)}` : ""}
        </span>
      );
  } else {
    const c = item.change;
    Icon = ArrowRightLeft;
    tone = "review";
    const t = changeText(c, m);
    title = t.fromTo ? (
      <>
        {t.title}: {t.fromTo[0]} <span aria-hidden="true">→</span>
        <span className="mem-sr"> a </span> {t.fromTo[1]}
      </>
    ) : (
      t.title
    );
    if (by) meta.push(`Por ${by}`);
    if (c.reason || c.reasonNote)
      extra = (
        <span className="mem-tl-reason">
          Motivo: {[c.reason ? CLOSED_REASON_LABEL[c.reason] : null, c.reasonNote].filter(Boolean).join(" · ")}
        </span>
      );
  }

  return (
    <li
      className={`mem-tl-item${flash ? " mem-flash" : ""}${item.kind === "visit" && item.isFirstVisit ? " is-first" : ""}`}
      data-kind={item.kind}
    >
      <time className="mem-tl-date" dateTime={item.date}>
        {shortDate(item.date)}
      </time>
      <span className={`mem-tl-icon mem-tone-${tone}`} aria-hidden="true">
        <Icon size={14} />
      </span>
      <div className="mem-tl-body">
        <p className="mem-tl-title">{title}</p>
        {meta.length > 0 && <p className="mem-help">{meta.join(" · ")}</p>}
        {quote && <p className="mem-tl-quote">“{quote}”</p>}
        {extra}
      </div>
    </li>
  );
}

function PersonTimeline({
  v,
  history,
  titles,
  onRetry,
}: {
  v: PersonView;
  history: ReturnType<typeof usePersonHistory>;
  titles: Record<string, string | null>;
  onRetry: () => void;
}) {
  const m = useMembers();
  const [filter, setFilter] = useState<TimelineFilter>("todo");
  const items = timeline(v.person, history.visits, history.followUps, history.changes);
  // Ids vistos al cargar la ficha: lo nuevo se resalta 1,2 s (16b §14).
  const [seen, setSeen] = useState<Set<string> | null>(null);
  if (!history.loading && !history.error && seen === null) setSeen(new Set(items.map((i) => i.id)));
  const shown = filter === "todo" ? items : items.filter((i) => i.kind === filter || (filter === "visit" && i.kind === "created"));
  return (
    <section className="panel mem-panel mem-tl-panel" aria-labelledby="mem-tl-title">
      <div className="mem-tl-head">
        <h2 className="mem-h2" id="mem-tl-title">
          Historial {!history.loading && !history.error && <span className="mem-count">({items.length})</span>}
        </h2>
        <div className="mem-segmented mem-tl-filter" role="group" aria-label="Filtrar historial">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} aria-label={f.label} onClick={() => setFilter(f.id)}>
              <span className="mem-tl-filter-long">{f.label}</span>
              <span className="mem-tl-filter-short" aria-hidden="true">
                {f.short}
              </span>
            </button>
          ))}
        </div>
      </div>
      {history.error ? (
        <ErrorState
          title="No pudimos cargar el historial"
          body={history.error === "permission" ? "Puede que tus permisos hayan cambiado. Recarga la página." : "Revisa tu conexión e inténtalo de nuevo."}
          onRetry={onRetry}
        />
      ) : history.loading ? (
        <div className="mem-skel-rows" aria-busy="true" aria-label="Cargando historial">
          <Skeleton h={44} />
          <Skeleton h={44} />
          <Skeleton h={44} />
        </div>
      ) : shown.length ? (
        <>
          {historyTruncated(history) && (
            <InlineNotice tone="info" icon={Info} role="status">
              Mostrando los {HISTORY_LIMIT} registros más recientes.
            </InlineNotice>
          )}
          <ol className="mem-tl" aria-label="Historial, del más nuevo al más antiguo">
            {shown.map((i) => (
              <TimelineEntry key={i.id} item={i} m={m} titles={titles} flash={!!seen && !seen.has(i.id)} />
            ))}
          </ol>
        </>
      ) : (
        <p className="mem-mini-empty">Sin registros de este tipo.</p>
      )}
    </section>
  );
}

function NextActionCard({ v }: { v: PersonView }) {
  const m = useMembers();
  const { open } = useMemberActions();
  const actionable = m.canManage && v.person.lifecycleStage === "en_consolidacion";
  const button = actionable && (
    <button type="button" className="button-secondary mem-btn-sm" onClick={() => open("followup", v.person.id)}>
      Registrar seguimiento
    </button>
  );
  return (
    <section className="panel mem-panel mem-next" aria-labelledby="mem-next-title">
      <h2 className="mem-h2" id="mem-next-title">
        Próxima acción
      </h2>
      {v.next ? (
        <div className="mem-next-body">
          <span className={`mem-next-icon ${v.nextOverdue ? "mem-tone-warning" : "mem-tone-info"}`} aria-hidden="true">
            <AlarmClock size={18} />
          </span>
          <div className="mem-next-text">
            <p className="mem-next-title">{v.next.text}</p>
            <p className="mem-help-13">
              {v.next.date ? (
                v.nextOverdue ? (
                  <span className="mem-overdue">Vencida · era para el {shortDate(v.next.date)}</span>
                ) : (
                  relDay(v.next.date, m.today)
                )
              ) : (
                "Sin fecha"
              )}
              {" · "}
              {v.next.ownerUid ? ownerLabel(m, v.next.ownerUid) : "Sin responsable"}
            </p>
          </div>
          {button}
        </div>
      ) : (
        <div className="mem-next-body">
          <span className="mem-next-icon mem-tone-neutral" aria-hidden="true">
            <AlarmClock size={18} />
          </span>
          <div className="mem-next-text">
            <p className="mem-next-title">Sin próxima acción</p>
            <p className="mem-help-13">Se define al registrar un seguimiento.</p>
          </div>
          {button}
        </div>
      )}
    </section>
  );
}

function AlertsPanel({ v }: { v: PersonView }) {
  return (
    <section className="panel mem-panel mem-alerts-panel" aria-labelledby="mem-alerts-title">
      <h2 className="mem-h2" id="mem-alerts-title">
        Alertas {!v.person.doNotContact && <span className="mem-count">({v.alerts.length})</span>}
      </h2>
      {v.person.doNotContact && <p className="mem-help-13">Con No contactar no se muestran alertas, salvo posibles duplicados.</p>}
      {v.alerts.length ? (
        <ul className="mem-alert-list">
          {v.alerts.map((a) => (
            <li key={a.type}>
              <AlertIcon type={a.type} size={28} />
              <span>
                <span className="mem-alert-list-title">{ALERT_VIS[a.type].label}</span>
                <span className="mem-help">{a.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        !v.person.doNotContact && (
          <p className="mem-ok-line">
            <CircleCheck size={16} aria-hidden="true" /> Sin alertas activas.
          </p>
        )
      )}
    </section>
  );
}

function DataPanel({ v, titles, onEdit }: { v: PersonView; titles: Record<string, string | null>; onEdit: () => void }) {
  const m = useMembers();
  const { open } = useMemberActions();
  const p = v.person;
  // Datos editables también para integrantes; responsable y "No contactar" solo en Consolidación.
  const editable = m.canManage && p.lifecycleStage === "en_consolidacion";
  const canEditData = m.canManage;
  const pr = p.projection;
  const muted = (text = "—") => <span className="mem-muted">{text}</span>;
  const rows: [string, React.ReactNode][] = [
    ["Teléfono", p.phoneE164 ? <span className="mem-num">{formatPhone(p.phoneE164)}</span> : muted()],
    ["Correo", p.email ?? muted()],
    ["Ingreso", shortDateYear(p.entryDate)],
    ["Primera visita", p.firstVisitAt ? shortDateYear(p.firstVisitAt) : muted()],
    ["Cómo llegó", p.arrivalSource ? ARRIVAL_SOURCE_LABEL[p.arrivalSource] : muted()],
    ["Invitado por", p.invitedBy ?? muted()],
  ];
  if (p.calendarEventId)
    rows.push(["Llegó a", m.canReadCalendar ? (titles[p.calendarEventId] ?? CALENDAR_FALLBACK_TITLE) : CALENDAR_FALLBACK_TITLE]);
  rows.push(
    ["Visitas", `${pr.visitCount}${pr.lastVisitDate ? ` · última ${relDay(pr.lastVisitDate, m.today)}` : ""}`],
    [
      "Responsable",
      <span className="mem-dd-owner" key="o">
        {v.ownerValid ? (v.ownerName ?? "Asignado") : p.followUpOwnerUid ? <span className="mem-owner-missing">Responsable sin acceso</span> : <span className="mem-owner-missing">Sin asignar</span>}
        {editable && (
          <button
            type="button"
            className="mem-toggle mem-dd-btn"
            aria-label={`${p.followUpOwnerUid && v.ownerValid ? "Cambiar" : "Asignar"} responsable de ${p.fullName}`}
            onClick={() => open("assign", p.id)}
          >
            {p.followUpOwnerUid && v.ownerValid ? "Cambiar" : "Asignar"}
          </button>
        )}
      </span>,
    ],
    [
      "Contacto",
      <span className="mem-dd-owner" key="c">
        {p.doNotContact ? "No contactar" : "Permitido"}
        {editable && (
          <button
            type="button"
            className="mem-toggle mem-dd-btn"
            aria-label={`${p.doNotContact ? "Quitar" : "Marcar"} No contactar: ${p.fullName}`}
            onClick={() => open("dnc", p.id)}
          >
            {p.doNotContact ? "Quitar" : "Marcar No contactar"}
          </button>
        )}
      </span>,
    ],
    ["Estado", <PersonStatusBadge status={p.consolidationStatus} key="s" />],
    ["Etapa", LIFECYCLE_LABEL[p.lifecycleStage]],
  );
  if (p.closedReason && p.consolidationStatus === "sin_continuidad") rows.push(["Motivo de cierre", CLOSED_REASON_LABEL[p.closedReason]]);
  return (
    <section className="panel mem-panel mem-data" aria-labelledby="mem-data-title">
      <details open className="mem-data-details">
        <summary>
          <h2 className="mem-h2" id="mem-data-title">
            Datos
          </h2>
        </summary>
        <dl className="mem-dl">
          {rows.map(([k, val]) => (
            <div className="mem-dl-row" key={k}>
              <dt>{k}</dt>
              <dd>{val}</dd>
            </div>
          ))}
        </dl>
        {canEditData && (
          <button type="button" className="button-secondary mem-btn-sm mem-mt" onClick={onEdit}>
            <Pencil size={14} aria-hidden="true" /> Editar datos
          </button>
        )}
      </details>
    </section>
  );
}

function PersonHeader({ v }: { v: PersonView }) {
  const m = useMembers();
  const { open } = useMemberActions();
  const p = v.person;
  const manage = m.canManage && p.lifecycleStage === "en_consolidacion";
  // Integrado: se puede registrar una visita, pero no cambiar estado (el servidor lo rechaza) ni registrar seguimiento.
  const canVisit = m.canManage;
  return (
    <header className="mem-ph">
      <div className="mem-ph-text">
        <h2 className="mem-ph-name">{p.fullName}</h2>
        <div className="mem-ph-badges">
          <DerivedBadges kinds={v.badges} />
          <PersonStatusBadge status={p.consolidationStatus} />
        </div>
        <p className="mem-subtitle">
          Ingresó el {shortDateYear(p.entryDate)} · {plural(p.projection.visitCount, "visita", "visitas")} · Responsable:{" "}
          {v.ownerValid ? (v.ownerName ?? "Asignado") : p.followUpOwnerUid ? "sin acceso" : "sin asignar"}
        </p>
      </div>
      <div className="mem-ph-actions">
        {canVisit && (
          <button type="button" className="button-primary" aria-label={`Registrar visita a ${p.fullName}`} onClick={() => open("visit", p.id)}>
            <CalendarPlus size={16} aria-hidden="true" />
            <span className="mem-ph-long">Registrar visita</span>
            <span className="mem-ph-short" aria-hidden="true">
              Visita
            </span>
          </button>
        )}
        {manage && (
          <button type="button" className="button-secondary" aria-label={`Registrar seguimiento de ${p.fullName}`} onClick={() => open("followup", p.id)}>
            <MessageSquarePlus size={16} aria-hidden="true" />
            <span className="mem-ph-long">Registrar seguimiento</span>
            <span className="mem-ph-short" aria-hidden="true">
              Seguimiento
            </span>
          </button>
        )}
        <WhatsAppLink person={p} />
        {manage && (
          <button type="button" className="button-secondary" onClick={() => open("status", p.id)}>
            <ArrowRightLeft size={16} aria-hidden="true" />
            {p.consolidationStatus === "sin_continuidad" ? "Reabrir" : "Cambiar estado"}
          </button>
        )}
      </div>
    </header>
  );
}

function Banners({ v, changes }: { v: PersonView; changes: PersonChange[] }) {
  const p = v.person;
  const name = firstName(p.fullName);
  const latest = (pred: (c: PersonChange) => boolean) =>
    changes
      .filter(pred)
      .map((c) => c.at)
      .filter((x): x is string => !!x)
      .sort()
      .at(-1);
  const stageAt = latest((c) => c.action === "stage_changed" && c.to === "integrante");
  const dncAt = latest((c) => c.action === "do_not_contact_changed" && (c.to === true || c.to === "true"));
  return (
    <>
      {p.lifecycleStage === "integrante" && (
        <InlineNotice tone="success" icon={CircleCheck}>
          <p>
            <strong>
              {name} es integrante{stageAt ? ` desde el ${numericYmd(stageAt.slice(0, 10))}` : ""}.
            </strong>{" "}
            Su historial de Consolidación se conserva. Integrado: ya no aparece en las alertas de Consolidación.
          </p>
        </InlineNotice>
      )}
      {p.consolidationStatus === "sin_continuidad" && p.lifecycleStage === "en_consolidacion" && (
        <InlineNotice tone="info" icon={CircleSlash}>
          <p>
            <strong>Seguimiento cerrado: Sin continuidad</strong>
            {p.closedReason ? ` (motivo: ${CLOSED_REASON_LABEL[p.closedReason].toLowerCase()})` : ""}. Si vuelve, al registrar su visita se
            sugerirá reabrir el seguimiento.
          </p>
        </InlineNotice>
      )}
      {p.doNotContact && (
        <InlineNotice tone="warning" icon={BellOff}>
          <p>
            Pidió no recibir contacto{dncAt ? ` (${numericYmd(dncAt.slice(0, 10))})` : ""}. No se muestran WhatsApp ni alertas.
          </p>
        </InlineNotice>
      )}
    </>
  );
}

function PersonLoaded({ v }: { v: PersonView }) {
  const m = useMembers();
  const [retryKey, setRetryKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const history = usePersonHistory(v.person.id, retryKey);
  const calendarIds = [v.person.calendarEventId, ...history.visits.map((x) => x.calendarEventId)].filter((x): x is string => !!x);
  const titles = useCalendarTitles(calendarIds, m.canReadCalendar);
  return (
    <div className="mem-person" data-person={v.person.id}>
      <BackLink />
      <PersonHeader v={v} />
      <div className="mem-banners">
        <Banners v={v} changes={history.changes} />
      </div>
      <div className="mem-person-grid">
        <div className="mem-person-main">
          <NextActionCard v={v} />
          <PersonTimeline v={v} history={history} titles={titles} onRetry={() => setRetryKey((k) => k + 1)} />
        </div>
        <div className="mem-person-side">
          <DataPanel v={v} titles={titles} onEdit={() => setEditing(true)} />
          <AlertsPanel v={v} />
        </div>
      </div>
      <p className="mem-help mem-page-note">{PRIVACY_NOTE}</p>
      {editing && <EditPersonSheet person={v.person} onClose={() => setEditing(false)} />}
    </div>
  );
}

function PersonContent() {
  const m = useMembers();
  const hydrated = useHydrated();
  const id = useQueryParam("id");
  const v = id ? m.viewOf(id) : undefined;

  // Respaldo: una persona fuera de las cargadas (límite de la lista) se lee
  // con un get puntual antes de concluir que no existe.
  const { loadPerson } = m;
  const [lookupSeq, setLookupSeq] = useState(0);
  const [lookup, setLookup] = useState<{ id: string; seq: number; state: "missing" | "error" } | null>(null);
  const needLookup = !!id && hydrated && !m.loading && !m.error && !v;
  useEffect(() => {
    if (!needLookup || !id) return;
    let alive = true;
    loadPerson(id).then(
      (found) => {
        if (alive && !found) setLookup({ id, seq: lookupSeq, state: "missing" });
      },
      () => {
        if (alive) setLookup({ id, seq: lookupSeq, state: "error" });
      },
    );
    return () => {
      alive = false;
    };
  }, [needLookup, id, loadPerson, lookupSeq]);
  const lookupState = lookup && lookup.id === id && lookup.seq === lookupSeq ? lookup.state : "loading";

  if (m.error)
    return (
      <>
        <BackLink />
        <section className="panel mem-panel mem-mt">
          <LoadErrorState />
        </section>
      </>
    );
  if (!hydrated || m.loading || (!v && !!id && lookupState === "loading"))
    return (
      <div aria-busy="true" aria-label="Cargando">
        <BackLink />
        <Skeleton h={28} w={260} style={{ marginTop: 12 }} />
        <Skeleton h={16} w={320} style={{ marginTop: 10 }} />
        <div className="mem-person-grid" style={{ marginTop: 24 }}>
          <Skeleton h={220} />
          <Skeleton h={220} />
        </div>
      </div>
    );
  if (!v && lookupState === "error")
    return (
      <>
        <BackLink />
        <section className="panel mem-panel mem-mt">
          <ErrorState
            title="No pudimos cargar esta persona"
            body="Revisa tu conexión e inténtalo de nuevo."
            onRetry={() => setLookupSeq((k) => k + 1)}
          />
        </section>
      </>
    );
  if (!v)
    return (
      <>
        <BackLink />
        <section className="panel mem-panel mem-mt">
          <EmptyState
            icon={UserSearch}
            title="No encontramos esta persona."
            body="Puede que el enlace esté incompleto o que la persona ya no esté disponible."
            action={
              <Link href={PEOPLE_HREF} className="button-secondary">
                Volver a Personas
              </Link>
            }
          />
        </section>
      </>
    );
  return <PersonLoaded key={v.person.id} v={v} />;
}

export function PersonScreen() {
  return (
    <MemberActions>
      <PersonContent />
    </MemberActions>
  );
}
