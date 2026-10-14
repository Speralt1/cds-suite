import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import { identityKey } from "../shared/names";
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
/** Otra ficha ya usa la misma clave de identidad (mismo nombre normalizado). */
export class DuplicateProfileError extends Error {
  readonly profileId: string;
  readonly identityKey: string;
  constructor(profileId: string, key: string) {
    super(
      "Ya existe una ficha con este nombre. Usa la ficha existente o distingue el nombre (por ejemplo, con el segundo apellido o una referencia).",
    );
    this.name = "DuplicateProfileError";
    this.profileId = profileId;
    this.identityKey = key;
  }
}
export function isDuplicateProfileError(e: unknown): e is DuplicateProfileError {
  return e instanceof DuplicateProfileError;
}
export interface SaveProfileResult {
  id: string;
  /**
   * Ficha antigua (sin clave) cuyo nombre ya está registrado por OTRA ficha: se guardó igual,
   * sin clave, y la interfaz avisa "Posible ficha duplicada". Nunca bloquea editar un registro antiguo.
   */
  possibleDuplicateOf?: string;
}
/**
 * Crea o edita una ficha y su registro de identidad (titheProfileKeys/{identityKey}) en UNA
 * transacción (doc 27). Casos:
 * - alta: si la clave está libre, crea ficha + registro; si es de otra ficha, DuplicateProfileError.
 *   Un reintento con el mismo id ya confirmado no hace nada (idempotente).
 * - edición sin cambio de clave (incluida reactivación): no toca el registro.
 * - cambio de nombre con clave: registra la nueva y borra la anterior; si la nueva es de otra
 *   ficha, DuplicateProfileError.
 * - ficha antigua sin clave: registra su clave si está libre (o si ya apunta a ella); si es de
 *   otra ficha, guarda SIN clave y devuelve possibleDuplicateOf.
 */
export async function saveProfile(
  db: Firestore,
  uid: string,
  input: ProfileInput,
  existing?: TitheProfile,
  id = doc(collection(db, "titheProfiles")).id,
): Promise<SaveProfileResult> {
  validateProfile(input);
  const profileId = existing?.id || id;
  const key = identityKey(input.displayName);
  let possibleDuplicateOf: string | undefined;
  await runTransaction(db, async (tx) => {
    possibleDuplicateOf = undefined;
    const ref = doc(db, "titheProfiles", profileId);
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
    const oldKey: string = (existing && current.data()?.identityKey) || "";
    let keepKey = "";
    let claimKey = false;
    if (key && key === oldKey) keepKey = key;
    else if (key) {
      const registry = await tx.get(doc(db, "titheProfileKeys", key));
      const owner = registry.exists()
        ? String(registry.data().profileId || "")
        : "";
      if (!owner) {
        keepKey = key;
        claimKey = true;
      } else if (owner === profileId) keepKey = key; // Registry already points here.
      else if (existing && !oldKey) possibleDuplicateOf = owner;
      else throw new DuplicateProfileError(owner, key);
    }
    const stamp = serverTimestamp();
    if (claimKey)
      tx.set(doc(db, "titheProfileKeys", keepKey), {
        profileId,
        createdBy: uid,
        createdAt: stamp,
      });
    if (oldKey && oldKey !== keepKey)
      tx.delete(doc(db, "titheProfileKeys", oldKey));
    tx.set(ref, {
      ...input,
      displayName: input.displayName.trim(),
      searchName: input.displayName.trim().toLowerCase(),
      ...(keepKey ? { identityKey: keepKey } : {}),
      members: input.type === "family" ? input.members.trim() : "",
      createdBy: existing?.createdBy || uid,
      createdAt: existing?.createdAt || stamp,
      updatedBy: uid,
      updatedAt: stamp,
    });
  });
  return possibleDuplicateOf
    ? { id: profileId, possibleDuplicateOf }
    : { id: profileId };
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
