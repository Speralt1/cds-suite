"use client";

// /calendario/compartir (solo manage_all, 18b §2.4 + 18 §10 R4): administra el
// enlace público sobre el callable `calendarShareLinkManage`.
// Estados: A nunca creado · B recién creado o generado (el enlace completo se
// muestra UNA vez, solo en memoria) · C activo (sin el enlace) · D desactivado
// ("Activar" vuelve a habilitar el MISMO enlace; "Generar enlace nuevo" rota).

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, Ban, Check, CircleCheck, CircleSlash, Copy, Power, RefreshCw, Share2, ShieldAlert } from "lucide-react";
import { useAccessModel } from "@/lib/access/model";
import { calendarErrorKind } from "@/lib/calendar/errors";
import { publicCalendarUrl } from "@/lib/calendar/public-feed-client";
import { manageShareLink, shareErrorMessage, type ShareLinkAction, type ShareLinkStatus } from "@/lib/calendar/share-client";
import { useToast } from "@/components/layout/notice";
import { ConfirmDialog } from "./event-dialogs";
import { storedDate } from "./labels";
import { CalBadge, EmptyState, ErrorState, InlineNotice, PageHeader, Skeleton } from "./ui";

const PUBLISHED = [
  "Solo actividades marcadas como Pública",
  "Título, fecha y hora",
  "Lugar",
  "Descripción pública",
  "Área responsable y áreas participantes",
  "«Cancelada», sin el motivo",
];
const NEVER = [
  "Actividades «Solo equipo»",
  "Notas internas y motivos",
  "Nombres y correos de usuarios",
  "Información financiera",
  "Actividades eliminadas",
];

type Confirm = "none" | "regenerate" | "deactivate" | "finish";

const GENERATE_FAILED = "No pudimos generar el enlace. Revisa tu conexión e inténtalo de nuevo.";
const COPY_FAILED = "No pudimos copiar automáticamente. El enlace quedó seleccionado: cópialo con Ctrl+C o mantén presionado para copiar.";

function actionError(action: ShareLinkAction, error: unknown): string {
  if (calendarErrorKind(error) === "network") {
    if (action === "create") return GENERATE_FAILED;
    if (action === "regenerate") return `${GENERATE_FAILED} El enlace anterior sigue funcionando.`;
  }
  return shareErrorMessage(error);
}

export function ShareAdminScreen() {
  const access = useAccessModel();
  const header = <PageHeader title="Compartir calendario" subtitle="Un enlace de solo lectura con las actividades públicas." />;
  if (!access.can("calendar.events.manage_all"))
    return (
      <div className="cal-screen cal-share">
        {header}
        <div className="panel">
          <EmptyState
            icon={ShieldAlert}
            title="No tienes acceso a esta sección"
            body="Solo Pastor o Administración administran el enlace compartido."
          />
        </div>
      </div>
    );
  return <ShareAdmin header={header} />;
}

function ShareAdmin({ header }: { header: React.ReactNode }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<ShareLinkStatus | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  /** Enlace en claro: solo en memoria, solo tras crear o generar (estado B). */
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [everCopied, setEverCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [busy, setBusy] = useState<ShareLinkAction | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<Confirm>("none");
  const inputRef = useRef<HTMLInputElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ids = useId();

  useEffect(() => {
    let alive = true;
    manageShareLink("status")
      .then((r) => {
        if (!alive) return;
        setStatus(r.status);
        setLoadError("");
      })
      .catch((e) => {
        if (alive) setLoadError(shareErrorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [loadAttempt]);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const run = useCallback(
    async (action: ShareLinkAction, message?: string) => {
      setBusy(action);
      setError("");
      try {
        const result = await manageShareLink(action);
        setStatus(result.status);
        if (result.token) {
          setFreshUrl(publicCalendarUrl(result.token));
          setCopied(false);
          setEverCopied(false);
          setCopyError("");
        } else if (action === "deactivate") setFreshUrl(null);
        if (message) toast(message);
        setConfirm("none");
      } catch (e) {
        setError(actionError(action, e));
        setConfirm("none");
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  const copy = async () => {
    if (!freshUrl) return;
    setCopyError("");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard");
      await navigator.clipboard.writeText(freshUrl);
      setCopied(true);
      setEverCopied(true);
      toast("Enlace copiado.");
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(COPY_FAILED);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };

  const finish = () => {
    setFreshUrl(null);
    setConfirm("none");
  };

  let panel: React.ReactNode;
  if (loadError) {
    panel = <ErrorState title="No pudimos cargar el estado del enlace." body={loadError} onRetry={() => setLoadAttempt((n) => n + 1)} />;
  } else if (!status) {
    panel = (
      <div role="status" aria-live="polite">
        <span className="cal-sr">Cargando el estado del enlace…</span>
        <div aria-hidden="true">
          <Skeleton h={22} w={160} />
          <Skeleton h={40} style={{ marginTop: 16 }} />
          <Skeleton h={18} w={220} style={{ marginTop: 16 }} />
        </div>
      </div>
    );
  } else if (freshUrl && status.active) {
    // B. Recién creado o generado.
    panel = (
      <div className="cal-share-fresh">
        <InlineNotice tone="success" icon={CircleCheck}>
          <strong>Enlace listo. Cópialo ahora: por seguridad no lo volveremos a mostrar.</strong>
        </InlineNotice>
        <div className="cal-share-field">
          <label htmlFor={`${ids}-url`} className="cal-sr">
            Enlace del calendario compartido
          </label>
          <input
            ref={inputRef}
            id={`${ids}-url`}
            className="cal-input cal-share-url"
            readOnly
            value={freshUrl}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" className="button-primary" onClick={copy}>
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {copied ? "Copiado" : "Copiar enlace"}
          </button>
        </div>
        {copyError && (
          <InlineNotice tone="warning" icon={CircleSlash} role="alert">
            {copyError}
          </InlineNotice>
        )}
        <a href={freshUrl} target="_blank" rel="noreferrer" className="cal-link cal-share-open">
          Abrir vista pública <ArrowUpRight size={14} aria-hidden="true" />
        </a>
        <p className="cal-help">Si cierras o recargas esta página, tendrás que generar un enlace nuevo para volver a copiarlo.</p>
        <div className="cal-share-actions">
          <button type="button" className="button-ghost" onClick={() => (everCopied ? finish() : setConfirm("finish"))}>
            Listo
          </button>
        </div>
      </div>
    );
  } else if (!status.exists) {
    // A. Nunca creado.
    panel = (
      <EmptyState
        icon={Share2}
        title="Aún no hay un enlace para compartir"
        body="Crea un enlace de solo lectura con las actividades públicas."
        action={
          <button type="button" className="button-primary" disabled={!!busy} onClick={() => run("create")}>
            {busy === "create" ? "Creando…" : "Crear enlace"}
          </button>
        }
      />
    );
  } else if (status.active) {
    // C. Activo (el enlace ya no se puede mostrar).
    const since = status.regeneratedAt ?? status.createdAt;
    panel = (
      <div className="cal-share-state">
        <div className="cal-share-status">
          <CalBadge icon={CircleCheck} text="Activo" tone="success" />
          <span className="cal-share-status-text">
            Enlace activo{storedDate(since) ? ` · ${status.regeneratedAt ? "generado" : "creado"} el ${storedDate(since)}` : ""}
          </span>
        </div>
        <p className="cal-help-13">
          Por seguridad, el enlace solo se muestra al crearlo. Si necesitas compartirlo otra vez, genera uno nuevo: el anterior dejará de
          funcionar.
        </p>
        <div className="cal-share-actions">
          <button type="button" className="button-secondary" disabled={!!busy} onClick={() => setConfirm("regenerate")}>
            <RefreshCw size={16} aria-hidden="true" /> Generar enlace nuevo
          </button>
          <button type="button" className="button-ghost cal-btn-danger-ghost" disabled={!!busy} onClick={() => setConfirm("deactivate")}>
            <Power size={16} aria-hidden="true" /> Desactivar enlace
          </button>
        </div>
      </div>
    );
  } else {
    // D. Desactivado: Activar vuelve a habilitar el MISMO enlace (R4).
    panel = (
      <div className="cal-share-state">
        <div className="cal-share-status">
          <CalBadge icon={Ban} text="Desactivado" tone="neutral" />
          <span className="cal-share-status-text">
            {storedDate(status.disabledAt) ? `Desactivado el ${storedDate(status.disabledAt)}` : "Desactivado"}
          </span>
        </div>
        <p className="cal-help-13">
          Nadie puede ver el calendario compartido. Al activarlo, vuelve a funcionar el mismo enlace que ya compartiste. Si el enlace llegó a
          quien no debía, genera uno nuevo: el anterior dejará de funcionar.
        </p>
        <div className="cal-share-actions">
          <button type="button" className="button-primary" disabled={!!busy} onClick={() => run("activate", "Enlace activado.")}>
            <Power size={16} aria-hidden="true" /> {busy === "activate" ? "Activando…" : "Activar"}
          </button>
          <button type="button" className="button-secondary" disabled={!!busy} onClick={() => setConfirm("regenerate")}>
            <RefreshCw size={16} aria-hidden="true" /> Generar enlace nuevo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="cal-screen cal-share">
      {header}
      <section className="panel cal-share-panel" aria-labelledby={`${ids}-title`}>
        <h3 className="cal-h3" id={`${ids}-title`}>
          Enlace
        </h3>
        {error && (
          <InlineNotice tone="danger" icon={CircleSlash} role="alert">
            {error}
          </InlineNotice>
        )}
        {panel}
      </section>

      <div className="cal-share-lists">
        <section className="panel" aria-labelledby={`${ids}-yes`}>
          <h3 className="cal-h3" id={`${ids}-yes`}>
            Qué se publica
          </h3>
          <ul className="cal-share-list">
            {PUBLISHED.map((t) => (
              <li key={t}>
                <CircleCheck size={16} className="cal-share-yes" aria-hidden="true" /> {t}
              </li>
            ))}
          </ul>
        </section>
        <section className="panel" aria-labelledby={`${ids}-no`}>
          <h3 className="cal-h3" id={`${ids}-no`}>
            Qué nunca se publica
          </h3>
          <ul className="cal-share-list">
            {NEVER.map((t) => (
              <li key={t}>
                <CircleSlash size={16} className="cal-share-no" aria-hidden="true" /> {t}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {confirm === "regenerate" && (
        <ConfirmDialog
          onClose={() => setConfirm("none")}
          busy={busy === "regenerate"}
          title="¿Generar un enlace nuevo?"
          body="El enlace actual dejará de funcionar de inmediato. Quienes lo tengan verán «Este calendario no está disponible». El enlace nuevo se mostrará una sola vez para que lo copies."
          confirmLabel={busy === "regenerate" ? "Generando…" : "Generar enlace nuevo"}
          onConfirm={() => run("regenerate")}
        />
      )}
      {confirm === "deactivate" && (
        <ConfirmDialog
          onClose={() => setConfirm("none")}
          busy={busy === "deactivate"}
          title="¿Desactivar el enlace?"
          body="Nadie podrá ver el calendario compartido hasta que lo actives. Al activarlo, volverá a funcionar el mismo enlace."
          confirmLabel={busy === "deactivate" ? "Desactivando…" : "Desactivar"}
          destructive
          onConfirm={() => run("deactivate", "Enlace desactivado.")}
        />
      )}
      {confirm === "finish" && (
        <ConfirmDialog
          onClose={() => setConfirm("none")}
          title="¿Terminar sin copiar el enlace?"
          body="El enlace queda activo, pero no podrás verlo de nuevo. Para compartirlo tendrás que generar uno nuevo."
          confirmLabel="Terminar"
          onConfirm={finish}
        />
      )}
    </div>
  );
}
