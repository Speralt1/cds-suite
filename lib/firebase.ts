import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

// Access each NEXT_PUBLIC value explicitly so Next.js can inline it at build time.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Object.values(firebaseConfig).every(
  (value) => typeof value === "string" && value.trim().length > 0,
);

// Lazy initialization keeps builds independent of credentials and avoids auth on SSR.
// The default app is reused during hot reload; Firestore performs no reads or writes.
export function getFirebaseServices() {
  if (!isFirebaseConfigured) {
    throw new Error(
      "Falta configurar Firebase. Revisa las variables de .env.local.",
    );
  }

  const isNew = !getApps().length;
  const app = isNew ? initializeApp(firebaseConfig) : getApp();
  const auth = getAuth(app);
  // Opt-in local verification only. Never connects a production build to an emulator.
  if (
    process.env.NODE_ENV === "development" &&
    (process.env.NEXT_PUBLIC_USE_AUTH_EMULATOR === "true" ||
      process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true") &&
    !auth.emulatorConfig
  ) {
    if (!firebaseConfig.projectId?.startsWith("demo-")) {
      throw new Error("Local auth tests require a demo- Firebase project.");
    }
    connectAuthEmulator(auth, "http://127.0.0.1:9099");
  }
  const db = getFirestore(app);
  if (
    isNew &&
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true"
  ) {
    if (!firebaseConfig.projectId?.startsWith("demo-"))
      throw new Error("Firestore emulator requires a demo project.");
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
  return { app, auth, db };
}
