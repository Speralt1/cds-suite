"use client";
import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePeriod, useSummaries } from "@/lib/finance/hooks";
import {
  useProfiles,
  useLatestAttribution,
  useMonthlyAttributions,
  useNewProfileCount,
} from "@/lib/finance/tithe-hooks";
import { clp, dateLabel, previousPeriod } from "@/lib/finance/formatters";
import { combineSummaries, variation } from "@/lib/finance/calculations";
import { PAGE_SIZE, MAX_PERIOD_RECORDS } from "@/lib/finance/constants";
import type { TitheProfile } from "@/lib/finance/types";
import {
  DetailGuard,
  Empty,
  FinancePageHeader,
  Loading,
  Notice,
  PeriodPicker,
} from "../shared";
import { ProfileForm } from "../forms/profile-form";
import { TitheRegister } from "./tithe-register";
import { profileHref } from "@/lib/finance/profile-route";
export function TithesPage() {
  return (
    <DetailGuard>
      <Tithes />
    </DetailGuard>
  );
}
function ProfileCard({ profile }: { profile: TitheProfile }) {
  const latest = useLatestAttribution(profile.id);
  return (
    <Link href={profileHref(profile.id)} className="profile-card">
      <div className="flex justify-between gap-2">
        <h3>{profile.displayName}</h3>
        <span
          className={`status-pill shrink-0 self-start ${profile.active ? "" : "voided"}`}
        >
          {profile.active ? "Activo" : "Inactivo"}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted">
        {profile.type === "family" ? "Familia" : "Persona"}
      </p>
      <p className="mt-5 text-xs">
        Último registro:{" "}
        {latest.loading ? "Consultando…" : dateLabel(latest.data[0]?.date)}
      </p>
      {latest.error && (
        <p className="mt-2 text-xs text-danger">
          No se pudo consultar el último registro.
        </p>
      )}
    </Link>
  );
}
function Tithes() {
  const params = useSearchParams();
  const [period, setPeriod] = usePeriod();
  const [register, setRegister] = useState(params.get("registrar") === "1");
  const [create, setCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState("");
  const [success, setSuccess] = useState("");
  const [refresh, setRefresh] = useState(0);
  const profiles = useProfiles(search, cursor);
  const current = useSummaries(period);
  const previous = useSummaries(previousPeriod(period));
  const attributions = useMonthlyAttributions(period.year, period.month);
  const count = useNewProfileCount(period.year, refresh);
  const change = variation(
    combineSummaries(current.data).titheTotal,
    combineSummaries(previous.data).titheTotal,
  );
  function saved(s: string) {
    setSuccess(s);
    setRefresh((v) => v + 1);
  }
  return (
    <>
      <FinancePageHeader
        title="Diezmos"
        subtitle="Personas y familias, con cuidado y privacidad."
        period={
          <PeriodPicker monthlyOnly value={period} onChange={setPeriod} />
        }
        actions={
          <button className="button-primary" onClick={() => setRegister(true)}>
            + Registrar diezmo
          </button>
        }
      />
      <Notice
        success={success}
        error={
          current.error ||
          previous.error ||
          attributions.error ||
          count.error ||
          profiles.error
        }
      />
      <div className="kpi-grid tithe-kpis">
        <article className="kpi">
          <h3>Diezmos del mes</h3>
          <p>
            {current.loading
              ? "…"
              : current.error
                ? "—"
                : clp(combineSummaries(current.data).titheTotal)}
          </p>
        </article>
        <article className="kpi">
          <h3>Personas/familias con registro</h3>
          <p>
            {attributions.loading
              ? "…"
              : attributions.error
                ? "—"
                : attributions.data.length >= MAX_PERIOD_RECORDS
                  ? "No disponible"
                  : new Set(
                      attributions.data
                        .filter((a) => a.status === "active")
                        .map((a) => a.profileId),
                    ).size}
          </p>
        </article>
        <article className="kpi">
          <h3>Nuevas fichas del año</h3>
          <p>{count.loading ? "…" : count.error ? "—" : count.count}</p>
        </article>
        <article className="kpi">
          <h3>Variación mensual</h3>
          <p>
            {change === null
              ? "—"
              : `${change.toLocaleString("es-CL", { maximumFractionDigits: 1 })}%`}
          </p>
          <span>
            {change === null
              ? "Sin base de comparación"
              : "Respecto al mes anterior"}
          </span>
        </article>
      </div>
      <div className="section-heading mt-8">
        <h2>Personas y familias</h2>
        <button className="button-secondary" onClick={() => setCreate(true)}>
          + Crear nueva ficha
        </button>
      </div>
      <div className="filters">
        <label>
          Buscar por nombre
          <input
            type="search"
            placeholder="Inicio del nombre de persona o familia"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCursor("");
            }}
          />
        </label>
      </div>
      {profiles.loading ? (
        <Loading />
      ) : profiles.error ? null : profiles.data.length ? (
        <div className="profile-grid">
          {profiles.data.slice(0, PAGE_SIZE).map((p) => (
            <ProfileCard key={p.id} profile={p} />
          ))}
        </div>
      ) : (
        <Empty>
          No hay fichas para esta búsqueda. Puedes crear la primera.
        </Empty>
      )}
      <div className="mt-5 flex gap-3">
        {cursor && (
          <button className="button-secondary" onClick={() => setCursor("")}>
            Volver al inicio
          </button>
        )}
        {profiles.data.length > PAGE_SIZE && (
          <button
            className="button-secondary"
            onClick={() =>
              setCursor(
                JSON.stringify([
                  profiles.data[PAGE_SIZE - 1].searchName,
                  profiles.data[PAGE_SIZE - 1].id,
                ]),
              )
            }
          >
            Siguiente página
          </button>
        )}
      </div>
      {create && (
        <ProfileForm
          onClose={() => setCreate(false)}
          onSaved={() => saved("Ficha creada correctamente")}
        />
      )}{" "}
      {register && (
        <TitheRegister onClose={() => setRegister(false)} onSaved={saved} />
      )}
    </>
  );
}
