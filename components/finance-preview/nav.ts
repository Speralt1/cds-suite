import {
  ArrowLeftRight,
  ChartColumn,
  Coffee,
  HandCoins,
  HandHeart,
  Inbox,
  LayoutDashboard,
  Scale,
  Settings,
  Target,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { FINANCE_SECTION_GROUPS } from "@/lib/suite-preview/modules";
import { FINANCE_BASE } from "@/lib/suite-preview/routes";
import type { Permission } from "@/lib/suite-preview/types";

// Navegación de Finanzas (fuente única: FINANCE_SECTION_GROUPS en
// lib/suite-preview/modules, con íconos como nombres). Aquí se expone con
// componentes lucide como NAV_GROUPS. shell.tsx re-exporta BASE y NAV_GROUPS
// para que las pantallas no cambien.
// R5 (doc 16 §10): Reportes y Configuración financieros viven en los módulos
// globales; la subnav conserva atajos "Reportes financieros ↗" y
// "Configuración financiera ↗" (este último solo con settings.manage).

export const BASE = FINANCE_BASE;

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: boolean;
  /** Atajo a otro módulo (↗). */
  shortcut?: boolean;
  requires?: Permission;
}

const ICON: Record<string, LucideIcon> = {
  LayoutDashboard,
  Inbox,
  ArrowLeftRight,
  Wallet,
  Scale,
  HandCoins,
  HandHeart,
  Coffee,
  Target,
  ChartColumn,
  Settings,
};

export const NAV_GROUPS: { label?: string; items: NavItem[] }[] = FINANCE_SECTION_GROUPS.map((g) => ({
  ...(g.label ? { label: g.label } : {}),
  items: g.items.map((s) => ({
    href: s.href,
    label: s.label,
    icon: ICON[s.icon] ?? LayoutDashboard,
    ...(s.badge ? { badge: true } : {}),
    ...(s.shortcut ? { shortcut: true } : {}),
    ...(s.requires ? { requires: s.requires } : {}),
  })),
}));

export const REGISTER_ACTIONS = [
  "Registrar efectivo",
  "Registrar diezmo",
  "Registrar gasto",
  "Otro movimiento",
] as const;
