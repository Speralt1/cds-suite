"use client";

// Personas (16b §9.3): búsqueda, filtros por query param, orden, tabla desktop
// con container queries (nunca más ancha que su panel) y lista móvil (<768)
// con acciones rápidas siempre visibles ("…" → sheet de acciones).

import Link from "next/link";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlarmClock,
  CalendarPlus,
  ChevronDown,
  Ellipsis,
  MessageCircle,
  MessageSquarePlus,
  Plus,
  Search,
  SlidersHorizontal,
  UserRound,
  Users,
  UserX,
  X,
} from "lucide-react";
import { CalDialog, EmptyState, PageHeader, Skeleton } from "@/components/calendar/ui";
import { replaceQueryParam, useQueryParam } from "@/components/calendar/use-query";
import { compareLocal } from "@/lib/shared/dates";
import { CONSOLIDATION_STATUSES, STATUS_LABEL, formatPhone, whatsappLink } from "@/lib/shared/members";
import { ALERT_LABEL, attentionQueue, createdAtOf, type PersonView } from "@/lib/members/consolidation";
import type { AlertType } from "@/lib/members/types";
import { useMembers, type MembersState } from "@/lib/members/use-members";
import { NEW_PERSON_HREF, PRIVACY_NOTE, agoText, alertReason, fold, personHref, plural, relDay, shortDate, shortName } from "./model";
import { MemberActions, useMemberActions } from "./sheets";
import { LoadErrorState } from "./status";
import { ALERT_VIS, DerivedBadges, PersonStatusBadge, STATUS_VIS } from "./vocab";

// ---------- Filtros ----------

function has(v: PersonView, t: AlertType) {
  return v.alerts.some((a) => a.type === t);
}

const ALERT_FILTERS: { value: string; label: string; match: (v: PersonView) => boolean }[] = [
  { value: "atencion", label: "Necesita atención", match: (v) => v.alerts.length > 0 },
  { value: "sin_responsable", label: "Sin responsable", match: (v) => has(v, "sin_responsable") },
  { value: "sin_primer_contacto", label: "Sin primer contacto", match: (v) => has(v, "sin_primer_contacto") },
  { value: "vencido", label: "Seguimiento vencido", match: (v) => has(v, "seguimiento_vencido") },
  { value: "volvio", label: "Volvió sin seguimiento", match: (v) => has(v, "volvio") },
  { value: "sin_volver", label: "Varios días sin volver", match: (v) => has(v, "varios_dias_sin_volver") },
  { value: "duplicado", label: "Posible duplicado", match: (v) => has(v, "posible_duplicado_telefono") || has(v, "posible_duplicado_correo") },
];

const TAG_FILTERS: { value: string; label: string }[] = [
  { value: "nuevos", label: "Nuevos" },
  { value: "nuevos_mes", label: "Ingresaron este mes" },
  { value: "volvieron", label: "Volvieron" },
  { value: "no_contactar", label: "No contactar" },
];

const STAGE_FILTERS: { value: string; label: string }[] = [
  { value: "activa", label: "En consolidación" },
  { value: "integrados", label: "Integrados" },
  { value: "sin_continuidad", label: "Sin continuidad" },
  { value: "todas", label: "Todas las etapas" },
];

const SORTS: { value: string; label: string }[] = [
  { value: "atencion", label: "Necesitan atención primero" },
  { value: "ingreso", label: "Ingreso más reciente" },
  { value: "ultima_visita", label: "Última visita más antigua" },
  { value: "proxima", label: "Próxima acción" },
  { value: "nombre", label: "Nombre A–Z" },
];

interface Filters {
  situacion: string | null;
  responsable: string | null;
  alerta: string | null;
  etiqueta: string | null;
  etapa: string;
  orden: string;
}

function useFilters(): Filters {
  return {
    situacion: useQueryParam("situacion"),
    responsable: useQueryParam("responsable"),
    alerta: useQueryParam("alerta"),
    etiqueta: useQueryParam("etiqueta"),
    etapa: useQueryParam("etapa") ?? "activa",
    orden: useQueryParam("orden") ?? "atencion",
  };
}

const activeCount = (f: Filters) =>
  [f.situacion, f.responsable, f.alerta, f.etiqueta].filter(Boolean).length + (f.etapa !== "activa" ? 1 : 0);

function setParam(name: string, value: string) {
  replaceQueryParam(name, value || null);
}

function clearFilters() {
  for (const k of ["situacion", "responsable", "alerta", "etiqueta", "etapa"]) replaceQueryParam(k, null);
}

function stageMatch(v: PersonView, etapa: string) {
  const p = v.person;
  if (etapa === "todas") return true;
  if (etapa === "integrados") return p.lifecycleStage === "integrante";
  if (etapa === "sin_continuidad") return p.consolidationStatus === "sin_continuidad";
  return v.open;
}

export function applyFilters(m: Pick<MembersState, "views" | "alerts" | "today">, f: Filters, q: string): PersonView[] {
  const query = fold(q.trim());
  const digits = q.replace(/\D/g, "");
  const order = new Map(attentionQueue(m.alerts).map((r, i) => [r.personId, i]));
  const list = [...m.views.values()].filter((v) => {
    const p = v.person;
    if (!stageMatch(v, f.etapa)) return false;
    if (f.situacion && p.consolidationStatus !== f.situacion) return false;
    if (f.responsable === "sin" ? v.ownerValid : f.responsable && p.followUpOwnerUid !== f.responsable) return false;
    if (f.alerta) {
      const def = ALERT_FILTERS.find((a) => a.value === f.alerta);
      if (def && !def.match(v)) return false;
    }
    if (f.etiqueta === "nuevos" && !v.badges.includes("nuevo")) return false;
    if (f.etiqueta === "nuevos_mes" && p.entryDate.slice(0, 7) !== m.today.slice(0, 7)) return false;
    if (f.etiqueta === "volvieron" && !v.badges.includes("volvio")) return false;
    if (f.etiqueta === "no_contactar" && !p.doNotContact) return false;
    if (query) {
      const inName = fold(p.fullName).includes(query);
      const inEmail = !!p.email && p.email.includes(query);
      const inPhone = digits.length >= 3 && p.phoneE164.replace(/\D/g, "").includes(digits);
      if (!inName && !inEmail && !inPhone) return false;
    }
    return true;
  });
  const byName = (a: PersonView, b: PersonView) => a.person.fullName.localeCompare(b.person.fullName, "es");
  const sorters: Record<string, (a: PersonView, b: PersonView) => number> = {
    atencion: (a, b) =>
      (order.get(a.person.id) ?? 1e6) - (order.get(b.person.id) ?? 1e6) || compareLocal(b.person.entryDate, a.person.entryDate) || byName(a, b),
    ingreso: (a, b) => compareLocal(createdAtOf(b.person), createdAtOf(a.person)) || byName(a, b),
    ultima_visita: (a, b) =>
      compareLocal(a.person.projection.lastVisitDate ?? "9999", b.person.projection.lastVisitDate ?? "9999") || byName(a, b),
    proxima: (a, b) => compareLocal(a.next?.date ?? "9999", b.next?.date ?? "9999") || byName(a, b),
    nombre: byName,
  };
  return list.sort(sorters[f.orden] ?? sorters.atencion);
}

function Chip({
  label,
  value,
  onChange,
  children,
  active,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <span className={`mem-chip-select${active ? " is-active" : ""}`}>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
      <ChevronDown size={14} aria-hidden="true" />
    </span>
  );
}

function FilterControls({ f, stacked }: { f: Filters; stacked?: boolean }) {
  const m = useMembers();
  const wrap = (label: string, node: React.ReactNode) =>
    stacked ? (
      <div className="mem-filter-field" key={label}>
        <span className="mem-filter-label" aria-hidden="true">
          {label}
        </span>
        {node}
      </div>
    ) : (
      <Fragment key={label}>{node}</Fragment>
    );
  return (
    <>
      {wrap(
        "Estado",
        <Chip
          label="Estado"
          value={f.situacion ?? ""}
          active={!!f.situacion}
          onChange={(v) => {
            setParam("situacion", v);
            if (v === "integrado") setParam("etapa", "integrados");
            else if (v === "sin_continuidad") setParam("etapa", "sin_continuidad");
            else if (v && f.etapa !== "activa") setParam("etapa", "");
          }}
        >
          <option value="">Estado: todos</option>
          {CONSOLIDATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </Chip>,
      )}
      {wrap(
        "Responsable",
        <Chip label="Responsable" value={f.responsable ?? ""} active={!!f.responsable} onChange={(v) => setParam("responsable", v)}>
          <option value="">Responsable: todos</option>
          <option value="sin">Sin responsable</option>
          {(m.owners ?? []).map((u) => (
            <option key={u.uid} value={u.uid}>
              {u.displayName}
            </option>
          ))}
        </Chip>,
      )}
      {wrap(
        "Alertas",
        <Chip label="Alertas" value={f.alerta ?? ""} active={!!f.alerta} onChange={(v) => setParam("alerta", v)}>
          <option value="">Alertas: todas</option>
          {ALERT_FILTERS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </Chip>,
      )}
      {wrap(
        "Etiquetas",
        <Chip label="Etiquetas" value={f.etiqueta ?? ""} active={!!f.etiqueta} onChange={(v) => setParam("etiqueta", v)}>
          <option value="">Etiquetas: todas</option>
          {TAG_FILTERS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Chip>,
      )}
      {wrap(
        "Etapa",
        <Chip label="Etapa" value={f.etapa} active={f.etapa !== "activa"} onChange={(v) => setParam("etapa", v === "activa" ? "" : v)}>
          {STAGE_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.value === "activa" ? "Etapa: en consolidación" : s.label}
            </option>
          ))}
        </Chip>,
      )}
      {wrap(
        "Ordenar",
        <Chip label="Ordenar" value={f.orden} onChange={(v) => setParam("orden", v === "atencion" ? "" : v)}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              Ordenar: {s.label}
            </option>
          ))}
        </Chip>,
      )}
    </>
  );
}

// ---------- Menú de fila (desktop) ----------

function MenuItem({ label, icon: Icon, onSelect }: { label: string; icon: typeof CalendarPlus; onSelect: () => void }) {
  return (
    <button type="button" role="menuitem" className="mem-menu-item" onClick={onSelect}>
      <Icon size={16} aria-hidden="true" /> {label}
    </button>
  );
}

function RowMenu({ v }: { v: PersonView }) {
  const m = useMembers();
  const { open } = useMemberActions();
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number; root: HTMLElement } | null>(null);
  const p = v.person;
  const integrated = p.lifecycleStage === "integrante";
  const wa = whatsappLink(p);


  useLayoutEffect(() => {
    if (pos) menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [pos]);

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPos(null);
        btn.current?.focus();
      }
    };
    const onScroll = () => setPos(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [pos]);

  const toggle = () => {
    if (pos) {
      setPos(null);
      return;
    }
    const b = btn.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const root = (b.closest(".cds-members") as HTMLElement | null) ?? document.body;
    const below = window.innerHeight - r.bottom > 200;
    setPos({ top: below ? r.bottom + 4 : Math.max(8, r.top - 188), right: Math.max(8, window.innerWidth - r.right), root });
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="mem-row-more"
        aria-label={`Acciones para ${p.fullName}`}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        onClick={toggle}
      >
        <Ellipsis size={18} aria-hidden="true" />
      </button>
      {pos &&
        createPortal(
          <div
            ref={menu}
            className="mem-menu-list mem-row-menu"
            role="menu"
            aria-label={`Acciones para ${p.fullName}`}
            style={{ top: pos.top, right: pos.right }}
          >
            {m.canManage && !integrated && (
              <MenuItem
                label="Registrar seguimiento"
                icon={MessageSquarePlus}
                onSelect={() => {
                  setPos(null);
                  open("followup", p.id);
                }}
              />
            )}
            {m.canManage && (
              <MenuItem
                label="Registrar visita"
                icon={CalendarPlus}
                onSelect={() => {
                  setPos(null);
                  open("visit", p.id);
                }}
              />
            )}
            {wa && (
              <a role="menuitem" className="mem-menu-item" href={wa} target="_blank" rel="noopener noreferrer" onClick={() => setPos(null)}>
                <MessageCircle size={16} aria-hidden="true" /> Abrir WhatsApp
              </a>
            )}
            <Link role="menuitem" className="mem-menu-item" href={personHref(p.id)} onClick={() => setPos(null)}>
              <UserRound size={16} aria-hidden="true" /> Ver ficha
            </Link>
          </div>,
          pos.root,
        )}
    </>
  );
}

// ---------- Celdas ----------

/** Alerta principal con ícono + texto y "+n" (16b §9.3). */
function AlertSummary({ v, today }: { v: PersonView; today: string }) {
  const primary = v.alerts[0];
  if (!primary) return null;
  const vis = ALERT_VIS[primary.type];
  const Icon = vis.icon;
  const others = v.alerts.slice(1);
  const text = alertReason(primary, v, today).strong;
  return (
    <span className={`mem-alert-sum mem-ink-${vis.tone}`} title={v.alerts.map((a) => ALERT_LABEL[a.type]).join(", ")}>
      <Icon size={14} aria-hidden="true" />
      <span className="mem-alert-sum-text">{text}</span>
      {others.length > 0 && (
        <>
          <span className="mem-alert-more" aria-hidden="true">
            +{others.length}
          </span>
          <span className="mem-sr">{`. Además: ${others.map((a) => ALERT_LABEL[a.type]).join(", ")}`}</span>
        </>
      )}
    </span>
  );
}

function NextAction({ v, today }: { v: PersonView; today: string }) {
  if (!v.next) return <span className="mem-muted">—</span>;
  return (
    <>
      <span className="mem-cell-main mem-cell-text">{v.next.text}</span>
      {v.next.date &&
        (v.nextOverdue ? (
          <span className="mem-cell-sub mem-overdue">
            <AlarmClock size={12} aria-hidden="true" /> Vencida · {shortDate(v.next.date)}
          </span>
        ) : (
          <span className="mem-cell-sub">{relDay(v.next.date, today)}</span>
        ))}
    </>
  );
}

function Owner({ v }: { v: PersonView }) {
  if (v.ownerValid) return <span className="mem-cell-text">{v.ownerName ? shortName(v.ownerName) : "Asignado"}</span>;
  return (
    <span className="mem-owner-missing">
      <UserX size={13} aria-hidden="true" />
      {v.person.followUpOwnerUid ? "Responsable sin acceso" : "Sin asignar"}
    </span>
  );
}

function PeopleTable({ rows }: { rows: PersonView[] }) {
  const m = useMembers();
  return (
    <div className="mem-people-cq">
      <table className="mem-table mem-people-table">
        <caption className="mem-sr">Personas en Consolidación</caption>
        <thead>
          <tr>
            <th scope="col" className="c-name">
              Nombre
            </th>
            <th scope="col" className="c-phone">
              Teléfono
            </th>
            <th scope="col" className="c-entry">
              Ingreso
            </th>
            <th scope="col" className="c-last">
              Última visita
            </th>
            <th scope="col" className="c-visits is-num">
              Visitas
            </th>
            <th scope="col" className="c-owner">
              Responsable
            </th>
            <th scope="col" className="c-status">
              Estado
            </th>
            <th scope="col" className="c-next">
              Próxima acción
            </th>
            <th scope="col" className="c-actions">
              <span className="mem-sr">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => {
            const p = v.person;
            const phone = p.phoneE164 ? formatPhone(p.phoneE164) : "—";
            const last = p.projection.lastVisitDate;
            return (
              <tr key={p.id} data-person={p.id}>
                <td className="c-name">
                  <span className="mem-name-line">
                    <Link href={personHref(p.id)} className="mem-person-link mem-cell-text">
                      {p.fullName}
                    </Link>
                  </span>
                  <span className="mem-cell-sub mem-name-sub">
                    <DerivedBadges kinds={v.badges} />
                    <AlertSummary v={v} today={m.today} />
                    <span className="c-inline-phone mem-num">{phone}</span>
                  </span>
                </td>
                <td className="c-phone mem-num">{phone}</td>
                <td className="c-entry">{shortDate(p.entryDate)}</td>
                <td className="c-last">
                  <span className="mem-cell-main mem-cell-plain">{last ? relDay(last, m.today) : "—"}</span>
                  <span className="mem-cell-sub c-inline-visits">{plural(p.projection.visitCount, "visita", "visitas")}</span>
                </td>
                <td className="c-visits is-num" data-testid="visit-count">
                  {p.projection.visitCount}
                </td>
                <td className="c-owner">
                  <Owner v={v} />
                </td>
                <td className="c-status">
                  <PersonStatusBadge status={p.consolidationStatus} />
                  <span className="mem-cell-sub c-inline-next">{v.next ? `Próx.: ${v.next.text}` : ""}</span>
                </td>
                <td className="c-next">
                  <NextAction v={v} today={m.today} />
                </td>
                <td className="c-actions">
                  <RowMenu v={v} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PeopleList({ rows }: { rows: PersonView[] }) {
  const m = useMembers();
  const { open } = useMemberActions();
  return (
    <ul className="mem-plist" aria-label="Personas">
      {rows.map((v) => {
        const p = v.person;
        const top = v.alerts[0];
        const vis = STATUS_VIS[p.consolidationStatus];
        const StatusIcon = vis.icon;
        const AlertI = top ? ALERT_VIS[top.type].icon : null;
        return (
          <li key={p.id} className="mem-prow" data-person={p.id}>
            <Link href={personHref(p.id)} className="mem-prow-link">
              <span className="mem-prow-l1">
                <span className="mem-prow-name">{p.fullName}</span>
                <DerivedBadges kinds={v.badges.filter((b) => b !== "no_contactar")} />
              </span>
              <span className="mem-prow-status">
                <StatusIcon size={16} aria-hidden="true" className={`mem-ink-${vis.tone}`} />
                {STATUS_LABEL[p.consolidationStatus]}
              </span>
              <span className="mem-prow-l2">
                {plural(p.projection.visitCount, "visita", "visitas")} · <span className="mem-nowrap">llegó {relDay(p.entryDate, m.today)}</span>
              </span>
              {top && AlertI ? (
                <span className={`mem-prow-l3 mem-ink-${ALERT_VIS[top.type].tone}`}>
                  <AlertI size={14} aria-hidden="true" /> {ALERT_LABEL[top.type]}
                  {top.type === "sin_primer_contacto" ? ` · ${agoText(p.entryDate, m.today)}` : ""}
                  {v.alerts.length > 1 ? ` · +${v.alerts.length - 1}` : ""}
                </span>
              ) : v.next ? (
                <span className="mem-prow-l3">
                  <span>
                    Próxima: {v.next.text}
                    {v.next.date ? (
                      <>
                        {" · "}
                        <span className="mem-nowrap">{relDay(v.next.date, m.today)}</span>
                      </>
                    ) : null}
                  </span>
                </span>
              ) : p.doNotContact ? (
                <span className="mem-prow-l3">No contactar</span>
              ) : null}
            </Link>
            <button type="button" className="mem-prow-more" aria-label={`Acciones para ${p.fullName}`} onClick={() => open("actions", p.id)}>
              <Ellipsis size={20} aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Pantalla ----------

function PeopleContent() {
  const m = useMembers();
  const f = useFilters();
  const [q, setQ] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const rows = m.loading || m.error ? [] : applyFilters(m, f, q);
  const needing = rows.filter((v) => v.alerts.length).length;
  const nFilters = activeCount(f);

  let body: React.ReactNode;
  if (m.error) body = <LoadErrorState />;
  else if (m.loading)
    body = (
      <div className="mem-pad mem-skel-rows" aria-busy="true" aria-label="Cargando">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} h={48} />
        ))}
      </div>
    );
  else if (!m.persons.length)
    body = (
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
    );
  else if (!rows.length)
    body = q.trim() ? (
      <EmptyState
        icon={Search}
        title={`Ninguna persona coincide con «${q.trim()}».`}
        body="Prueba con otro nombre, el teléfono sin espacios o el correo."
        action={
          <button type="button" className="button-secondary" onClick={() => setQ("")}>
            Limpiar búsqueda
          </button>
        }
      />
    ) : (
      <EmptyState
        icon={SlidersHorizontal}
        title="Ninguna persona coincide con estos filtros."
        action={
          <button type="button" className="button-secondary" onClick={clearFilters}>
            Limpiar filtros
          </button>
        }
      />
    );
  else
    body = (
      <>
        <div className="mem-people-desktop">
          <PeopleTable rows={rows} />
        </div>
        <div className="mem-people-mobile">
          <PeopleList rows={rows} />
        </div>
      </>
    );

  return (
    <>
      <PageHeader title="Personas" subtitle="Quienes visitan la iglesia y su acompañamiento." />
      <section className="panel mem-panel is-flush mem-people-panel" aria-label="Lista de personas">
        <div className="mem-toolbar mem-people-toolbar">
          <label className="mem-search mem-people-search">
            <Search size={16} aria-hidden="true" />
            <span className="mem-sr">Buscar nombre, teléfono o correo</span>
            <input
              className="mem-input"
              type="search"
              placeholder="Buscar nombre, teléfono o correo"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <div className="mem-people-chips">
            <FilterControls f={f} />
          </div>
          <button type="button" className="button-secondary mem-filters-btn" onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal size={16} aria-hidden="true" /> Filtros{nFilters ? ` (${nFilters})` : ""}
          </button>
        </div>
        {!m.loading && !m.error && (
          <div className="mem-people-count">
            <span>
              <strong>{plural(rows.length, "persona", "personas")}</strong>
              {needing ? ` · ${plural(needing, "necesita", "necesitan")} atención` : ""}
            </span>
            {nFilters > 0 && (
              <button type="button" className="mem-toggle" onClick={clearFilters}>
                <X size={14} aria-hidden="true" /> Limpiar filtros
              </button>
            )}
          </div>
        )}
        {body}
      </section>
      <p className="mem-help mem-page-note">{PRIVACY_NOTE}</p>

      {filtersOpen && (
        <CalDialog
          title="Filtros"
          onClose={() => setFiltersOpen(false)}
          footer={
            <div className="mem-foot">
              <button type="button" className="button-secondary" onClick={clearFilters}>
                Limpiar
              </button>
              <button type="button" className="button-primary" onClick={() => setFiltersOpen(false)}>
                Ver {plural(rows.length, "persona", "personas")}
              </button>
            </div>
          }
        >
          <div className="mem-filter-stack">
            <FilterControls f={f} stacked />
          </div>
        </CalDialog>
      )}
    </>
  );
}

export function PeopleScreen() {
  return (
    <MemberActions>
      <PeopleContent />
    </MemberActions>
  );
}
