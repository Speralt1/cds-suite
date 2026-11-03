"use client";

// Mesas y enlaces (coordinación): encargados por mesa y enlace de recepción de la mesa.
// El enlace completo se muestra UNA sola vez (el servidor guarda solo su hash).
import { useState } from "react";
import { Copy, Share2 } from "lucide-react";
import * as api from "@/lib/outreach/client";
import { isReadOnly } from "@/lib/outreach/model";
import { Done, ErrorNote, Loading, useAction, useLoad } from "./ui";

interface Issued {
  table: number;
  url: string;
  window: { opensAt: string; closesAt: string } | null;
}

export default function TablesView({ edition }: { edition: api.EditionSummary }) {
  const data = useLoad(async () => ({ tables: await api.tablesList(edition.id), team: await api.teamCandidates(edition.id) }), [edition.id]);
  const act = useAction();
  const [leaders, setLeaders] = useState<Record<number, string>>({});
  const [extra, setExtra] = useState<number[]>([]);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const closed = isReadOnly({ status: edition.status });

  const numbers = [...new Set([...(data.data?.tables.map((t) => t.number) ?? []), ...extra])].sort((a, b) => a - b);
  const infoOf = (n: number) => data.data?.tables.find((t) => t.number === n);
  const leaderOf = (n: number) => (n in leaders ? leaders[n] : (infoOf(n)?.leaderUid ?? ""));

  const save = async () => {
    const ok = await act.run(() => api.tablesSet(edition.id, numbers.map((n) => ({ number: n, ...(leaderOf(n) ? { leaderUid: leaderOf(n) } : {}) }))));
    if (ok) {
      setSaved(true);
      setLeaders({});
      setExtra([]);
      data.reload();
    }
  };
  const issue = async (n: number) => {
    setCopied(false);
    const res = await act.run(() => api.tableLinkIssue(edition.id, n));
    if (res?.token) {
      setIssued({ table: n, url: api.tableLinkUrl(window.location.origin, edition.id, n, res.token), window: res.window });
      data.reload();
    }
  };
  const revoke = async (n: number) => {
    const ok = await act.run(() => api.tableLinkRevoke(edition.id, n));
    setRevoking(null);
    if (ok) data.reload();
  };
  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const share = () => {
    if (issued && typeof navigator.share === "function") void navigator.share({ title: `Mesa ${issued.table}`, url: issued.url }).catch(() => undefined);
  };

  return (
    <div className="vp-list-wrap">
      {issued && (
        <section className="vp-card vp-narrow" aria-labelledby="vp-l-link">
          <div className="vp-card-head">
            <h3 id="vp-l-link">Enlace de la mesa {issued.table}</h3>
            <p>Entrégaselo solo al encargado de la mesa.</p>
          </div>
          <p className="vp-error" role="note">
            Este enlace se muestra una sola vez. Si lo pierdes, tendrás que crear uno nuevo (el anterior deja de servir).
          </p>
          <input className="form-input" readOnly aria-label="Enlace de la mesa" value={issued.url} onFocus={(e) => e.currentTarget.select()} />
          {issued.window && <p className="vp-small">Funciona durante el evento ({issued.window.opensAt.replace("T", " ")} a {issued.window.closesAt.replace("T", " ")}).</p>}
          <div className="vp-actions">
            <button type="button" className="button-primary" onClick={() => void copy()}>
              <Copy size={16} aria-hidden="true" /> Copiar enlace
            </button>
            {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
              <button type="button" className="button-secondary" onClick={share}>
                <Share2 size={16} aria-hidden="true" /> Compartir
              </button>
            )}
            <button type="button" className="button-secondary" onClick={() => setIssued(null)}>
              Listo, ya lo guardé
            </button>
          </div>
          {copied && <Done>Enlace copiado.</Done>}
        </section>
      )}

      <section className="vp-card" aria-labelledby="vp-l-tab">
        <div className="vp-card-head">
          <h3 id="vp-l-tab">Mesas y enlaces</h3>
          <p>Cada mesa tiene un encargado y un enlace para marcar a las personas en el evento.</p>
        </div>
        {data.loading && !data.data && <Loading />}
        {data.error && <ErrorNote message={data.error} onRetry={data.reload} />}
        {act.error && <ErrorNote message={act.error} />}
        {saved && <Done>Mesas guardadas.</Done>}
        {data.data && numbers.length === 0 && <p className="vp-small">Aún no hay mesas. Agrega la primera.</p>}
        <ul className="vp-people">
          {numbers.map((n) => {
            const info = infoOf(n);
            return (
              <li key={n}>
                <div className="vp-person">
                  <p className="vp-person-name">Mesa {n}</p>
                  <p className="vp-person-meta">{info?.linkRevoked ? "Enlace revocado" : info?.hasLink ? "Enlace activo" : "Sin enlace"}</p>
                  <label className="vp-as">
                    <span>Encargado de la mesa {n}</span>
                    <select value={leaderOf(n)} disabled={closed} onChange={(e) => { setSaved(false); setLeaders((l) => ({ ...l, [n]: e.target.value })); }}>
                      <option value="">Sin encargado</option>
                      {data.data?.team.map((c) => (
                        <option key={c.uid} value={c.uid}>
                          {c.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {!closed && info && (
                  <div className="vp-actions">
                    <button type="button" className="button-secondary vp-row-cta" disabled={act.busy} onClick={() => void issue(n)}>
                      {info.hasLink && !info.linkRevoked ? `Crear enlace nuevo de la mesa ${n}` : `Crear enlace de la mesa ${n}`}
                    </button>
                    {info.hasLink && !info.linkRevoked &&
                      (revoking === n ? (
                        <button type="button" className="button-secondary vp-row-cta" disabled={act.busy} onClick={() => void revoke(n)}>
                          Confirmar: revocar mesa {n}
                        </button>
                      ) : (
                        <button type="button" className="button-secondary vp-row-cta" onClick={() => setRevoking(n)}>
                          Revocar enlace de la mesa {n}
                        </button>
                      ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {!closed && (
          <div className="vp-actions">
            <button type="button" className="button-primary" disabled={act.busy || numbers.length === 0} onClick={() => void save()}>
              Guardar mesas
            </button>
            <button type="button" className="button-secondary" onClick={() => setExtra((e) => [...e, (numbers[numbers.length - 1] ?? 0) + 1])}>
              Agregar mesa
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
