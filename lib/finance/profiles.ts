import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import { parseDate } from "./formatters";
import type { ProfileInput, TitheProfile } from "./types";
export function validateProfile(input: ProfileInput) {
  if (!input.displayName.trim() || input.displayName.length > 120)
    throw new Error("Ingresa un nombre de hasta 120 caracteres.");
  if (
    input.phone.length > 40 ||
    input.email.length > 160 ||
    input.members.length > 600
  )
    throw new Error("Revisa la extensión de los datos de contacto.");
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))
    throw new Error("Ingresa un correo válido o deja el campo vacío.");
}
export async function saveProfile(
  db: Firestore,
  uid: string,
  input: ProfileInput,
  existing?: TitheProfile,
  id = doc(collection(db, "titheProfiles")).id,
) {
  validateProfile(input);
  await runTransaction(db, async (tx) => {
    const ref = doc(db, "titheProfiles", existing?.id || id);
    const current = await tx.get(ref);
    if (!existing && current.exists()) return; // Retry of an already confirmed create.
    if (
      existing &&
      (!current.exists() ||
        !current.data().updatedAt.isEqual(existing.updatedAt))
    )
      throw new Error(
        "La ficha cambió. Cierra el formulario y vuelve a abrirlo antes de editar.",
      );
    const stamp = serverTimestamp();
    tx.set(ref, {
      ...input,
      displayName: input.displayName.trim(),
      searchName: input.displayName.trim().toLowerCase(),
      members: input.type === "family" ? input.members.trim() : "",
      createdBy: existing?.createdBy || uid,
      createdAt: existing?.createdAt || stamp,
      updatedBy: uid,
      updatedAt: stamp,
    });
  });
  return existing?.id || id;
}
export async function addFollowup(
  db: Firestore,
  uid: string,
  profileId: string,
  input: {
    date: string;
    note: string;
    status: "pending" | "completed";
    nextFollowUpDate: string;
  },
  id: string,
) {
  if (!input.note.trim() || input.note.length > 3000)
    throw new Error("Escribe una nota de hasta 3.000 caracteres.");
  const date = parseDate(input.date);
  if (input.nextFollowUpDate) parseDate(input.nextFollowUpDate);
  await runTransaction(db, async (tx) => {
    const ref = doc(db, "pastoralFollowups", id);
    const old = await tx.get(ref);
    const p = await tx.get(doc(db, "titheProfiles", profileId));
    if (old.exists()) throw new Error("El acompañamiento ya fue registrado.");
    if (!p.exists() || p.data().pastoralContactAuthorized !== true)
      throw new Error("La ficha no tiene consentimiento de contacto pastoral.");
    const stamp = serverTimestamp();
    tx.set(ref, {
      ...input,
      note: input.note.trim(),
      date,
      profileId,
      createdBy: uid,
      createdAt: stamp,
      updatedBy: uid,
      updatedAt: stamp,
    });
  });
}
