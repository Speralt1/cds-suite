"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth/auth-provider";
import { getFirebaseServices } from "@/lib/firebase";
import { saveProfile } from "@/lib/finance/profiles";
import { dateLabel, errorMessage } from "@/lib/finance/formatters";
import { profileHref } from "@/lib/finance/profile-route";
import {
  useActiveTitheCount,
  useProfileDirectory,
} from "@/lib/finance/tithe-hooks";
import { duplicateGroups } from "@/lib/shared/names";
import type { TitheProfile } from "@/lib/finance/types";
import { Empty, Loading, Notice } from "../shared";

function profileInput(p: TitheProfile, active: boolean) {
  return {
    type: p.type,
    displayName: p.displayName,
    phone: p.phone,
    email: p.email,
    members: p.members,
    active,
    pastoralContactAuthorized: p.pastoralContactAuthorized,
  };
}

function DuplicateRow({
  profile,
  refresh,
  onArchived,
}: {
  profile: TitheProfile;
  refresh: number;
  onArchived: (message: string, error?: string) => void;
}) {
  const { user } = useAuth();
  const count = useActiveTitheCount(profile.id, refresh);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  async function archive() {
    if (busy || !user) return;
    setBusy(true);
    try {
      // Ruta normal de edición: misma transacción, auditoría y reglas. No borra ni fusiona nada.
      await saveProfile(
        getFirebaseServices().db,
        user.uid,
        profileInput(profile, false),
        profile,
      );
      onArchived(`Ficha «${profile.displayName}» archivada. Conserva su historial.`);
    } catch (e) {
      onArchived("", errorMessage(e));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }
  return (
    <li className="duplicate-row">
      <div className="min-w-0">
        <strong className="break-words">{profile.displayName}</strong>
        <span className="field-help">
          {profile.type === "family" ? "Familia" : "Persona"} ·{" "}
          {profile.active ? "Activa" : "Archivada"} · creada el{" "}
          {dateLabel(profile.createdAt)} ·{" "}
          {count === undefined
            ? "contando diezmos…"
            : count === null
              ? "diezmos: abre la ficha"
              : `${count} ${count === 1 ? "diezmo activo" : "diezmos activos"}`}
        </span>
      </div>
      <div className="duplicate-actions">
        <Link className="button-secondary" href={profileHref(profile.id)}>
          Abrir ficha
        </Link>
        {profile.active && !confirm && (
          <button
            type="button"
            className="button-secondary"
            onClick={() => setConfirm(true)}
          >
            Archivar
          </button>
        )}
        {confirm && (
          <span role="group" aria-label={`Archivar ${profile.displayName}`} className="duplicate-confirm">
            <span className="field-help">
              Se archiva: conserva su historial y deja de aparecer al
              registrar diezmos. No se elimina.
            </span>
            <button
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="button-primary"
              disabled={busy}
              onClick={archive}
            >
              {busy ? "Archivando…" : "Confirmar archivo"}
            </button>
          </span>
        )}
      </div>
    </li>
  );
}

function DuplicateGroups() {
  const [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState({ success: "", error: "" });
  const directory = useProfileDirectory(true, refresh);
  const groups = useMemo(() => duplicateGroups(directory.data), [directory.data]);
  if (directory.loading) return <Loading />;
  return (
    <>
      <Notice
        success={message.success}
        error={message.error || directory.error}
      />
      {directory.truncated && (
        <p className="field-help">
          Se revisaron las primeras 500 fichas por nombre.
        </p>
      )}
      {groups.length ? (
        <ol className="duplicate-groups">
          {groups.map((g) => (
            <li key={g.profiles.map((p) => p.id).join(",")} className="panel">
              <p className="duplicate-reason">
                {g.reason === "exact" ? "Mismo nombre" : "Nombres similares"} ·{" "}
                {g.profiles.length} fichas
              </p>
              <ul>
                {g.profiles.map((p) => (
                  <DuplicateRow
                    key={p.id}
                    profile={p}
                    refresh={refresh}
                    onArchived={(success, error = "") => {
                      setMessage({ success, error });
                      if (success) setRefresh((v) => v + 1);
                    }}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      ) : (
        <Empty>No encontramos fichas con nombres iguales o similares.</Empty>
      )}
    </>
  );
}

/**
 * Panel "Posibles fichas duplicadas" (doc 27). Solo lectura + Archivar por la ruta normal.
 * Sin fusionar, sin borrar, sin cambios automáticos. La lista (≤ 500 fichas) se lee al abrir.
 */
export function DuplicateProfilesPanel() {
  const [open, setOpen] = useState(false);
  return (
    <section className="duplicate-panel mt-6" aria-labelledby="duplicate-panel-title">
      <div className="section-heading">
        <div>
          <h2 id="duplicate-panel-title">Posibles fichas duplicadas</h2>
          <p>
            Fichas con el mismo nombre o uno muy parecido. Revisa cada caso:
            archivar no borra el historial.
          </p>
        </div>
        <button
          type="button"
          className="button-secondary"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Ocultar revisión" : "Revisar posibles duplicados"}
        </button>
      </div>
      {open && <DuplicateGroups />}
    </section>
  );
}
