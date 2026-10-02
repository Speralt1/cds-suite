"use client";

import { createContext } from "react";

// Región de toasts ÚNICA de la preview. SuiteProvider la expone; el
// PreviewProvider de Finanzas delega en ella (y no renderiza su propia región
// role="status") cuando existe. Módulo mínimo para no arrastrar dependencias.

export interface SuiteToastValue {
  toast: (message: string, undo?: () => void) => void;
  /** Toast "{what}. Simulación: no se guardó nada." */
  simulate: (what?: string, undo?: () => void) => void;
}

export const SuiteToastContext = createContext<SuiteToastValue | null>(null);

export const SIMULATION_SUFFIX = "Simulación: no se guardó nada.";

export function simulationMessage(what?: string): string {
  return `${what ? `${what.replace(/\.$/, "")}. ` : ""}${SIMULATION_SUFFIX}`;
}
