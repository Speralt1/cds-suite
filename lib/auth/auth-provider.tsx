"use client";

import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import { createContext, useContext, useEffect, useState } from "react";
import { getFirebaseServices, isFirebaseConfigured } from "@/lib/firebase";
import { getAuthErrorMessage } from "@/lib/auth/errors";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  initializationError: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState<Auth | null>(null);
  const [initializationError, setInitializationError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    async function initialize() {
      try {
        if (!isFirebaseConfigured) {
          if (active) {
            setInitializationError(
              "La aplicación aún no está configurada. Contacta al administrador para conectar Firebase.",
            );
            setLoading(false);
          }
          return;
        }

        const { auth: firebaseAuth } = getFirebaseServices();
        await setPersistence(firebaseAuth, browserLocalPersistence);
        if (!active) return;
        setAuth(firebaseAuth);
        unsubscribe = onAuthStateChanged(
          firebaseAuth,
          (currentUser) => {
            if (!active) return;
            setUser(currentUser);
            setLoading(false);
          },
          (error) => {
            if (!active) return;
            setUser(null);
            setInitializationError(getAuthErrorMessage(error));
            setLoading(false);
          },
        );
      } catch (error) {
        if (active) {
          setInitializationError(getAuthErrorMessage(error));
          setLoading(false);
        }
      }
    }

    void initialize();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  async function login(email: string, password: string) {
    if (!auth || initializationError)
      throw new Error("Authentication is not ready");
    await signInWithEmailAndPassword(auth, email.trim(), password);
    // Navigation is driven by onAuthStateChanged, never by a guessed session.
  }

  async function logout() {
    if (!auth) throw new Error("Authentication is not ready");
    await signOut(auth);
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, initializationError, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
