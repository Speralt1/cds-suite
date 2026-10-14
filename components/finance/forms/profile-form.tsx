"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc } from "firebase/firestore";
import { useAuth } from "@/lib/auth/auth-provider";
import { getFirebaseServices } from "@/lib/firebase";
import { isDuplicateProfileError, saveProfile } from "@/lib/finance/profiles";
import {
  useProfileDirectory,
  type ProfileDirectoryState,
} from "@/lib/finance/tithe-hooks";
import { errorMessage } from "@/lib/finance/formatters";
import { identityKey, similarProfiles } from "@/lib/shared/names";
import type { ProfileInput, TitheProfile } from "@/lib/finance/types";
import { Modal, Notice } from "../shared";
import {
  ProfileMatchesNotice,
  type ProfileMatch,
} from "../tithes/profile-matches";
/** Espera tras la última tecla antes de recalcular coincidencias de nombre. */
export const NAME_MATCH_DEBOUNCE_MS = 250;
export const POSSIBLE_DUPLICATE_WARNING =
  "Posible ficha duplicada: otra ficha ya usa este nombre. Los cambios se guardaron; revisa «Posibles fichas duplicadas» en Diezmos.";
export const RELEASED_NAME_NOTICE =
  "Una ficha archivada con el mismo nombre cedió el nombre: ahora lo reserva esta ficha. La ficha archivada conserva su historial.";
export function ProfileForm({
  existing,
  reactivate = false,
  onClose,
  onSaved,
  onUseExisting,
  onReactivateExisting,
  directory: sharedDirectory,
}: {
  existing?: TitheProfile;
  /** Abre una ficha archivada con "Ficha activa" marcado para reactivarla al guardar. */
  reactivate?: boolean;
  onClose: () => void;
  onSaved: (profile: TitheProfile, warning?: string) => void;
  /** Flujo de diezmo: selecciona la ficha existente en vez de crear otra. */
  onUseExisting?: (profile: TitheProfile) => void;
  /** Abre la ficha archivada coincidente para revisarla y reactivarla. */
  onReactivateExisting?: (profile: TitheProfile) => void;
  /** Lista acotada ya cargada por el padre (evita una segunda lectura). */
  directory?: ProfileDirectoryState;
}) {
  const { user } = useAuth();
  const [id] = useState(
    () =>
      existing?.id ||
      doc(collection(getFirebaseServices().db, "titheProfiles")).id,
  );
  const [input, setInput] = useState<ProfileInput>(() =>
    existing
      ? {
          type: existing.type,
          displayName: existing.displayName,
          phone: existing.phone,
          email: existing.email,
          members: existing.members,
          active: reactivate ? true : existing.active,
          pastoralContactAuthorized: existing.pastoralContactAuthorized,
        }
      : {
          type: "person",
          displayName: "",
          phone: "",
          email: "",
          members: "",
          active: true,
          pastoralContactAuthorized: false,
        },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [serverDuplicate, setServerDuplicate] = useState<{
    key: string;
    profile: TitheProfile;
  } | null>(null);
  const lock = useRef(false);
  const matchRef = useRef<HTMLDivElement>(null);
  // Una sola lectura acotada al abrir el formulario; las coincidencias se calculan en el cliente.
  const ownDirectory = useProfileDirectory(!sharedDirectory);
  const directory = sharedDirectory ?? ownDirectory;
  const [debouncedName, setDebouncedName] = useState(input.displayName);
  useEffect(() => {
    const t = setTimeout(
      () => setDebouncedName(input.displayName),
      NAME_MATCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(t);
  }, [input.displayName]);
  const originalKey = existing ? identityKey(existing.displayName) : "";
  function matchesFor(name: string): ProfileMatch[] {
    return similarProfiles(name, directory.data, undefined, existing?.id);
  }
  // Bloquea solo cuando la ficha INTRODUCE un nombre ya usado (alta o cambio de nombre).
  // Editar otros datos de una ficha antigua duplicada nunca se bloquea.
  const introducesKey = (name: string) =>
    !existing || identityKey(name) !== originalKey;
  const matches = useMemo(
    () => matchesFor(debouncedName),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [debouncedName, directory.data, existing?.id],
  );
  const serverMatch: ProfileMatch[] =
    serverDuplicate && serverDuplicate.key === identityKey(input.displayName)
      ? [
          {
            profile: serverDuplicate.profile,
            score: 1,
            reason: "exact",
          },
        ]
      : [];
  const shown = matches.length ? matches : serverMatch;
  const blocking =
    shown.length > 0 &&
    shown[0].reason === "exact" &&
    introducesKey(debouncedName);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current || !user) return;
    // Comprobación con el nombre actual (no el del debounce): sin esperar a la red.
    const now = matchesFor(input.displayName);
    if (
      now[0]?.reason === "exact" &&
      introducesKey(input.displayName)
    ) {
      setDebouncedName(input.displayName);
      setError("");
      requestAnimationFrame(() => matchRef.current?.focus());
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const db = getFirebaseServices().db;
      const result = await saveProfile(db, user.uid, input, existing, id);
      const s = await getDoc(doc(db, "titheProfiles", id));
      onSaved(
        { id, ...s.data() } as TitheProfile,
        result.possibleDuplicateOf
          ? POSSIBLE_DUPLICATE_WARNING
          : result.releasedFrom
            ? RELEASED_NAME_NOTICE
            : undefined,
      );
      onClose();
    } catch (e) {
      if (isDuplicateProfileError(e)) {
        // La ficha dueña de la clave, leída tal cual (estado real: activa o archivada).
        const db = getFirebaseServices().db;
        const owner =
          directory.data.find((p) => p.id === e.profileId) ??
          (await getDoc(doc(db, "titheProfiles", e.profileId))
            .then((s) =>
              s.exists()
                ? ({ id: s.id, ...s.data() } as TitheProfile)
                : null,
            )
            .catch(() => null));
        if (owner) setServerDuplicate({ key: e.identityKey, profile: owner });
        else setError(e.message);
        setDebouncedName(input.displayName);
        requestAnimationFrame(() => matchRef.current?.focus());
      } else setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={existing ? "Editar ficha" : "Crear nueva ficha"}
      busy={busy}
      onClose={onClose}
    >
      <form className="finance-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            Tipo
            <select
              value={input.type}
              onChange={(e) =>
                setInput({
                  ...input,
                  type: e.target.value as ProfileInput["type"],
                })
              }
            >
              <option value="person">Persona</option>
              <option value="family">Familia</option>
            </select>
          </label>
          <label>
            Nombre
            <input
              autoFocus
              data-autofocus
              required
              maxLength={120}
              value={input.displayName}
              onChange={(e) =>
                setInput({ ...input, displayName: e.target.value })
              }
            />
          </label>
          <ProfileMatchesNotice
            ref={matchRef}
            matches={shown}
            blocking={blocking}
            truncated={directory.truncated}
            onUse={onUseExisting}
            onReactivate={onReactivateExisting}
          />
          <div className="form-grid">
            <label>
              Teléfono (opcional)
              <input
                type="tel"
                maxLength={40}
                value={input.phone}
                onChange={(e) => setInput({ ...input, phone: e.target.value })}
              />
            </label>
            <label>
              Correo (opcional)
              <input
                type="email"
                maxLength={160}
                value={input.email}
                onChange={(e) => setInput({ ...input, email: e.target.value })}
              />
            </label>
          </div>
          {input.type === "family" && (
            <label>
              Integrantes (opcional)
              <textarea
                rows={2}
                maxLength={600}
                value={input.members}
                onChange={(e) =>
                  setInput({ ...input, members: e.target.value })
                }
              />
            </label>
          )}
          <label className="check-label">
            <input
              type="checkbox"
              checked={input.active}
              onChange={(e) => setInput({ ...input, active: e.target.checked })}
            />
            Ficha activa
          </label>
          {!input.active && (
            <p className="field-help" role="note">
              La ficha se archiva: conserva su historial, deja de aparecer al
              registrar diezmos. No se elimina.
            </p>
          )}
          {reactivate && existing && !existing.active && input.active && (
            <p className="field-help" role="note">
              Revisa los datos y guarda para reactivar esta ficha.
            </p>
          )}
          <label className="check-label">
            <input
              type="checkbox"
              checked={input.pastoralContactAuthorized}
              onChange={(e) =>
                setInput({
                  ...input,
                  pastoralContactAuthorized: e.target.checked,
                })
              }
            />
            La persona o familia autorizó el contacto pastoral.
          </label>
          <p className="field-help">
            El consentimiento es opcional. Solo permite registrar acompañamiento
            a los roles pastor y admin.
          </p>
          <Notice error={error} />
        </fieldset>
        <div className="form-footer">
          <button
            type="button"
            className="button-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button className="button-primary" disabled={busy}>
            {busy ? "Guardando…" : "Guardar ficha"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
