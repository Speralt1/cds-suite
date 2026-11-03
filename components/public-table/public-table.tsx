"use client";

// Mesa pública de «Ve por los tuyos» (doc 40 · H4). Página sin login ni shell:
// el enlace `/mesa#<edición>.<mesa>.<token>` se lee del fragmento en un efecto,
// se quita de la barra/historial (replaceState) y el token vive solo en memoria
// (sessionStorage únicamente para sobrevivir a un refresco; se borra al revocarse).
// No importa preferencias ni shell privado (tests/public-table). Nunca muestra
// teléfonos ni correos: la callable solo devuelve nombre, mesa y marca.

import { useCallback, useEffect, useRef, useState } from "react";
import { AleroMark } from "@/components/layout/alero-mark";
import {
  TABLE_SESSION_KEY,
  TableOpError,
  newRequestId,
  parseTableLink,
  tableAddWalkIn,
  tableLinkFromLocation,
  tableListMine,
  tableMark,
  tableSearch,
  tableUnmark,
  type TableLink,
  type TableWindow,
} from "@/lib/outreach/table-client";
import { TABLE_MARKS, TABLE_MARK_LABEL, type TableMark, type TableRow } from "@/lib/shared/outreach-tables";

export const SEARCH_DEBOUNCE_MS = 300;

type Fatal = "unavailable" | "revoked" | "outside-window";
type Action =
  | { type: "mark"; requestId: string; row: TableRow; mark: TableMark; moveHere: boolean }
  | { type: "unmark"; requestId: string; id: string; fullName: string }
  | { type: "add"; requestId: string; fullName: string; phone: string };
interface Marked {
  id: string;
  fullName: string;
  mark: TableMark;
}

export const FATAL_TEXT: Record<Fatal, { title: string; body: string }> = {
  unavailable: { title: "Este enlace no está disponible", body: "Revisa que hayas abierto el enlace completo o pídele uno nuevo a quien coordina." },
  revoked: { title: "Este enlace fue desactivado", body: "Pídele a quien coordina un enlace nuevo para tu mesa." },
  "outside-window": {
    title: "Todavía no es la hora (o ya terminó)",
    body: "El enlace de la mesa se abre a las 16:00 del día del evento y vence a las 02:00 de la madrugada siguiente. Vuelve a abrirlo en ese horario.",
  },
};

/** «2026-11-28T16:00» → «28-11-2026 a las 16:00». */
export function fmtLocal(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(v);
  return m ? `${m[3]}-${m[2]}-${m[1]} a las ${m[4]}` : v;
}

function readSession(): string | null {
  try {
    return window.sessionStorage.getItem(TABLE_SESSION_KEY);
  } catch {
    return null;
  }
}
function writeSession(value: string | null) {
  try {
    if (value) window.sessionStorage.setItem(TABLE_SESSION_KEY, value);
    else window.sessionStorage.removeItem(TABLE_SESSION_KEY);
  } catch {
    /* sin almacenamiento: el enlace solo vive en memoria */
  }
}

export function PublicTable() {
  const [ready, setReady] = useState(false);
  const [link, setLink] = useState<TableLink | null>(null);
  const [fatal, setFatal] = useState<Fatal | null>(null);
  const [windowInfo, setWindowInfo] = useState<TableWindow | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TableRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<TableRow | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [moveOk, setMoveOk] = useState(false);
  const [marked, setMarked] = useState<Marked[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Action | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const seq = useRef(0);

  // Lectura del enlace: fragmento → memoria; el fragmento se borra del historial.
  useEffect(() => {
    const take = () => {
      const fromHash = tableLinkFromLocation(window.location);
      const hadHash = window.location.hash.length > 1;
      if (hadHash) {
        try {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        } catch {
          /* ignore */
        }
      }
      const found = fromHash ?? (hadHash ? null : parseTableLink(readSession()));
      if (found) writeSession(`${found.editionId}.${found.table}.${found.token}`);
      else if (hadHash) writeSession(null);
      setLink(found);
      setFatal(found ? null : "unavailable");
      setReady(true);
    };
    take();
    const onHash = () => take();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const fail = useCallback((e: unknown, action?: Action): void => {
    if (!(e instanceof TableOpError)) {
      setNotice("No pudimos completar la acción. Inténtalo de nuevo.");
      return;
    }
    switch (e.kind) {
      case "unavailable":
      case "revoked":
        writeSession(null);
        setLink(null);
        setFatal(e.kind);
        break;
      case "outside-window":
        setWindowInfo(e.window ?? null);
        setFatal("outside-window");
        break;
      case "network":
        if (action) setPending(action);
        setNotice(action ? "Sin conexión. Tu acción quedó guardada: reintenta cuando tengas señal." : "Sin conexión. Reintenta cuando tengas señal.");
        break;
      case "rate-limited":
        if (action) setPending(action);
        setNotice("Demasiadas acciones seguidas. Espera un minuto y reintenta.");
        break;
      case "other-table":
        if (action?.type === "mark") {
          setSelected({ ...action.row, tableNumber: e.otherTable ?? action.row.tableNumber });
          setMoveOk(false);
          setNotice(null);
        }
        break;
      default:
        setNotice("No se pudo registrar. Revisa los datos o avisa a quien coordina.");
    }
  }, []);

  // Carga de «Marcadas en esta mesa» (al abrir y tras cada marca/deshacer): sobrevive a recargas.
  const loadMarked = useCallback(
    async (l: TableLink) => {
      try {
        const out = await tableListMine(l);
        setMarked(out.items);
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );
  useEffect(() => {
    if (link && !fatal) void loadMarked(link);
  }, [link, fatal, loadMarked]);

  // Búsqueda con debounce.
  useEffect(() => {
    if (!link || fatal) return;
    const q = query.trim();
    const mine = ++seq.current;
    if (q.length < 3) return;
    const t = setTimeout(() => {
      setSearching(true);
      tableSearch(link, q)
        .then((rows) => {
          if (mine !== seq.current) return;
          setResults(rows);
          setSearched(true);
        })
        .catch((e) => {
          if (mine === seq.current) fail(e);
        })
        .finally(() => {
          if (mine === seq.current) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, link, fatal, fail]);

  const pick = (row: TableRow) => {
    setSelected(row);
    setAgreed(false);
    setMoveOk(false);
    setNotice(null);
  };
  const resetSelection = () => {
    setSelected(null);
    setAgreed(false);
    setMoveOk(false);
    setQuery("");
    setResults([]);
    setSearched(false);
  };

  const run = useCallback(
    async (action: Action) => {
      if (!link) return;
      setBusy(true);
      setNotice(null);
      try {
        if (action.type === "mark") {
          await tableMark(link, { registrationId: action.row.id, mark: action.mark, personAgreed: true, moveHere: action.moveHere, requestId: action.requestId });
          setMarked((list) => [{ id: action.row.id, fullName: action.row.fullName, mark: action.mark }, ...list.filter((m) => m.id !== action.row.id)]);
          resetSelection();
          void loadMarked(link);
        } else if (action.type === "unmark") {
          await tableUnmark(link, { registrationId: action.id, requestId: action.requestId });
          setMarked((list) => list.filter((m) => m.id !== action.id));
          void loadMarked(link);
        } else {
          const out = await tableAddWalkIn(link, { fullName: action.fullName, phone: action.phone, requestId: action.requestId });
          setAdding(false);
          setNewName("");
          setNewPhone("");
          if (out.row) pick(out.row);
          setNotice(`${action.fullName} quedó agregada a esta mesa. Ahora puedes marcarla.`);
        }
        setPending(null);
      } catch (e) {
        fail(e, action);
      } finally {
        setBusy(false);
      }
    },
    [link, fail, loadMarked],
  );

  if (!ready) {
    return (
      <main className="pt-root">
        <p className="pt-small" role="status">
          Cargando…
        </p>
      </main>
    );
  }

  const header = (
    <header className="pt-header">
      <span className="pt-mark">
        <AleroMark className="pt-mark-icon" />
      </span>
      <div>
        <h1 className="pt-title">{link ? `Mesa ${link.table}` : "Mesa"} · Ve por los tuyos</h1>
        <p className="pt-small">Casa de Salvación</p>
      </div>
    </header>
  );

  if (fatal || !link) {
    const t = FATAL_TEXT[fatal ?? "unavailable"];
    const exact = fatal === "outside-window" && windowInfo ? `Abre ${fmtLocal(windowInfo.opensAt)} y vence ${fmtLocal(windowInfo.closesAt)}.` : null;
    return (
      <main className="pt-root">
        {header}
        <section className="pt-card" role="alert">
          <h2 className="pt-name">{t.title}</h2>
          <p className="pt-small">{t.body}</p>
          {exact && <p className="pt-small">{exact}</p>}
        </section>
      </main>
    );
  }

  const shown = query.trim().length >= 3;
  const other = selected && selected.tableNumber != null && selected.tableNumber !== link.table;
  const canMark = agreed && (!other || moveOk) && !busy;

  return (
    <main className="pt-root">
      {header}
      <p className="pt-small">Sin usuario ni contraseña. Este enlace vale desde las 16:00 del día del evento hasta las 02:00 de la madrugada.</p>

      {notice && (
        <div className="pt-notice" role="status">
          <span>{notice}</span>
          {pending && (
            <button type="button" className="pt-btn pt-btn-secondary" disabled={busy} onClick={() => run(pending)}>
              Reintentar
            </button>
          )}
        </div>
      )}

      <label className="pt-search">
        <span>Busca por el código de la entrada o por el nombre</span>
        <input
          className="pt-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
          }}
          placeholder="VP042 o «Marta Ro…»"
          autoComplete="off"
          inputMode="search"
          aria-label="Buscar persona"
        />
      </label>
      {shown && searching && (
        <p className="pt-small" role="status">
          Buscando…
        </p>
      )}
      {shown && !searching && searched && results.length === 0 && (
        <p className="pt-small">Sin resultados. Escribe al menos 3 letras o el código completo.</p>
      )}
      {shown && results.length > 0 && !selected && (
        <ul className="pt-people" aria-label="Resultados">
          {results.map((r) => (
            <li key={r.id}>
              <div>
                <p className="pt-name">{r.fullName}</p>
                <p className="pt-meta">
                  {r.tableNumber ? `Mesa ${r.tableNumber}` : "Sin mesa"}
                  {r.mark && ` · ${TABLE_MARK_LABEL[r.mark]}`}
                </p>
              </div>
              <button type="button" className="pt-btn pt-btn-secondary" onClick={() => pick(r)}>
                Elegir
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <section className="pt-card" aria-labelledby="pt-sel">
          <h2 id="pt-sel" className="pt-name">
            {selected.fullName}
          </h2>
          {other && (
            <div className="pt-warn">
              <p>
                Figura en la mesa {selected.tableNumber}; ¿está sentada aquí?
              </p>
              <button type="button" className="pt-btn pt-btn-secondary" aria-pressed={moveOk} onClick={() => setMoveOk(true)}>
                {moveOk ? "Sí, está sentada aquí" : "Sí, está aquí"}
              </button>
            </div>
          )}
          <label className={`pt-agree${agreed ? " is-on" : ""}`}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            ¿Te podemos anotar para acompañarte? · Dijo que sí
          </label>
          <div className="pt-actions">
            {TABLE_MARKS.map((m) => (
              <button
                key={m}
                type="button"
                className={`pt-btn ${m === "acepto_a_cristo" ? "pt-btn-primary" : "pt-btn-secondary"}`}
                disabled={!canMark}
                onClick={() => run({ type: "mark", requestId: newRequestId(), row: selected, mark: m, moveHere: !!other })}
              >
                {TABLE_MARK_LABEL[m]}
              </button>
            ))}
          </div>
          <button type="button" className="pt-link" onClick={() => setSelected(null)}>
            Cancelar
          </button>
        </section>
      )}

      <section aria-labelledby="pt-marked">
        <h2 id="pt-marked" className="pt-group">
          Marcadas en esta mesa <span>{marked.length}</span>
        </h2>
        {marked.length === 0 ? (
          <p className="pt-small">Aún no hay marcas. Busca a la persona y elige lo que expresó.</p>
        ) : (
          <ul className="pt-people">
            {marked.map((m) => (
              <li key={m.id}>
                <div>
                  <p className="pt-name">{m.fullName}</p>
                  <p className="pt-meta">{TABLE_MARK_LABEL[m.mark]}</p>
                </div>
                <button
                  type="button"
                  className="pt-link"
                  disabled={busy}
                  aria-label={`Deshacer marca de ${m.fullName}`}
                  onClick={() => run({ type: "unmark", requestId: newRequestId(), id: m.id, fullName: m.fullName })}
                >
                  Deshacer
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {adding ? (
        <section className="pt-card" aria-labelledby="pt-add">
          <h2 id="pt-add" className="pt-name">
            Llegó sin inscripción
          </h2>
          <label className="pt-field">
            Nombre y apellido
            <input className="pt-input" value={newName} onChange={(e) => setNewName(e.target.value)} autoComplete="off" />
          </label>
          <label className="pt-field">
            Teléfono
            <input className="pt-input" inputMode="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="9 1234 5678" autoComplete="off" />
          </label>
          <div className="pt-actions">
            <button
              type="button"
              className="pt-btn pt-btn-primary"
              disabled={busy || newName.trim().length < 3 || newPhone.trim().length < 8}
              onClick={() => run({ type: "add", requestId: newRequestId(), fullName: newName.trim(), phone: newPhone.trim() })}
            >
              Agregar a esta mesa
            </button>
            <button type="button" className="pt-btn pt-btn-secondary" onClick={() => setAdding(false)}>
              Cancelar
            </button>
          </div>
        </section>
      ) : (
        <button type="button" className="pt-btn pt-btn-secondary pt-wide" onClick={() => setAdding(true)}>
          Agregar a alguien sin inscripción
        </button>
      )}
      <p className="pt-small">Desde aquí no se ven teléfonos ni la lista completa. Cada marca queda con el número de mesa y la hora.</p>
    </main>
  );
}
