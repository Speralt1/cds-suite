"use client";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  collection,
  documentId,
  getDocs,
  query as firestoreQuery,
  where,
  orderBy,
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef } from "firebase/storage";
import { Ban } from "lucide-react";
import { getFirebaseServices } from "@/lib/firebase";
import { useAccess } from "@/lib/auth/access-provider";
import { canSeePastoral } from "@/lib/finance/permissions";
import { useCollection, useDocument } from "@/lib/finance/hooks";
import { useLatestAttribution } from "@/lib/finance/tithe-hooks";
import { groupAttributionsByMonth, titheAggregates } from "@/lib/finance/insights";
import {
  clp,
  dateLabel,
  parseDate,
  periodId,
  today,
} from "@/lib/finance/formatters";
import { MONTHS, MAX_PERIOD_RECORDS } from "@/lib/finance/constants";
import { PAYMENT_METHODS } from "@/lib/finance/constants";
import { safeLimit } from "@/lib/finance/query-limit";
import type { TitheProfile, TitheAttribution } from "@/lib/finance/types";
import { DetailGuard, Loading, Empty, Notice } from "../shared";
import { ProfileForm } from "../forms/profile-form";
import { TitheRegister } from "./tithe-register";
import { PastoralPanel } from "./pastoral-panel";
import { EvolutionChart } from "../charts/finance-charts";

const CURRENT_YEAR = new Date().getFullYear();
const FIRST_YEAR = 2024;

// Method comes from a batched read of financeTransactions, limited to the
// attribution rows currently rendered (§C3): up to 30 ids per
// documentId()-"in" query.
function useTransactionMethods(ids: string[]) {
  const key = [...new Set(ids)].sort().join(",");
  const [state, setState] = useState<{ key: string; map: Record<string, string> }>({
    key: "",
    map: {},
  });
  useEffect(() => {
    if (!key) return;
    let active = true;
    const uniqueIds = key.split(",");
    (async () => {
      const db = getFirebaseServices().db;
      const map: Record<string, string> = {};
      for (let i = 0; i < uniqueIds.length; i += 30) {
        const chunk = uniqueIds.slice(i, i + 30);
        const snapshot = await getDocs(
          firestoreQuery(collection(db, "financeTransactions"), where(documentId(), "in", chunk)),
        );
        snapshot.docs.forEach((doc) => {
          map[doc.id] = (doc.data() as { paymentMethod?: string }).paymentMethod || "";
        });
      }
      if (active) setState({ key, map });
    })().catch(() => {
      if (active) setState({ key, map: {} });
    });
    return () => {
      active = false;
    };
  }, [key]);
  return key ? (state.key === key ? state.map : {}) : {};
}

function ReceiptCell({ transactionId }: { transactionId: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "missing">("idle");
  async function open() {
    if (status === "loading") return;
    setStatus("loading");
    try {
      const url = await getDownloadURL(
        storageRef(getFirebaseServices().storage, `tithe-receipts/${transactionId}/receipt`),
      );
      window.open(url, "_blank", "noopener,noreferrer");
      setStatus("idle");
    } catch {
      setStatus("missing");
    }
  }
  if (status === "missing")
    return <span className="field-help">Sin comprobante</span>;
  return (
    <button
      type="button"
      className="button-secondary receipt-button"
      onClick={open}
      disabled={status === "loading"}
    >
      {status === "loading" ? "Abriendo…" : "Ver comprobante"}
    </button>
  );
}
export function ProfilePage({ id }: { id: string }) {
  return (
    <DetailGuard>
      <Profile id={id} />
    </DetailGuard>
  );
}
function Profile({ id }: { id: string }) {
  const state = useDocument<TitheProfile>("titheProfiles", id);
  return state.loading ? (
    <Loading />
  ) : state.error ? (
    <Notice error={state.error} />
  ) : state.data ? (
    <ProfileDetail profile={state.data} />
  ) : (
    <Empty>
      Esta ficha no existe.{" "}
      <Link href="/finanzas/diezmos" className="underline">
        Volver a diezmos
      </Link>
    </Empty>
  );
}
function ProfileDetail({ profile }: { profile: TitheProfile }) {
  const access = useAccess();
  const [year, setYear] = useState(CURRENT_YEAR);
  const [edit, setEdit] = useState(false);
  const [register, setRegister] = useState(false);
  const [success, setSuccess] = useState("");
  const latest = useLatestAttribution(profile.id);
  const constraints = useMemo(
    () => [
      where("profileId", "==", profile.id),
      where("date", ">=", parseDate(`${year}-01-01`)),
      where("date", "<", parseDate(`${year + 1}-01-01`)),
      orderBy("date", "desc"),
      safeLimit(MAX_PERIOD_RECORDS),
    ],
    [profile.id, year],
  );
  const history = useCollection<TitheAttribution>(
    "titheAttributions",
    constraints,
  );
  const [months] = useState(() =>
    Array.from({ length: 12 }, (_, i) => {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - 11 + i);
      return periodId(d.getFullYear(), d.getMonth() + 1);
    }),
  );
  const last12constraints = useMemo(
    () => [
      where("profileId", "==", profile.id),
      where("date", ">=", parseDate(`${months[0]}-01`)),
      where(
        "date",
        "<",
        parseDate(
          `${Number(months[11].slice(0, 4)) + (months[11].slice(5) === "12" ? 1 : 0)}-${months[11].slice(5) === "12" ? "01" : String(Number(months[11].slice(5)) + 1).padStart(2, "0")}-01`,
        ),
      ),
      orderBy("date", "desc"),
      safeLimit(MAX_PERIOD_RECORDS),
    ],
    [profile.id, months],
  );
  const recent = useCollection<TitheAttribution>(
    "titheAttributions",
    last12constraints,
  );
  const graph = months.map((m) => ({
    label: m.slice(5) + "/" + m.slice(2, 4),
    income: recent.data
      .filter((a) => a.status === "active" && a.period === m)
      .reduce((s, a) => s + a.amount, 0),
    expense: 0,
  }));
  const total = history.data
    .filter((a) => a.status === "active")
    .reduce((s, a) => s + a.amount, 0);
  const aggregates = titheAggregates(
    recent.data,
    year === CURRENT_YEAR ? history.data : undefined,
    today(),
  );
  const groups = groupAttributionsByMonth(history.data);
  const methods = useTransactionMethods(history.data.map((a) => a.transactionId));
  return (
    <>
      <Link className="button-secondary mb-6" href="/finanzas/diezmos">
        ← Personas y familias
      </Link>
      <div className="section-heading">
        <div className="min-w-0">
          <h2 className="break-words">{profile.displayName}</h2>
          <p>
            {profile.type === "family" ? "Familia" : "Persona"} ·{" "}
            {profile.active ? "Activa" : "Inactiva"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="button-secondary" onClick={() => setEdit(true)}>
            Editar ficha
          </button>
          <button
            className="button-primary"
            disabled={!profile.active}
            onClick={() => setRegister(true)}
          >
            + Registrar diezmo
          </button>
        </div>
      </div>
      <Notice
        success={success}
        error={history.error || latest.error || recent.error}
      />
      <section className="panel tithe-contrib-strip">
        <div>
          <span>Este mes</span>
          <strong>{clp(aggregates.thisMonth)}</strong>
        </div>
        <div>
          <span>Este año</span>
          <strong>
            {year === CURRENT_YEAR
              ? `${clp(aggregates.thisYear)} (${aggregates.thisYearCount})`
              : "—"}
          </strong>
        </div>
        <div>
          <span>Últimos 12 meses</span>
          <strong>{clp(aggregates.last12Months)}</strong>
        </div>
        <div>
          <span>Último registro</span>
          <strong>
            {latest.loading ? "Consultando…" : dateLabel(latest.data[0]?.date)}
          </strong>
        </div>
      </section>
      <div className="panel">
        <dl className="detail-grid">
          <div>
            <dt>Teléfono</dt>
            <dd>{profile.phone || "No registrado"}</dd>
          </div>
          <div>
            <dt>Correo</dt>
            <dd>{profile.email || "No registrado"}</dd>
          </div>
          {profile.type === "family" && (
            <div>
              <dt>Integrantes</dt>
              <dd>{profile.members || "No registrados"}</dd>
            </div>
          )}
          <div>
            <dt>Consentimiento de contacto pastoral</dt>
            <dd>
              {profile.pastoralContactAuthorized
                ? "Autorizado"
                : "No autorizado"}
            </dd>
          </div>
          <div>
            <dt>Último registro activo</dt>
            <dd>
              {latest.loading
                ? "Consultando…"
                : dateLabel(latest.data[0]?.date)}
            </dd>
          </div>
        </dl>
      </div>
      <section className="panel mt-6">
        <h3>Registros de los últimos 12 meses</h3>
        {recent.loading ? (
          <Loading />
        ) : recent.data.length >= MAX_PERIOD_RECORDS ? (
          <Notice error="El período supera el límite de registros. No se muestran totales parciales." />
        ) : (
          <EvolutionChart data={graph} tithe />
        )}
      </section>
      <div className="section-heading mt-8">
        <div>
          <h2>Historial de registros</h2>
          <p>
            Total de {year}:{" "}
            {history.loading
              ? "Consultando…"
              : history.data.length >= MAX_PERIOD_RECORDS
                ? "No disponible"
                : clp(total)}
          </p>
        </div>
        <div className="period-picker mb-0">
          <label>
            Año
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {Array.from(
                { length: CURRENT_YEAR - FIRST_YEAR + 1 },
                (_, i) => CURRENT_YEAR - i,
              ).map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {history.loading ? (
        <Loading />
      ) : history.data.length ? (
        <div className="tithe-history-table-wrap">
          <table className="tithe-history-table">
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Método</th>
                <th scope="col">Monto</th>
                <th scope="col">Comprobante</th>
                <th scope="col">Estado</th>
                <th scope="col">Nota</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group.period}>
                  <tr className="tithe-history-group">
                    <th scope="rowgroup" colSpan={6}>
                      {MONTHS[Number(group.period.slice(5, 7)) - 1]}{" "}
                      {group.period.slice(0, 4)} · {group.count}{" "}
                      {group.count === 1 ? "registro" : "registros"} ·{" "}
                      {clp(group.subtotal)}
                    </th>
                  </tr>
                  {group.items.map((a) => (
                    <tr key={a.id} className={a.status === "voided" ? "is-voided" : undefined}>
                      <td>{dateLabel(a.date)}</td>
                      <td>
                        {methods[a.transactionId]
                          ? PAYMENT_METHODS[
                              methods[a.transactionId] as keyof typeof PAYMENT_METHODS
                            ] || methods[a.transactionId]
                          : "…"}
                      </td>
                      <td className="tabular-nums">{clp(a.amount)}</td>
                      <td>
                        <ReceiptCell transactionId={a.transactionId} />
                      </td>
                      <td>
                        {a.status === "voided" ? (
                          <span className="status-pill voided tithe-voided">
                            <Ban size={12} aria-hidden="true" />
                            Anulado
                          </span>
                        ) : (
                          <span className="status-pill">Activo</span>
                        )}
                      </td>
                      <td className="tithe-history-note">{a.note || "—"}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No hay registros en {year}.</Empty>
      )}
      {canSeePastoral(access.role) && <PastoralPanel profile={profile} />}{" "}
      {edit && (
        <ProfileForm
          existing={profile}
          onClose={() => setEdit(false)}
          onSaved={() => setSuccess("Ficha actualizada correctamente")}
        />
      )}{" "}
      {register && (
        <TitheRegister
          initialProfile={profile}
          onClose={() => setRegister(false)}
          onSaved={setSuccess}
        />
      )}
    </>
  );
}
