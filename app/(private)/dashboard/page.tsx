"use client";

import Link from "next/link";
import {
  ArrowRight,
  Wallet,
  HandHeart,
  CalendarDays,
  Users,
  Flag,
  LockKeyhole,
} from "lucide-react";

const upcomingModules = [
  {
    title: "Servicios",
    description: "Cada servicio, un mismo propósito.",
    icon: HandHeart,
  },
  {
    title: "Reuniones",
    description: "Espacios para encontrarnos.",
    icon: CalendarDays,
  },
  { title: "Equipos", description: "Personas que sirven juntas.", icon: Users },
  {
    title: "Objetivos",
    description: "Un camino compartido para crecer.",
    icon: Flag,
  },
];

export default function DashboardPage() {
  return (
    <>
      <div className="mb-10">
        <p className="mb-3 text-[10px] font-semibold tracking-[0.17em] text-primary">
          CASA DE SALVACIÓN
        </p>
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">
          CDS Administración
        </h1>
        <p className="mt-4 text-sm leading-6 text-muted">
          Hola, te damos la bienvenida. Este es tu espacio para organizar y
          servir.
        </p>
      </div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Tu espacio de trabajo</h2>
        <span className="text-xs text-muted">Todo comienza aquí</span>
      </div>
      <section
        className="relative overflow-hidden rounded-2xl border border-line bg-white p-7 sm:p-9"
        aria-labelledby="finance-title"
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-6 flex items-center gap-3">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-soft">
                <Wallet
                  className="size-6 text-primary"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              </span>
              <span className="rounded-full border border-line px-2.5 py-1 text-[10px] font-medium text-muted">
                Módulo inicial
              </span>
            </div>
            <h3
              id="finance-title"
              className="text-2xl font-medium tracking-tight"
            >
              Finanzas
            </h3>
            <p className="mt-3 text-sm leading-6 text-muted">
              Ingresos, gastos, diezmos y reportes financieros.
            </p>
            <Link className="button-primary mt-7" href="/finanzas">
              Ingresar
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
          <div className="hidden max-w-56 border-l border-line pl-9 sm:block">
            <p className="text-xs font-semibold tracking-wide text-primary">
              ORDEN PARA SERVIR
            </p>
            <p className="mt-3 text-sm leading-7 text-muted">
              Un lugar para cuidar los recursos que sostienen nuestra misión.
            </p>
            <p className="mt-4 text-xs text-muted">Estructura inicial · V0.1</p>
          </div>
        </div>
      </section>
      <section className="mt-10" aria-labelledby="upcoming-title">
        <div className="mb-5">
          <h2 id="upcoming-title" className="text-sm font-semibold">
            Lo que viene
          </h2>
          <p className="mt-1.5 text-xs leading-5 text-muted">
            Nuevos espacios que iremos construyendo juntos.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {upcomingModules.map(({ title, description, icon: Icon }) => (
            <article
              key={title}
              className="rounded-2xl border border-line bg-white/60 p-5"
              aria-label={`${title}, próximamente`}
            >
              <Icon
                className="mb-6 size-5 text-muted"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <h3 className="text-sm font-semibold">{title}</h3>
              <p className="mt-2 min-h-10 text-xs leading-5 text-muted">
                {description}
              </p>
              <span className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-sand px-2 py-1 text-[10px] font-medium text-muted">
                <LockKeyhole className="size-3" aria-hidden="true" />
                Próximamente
              </span>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
