"use client";
import Link from "next/link";
import { forwardRef, useId, useState } from "react";
import type { NameMatch } from "@/lib/shared/names";
import type { TitheProfile } from "@/lib/finance/types";
import { profileHref } from "@/lib/finance/profile-route";

export type ProfileMatch = NameMatch<TitheProfile>;

/**
 * Aviso de fichas con nombre igual o similar (doc 27).
 * - blocking: misma clave de identidad → "Ya existe una ficha con este nombre" (no se guarda).
 * - si no: nombre similar → aviso informativo; se puede continuar.
 * Texto + rol status (no depende del color); botones de 44 px (`button-secondary`).
 */
export const ProfileMatchesNotice = forwardRef<
  HTMLDivElement,
  {
    matches: ProfileMatch[];
    blocking: boolean;
    truncated?: boolean;
    onUse?: (profile: TitheProfile) => void;
    onReactivate?: (profile: TitheProfile) => void;
  }
>(function ProfileMatchesNotice(
  { matches, blocking, truncated = false, onUse, onReactivate },
  ref,
) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (!matches.length) return null;
  const first = matches[0].profile;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      className={`profile-match-notice ${blocking ? "is-blocking" : ""}`}
    >
      <p className="profile-match-title">
        <strong>
          {blocking
            ? "Ya existe una ficha con este nombre"
            : matches[0].reason === "exact"
              ? "Posible ficha duplicada"
              : "Ya encontramos una persona con un nombre similar"}
        </strong>
      </p>
      <p>
        {blocking ? (
          <>
            «{first.displayName}» ({first.active ? "activa" : "archivada"}).
            Usa esa ficha. Si es otra persona o familia con el mismo nombre,
            distingue el nombre: agrega el segundo apellido o una referencia
            (por ejemplo, «Juan Pérez Soto» o «Juan Pérez (Coquimbo)»).
          </>
        ) : matches[0].reason === "exact" ? (
          <>
            Otra ficha, «{first.displayName}» (
            {first.active ? "activa" : "archivada"}), tiene el mismo nombre.
            Puedes guardar esta ficha; si es la misma persona o familia,
            archiva una de las dos desde «Posibles fichas duplicadas».
          </>
        ) : (
          <>
            «{first.displayName}»
            {matches.length > 1 ? ` y ${matches.length - 1} más` : ""}. Revisa
            si es la misma persona o familia antes de crear otra ficha. Puedes
            continuar si no lo es.
          </>
        )}
      </p>
      <div className="profile-match-actions">
        {first.active && onUse ? (
          <button
            type="button"
            className="button-secondary"
            onClick={() => onUse(first)}
          >
            Usar ficha existente
          </button>
        ) : first.active ? (
          <Link className="button-secondary" href={profileHref(first.id)}>
            Abrir ficha existente
          </Link>
        ) : onReactivate ? (
          <button
            type="button"
            className="button-secondary"
            onClick={() => onReactivate(first)}
          >
            Revisar y reactivar
          </button>
        ) : (
          <Link className="button-secondary" href={profileHref(first.id)}>
            Revisar y reactivar
          </Link>
        )}
        <button
          type="button"
          className="button-secondary"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
        >
          Revisar coincidencias ({matches.length})
        </button>
      </div>
      {open && (
        <ul id={listId} className="profile-match-list">
          {matches.map((m) => (
            <li key={m.profile.id}>
              <span className="min-w-0 break-words">
                {m.profile.displayName}
              </span>
              <span className="field-help">
                {m.profile.type === "family" ? "Familia" : "Persona"} ·{" "}
                {m.profile.active ? "Activa" : "Archivada"} ·{" "}
                {m.reason === "exact" ? "Mismo nombre" : "Nombre similar"}
              </span>
              <Link
                className="profile-match-link"
                href={profileHref(m.profile.id)}
                target="_blank"
                rel="noopener"
              >
                Abrir ficha
              </Link>
            </li>
          ))}
        </ul>
      )}
      {truncated && (
        <p className="field-help">
          Se compararon las primeras 500 fichas. Puede haber otras coincidencias.
        </p>
      )}
    </div>
  );
});
