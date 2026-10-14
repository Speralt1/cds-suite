"use client";

// Control "Aa" · tamaño del texto (Design Lock 28 §C4).
// - Botón de 44×44 "Aa" con aria-label "Tamaño del texto (actual: Normal)".
// - ≥768: popover role="dialog" junto al botón; <768: la misma lista en `Sheet`.
// - 3 radios en filas de 3rem: Normal · 100 %, Grande · 110 %, Muy grande · 125 %.
// - Se aplica al instante (font-size de <html>) y se anuncia con role="status".
// - Esc cierra y devuelve el foco al botón. Se guarda en este dispositivo.
// El popover/hoja solo se monta abierto: el shell conserva una única región
// role="status" mientras está cerrado.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  TEXT_SIZE_OPTIONS,
  textSizeLabel,
  useMediaQuery,
  useTextSize,
  type TextSize,
} from "@/lib/ui/preferences";
import { Sheet } from "./sheet";

const POPOVER_QUERY = "(min-width: 768px)";
/** Muestra de cada fila: 14px (cuerpo) al porcentaje de la opción, fija. */
const SAMPLE_PX = 14;

function optionText(label: string, percent: number) {
  return `${label} · ${percent} %`;
}

function TextSizeOptions({
  value,
  onChange,
  announcement,
}: {
  value: TextSize;
  onChange: (value: TextSize) => void;
  announcement: string;
}) {
  const name = useId();
  return (
    <>
      <fieldset className="text-size-options">
        <legend className="sr-only">Tamaño del texto</legend>
        {TEXT_SIZE_OPTIONS.map((o) => (
          <label key={o.value} className="text-size-option">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span className="text-size-option-text">{optionText(o.label, o.percent)}</span>
            <span
              className="text-size-option-sample"
              style={{ fontSize: `${(SAMPLE_PX * o.percent) / 100}px` }}
              aria-hidden="true"
            >
              Aa
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-size-help">Se guarda en este dispositivo.</p>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </>
  );
}

export function TextSizeControl({ className = "" }: { className?: string }) {
  const [value, setValue] = useTextSize();
  const [open, setOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const popoverMode = useMediaQuery(POPOVER_QUERY);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const current = textSizeLabel(value);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setAnnouncement("");
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  function change(next: TextSize) {
    setValue(next);
    const option = TEXT_SIZE_OPTIONS.find((o) => o.value === next);
    if (option) setAnnouncement(`Tamaño del texto: ${optionText(option.label, option.percent)}`);
  }

  // Popover: foco inicial en la opción marcada; Esc y clic fuera cierran.
  useEffect(() => {
    if (!open || !popoverMode) return;
    popoverRef.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    }
    function onPointer(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && !popoverRef.current?.contains(target) && !buttonRef.current?.contains(target)) close(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
    // Solo al abrir: el foco no debe saltar al cambiar de opción.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, popoverMode]);

  return (
    <div className={`text-size-control ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        className="text-size-button"
        aria-label={`Tamaño del texto (actual: ${current})`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <span aria-hidden="true">Aa</span>
      </button>
      {open && popoverMode && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-labelledby={titleId}
          className="text-size-popover"
          onBlur={(event) => {
            // Tab fuera del popover lo cierra (sin mover el foco).
            const next = event.relatedTarget as Node | null;
            if (next && !popoverRef.current?.contains(next) && next !== buttonRef.current) close(false);
          }}
        >
          <h2 id={titleId} className="text-size-title">
            Tamaño del texto
          </h2>
          <TextSizeOptions value={value} onChange={change} announcement={announcement} />
        </div>
      )}
      {open && !popoverMode && (
        <Sheet title="Tamaño del texto" onClose={() => close(false)}>
          <TextSizeOptions value={value} onChange={change} announcement={announcement} />
        </Sheet>
      )}
    </div>
  );
}
