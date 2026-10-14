"use client";
import { useState } from "react";
import {
  matchesProfileSearch,
  useProfileDirectory,
  useProfiles,
} from "@/lib/finance/tithe-hooks";
import type { TitheProfile } from "@/lib/finance/types";
import { Modal, Notice, Loading, Empty } from "../shared";
import { ProfileForm } from "../forms/profile-form";
import { TransactionForm } from "../forms/transaction-form";
const MAX_RESULTS = 30;
export function TitheRegister({
  onClose,
  onSaved,
  initialProfile,
}: {
  onClose: () => void;
  onSaved: (s: string) => void;
  initialProfile?: TitheProfile;
}) {
  const [selected, setSelected] = useState<TitheProfile | undefined>(
    initialProfile,
  );
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [reactivating, setReactivating] = useState<TitheProfile | null>(null);
  // Una lectura acotada (≤ 500 fichas) al abrir; la búsqueda es normalizada y local.
  const directory = useProfileDirectory(!selected);
  // Con más de 500 fichas, se suma la búsqueda por prefijo del servidor (comportamiento anterior).
  const server = useProfiles(
    search,
    "",
    !selected && directory.truncated && !!search.trim(),
  );
  if (selected)
    return (
      <TransactionForm profile={selected} onClose={onClose} onSaved={onSaved} />
    );
  if (reactivating)
    return (
      <ProfileForm
        existing={reactivating}
        reactivate
        onClose={() => setReactivating(null)}
        onSaved={(p) => {
          setReactivating(null);
          if (p.active) setSelected(p);
        }}
      />
    );
  if (creating)
    return (
      <ProfileForm
        directory={directory}
        onClose={() => setCreating(false)}
        onSaved={(p) => {
          setSelected(p);
          setCreating(false);
        }}
        onUseExisting={(p) => {
          setCreating(false);
          setSelected(p);
        }}
        onReactivateExisting={(p) => {
          setCreating(false);
          setReactivating(p);
        }}
      />
    );
  const byId = new Map<string, TitheProfile>();
  for (const p of directory.data)
    if (p.active && matchesProfileSearch(p.displayName, search))
      byId.set(p.id, p);
  for (const p of server.data) if (p.active) byId.set(p.id, p);
  const results = [...byId.values()];
  return (
    <Modal title="Registrar diezmo" onClose={onClose}>
      <div className="finance-form">
        <label>
          Buscar persona o familia
          <input
            autoFocus
            data-autofocus
            type="search"
            placeholder="Escribe parte del nombre"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button
          className="button-secondary mb-5 w-full"
          onClick={() => setCreating(true)}
        >
          + Crear nueva ficha
        </button>
        <Notice error={directory.error || server.error} />
        {directory.loading ? (
          <Loading />
        ) : results.length ? (
          <div className="flex flex-col gap-2">
            {results.slice(0, MAX_RESULTS).map((p) => (
              <button
                key={p.id}
                className="button-secondary justify-between text-left"
                onClick={() => setSelected(p)}
              >
                <span className="min-w-0 break-words">{p.displayName}</span>
                <span className="field-help shrink-0">
                  {p.type === "person" ? "Persona" : "Familia"}
                </span>
              </button>
            ))}
            <p className="field-help">
              Se muestran hasta {MAX_RESULTS} fichas activas. Escribe más
              letras para precisar la búsqueda (no importan tildes ni
              mayúsculas).
            </p>
          </div>
        ) : (
          <Empty>No hay fichas activas para esta búsqueda.</Empty>
        )}
        {directory.truncated && (
          <p className="field-help">
            Hay más de 500 fichas: la búsqueda sin tildes cubre las primeras
            500; las demás se buscan por el inicio del nombre.
          </p>
        )}
      </div>
    </Modal>
  );
}
