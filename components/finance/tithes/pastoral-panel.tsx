"use client";
import { useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  orderBy,
  where,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { useAuth } from "@/lib/auth/auth-provider";
import { getFirebaseServices } from "@/lib/firebase";
import { useCollection } from "@/lib/finance/hooks";
import { addFollowup } from "@/lib/finance/profiles";
import { safeLimit } from "@/lib/finance/query-limit";
import { today, dateLabel, errorMessage } from "@/lib/finance/formatters";
import type { PastoralFollowup, TitheProfile } from "@/lib/finance/types";
import { Notice, Loading, Empty, Modal } from "../shared";
export function PastoralPanel({ profile }: { profile: TitheProfile }) {
  const [count, setCount] = useState(30);
  const constraints = useMemo(
    () => [
      where("profileId", "==", profile.id),
      orderBy("date", "desc"),
      safeLimit(count + 1),
    ],
    [profile.id, count],
  );
  const state = useCollection<PastoralFollowup>(
    "pastoralFollowups",
    constraints,
  );
  const [create, setCreate] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const { user } = useAuth();
  async function complete(note: PastoralFollowup) {
    if (busy || !user) return;
    setBusy(note.id);
    try {
      await updateDoc(
        doc(getFirebaseServices().db, "pastoralFollowups", note.id),
        {
          status: "completed",
          updatedBy: user.uid,
          updatedAt: serverTimestamp(),
        },
      );
      setSuccess("Acompañamiento actualizado correctamente");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="panel mt-8">
      <div className="section-heading">
        <div>
          <h2>Acompañamiento pastoral</h2>
          <p>Privado · Solo pastor y admin.</p>
        </div>
        <button
          className="button-secondary"
          disabled={!profile.pastoralContactAuthorized}
          onClick={() => setCreate(true)}
        >
          + Registrar acompañamiento
        </button>
      </div>
      {!profile.pastoralContactAuthorized && (
        <p className="notice">
          Esta ficha no tiene consentimiento de contacto pastoral. No se pueden
          registrar ni modificar notas.
        </p>
      )}
      <Notice error={state.error || error} success={success} />
      {state.loading ? (
        <Loading />
      ) : state.data.length ? (
        state.data.slice(0, count).map((n) => (
          <article key={n.id} className="followup">
            <p className="mb-2 text-xs text-muted">
              {dateLabel(n.date)} ·{" "}
              {n.status === "pending" ? "Pendiente" : "Completado"}
            </p>
            <p>{n.note}</p>
            {n.nextFollowUpDate && (
              <p className="mt-3 text-xs">
                Próximo contacto:{" "}
                {n.nextFollowUpDate.split("-").reverse().join("-")}
              </p>
            )}
            <p className="mt-3 text-xs text-muted">
              Registrado por {n.createdBy} · {dateLabel(n.createdAt)}
            </p>
            {n.status === "pending" && profile.pastoralContactAuthorized && (
              <button
                className="button-secondary mt-3"
                disabled={!!busy}
                onClick={() => void complete(n)}
              >
                {busy === n.id ? "Guardando…" : "Marcar completado"}
              </button>
            )}
          </article>
        ))
      ) : (
        <Empty>Aún no hay acompañamientos registrados.</Empty>
      )}
      {state.data.length > count && (
        <button
          className="button-secondary mt-4"
          onClick={() => setCount(count + 30)}
        >
          Ver anteriores
        </button>
      )}
      {create && (
        <FollowupForm
          profileId={profile.id}
          onClose={() => setCreate(false)}
          onSaved={setSuccess}
        />
      )}
    </section>
  );
}
function FollowupForm({
  profileId,
  onClose,
  onSaved,
}: {
  profileId: string;
  onClose: () => void;
  onSaved: (s: string) => void;
}) {
  const { user } = useAuth();
  const [id] = useState(
    () => doc(collection(getFirebaseServices().db, "pastoralFollowups")).id,
  );
  const [input, setInput] = useState({
    date: today(),
    note: "",
    status: "pending" as "pending" | "completed",
    nextFollowUpDate: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current || !user) return;
    lock.current = true;
    setBusy(true);
    try {
      await addFollowup(
        getFirebaseServices().db,
        user.uid,
        profileId,
        input,
        id,
      );
      onSaved("Acompañamiento registrado correctamente");
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal title="Registrar acompañamiento" onClose={onClose} busy={busy}>
      <form className="finance-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            Fecha
            <input
              type="date"
              min="2000-01-01"
              max="2099-12-31"
              required
              value={input.date}
              onChange={(e) => setInput({ ...input, date: e.target.value })}
            />
          </label>
          <label>
            Nota pastoral privada
            <textarea
              autoFocus
              data-autofocus
              required
              rows={5}
              maxLength={3000}
              value={input.note}
              onChange={(e) => setInput({ ...input, note: e.target.value })}
            />
          </label>
          <div className="form-grid">
            <label>
              Estado
              <select
                value={input.status}
                onChange={(e) =>
                  setInput({
                    ...input,
                    status: e.target.value as "pending" | "completed",
                  })
                }
              >
                <option value="pending">Pendiente</option>
                <option value="completed">Completado</option>
              </select>
            </label>
            <label>
              Próximo contacto (opcional)
              <input
                type="date"
                min="2000-01-01"
                max="2099-12-31"
                value={input.nextFollowUpDate}
                onChange={(e) =>
                  setInput({ ...input, nextFollowUpDate: e.target.value })
                }
              />
            </label>
          </div>
          <Notice error={error} />
        </fieldset>
        <div className="form-footer">
          <button
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button className="button-primary" disabled={busy}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
