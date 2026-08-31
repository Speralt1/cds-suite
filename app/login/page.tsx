"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, LockKeyhole, Sprout } from "lucide-react";
import { Brand } from "@/components/layout/brand";
import { SessionLoading } from "@/components/ui/session-loading";
import { useAuth } from "@/lib/auth/auth-provider";
import { getAuthErrorMessage } from "@/lib/auth/errors";

export default function LoginPage() {
  const { user, loading, initializationError, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user && !initializationError) router.replace("/dashboard");
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
    } catch (error) {
      setError(getAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || (user && !initializationError)) return <SessionLoading />;

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section
        className="relative flex flex-col overflow-hidden border-b border-line bg-[#edf1e9] px-7 py-7 sm:px-12 lg:border-r lg:border-b-0 lg:px-16 lg:py-12"
        aria-label="Casa de Salvación"
      >
        <Brand />
        <div className="my-auto hidden max-w-xl py-24 lg:block">
          <span className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#ced9c8] px-3 py-1.5 text-[10px] font-semibold tracking-[0.15em] text-primary">
            <span className="size-1.5 rounded-full bg-primary" />
            NUESTRA COMUNIDAD, CONECTADA
          </span>
          <h1 className="text-4xl leading-[1.13] font-medium tracking-[-0.045em] sm:text-5xl xl:text-6xl">
            Un espacio para
            <br />
            servir y crecer
            <br />
            <span className="text-primary">juntos.</span>
          </h1>
          <p className="mt-6 max-w-sm text-sm leading-7 text-muted">
            La administración de nuestra iglesia, en un solo lugar. Más orden
            para dedicar tiempo a lo que nos une.
          </p>
          <div className="mt-12 hidden items-center gap-4 border-t border-[#d6dfd1] pt-7 lg:flex">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-white/70">
              <Sprout
                className="size-6 text-primary"
                strokeWidth={1.5}
                aria-hidden="true"
              />
            </span>
            <div>
              <p className="text-sm font-medium">Casa de Salvación</p>
              <p className="mt-1 text-xs text-muted">
                Fe, comunidad y propósito.
              </p>
            </div>
          </div>
        </div>
        <p className="hidden text-xs text-muted lg:block">
          CDS Suite <span className="mx-2">·</span> Administración con propósito
        </p>
      </section>
      <section className="flex flex-col bg-white px-7 py-12 sm:px-12 lg:px-16">
        <div className="my-auto w-full max-w-sm self-center py-4 lg:py-12">
          <span className="mb-6 flex size-12 items-center justify-center rounded-2xl border border-line bg-canvas">
            <LockKeyhole
              className="size-5 text-primary"
              strokeWidth={1.5}
              aria-hidden="true"
            />
          </span>
          <p className="mb-3 text-[10px] font-semibold tracking-[0.17em] text-muted">
            BIENVENIDO A CDS ADMINISTRACIÓN
          </p>
          <h2 className="text-3xl font-medium tracking-tight">
            Qué bueno verte.
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted">
            Ingresa con tu cuenta para acceder a tu espacio de trabajo.
          </p>
          <form
            className="mt-9 space-y-5"
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
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="form-input"
                placeholder="Ingresa tu contraseña"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
                aria-describedby={error ? "login-error" : undefined}
              />
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
              className="button-primary mt-2 w-full"
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
          <p className="mt-7 text-center text-xs leading-6 text-muted">
            Acceso exclusivo para usuarios autorizados.
            <br />
            Si necesitas una cuenta, contacta al administrador.
          </p>
        </div>
        <p className="mt-10 text-center text-xs text-muted">
          Casa de Salvación <span className="mx-2 text-line">/</span> CDS Suite
          V0.1
        </p>
      </section>
    </main>
  );
}
