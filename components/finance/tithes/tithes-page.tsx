"use client";
import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePeriod, useSummaries } from "@/lib/finance/hooks";
import {
  useProfiles,
  useLatestAttribution,
  useMonthlyAttributions,
  useTotalProfileCount,
  useValidatedMonthlyDonors,
  useProfileCount,
} from "@/lib/finance/tithe-hooks";
import { useAccess } from "@/lib/auth/access-provider";
import { can } from "@/lib/shared/access";
import { clp, dateLabel, periodLabel, previousPeriod } from "@/lib/finance/formatters";
import { combineSummaries, variation } from "@/lib/finance/calculations";
import { PAGE_SIZE } from "@/lib/finance/constants";
import type { TitheProfile } from "@/lib/finance/types";
import {
  DetailGuard,
  Empty,
  FinancePageHeader,
  Loading,
  Modal,
  Notice,
  PeriodPicker,
} from "../shared";
import { ProfileForm } from "../forms/profile-form";
import { TitheRegister } from "./tithe-register";
import { DuplicateProfilesPanel } from "./duplicate-profiles";
import { profileHref } from "@/lib/finance/profile-route";
export function TithesPage() {
  return (
    <DetailGuard>
      <Tithes />
    </DetailGuard>
  );
}
function ProfileRow({
  profile,
  onRegister,
}: {
  profile: TitheProfile;
  onRegister: (profile: TitheProfile) => void;
}) {
  const latest = useLatestAttribution(profile.id);
  return (
    <div className="profile-row">
      <Link href={profileHref(profile.id)} className="profile-row-name">
        {profile.displayName}
      </Link>
      <span className="profile-row-type">
        {profile.type === "family" ? "Familia" : "Persona"}
      </span>
      <span className="profile-row-latest">
        {latest.loading
          ? "Consultando…"
          : latest.error
            ? "—"
            : dateLabel(latest.data[0]?.date)}
      </span>
      <span
        className={`status-pill shrink-0 ${profile.active ? "" : "voided"}`}
      >
        {profile.active ? "Activa" : "Archivada"}
      </span>
      {profile.active && (
        <button
          type="button"
          className="button-secondary profile-row-action"
          onClick={() => onRegister(profile)}
        >
          Registrar
        </button>
      )}
    </div>
  );
}
function Tithes() {
  const params = useSearchParams();
  const [period, setPeriod] = usePeriod();
  const [register, setRegister] = useState(params.get("registrar") === "1");
  const [registerProfile, setRegisterProfile] = useState<TitheProfile | null>(null);
  const [create, setCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState("");
  const [success, setSuccess] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [warning, setWarning] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [showDonors, setShowDonors] = useState(false);
  const access = useAccess();
  const profiles = useProfiles(search, cursor);
  // Conteo por agregación (sin leer las fichas archivadas).
  const archived = useProfileCount(false, refresh);
  const visibleProfiles = profiles.data
    .slice(0, PAGE_SIZE)
    .filter((p) => showArchived || p.active);
  const hiddenOnPage =
    profiles.data.slice(0, PAGE_SIZE).length - visibleProfiles.length;
  const current = useSummaries(period);
  const priorPeriod = previousPeriod(period);
  const attributions = useMonthlyAttributions(period.year, period.month);
  const priorAttributions = useMonthlyAttributions(priorPeriod.year, priorPeriod.month);
  const currentDonors = useValidatedMonthlyDonors(
    period.year, period.month, attributions.data, attributions.synced,
  );
  const priorDonors = useValidatedMonthlyDonors(
    priorPeriod.year, priorPeriod.month, priorAttributions.data, priorAttributions.synced,
  );
  const count = useTotalProfileCount(refresh);
  const donorsLoading = attributions.loading || currentDonors.loading;
  const priorLoading = priorAttributions.loading || priorDonors.loading;
  const donorsError = attributions.error || currentDonors.error;
  const priorError = priorAttributions.error || priorDonors.error;
  const donorChange = variation(
    currentDonors.report.donors.length,
    priorDonors.report.donors.length,
  );
  function saved(s: string, w = "") {
    setSuccess(s);
    setWarning(w);
    setRefresh((v) => v + 1);
  }
  return (
    <>
      <FinancePageHeader
        title="Diezmos"
        subtitle="Personas y familias, con cuidado y privacidad."
        aside={
          <button className="button-primary" onClick={() => setRegister(true)}>
            + Registrar diezmo
          </button>
        }
      />
      <Notice
        success={success}
        error={
          current.error ||
          donorsError ||
          priorError ||
          count.error ||
          profiles.error
        }
      />
      {warning && (
        <p role="status" className="notice-warning">
          {warning}
        </p>
      )}
      <div className="filters tithe-search">
        <label>
          Buscar persona o familia
          <input
            type="search"
            autoFocus
            placeholder="Escribe el inicio del nombre…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCursor("");
            }}
          />
        </label>
      </div>
      <div className="section-heading mt-6">
        <h2>Personas y familias</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="button-secondary"
            aria-pressed={showArchived}
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? "Ocultar archivadas" : "Mostrar archivadas"}
            {archived.loading || archived.error ? "" : ` (${archived.count})`}
          </button>
          <button className="button-secondary" onClick={() => setCreate(true)}>
            + Crear nueva ficha
          </button>
        </div>
      </div>
      {profiles.loading ? (
        <Loading />
      ) : profiles.error ? null : visibleProfiles.length ? (
        <div className="profile-rows">
          {visibleProfiles.map((p) => (
            <ProfileRow key={p.id} profile={p} onRegister={setRegisterProfile} />
          ))}
          {hiddenOnPage > 0 && (
            <p className="field-help">
              {hiddenOnPage === 1
                ? "1 ficha archivada oculta en esta página."
                : `${hiddenOnPage} fichas archivadas ocultas en esta página.`}
            </p>
          )}
        </div>
      ) : profiles.data.length ? (
        <Empty>
          Las fichas de esta página están archivadas. Usa «Mostrar archivadas»
          para verlas.
        </Empty>
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
      <PeriodPicker monthlyOnly value={period} onChange={setPeriod} />
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
          <h3>Diezmantes del mes</h3>
          <button
            type="button"
            className="tithe-kpi-action"
            onClick={() => setShowDonors(true)}
            disabled={donorsLoading || !!donorsError}
            aria-label="Ver detalle de diezmantes del mes"
          >
            <strong>{donorsLoading ? "…" : donorsError ? "—" : currentDonors.report.donors.length}</strong>
            <span>Ver detalle</span>
          </button>
        </article>
        <article className="kpi">
          <h3>Diezmantes del mes anterior</h3>
          <p>{priorLoading ? "…" : priorError ? "—" : priorDonors.report.donors.length}</p>
          <span>
            {priorLoading || donorsLoading || priorError || donorsError
              ? "Comparación pendiente"
              : donorChange === null
                ? `${periodLabel(priorPeriod)} · Sin base: mes anterior en cero`
                : `${periodLabel(priorPeriod)} · ${donorChange < 0 ? "−" : donorChange > 0 ? "+" : ""}${Math.abs(donorChange).toLocaleString("es-CL", { maximumFractionDigits: 1 })}% este mes`}
          </span>
        </article>
        <article className="kpi">
          <h3>Personas/familias registradas</h3>
          <p>{count.loading ? "…" : count.error ? "—" : count.count}</p>
          <span>Fichas existentes, incluidas archivadas</span>
        </article>
      </div>
      {!donorsLoading && !donorsError && currentDonors.report.excluded > 0 && (
        <p role="status" className="notice-warning">
          {currentDonors.report.excluded} aporte(s) sin ficha o con datos incongruentes no se incluyeron en el conteo de diezmantes.
        </p>
      )}
      {showDonors && (
        <Modal title={`Diezmantes · ${periodLabel(period)}`} size="wide" onClose={() => setShowDonors(false)}>
          <div className="tithe-donor-detail">
            {currentDonors.report.donors.length ? (
              currentDonors.report.donors.map((row) => (
                <div className="tithe-donor-row" key={row.profile.id}>
                  <div>
                    <Link href={profileHref(row.profile.id)}>{row.profile.displayName}</Link>
                    <small>{row.profile.type === "family" ? "Familia" : "Persona"}</small>
                  </div>
                  <dl>
                    <div><dt>Aportes</dt><dd>{row.contributions}</dd></div>
                    <div><dt>Total del período</dt><dd>{clp(row.total)}</dd></div>
                    <div><dt>Último diezmo</dt><dd>{dateLabel(row.latestDate)}</dd></div>
                  </dl>
                </div>
              ))
            ) : (
              <p>Sin diezmos válidos en este mes.</p>
            )}
          </div>
        </Modal>
      )}
      {can(access, "finance.records.manage") && <DuplicateProfilesPanel />}
      {create && (
        <ProfileForm
          onClose={() => setCreate(false)}
          onSaved={() => saved("Ficha creada correctamente")}
        />
      )}{" "}
      {register && (
        <TitheRegister onClose={() => setRegister(false)} onSaved={saved} />
      )}
      {registerProfile && (
        <TitheRegister
          initialProfile={registerProfile}
          onClose={() => setRegisterProfile(null)}
          onSaved={saved}
        />
      )}
    </>
  );
}
