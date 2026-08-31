"use client";
import { useState } from "react";
import { useProfiles } from "@/lib/finance/tithe-hooks";
import type { TitheProfile } from "@/lib/finance/types";
import { Modal, Notice, Loading, Empty } from "../shared";
import { ProfileForm } from "../forms/profile-form";
import { TransactionForm } from "../forms/transaction-form";
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
  const profiles = useProfiles(search);
  if (selected)
    return (
      <TransactionForm profile={selected} onClose={onClose} onSaved={onSaved} />
    );
  if (creating)
    return (
      <ProfileForm
        onClose={() => setCreating(false)}
        onSaved={(p) => {
          setSelected(p);
          setCreating(false);
        }}
      />
    );
  return (
    <Modal title="Registrar diezmo" onClose={onClose}>
      <div className="finance-form">
        <label>
          Buscar persona o familia
          <input
            autoFocus
            data-autofocus
            type="search"
            placeholder="Escribe el inicio del nombre"
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
        <Notice error={profiles.error} />
        {profiles.loading ? (
          <Loading />
        ) : profiles.data.filter((p) => p.active).length ? (
          <div className="flex flex-col gap-2">
            {profiles.data
              .filter((p) => p.active)
              .map((p) => (
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
              Se muestran hasta 31 coincidencias. Escribe más letras para
              precisar la búsqueda.
            </p>
          </div>
        ) : (
          <Empty>No hay fichas activas para esta búsqueda.</Empty>
        )}
      </div>
    </Modal>
  );
}
