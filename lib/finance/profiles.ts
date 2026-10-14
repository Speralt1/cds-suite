import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  where,
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
  /** Ficha archivada con el mismo nombre que cedió su clave a esta (gemelas antiguas). */
  releasedFrom?: string;
}
/** Ids de registro que apuntan a la ficha (máx. 10). Solo para fichas guardadas sin clave. */
async function keysOwnedBy(db: Firestore, profileId: string) {
  const s = await getDocs(
    query(
      collection(db, "titheProfileKeys"),
      where("profileId", "==", profileId),
      limit(10),
    ),
  );
  return s.docs.map((d) => d.id);
}
/** Señal interna: la clave es de una ficha ARCHIVADA y debe cederse antes de tomarla. */
class ArchivedOwner {
  constructor(readonly profileId: string) {}
}
/**
 * Cede la clave de una ficha archivada: la ficha queda sin `identityKey` y el registro se borra,
 * en un commit (las reglas lo permiten porque la ficha se escribe en el mismo commit y ya no
 * usa la clave). Si la ficha dejó de estar archivada o ya no tiene esa clave, no hace nada.
 */
async function releaseArchivedKey(
  db: Firestore,
  uid: string,
  ownerId: string,
  key: string,
): Promise<boolean> {
  return runTransaction(db, async (tx) => {
    const ownerRef = doc(db, "titheProfiles", ownerId);
    const keyRef = doc(db, "titheProfileKeys", key);
    const owner = await tx.get(ownerRef);
    const registry = await tx.get(keyRef);
    if (
      !owner.exists() ||
      owner.data().active !== false ||
      owner.data().identityKey !== key ||
      registry.data()?.profileId !== ownerId
    )
      return false;
    const data = { ...owner.data() };
    delete data.identityKey;
    tx.set(ownerRef, { ...data, updatedBy: uid, updatedAt: serverTimestamp() });
    tx.delete(keyRef);
    return true;
  });
}
function isPermissionDenied(e: unknown) {
  return (
    !!e &&
    typeof e === "object" &&
    "code" in e &&
    String((e as { code: unknown }).code).includes("permission-denied")
  );
}
/**
 * Crea o edita una ficha y su registro de identidad (titheProfileKeys/{identityKey}) en UNA
 * transacción (doc 27). Casos:
 * - alta: si la clave está libre, crea ficha + registro; si es de otra ficha, DuplicateProfileError.
 *   Un reintento con el mismo id ya confirmado no hace nada (idempotente).
 * - edición sin cambio de clave (incluida reactivación): no toca el registro.
 * - cambio de nombre con clave: registra la nueva y borra la anterior; si la nueva es de otra
 *   ficha, DuplicateProfileError.
 * - ficha antigua sin clave:
 *   - ACTIVA: registra su clave si está libre (o si ya apunta a ella). Si la tiene otra ficha
 *     ARCHIVADA con el mismo nombre (gemelas antiguas), esa ficha la cede primero (commit
 *     aparte) y esta la toma. Si la tiene otra ficha activa, guarda SIN clave y devuelve
 *     possibleDuplicateOf (nunca bloquea).
 *   - ARCHIVADA (se archiva ahora o ya lo estaba): no toma ninguna clave; así la gemela activa
 *     puede tomarla en su próxima edición.
 *   - borra los registros huérfanos que aún apunten a ella (los deja el cliente anterior al
 *     reescribir la ficha sin `identityKey`), salvo el que conserva.
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
  // Mismo nombre que ya tenía: única situación en la que una gemela archivada cede su clave.
  const sameName = !!existing && identityKey(existing.displayName) === key;
  const orphanCandidates =
    existing && !existing.identityKey ? await keysOwnedBy(db, profileId) : [];
  let possibleDuplicateOf: string | undefined;
  let releasedFrom: string | undefined;
  // Como máximo 3 intentos: uno con cesión desde una gemela archivada (una sola vez) y un
  // reintento si otra ficha tomó la misma clave libre a la vez (el alta del registro sobre un
  // documento ya existente se evalúa como update y las reglas responden permission-denied).
  let handoffTried = false;
  let claimRetried = false;
  for (;;) {
    const allowHandoff = !handoffTried;
    let claimed = false;
    try {
      await runTransaction(db, async (tx) => {
        possibleDuplicateOf = undefined;
        claimed = false;
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
        // Lecturas del registro (cada documento se lee una sola vez).
        const owners = new Map<string, string>();
        const ownerOf = async (k: string) => {
          if (!owners.has(k)) {
            const r = await tx.get(doc(db, "titheProfileKeys", k));
            owners.set(k, r.exists() ? String(r.data().profileId || "") : "");
          }
          return owners.get(k)!;
        };
        let keepKey = "";
        let claimKey = false;
        if (key && key === oldKey) keepKey = key;
        else if (key && existing && !oldKey && !input.active) {
          // Ficha antigua archivada: no reserva el nombre (lo libera para su gemela activa).
        } else if (key) {
          const owner = await ownerOf(key);
          if (!owner) {
            keepKey = key;
            claimKey = true;
          } else if (owner === profileId) keepKey = key; // Registry already points here.
          else {
            if (allowHandoff && existing && sameName && input.active) {
              const o = await tx.get(doc(db, "titheProfiles", owner));
              if (
                o.exists() &&
                o.data().active === false &&
                o.data().identityKey === key
              )
                throw new ArchivedOwner(owner);
            }
            // Solo se tolera (aviso) si la ficha antigua conserva su nombre. Un cambio de
            // nombre hacia un nombre ya registrado se rechaza también en fichas antiguas.
            if (existing && !oldKey && sameName) possibleDuplicateOf = owner;
            else throw new DuplicateProfileError(owner, key);
          }
        }
        const orphans: string[] = [];
        for (const k of orphanCandidates)
          if (k !== keepKey && (await ownerOf(k)) === profileId) orphans.push(k);
        const stamp = serverTimestamp();
        claimed = claimKey;
        if (claimKey)
          tx.set(doc(db, "titheProfileKeys", keepKey), {
            profileId,
            createdBy: uid,
            createdAt: stamp,
          });
        if (oldKey && oldKey !== keepKey)
          tx.delete(doc(db, "titheProfileKeys", oldKey));
        for (const k of orphans)
          if (k !== oldKey) tx.delete(doc(db, "titheProfileKeys", k));
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
      break;
    } catch (e) {
      if (e instanceof ArchivedOwner) {
        handoffTried = true;
        // Si la cesión falla, se sigue sin ella: nunca bloquea editar una ficha antigua
        // (el siguiente intento avisa possibleDuplicateOf).
        try {
          if (await releaseArchivedKey(db, uid, e.profileId, key))
            releasedFrom = e.profileId;
        } catch {
          /* sin cesión */
        }
        continue;
      }
      if (claimed && !claimRetried && isPermissionDenied(e)) {
        // Otra ficha registró la misma clave entre la lectura y el commit: se vuelve a leer y
        // se resuelve como corresponde (aviso, DuplicateProfileError o «La ficha cambió»).
        claimRetried = true;
        continue;
      }
      throw e;
    }
  }
  return {
    id: profileId,
    ...(possibleDuplicateOf ? { possibleDuplicateOf } : {}),
    ...(releasedFrom ? { releasedFrom } : {}),
  };
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
