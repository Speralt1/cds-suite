"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { useAuth } from "./auth-provider";
import { getFirebaseServices } from "../firebase";
import { isAuthorized } from "../finance/permissions";
import type { AccessUser } from "../finance/types";
import { SessionLoading } from "@/components/ui/session-loading";
import { useOnlineStatus } from "@/lib/browser/online";
const AccessContext = createContext<AccessUser | null>(null);
export function AccessProvider({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const online = useOnlineStatus();
  const [access, setAccess] = useState<{
    uid: string;
    profile: AccessUser | null;
    error: string;
    awaitingServer: boolean;
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
        if (snapshot.metadata.fromCache) {
          setAccess((current) => ({
            uid: user.uid,
            profile: current?.uid === user.uid ? current.profile : null,
            error: "",
            awaitingServer: !(current?.uid === user.uid && current.profile),
          }));
          return;
        }
        setAccess({
          uid: user.uid,
          profile: isAuthorized(profile) ? profile : null,
          error: "",
          awaitingServer: false,
        });
      },
      () =>
        setAccess({
          uid: user.uid,
          profile: null,
          error:
            "No pudimos verificar tu acceso. Revisa tu conexión y las reglas de Firestore.",
          awaitingServer: false,
        }),
    );
  }, [user]);
  if (
    !user ||
    !access ||
    access.uid !== user.uid ||
    (access.awaitingServer && online)
  )
    return <SessionLoading />;
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
        {(access.error || (!online && access.awaitingServer)) && (
          <p role="alert" className="mt-4 text-danger">
            {access.error ||
              "Sin conexión: no pudimos confirmar tu autorización."}
          </p>
        )}
        <button
          className="button-primary mt-8 self-start"
          onClick={() =>
            void logout().catch(() =>
              setAccess({
                ...access,
                error: "No se pudo cerrar la sesión. Intenta nuevamente.",
                awaitingServer: false,
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
