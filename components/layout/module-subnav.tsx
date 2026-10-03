"use client";

// Subnav de un módulo dentro del contenido (18 §10 R1, 18a §G.4): el mismo
// estilo visual que `FinanceNav` (que no se toca) para Calendario,
// Configuración y Reportes. Activa el ítem con el href más largo que coincide.

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { normalizePath } from "@/lib/access/routes";

export interface ModuleSubnavItem {
  href: string;
  label: string;
  icon?: LucideIcon;
}

function matches(path: string, href: string) {
  return path === href || path.startsWith(`${href}/`);
}

/** Href del ítem activo: el más largo que coincide con la ruta. */
export function activeSubnavHref(pathname: string, items: readonly ModuleSubnavItem[]): string | null {
  const path = normalizePath(pathname);
  let best: string | null = null;
  for (const { href } of items) {
    const h = normalizePath(href);
    if (matches(path, h) && (!best || h.length > best.length)) best = h;
  }
  return best;
}

export function ModuleSubnav({
  label,
  items,
}: {
  /** Nombre del módulo: la nav se anuncia como "Secciones de {label}". */
  label: string;
  items: readonly ModuleSubnavItem[];
}) {
  const path = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const active = activeSubnavHref(path, items);

  useEffect(() => {
    navRef.current
      ?.querySelector<HTMLElement>('a[aria-current="page"]')
      ?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [path]);

  return (
    <nav
      ref={navRef}
      aria-label={`Secciones de ${label}`}
      className="sticky top-[var(--finance-nav-top,0px)] z-20 flex gap-1 overflow-x-auto border-b border-line bg-canvas [scrollbar-width:none] max-sm:pr-6 max-sm:[mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)] [&::-webkit-scrollbar]:hidden"
    >
      {items.map(({ href, label: itemLabel, icon: Icon }) => {
        const current = normalizePath(href) === active;
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`-mb-px inline-flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap focus-visible:rounded focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary max-sm:h-11 max-sm:px-3.5 ${
              current ? "border-primary text-primary" : "border-transparent text-[#5f6d65] hover:text-ink"
            }`}
          >
            {Icon && <Icon className="size-4" aria-hidden="true" />}
            {itemLabel}
          </Link>
        );
      })}
    </nav>
  );
}
