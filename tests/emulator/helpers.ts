// Helpers del smoke con emuladores (npm run test:emulator). Solo proyecto
// demo-cds-suite y hosts locales; se niegan a correr en cualquier otro caso.
import {
  SEED_AUTH_HOST,
  SEED_FIRESTORE_HOST,
  SEED_FUNCTIONS_ORIGIN,
  SEED_PASSWORD,
  SEED_PROJECT,
  SEED_REGION,
  runSeed,
  type SeedResult,
} from "../../scripts/seed-platform-calendar-emulator.mjs";

export const FEED_URL = `${SEED_FUNCTIONS_ORIGIN}/${SEED_PROJECT}/${SEED_REGION}/calendarPublicFeed`;
export const CALLABLE_URL = `${SEED_FUNCTIONS_ORIGIN}/${SEED_PROJECT}/${SEED_REGION}/calendarShareLinkManage`;

/** Entorno del seed: exige que emulators:exec haya fijado los hosts locales. */
export function emulatorEnv(): NodeJS.ProcessEnv {
  const project = process.env.GCLOUD_PROJECT || SEED_PROJECT;
  if (!project.startsWith("demo-")) throw new Error(`Proyecto no demo: ${project}`);
  return {
    ...process.env,
    CDS_SEED_LOCAL: "true",
    FIRESTORE_EMULATOR_HOST: SEED_FIRESTORE_HOST,
    FIREBASE_AUTH_EMULATOR_HOST: SEED_AUTH_HOST,
    GCLOUD_PROJECT: SEED_PROJECT,
  };
}

export async function seed(): Promise<SeedResult> {
  const env = emulatorEnv();
  // El Admin SDK del seed lee estas variables del proceso.
  process.env.FIRESTORE_EMULATOR_HOST = env.FIRESTORE_EMULATOR_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = env.FIREBASE_AUTH_EMULATOR_HOST;
  return runSeed({ env });
}

export interface FeedResponse {
  status: number;
  text: string;
  headers: Record<string, string | null>;
}

export async function fetchFeed(token: string | null): Promise<FeedResponse> {
  const url = token === null ? FEED_URL : `${FEED_URL}?t=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const text = await res.text();
  const pick = (name: string) => res.headers.get(name);
  return {
    status: res.status,
    text,
    headers: {
      "content-type": pick("content-type"),
      "cache-control": pick("cache-control"),
      "referrer-policy": pick("referrer-policy"),
      "x-robots-tag": pick("x-robots-tag"),
    },
  };
}

/** ID token del emulador de Auth (cuentas ficticias del seed). */
export async function signIn(email: string): Promise<string> {
  const res = await fetch(`http://${SEED_AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: SEED_PASSWORD, returnSecureToken: true }),
  });
  const json = (await res.json()) as { idToken?: string; error?: { message?: string } };
  if (!json.idToken) throw new Error(`No se pudo iniciar sesión en el emulador: ${json.error?.message ?? res.status}`);
  return json.idToken;
}

export interface CallableResult {
  status: number;
  result?: { status?: Record<string, unknown>; token?: string };
  error?: { status?: string; message?: string };
}

/** Protocolo callable HTTP: POST {data} → {result} | {error}. */
export async function callShareLink(idToken: string | null, action: string): Promise<CallableResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(CALLABLE_URL, { method: "POST", headers, body: JSON.stringify({ data: { action } }) });
  const json = (await res.json()) as Omit<CallableResult, "status">;
  return { status: res.status, ...json };
}
