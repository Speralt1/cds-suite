"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import {
  ChartNoAxesCombined,
  ArrowLeftRight,
  HeartHandshake,
  FileChartColumn,
  Construction,
  type LucideIcon,
} from "lucide-react";

const sections: {
  id: string;
  label: string;
  icon: LucideIcon;
  title: string;
  description: string;
}[] = [
  {
    id: "resumen",
    label: "Resumen",
    icon: ChartNoAxesCombined,
    title: "Una visión clara de los recursos",
    description:
      "Aquí encontrarás el resumen financiero de Casa de Salvación. Los indicadores se incorporarán en una próxima versión.",
  },
  {
    id: "movimientos",
    label: "Movimientos",
    icon: ArrowLeftRight,
    title: "Cada movimiento, en su lugar",
    description:
      "Este espacio reunirá los ingresos y gastos. El registro de movimientos estará disponible en una próxima versión.",
  },
  {
    id: "diezmos",
    label: "Diezmos",
    icon: HeartHandshake,
    title: "Un espacio para la generosidad",
    description:
      "Aquí se organizará el seguimiento de diezmos. Esta versión todavía no permite registrar ni consultar aportes.",
  },
  {
    id: "reportes",
    label: "Reportes",
    icon: FileChartColumn,
    title: "Información para acompañar las decisiones",
    description:
      "Este espacio reunirá los reportes financieros. La generación de informes y PDF se incorporará más adelante.",
  },
];

export function FinanceWorkspace() {
  const [activeIndex, setActiveIndex] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = sections[activeIndex];
  const Icon = active.icon;

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (index + 1) % sections.length;
        break;
      case "ArrowLeft":
        nextIndex = (index - 1 + sections.length) % sections.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = sections.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    setActiveIndex(nextIndex);
    tabs.current[nextIndex]?.focus();
  }

  return (
    <section>
      <div
        className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-white p-1.5 sm:flex"
        role="tablist"
        aria-label="Secciones de Finanzas"
      >
        {sections.map(({ id, label, icon: TabIcon }, index) => (
          <button
            key={id}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            type="button"
            id={`tab-${id}`}
            role="tab"
            aria-selected={index === activeIndex}
            aria-controls={`panel-${id}`}
            tabIndex={index === activeIndex ? 0 : -1}
            onClick={() => setActiveIndex(index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-xs font-medium transition-colors sm:flex-1 sm:text-sm ${index === activeIndex ? "bg-primary-soft text-primary" : "text-muted hover:bg-canvas"}`}
          >
            <TabIcon className="size-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      {sections.map(({ id }, index) => (
        <div
          key={id}
          id={`panel-${id}`}
          role="tabpanel"
          aria-labelledby={`tab-${id}`}
          tabIndex={0}
          hidden={index !== activeIndex}
          className="mt-6 rounded-2xl border border-line bg-white px-6 py-16 text-center sm:py-22"
        >
          {index === activeIndex && (
            <>
              <span className="mx-auto mb-6 flex size-16 items-center justify-center rounded-2xl bg-primary-soft">
                <Icon
                  className="size-7 text-primary"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              </span>
              <p className="mb-3 text-[10px] font-semibold tracking-[0.16em] text-muted">
                {active.label.toUpperCase()}
              </p>
              <h2 className="text-2xl font-medium tracking-tight">
                {active.title}
              </h2>
              <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-muted">
                {active.description}
              </p>
              <span className="mt-7 inline-flex items-center gap-2 rounded-full border border-line bg-canvas px-3 py-1.5 text-xs text-muted">
                <Construction className="size-3.5" aria-hidden="true" />
                Próximamente
              </span>
            </>
          )}
        </div>
      ))}
      <p className="mt-5 text-xs leading-6 text-muted">
        Esta es la estructura inicial del módulo. No se muestran estadísticas ni
        se registran datos financieros.
      </p>
    </section>
  );
}
