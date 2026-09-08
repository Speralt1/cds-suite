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
import { errorMessage } from "@/lib/finance/formatters";
import {
  validateManagedUserCreate,
  validateManagedUserUpdate,
  type ManagedUser,
  type ManagedUserCreate,
  type ManagedUserUpdate,
} from "./users";

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
            error: errorMessage(error),
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
  input: ManagedUserCreate,
) {
  const valid = validateManagedUserCreate(input);
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
      await setDoc(doc(db, "users", credential.user.uid), {
        displayName: valid.displayName,
        email: valid.email,
        role: valid.role,
        active: true,
        createdAt: serverTimestamp(),
      });
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

export async function updateManagedUser(
  db: Firestore,
  currentUid: string,
  targetUid: string,
  update: ManagedUserUpdate,
) {
  const valid = validateManagedUserUpdate(
    currentUid,
    targetUid,
    update,
  );

  await updateDoc(doc(db, "users", targetUid), valid);
}
