"use client";

import { useEffect, useState } from "react";
import { deleteApp, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  inMemoryPersistence,
  sendPasswordResetEmail,
  setPersistence,
  signOut,
  type Auth,
} from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { getFirebaseServices } from "@/lib/firebase";
import { settingsLoadError } from "./errors";
import { LEGACY_ROLE_ACCESS, deriveLegacyRole, normalizeAccess } from "@/lib/shared/access";
import {
  accessDraftForCreate,
  accessDraftFromUser,
  buildUserAccessV1Fields,
  buildUserDocV1,
  validateManagedUserAccessV1,
  validateManagedUserCreate,
  validateManagedUserUpdate,
  type AccessDraft,
  type ManagedUser,
  type ManagedUserCreate,
  type ManagedUserLike,
  type ManagedUserUpdate,
} from "./users";

/** Acceso v1 opcional del alta (sin él, se usa el mapeo del rol). */
export type ManagedUserCreateAccess = Omit<AccessDraft, "displayName" | "active">;

function actorUidOf(auth: Auth): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Tu sesión expiró. Vuelve a ingresar para continuar.");
  return uid;
}

export function useManagedUsers() {
  const [state, setState] = useState<{
    data: ManagedUser[];
    loading: boolean;
    error: string;
  }>({
    data: [],
    loading: true,
    error: "",
  });

  useEffect(
    () =>
      onSnapshot(
        query(
          collection(getFirebaseServices().db, "users"),
          orderBy("displayName"),
        ),
        (snapshot) =>
          setState({
            data: snapshot.docs.map(
              (item) => ({ id: item.id, ...item.data() }) as ManagedUser,
            ),
            loading: false,
            error: "",
          }),
        (error) =>
          setState({
            data: [],
            loading: false,
            error: settingsLoadError(error, "los usuarios"),
          }),
      ),
    [],
  );

  return state;
}

function temporaryPassword() {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#";

  const bytes = crypto.getRandomValues(new Uint8Array(24));

  return Array.from(
    bytes,
    (value) => alphabet[value % alphabet.length],
  ).join("");
}

export async function createManagedUser(
  db: Firestore,
  primaryAuth: Auth,
  input: ManagedUserCreate & { access?: ManagedUserCreateAccess },
) {
  // El rol legacy se conserva siempre: con acceso v1 explícito se deriva de él.
  const role = input.access
    ? deriveLegacyRole(input.access.baseRole, input.access.permissions)
    : input.role;
  const valid = validateManagedUserCreate({ ...input, role });
  const actorUid = actorUidOf(primaryAuth);
  const draft = validateManagedUserAccessV1(
    actorUid,
    "",
    accessDraftForCreate({ displayName: valid.displayName, role: valid.role }, input.access),
  );
  const primaryApp = getFirebaseServices().app;

  const secondaryApp = initializeApp(
    primaryApp.options,
    `cds-user-create-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`,
  );

  const secondaryAuth = getAuth(secondaryApp);

  await setPersistence(secondaryAuth, inMemoryPersistence);

  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      valid.email,
      temporaryPassword(),
    );

    try {
      await setDoc(
        doc(db, "users", credential.user.uid),
        buildUserDocV1(draft, {
          email: valid.email,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: actorUid,
        }),
      );
    } catch (error) {
      await deleteUser(credential.user).catch(() => undefined);
      throw error;
    }

    let resetEmailSent = true;
    let resetEmailError = "";

    try {
      primaryAuth.languageCode = "es";

      await sendPasswordResetEmail(
        primaryAuth,
        valid.email,
        {
          url: "https://cds-administracion.web.app/login",
          handleCodeInApp: false,
        },
      );
    } catch (error) {
      resetEmailSent = false;

      resetEmailError =
        error instanceof Error
          ? error.message
          : "Firebase no pudo enviar el correo de acceso.";

      console.error("Error enviando acceso a usuario:", error);
    }

    return {
      uid: credential.user.uid,
      resetEmailSent,
      resetEmailError,
    };
  } finally {
    await signOut(secondaryAuth).catch(() => undefined);
    await deleteApp(secondaryApp).catch(() => undefined);
  }
}

export async function resendPasswordSetup(
  auth: Auth,
  email: string,
) {
  auth.languageCode = "es";

  await sendPasswordResetEmail(
    auth,
    email.trim().toLowerCase(),
    {
      url: "https://cds-administracion.web.app/login",
      handleCodeInApp: false,
    },
  );
}

/**
 * Edición clásica {displayName, role, active}. Escribe siempre el payload v1:
 * si el documento es legacy (o cambia el rol) se promueve con el mapeo exacto
 * del rol; si ya es v1 y el rol no cambia, conserva su acceso v1.
 */
export async function updateManagedUser(
  db: Firestore,
  currentUid: string,
  targetUid: string,
  update: ManagedUserUpdate,
  current?: ManagedUserLike,
) {
  const valid = validateManagedUserUpdate(
    currentUid,
    targetUid,
    update,
  );

  const profile = current ? normalizeAccess(current) : null;
  const keepV1 =
    !!current &&
    profile?.schema === "v1" &&
    deriveLegacyRole(profile.baseRole, profile.permissions) === valid.role;
  const mapped = LEGACY_ROLE_ACCESS[valid.role];
  const draft: AccessDraft = keepV1
    ? { ...accessDraftFromUser(current), displayName: valid.displayName, active: valid.active }
    : {
        displayName: valid.displayName,
        active: valid.active,
        baseRole: mapped.baseRole,
        position: mapped.position,
        permissions: [...mapped.permissions],
        areaIds: [],
        homeModule: mapped.homeModule,
      };

  await updateDoc(
    doc(db, "users", targetUid),
    { ...buildUserAccessV1Fields(draft, { updatedAt: serverTimestamp(), updatedBy: currentUid }) },
  );
}

/**
 * Guarda el acceso v1 completo de una persona (editor nuevo). Valida la
 * auto-protección y que quede al menos un administrador activo en `users`.
 * `email` y `createdAt` no se tocan (son inmutables).
 */
export async function updateManagedUserAccess(
  db: Firestore,
  currentUid: string,
  targetUid: string,
  draft: AccessDraft,
  users: readonly ManagedUserLike[],
) {
  const valid = validateManagedUserAccessV1(currentUid, targetUid, draft, users);
  await updateDoc(
    doc(db, "users", targetUid),
    { ...buildUserAccessV1Fields(valid, { updatedAt: serverTimestamp(), updatedBy: currentUid }) },
  );
  return valid;
}

/** Quitar o devolver el acceso, a partir de lo guardado (promueve a v1 si es legacy). */
export async function setManagedUserActive(
  db: Firestore,
  currentUid: string,
  target: ManagedUserLike,
  active: boolean,
  users: readonly ManagedUserLike[],
) {
  return updateManagedUserAccess(
    db,
    currentUid,
    target.id,
    { ...accessDraftFromUser(target), active },
    users,
  );
}
