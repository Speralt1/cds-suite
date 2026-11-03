"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { AleroMark } from "@/components/layout/alero-mark";
import { SessionLoading } from "@/components/ui/session-loading";
import { useAuth } from "@/lib/auth/auth-provider";
import { getAuthErrorMessage } from "@/lib/auth/errors";
import { markLandingIntent } from "@/lib/access/landing-intent";
import styles from "./login.module.css";

export default function LoginPage() {
  const { user, loading, initializationError, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user && !initializationError) {
      // La URL sigue siendo /finanzas; RouteGuard resuelve el módulo inicial.
      markLandingIntent();
      router.replace("/finanzas");
    }
  }, [user, loading, initializationError, router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    if (!email.trim() || !password) {
      setError("Completa tu correo y contraseña para ingresar.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Ingresa un correo electrónico válido.");
      return;
    }
    setSubmitting(true);
    try {
      await login(email, password);
      setPassword("");
      setShowPassword(false);
    } catch (error) {
      setError(getAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || (user && !initializationError)) return <SessionLoading />;

  return (
    <main className={styles.page}>
      <section className={styles.intro} aria-label="Alero · Casa de Salvación">
        <svg className={styles.eave} viewBox="0 0 400 160" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path d="M-20 150 200 10l220 140" />
        </svg>
        <div className={styles.lockup}>
          <span className={styles.mark}>
            <AleroMark />
          </span>
          <span>
            <span className={styles.wordmark}>Alero</span>
            <span className={styles.church}>Casa de Salvación</span>
          </span>
        </div>
        <div className={styles.introBody}>
          <p className={styles.title}>Al alero de la casa, cada persona y cada peso tienen quién los cuide.</p>
          <ul className={styles.modules} aria-label="Lo que encontrarás según tus permisos">
            <li>Finanzas</li>
            <li>Calendario</li>
            <li>Integrantes</li>
          </ul>
        </div>
      </section>
      <section className={styles.access} aria-labelledby="login-title">
        <div className={styles.formWrap}>
          <h1 id="login-title" className={styles.formTitle}>
            Iniciar sesión
          </h1>
          <p className={styles.formDescription}>Usa el correo con el que te invitó el administrador.</p>
          <form
            className={styles.form}
            onSubmit={handleSubmit}
            noValidate
            aria-label="Iniciar sesión"
            aria-busy={submitting}
          >
            <div>
              <label htmlFor="email" className="mb-2 block text-sm font-medium">
                Correo electrónico
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                className="form-input"
                placeholder="tu@correo.cl"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={submitting}
                aria-describedby={error ? "login-error" : undefined}
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-medium"
              >
                Contraseña
              </label>
              <div className={styles.password}>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  className="form-input"
                  placeholder="Ingresa tu contraseña"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={submitting}
                  aria-describedby={error ? "login-error" : undefined}
                />
                <button
                  type="button"
                  className={styles.reveal}
                  aria-label={
                    showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                  }
                  aria-pressed={showPassword}
                  aria-controls="password"
                  onClick={() => setShowPassword((visible) => !visible)}
                  disabled={submitting}
                >
                  {showPassword ? (
                    <EyeOff size={18} aria-hidden="true" />
                  ) : (
                    <Eye size={18} aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
            {(error || initializationError) && (
              <p
                id="login-error"
                role="alert"
                className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm leading-6 text-danger"
              >
                {initializationError || error}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting || !!initializationError}
              className={`button-primary ${styles.submit}`}
            >
              {submitting ? (
                <>
                  <LoaderCircle
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                  Ingresando…
                </>
              ) : (
                <>
                  Ingresar
                  <ArrowRight className="size-4" aria-hidden="true" />
                </>
              )}
            </button>
          </form>
          <details className={styles.help}>
            <summary>¿Es tu primer ingreso?</summary>
            <p>
              Abre el correo de acceso y define tu contraseña desde el enlace. Si no lo encuentras, revisa Spam o pide al
              administrador que te reenvíe el acceso. Nadie de la iglesia te pedirá tu contraseña.
            </p>
          </details>
        </div>
        <p className={styles.accessFooter}>Acceso solo para personas autorizadas por Casa de Salvación.</p>
      </section>
    </main>
  );
}
