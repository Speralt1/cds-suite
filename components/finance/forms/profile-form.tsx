"use client";
import { useRef, useState } from "react";
import { collection, doc, getDoc } from "firebase/firestore";
import { useAuth } from "@/lib/auth/auth-provider";
import { getFirebaseServices } from "@/lib/firebase";
import { saveProfile } from "@/lib/finance/profiles";
import { errorMessage } from "@/lib/finance/formatters";
import type { ProfileInput, TitheProfile } from "@/lib/finance/types";
import { Modal, Notice } from "../shared";
export function ProfileForm({
  existing,
  onClose,
  onSaved,
}: {
  existing?: TitheProfile;
  onClose: () => void;
  onSaved: (profile: TitheProfile) => void;
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
          active: existing.active,
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
  const lock = useRef(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current || !user) return;
    lock.current = true;
    setBusy(true);
    try {
      const db = getFirebaseServices().db;
      await saveProfile(db, user.uid, input, existing, id);
      const s = await getDoc(doc(db, "titheProfiles", id));
      onSaved({ id, ...s.data() } as TitheProfile);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
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
