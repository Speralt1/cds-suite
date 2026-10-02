"use client";

// Personas (16b §9.3): búsqueda, filtros por query param, orden, tabla desktop
// con container queries (nunca más ancha que su panel) y lista móvil (<768).

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
import { ALERT_LABEL, STATUS_LABEL, STATUS_ORDER, attentionQueue } from "@/lib/suite-preview/consolidation";
import { compareLocal } from "@/lib/suite-preview/dates";
import type { AlertType } from "@/lib/suite-preview/types";
import { shortDate } from "@/lib/finance-preview/format";
import { EmptyState, ErrorState, Sheet, SkeletonRows } from "@/components/finance-preview/ui";
import { PageHeader } from "../primitives";
import { replaceQueryParam, useQueryParam } from "../use-query";
import { C_BASE, agoText, alertReason, fold, personHref, plural, relDay, shortName, type PersonView } from "./model";
import { MemberActions, useMemberActions } from "./sheets";
import { useMembers, type MembersModel } from "./use-members";
import { ALERT_VIS, DerivedBadges, PersonStatusBadge, STATUS_VIS } from "./vocab";

// ---------- Filtros ----------

const ALERT_FILTERS: { value: string; label: string; match: (v: PersonView) => boolean }[] = [
  { value: "atencion", label: "Necesita atención", match: (v) => v.attention.length > 0 },
  { value: "sin_responsable", label: "Sin responsable", match: (v) => has(v, "sin_responsable") },
  { value: "sin_primer_contacto", label: "Sin primer contacto", match: (v) => has(v, "sin_primer_contacto") },
  { value: "vencido", label: "Seguimiento vencido", match: (v) => has(v, "seguimiento_vencido") },
  { value: "volvio", label: "Volvió sin seguimiento", match: (v) => has(v, "volvio") },
  { value: "sin_volver", label: "Varios días sin volver", match: (v) => has(v, "varios_dias_sin_volver") },
  { value: "duplicado", label: "Posible duplicado", match: (v) => has(v, "posible_duplicado_telefono") || has(v, "posible_duplicado_correo") },
  { value: "cumpleanos", label: "Cumpleaños próximo", match: (v) => has(v, "cumpleanos_proximo") },
];
function has(v: PersonView, t: AlertType) {
  return v.alerts.some((a) => a.type === t);
}

const TAG_FILTERS: { value: string; label: string }[] = [
  { value: "nuevos", label: "Nuevos" },
  { value: "nuevos_mes", label: "Ingresaron este mes" },
  { value: "volvieron", label: "Volvieron" },
  { value: "menores", label: "Menores de edad" },
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
  return v.active;
}

function applyFilters(m: MembersModel, f: Filters, q: string): PersonView[] {
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
    if (f.etiqueta === "menores" && !v.badges.includes("menor")) return false;
    if (query) {
      const inName = fold(p.fullName).includes(query);
      const inEmail = !!p.email && p.email.includes(query);
      const inPhone = digits.length >= 3 && (p.phoneE164.replace(/\D/g, "").includes(digits) || p.phoneRaw.replace(/\D/g, "").includes(digits));
      if (!inName && !inEmail && !inPhone) return false;
    }
    return true;
  });
  const byName = (a: PersonView, b: PersonView) => a.person.fullName.localeCompare(b.person.fullName, "es");
  const sorters: Record<string, (a: PersonView, b: PersonView) => number> = {
    atencion: (a, b) =>
      (order.get(a.person.id) ?? 1e6) - (order.get(b.person.id) ?? 1e6) || compareLocal(b.person.entryDate, a.person.entryDate) || byName(a, b),
    ingreso: (a, b) => compareLocal(b.person.createdAt, a.person.createdAt) || byName(a, b),
    ultima_visita: (a, b) => compareLocal(a.stats.lastVisitDate ?? "9999", b.stats.lastVisitDate ?? "9999") || byName(a, b),
    proxima: (a, b) => compareLocal(a.next?.date ?? "9999", b.next?.date ?? "9999") || byName(a, b),
    nombre: byName,
  };
  return list.sort(sorters[f.orden] ?? sorters.atencion);
}

function Chip({ label, value, onChange, children, active }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode; active?: boolean }) {
  return (
    <span className={`fx-chip${active ? " is-active" : ""}`}>
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
      <div className="sx-filter-field" key={label}>
        <span className="sx-filter-label" aria-hidden="true">
          {label}
        </span>
        {node}
      </div>
    ) : (
      <Fragment key={label}>{node}</Fragment>
    );
  return (
    <>
      {wrap("Estado", (
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
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </Chip>
      ))}
      {wrap("Responsable", (
        <Chip label="Responsable" value={f.responsable ?? ""} active={!!f.responsable} onChange={(v) => setParam("responsable", v)}>
          <option value="">Responsable: todos</option>
          <option value="sin">Sin responsable</option>
          {m.owners.map((u) => (
            <option key={u.uid} value={u.uid}>
              {u.displayName}
            </option>
          ))}
        </Chip>
      ))}
      {wrap("Alertas", (
        <Chip label="Alertas" value={f.alerta ?? ""} active={!!f.alerta} onChange={(v) => setParam("alerta", v)}>
          <option value="">Alertas: todas</option>
          {ALERT_FILTERS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </Chip>
      ))}
      {wrap("Etiquetas", (
        <Chip label="Etiquetas" value={f.etiqueta ?? ""} active={!!f.etiqueta} onChange={(v) => setParam("etiqueta", v)}>
          <option value="">Etiquetas: todas</option>
          {TAG_FILTERS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Chip>
      ))}
      {wrap("Etapa", (
        <Chip label="Etapa" value={f.etapa} active={f.etapa !== "activa"} onChange={(v) => setParam("etapa", v === "activa" ? "" : v)}>
          {STAGE_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.value === "activa" ? "Etapa: en consolidación" : s.label}
            </option>
          ))}
        </Chip>
      ))}
      {wrap("Ordenar", (
        <Chip label="Ordenar" value={f.orden} onChange={(v) => setParam("orden", v === "atencion" ? "" : v)}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              Ordenar: {s.label}
            </option>
          ))}
        </Chip>
      ))}
    </>
  );
}

// ---------- Menú de fila (desktop) ----------

function RowMenu({ v }: { v: PersonView }) {
  const m = useMembers();
  const { open } = useMemberActions();
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number; root: HTMLElement } | null>(null);
  const p = v.person;
  const integrated = p.lifecycleStage === "integrante";

  const close = (focus = true) => {
    setPos(null);
    if (focus) btn.current?.focus();
  };

  useLayoutEffect(() => {
    if (pos) menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [pos]);

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onScroll = () => close(false);
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
    if (pos) return close();
    const b = btn.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const root = (b.closest(".fx") as HTMLElement | null) ?? document.body;
    const below = window.innerHeight - r.bottom > 200;
    setPos({ top: below ? r.bottom + 4 : Math.max(8, r.top - 188), right: Math.max(8, window.innerWidth - r.right), root });
  };

  const item = (label: string, Icon: typeof CalendarPlus, onClick: () => void) => (
    <button
      type="button"
      role="menuitem"
      className="fx-menu-item"
      onClick={() => {
        close(false);
        onClick();
      }}
    >
      <Icon size={16} aria-hidden="true" /> {label}
    </button>
  );

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="sx-row-more"
        aria-label={`Acciones para ${p.fullName}`}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        onClick={toggle}
      >
        <Ellipsis size={18} aria-hidden="true" />
      </button>
      {pos &&
        createPortal(
          <div ref={menu} className="fx-menu-list sx-row-menu" role="menu" aria-label={`Acciones para ${p.fullName}`} style={{ top: pos.top, right: pos.right }}>
            {m.canManage && !integrated && item("Registrar visita", CalendarPlus, () => open("visit", p.id))}
            {m.canManage && !integrated && item("Registrar seguimiento", MessageSquarePlus, () => open("followup", p.id))}
            {!p.doNotContact && item("Abrir WhatsApp", MessageCircle, () => m.whatsapp(p))}
            <Link role="menuitem" className="fx-menu-item" href={m.hrefFor(personHref(p.id))} onClick={() => close(false)}>
              <UserRound size={16} aria-hidden="true" /> Ver ficha
            </Link>
          </div>,
          pos.root,
        )}
    </>
  );
}

// ---------- Celdas ----------

/** Alerta principal con ícono + texto ("Sin responsable", "21 días sin volver") y "+n" (16b §9.3). */
function AlertSummary({ v, today }: { v: PersonView; today: string }) {
  const primary = v.attention[0] ?? v.alerts[0];
  if (!primary) return null;
  const vis = ALERT_VIS[primary.type];
  const Icon = vis.icon;
  const others = v.alerts.filter((a) => a.type !== primary.type);
  const text = alertReason(primary, v, today).strong;
  return (
    <span className={`sx-alert-sum sx-ink-${vis.tone}`} title={v.alerts.map((a) => ALERT_LABEL[a.type]).join(", ")}>
      <Icon size={14} aria-hidden="true" />
      <span className="sx-alert-sum-text">{text}</span>
      {others.length > 0 && (
        <>
          <span className="sx-alert-more" aria-hidden="true">
            +{others.length}
          </span>
          <span className="fx-sr">{`. Además: ${others.map((a) => ALERT_LABEL[a.type]).join(", ")}`}</span>
        </>
      )}
    </span>
  );
}

function NextAction({ v, today }: { v: PersonView; today: string }) {
  if (!v.next) return <span className="sx-muted">—</span>;
  return (
    <>
      <span className="fx-cell-main sx-cell-text">{v.next.text}</span>
      {v.next.date &&
        (v.nextOverdue ? (
          <span className="fx-cell-sub sx-overdue">
            <AlarmClock size={12} aria-hidden="true" /> Vencida · {shortDate(v.next.date)}
          </span>
        ) : (
          <span className="fx-cell-sub">{relDay(v.next.date, today)}</span>
        ))}
    </>
  );
}

function Owner({ v }: { v: PersonView }) {
  if (v.ownerValid) return <span className="sx-cell-text">{shortName(v.ownerName)}</span>;
  return (
    <span className="sx-owner-missing" title={v.person.followUpOwnerUid ? `${v.ownerName} ya no tiene acceso` : undefined}>
      <UserX size={13} aria-hidden="true" />
      {v.person.followUpOwnerUid ? "Responsable sin acceso" : "Sin asignar"}
    </span>
  );
}

function PeopleTable({ rows }: { rows: PersonView[] }) {
  const m = useMembers();
  return (
    <div className="sx-people-cq">
      <table className="fx-table fx-table-fixed sx-people-table">
        <caption className="fx-sr">Personas en Consolidación</caption>
        <thead>
          <tr>
            <th scope="col" className="c-name">Nombre</th>
            <th scope="col" className="c-age is-num">Edad</th>
            <th scope="col" className="c-phone">Teléfono</th>
            <th scope="col" className="c-entry">Ingreso</th>
            <th scope="col" className="c-last">Última visita</th>
            <th scope="col" className="c-visits is-num">Visitas</th>
            <th scope="col" className="c-owner">Responsable</th>
            <th scope="col" className="c-status">Estado</th>
            <th scope="col" className="c-next">Próxima acción</th>
            <th scope="col" className="c-actions">
              <span className="fx-sr">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => {
            const p = v.person;
            return (
              <tr key={p.id} data-person={p.id}>
                <td className="c-name">
                  <span className="sx-name-line">
                    <Link href={m.hrefFor(personHref(p.id))} className="sx-person-link sx-cell-text">
                      {p.fullName}
                    </Link>
                  </span>
                  <span className="fx-cell-sub sx-name-sub">
                    <DerivedBadges kinds={v.badges} short />
                    <AlertSummary v={v} today={m.today} />
                    <span className="c-inline-phone fx-num">{v.phone}</span>
                  </span>
                </td>
                <td className="c-age is-num">{v.age === null ? "—" : v.age}</td>
                <td className="c-phone fx-num">{v.phone}</td>
                <td className="c-entry">{shortDate(p.entryDate)}</td>
                <td className="c-last">
                  <span className="fx-cell-main sx-cell-plain">{v.stats.lastVisitDate ? relDay(v.stats.lastVisitDate, m.today) : "—"}</span>
                  <span className="fx-cell-sub c-inline-visits">{plural(v.stats.visitCount, "visita", "visitas")}</span>
                </td>
                <td className="c-visits is-num" data-testid="visit-count">
                  {v.stats.visitCount}
                </td>
                <td className="c-owner">
                  <Owner v={v} />
                </td>
                <td className="c-status">
                  <PersonStatusBadge status={p.consolidationStatus} />
                  <span className="fx-cell-sub c-inline-next">{v.next ? `Próx.: ${v.next.text}` : ""}</span>
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
    <ul className="sx-plist" aria-label="Personas">
      {rows.map((v) => {
        const p = v.person;
        const top = v.attention[0] ?? v.alerts[0];
        const vis = STATUS_VIS[p.consolidationStatus];
        const StatusIcon = vis.icon;
        const AlertI = top ? ALERT_VIS[top.type].icon : null;
        return (
          <li key={p.id} className="sx-prow" data-person={p.id}>
            <Link href={m.hrefFor(personHref(p.id))} className="sx-prow-link">
              <span className="sx-prow-l1">
                <span className="sx-prow-name">{p.fullName}</span>
                <DerivedBadges kinds={v.badges.filter((b) => b !== "no_contactar")} short />
              </span>
              <span className="sx-prow-status">
                <StatusIcon size={16} aria-hidden="true" className={`sx-ink-${vis.tone}`} />
                {STATUS_LABEL[p.consolidationStatus]}
              </span>
              <span className="sx-prow-l2">
                {v.age === null ? "Edad desconocida" : `${v.age} años`} · {plural(v.stats.visitCount, "visita", "visitas")} · llegó {relDay(p.entryDate, m.today)}
              </span>
              {top && AlertI ? (
                <span className={`sx-prow-l3 sx-ink-${ALERT_VIS[top.type].tone}`}>
                  <AlertI size={14} aria-hidden="true" /> {ALERT_LABEL[top.type]}
                  {top.type === "sin_primer_contacto" ? ` · ${agoText(p.entryDate, m.today)}` : ""}
                  {v.alerts.length > 1 ? ` · +${v.alerts.length - 1}` : ""}
                </span>
              ) : v.next ? (
                <span className="sx-prow-l3">
                  Próxima: {v.next.text}
                  {v.next.date ? ` · ${relDay(v.next.date, m.today)}` : ""}
                </span>
              ) : p.doNotContact ? (
                <span className="sx-prow-l3">No contactar</span>
              ) : null}
            </Link>
            <button type="button" className="sx-prow-more" aria-label={`Acciones para ${p.fullName}`} onClick={() => open("actions", p.id)}>
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
  const estado = useQueryParam("estado");
  const f = useFilters();
  const [q, setQ] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const rows = estado === "vacio" ? [] : applyFilters(m, f, q);
  const needing = rows.filter((v) => v.attention.length).length;
  const nFilters = activeCount(f);

  const header = (
    <PageHeader
      title="Personas"
      subtitle="Quienes visitan la iglesia y su acompañamiento."
      actions={
        m.canManage ? (
          <Link href={m.hrefFor(`${C_BASE}/nueva`)} className="fx-btn fx-btn-primary fx-hide-mobile">
            <Plus size={16} aria-hidden="true" /> Nueva persona
          </Link>
        ) : undefined
      }
    />
  );

  let body: React.ReactNode;
  if (estado === "cargando") body = <div className="sx-pad"><SkeletonRows rows={8} h={52} /></div>;
  else if (estado === "error") body = <ErrorState title="No pudimos cargar las personas" onRetry={() => replaceQueryParam("estado", null)} />;
  else if (estado === "vacio")
    body = (
      <EmptyState
        icon={Users}
        title="Aún no hay personas en Consolidación"
        body="Registra a quienes visitan la iglesia por primera vez."
        action={
          m.canManage ? (
            <Link href={m.hrefFor(`${C_BASE}/nueva`)} className="fx-btn fx-btn-primary">
              <Plus size={16} aria-hidden="true" /> Nueva persona
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
          <button type="button" className="fx-btn fx-btn-secondary" onClick={() => setQ("")}>
            Limpiar búsqueda
          </button>
        }
      />
    ) : (
      <EmptyState
        icon={SlidersHorizontal}
        title="Ninguna persona coincide con estos filtros."
        action={
          <button type="button" className="fx-btn fx-btn-secondary" onClick={clearFilters}>
            Limpiar filtros
          </button>
        }
      />
    );
  else
    body = (
      <>
        <div className="sx-people-desktop">
          <PeopleTable rows={rows} />
        </div>
        <div className="sx-people-mobile">
          <PeopleList rows={rows} />
        </div>
      </>
    );

  return (
    <>
      {header}
      <section className="fx-panel fx-panel-flush sx-people-panel" aria-label="Lista de personas">
        <div className="fx-toolbar sx-people-toolbar">
          <label className="fx-search sx-people-search">
            <Search size={16} aria-hidden="true" />
            <span className="fx-sr">Buscar nombre, teléfono o correo</span>
            <input className="fx-input" type="search" placeholder="Buscar nombre, teléfono o correo" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="sx-people-chips">
            <FilterControls f={f} />
          </div>
          <button type="button" className="fx-btn fx-btn-secondary sx-filters-btn" onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal size={16} aria-hidden="true" /> Filtros{nFilters ? ` (${nFilters})` : ""}
          </button>
        </div>
        {estado !== "cargando" && estado !== "error" && (
          <div className="sx-people-count">
            <span>
              <strong>{plural(rows.length, "persona", "personas")}</strong>
              {needing ? ` · ${plural(needing, "necesita", "necesitan")} atención` : ""}
            </span>
            {nFilters > 0 && (
              <button type="button" className="fx-toggle" onClick={clearFilters}>
                <X size={14} aria-hidden="true" /> Limpiar filtros
              </button>
            )}
          </div>
        )}
        {body}
      </section>
      <p className="fx-help sx-page-note">Datos personales de uso pastoral. Solo los ve el equipo de Consolidación.</p>

      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        labelId="sx-people-filters"
        title="Filtros"
        footer={
          <>
            <button type="button" className="fx-btn fx-btn-secondary" onClick={clearFilters}>
              Limpiar
            </button>
            <button type="button" className="fx-btn fx-btn-primary" onClick={() => setFiltersOpen(false)}>
              Ver {plural(rows.length, "persona", "personas")}
            </button>
          </>
        }
      >
        <div className="fx-filter-stack">
          <FilterControls f={f} stacked />
        </div>
      </Sheet>
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

