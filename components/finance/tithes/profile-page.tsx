"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { where, orderBy, limit } from "firebase/firestore";
import { useAccess } from "@/lib/auth/access-provider";
import { canSeePastoral } from "@/lib/finance/permissions";
import { useCollection, useDocument } from "@/lib/finance/hooks";
import { useLatestAttribution } from "@/lib/finance/tithe-hooks";
import { clp, dateLabel, parseDate, periodId } from "@/lib/finance/formatters";
import { MAX_PERIOD_RECORDS, PAGE_SIZE } from "@/lib/finance/constants";
import type { TitheProfile, TitheAttribution } from "@/lib/finance/types";
import { DetailGuard, Loading, Empty, Notice } from "../shared";
import { ProfileForm } from "../forms/profile-form";
import { TitheRegister } from "./tithe-register";
import { PastoralPanel } from "./pastoral-panel";
import { EvolutionChart } from "../charts/finance-charts";
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
  const [year, setYear] = useState(new Date().getFullYear());
  const [count, setCount] = useState(PAGE_SIZE);
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
      limit(MAX_PERIOD_RECORDS + 1),
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
      limit(MAX_PERIOD_RECORDS + 1),
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
        ) : recent.data.length > MAX_PERIOD_RECORDS ? (
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
              : history.data.length > MAX_PERIOD_RECORDS
                ? "No disponible"
                : clp(total)}
          </p>
        </div>
        <div className="period-picker mb-0">
          <label>
            Año
            <select
              value={year}
              onChange={(e) => {
                setYear(Number(e.target.value));
                setCount(PAGE_SIZE);
              }}
            >
              {Array.from({ length: 100 }, (_, i) => 2099 - i).map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {history.loading ? (
        <Loading />
      ) : history.data.length ? (
        <div className="panel">
          {history.data.slice(0, count).map((a) => (
            <article
              key={a.id}
              className="flex flex-wrap justify-between gap-3 border-b border-line py-4"
            >
              <div>
                <p className="text-sm">
                  {dateLabel(a.date)}{" "}
                  <span
                    className={`status-pill ${a.status === "voided" ? "voided" : ""}`}
                  >
                    {a.status === "active" ? "Activo" : "Anulado"}
                  </span>
                </p>
                {a.note && (
                  <p className="mt-2 text-xs text-muted break-words">
                    {a.note}
                  </p>
                )}
                <Link
                  className="inline-flex min-h-11 items-center text-xs text-primary underline"
                  href="/finanzas/movimientos"
                >
                  Consultar movimiento en el libro general
                </Link>
              </div>
              <p className="text-sm font-semibold">{clp(a.amount)}</p>
            </article>
          ))}
          {count < history.data.length && (
            <button
              className="button-secondary mt-5"
              onClick={() => setCount(count + PAGE_SIZE)}
            >
              Ver más registros
            </button>
          )}
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
