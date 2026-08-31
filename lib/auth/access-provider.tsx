"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { useAuth } from "./auth-provider";
import { getFirebaseServices } from "../firebase";
import { isAuthorized } from "../finance/permissions";
import type { AccessUser } from "../finance/types";
import { SessionLoading } from "@/components/ui/session-loading";
const AccessContext = createContext<AccessUser | null>(null);
export function AccessProvider({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [access, setAccess] = useState<{
    uid: string;
    profile: AccessUser | null;
    error: string;
  } | null>(null);
  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(getFirebaseServices().db, "users", user.uid),
      { includeMetadataChanges: true },
      (snapshot) => {
        const profile = snapshot.exists()
          ? (snapshot.data() as AccessUser)
          : null;
        setAccess({
          uid: user.uid,
          profile:
            !snapshot.metadata.fromCache && isAuthorized(profile)
              ? profile
              : null,
          error: snapshot.metadata.fromCache
            ? "Se necesita conexión para verificar tu autorización."
            : "",
        });
      },
      () =>
        setAccess({
          uid: user.uid,
          profile: null,
          error:
            "No pudimos verificar tu acceso. Revisa tu conexión y las reglas de Firestore.",
        }),
    );
  }, [user]);
  if (!user || !access || access.uid !== user.uid) return <SessionLoading />;
  if (!access.profile)
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6">
        <p className="text-sm text-primary">CDS Administración</p>
        <h1 className="mt-5 text-3xl font-medium">
          Tu cuenta aún no tiene acceso autorizado a CDS Administración.
        </h1>
        <p className="mt-5 text-muted">
          Solicita al administrador que habilite tu cuenta. Tu correo es{" "}
          {user.email}.
        </p>
        {access.error && (
          <p role="alert" className="mt-4 text-danger">
            {access.error}
          </p>
        )}
        <button
          className="button-primary mt-8 self-start"
          onClick={() =>
            void logout().catch(() =>
              setAccess({
                ...access,
                error: "No se pudo cerrar la sesión. Intenta nuevamente.",
              }),
            )
          }
        >
          Cerrar sesión
        </button>
      </main>
    );
  return (
    <AccessContext.Provider
      key={`${user.uid}:${access.profile.role}`}
      value={access.profile}
    >
      {children}
    </AccessContext.Provider>
  );
}
export function useAccess() {
  const access = useContext(AccessContext);
  if (!access) throw new Error("Acceso no autorizado");
  return access;
}
