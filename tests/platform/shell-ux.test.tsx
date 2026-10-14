// Design Lock 28 · B1: shell (rail con etiquetas, hamburguesa, cajón, sidebar
// contraíble) y control "Aa" (tamaño del texto) con sus preferencias.
import fs from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/app-shell";
import {
  getSidebarPref,
  getTextSize,
  resetPreferencesForTests,
  setTextSize,
} from "@/lib/ui/preferences";
import { PREPAINT_SCRIPT, PUBLIC_PATH_PATTERN, SIDEBAR_KEY, TEXT_SIZE_KEY } from "@/lib/ui/prepaint";

const state = vi.hoisted(() => ({
  path: "/finanzas",
  access: null as Record<string, unknown> | null,
  logout: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.path,
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => ({ user: { uid: "u1", email: "persona@cds.test" }, logout: state.logout }),
}));
vi.mock("@/lib/auth/access-provider", () => ({
  useOptionalAccess: () => state.access,
  useAccess: () => state.access,
}));
vi.mock("@/lib/calendar/areas-client", () => ({
  useAreas: () => ({ areas: [], loading: false, error: "" }),
}));

const html = document.documentElement;

/** matchMedia simulado: solo las queries listadas coinciden. */
function stubMedia(matching: string[]) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: matching.includes(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  });
}

/** matchMedia controlable: `set(query, matches)` dispara los listeners "change". */
function controllableMedia(initial: string[] = []) {
  const matching = new Set(initial);
  const listeners = new Map<string, Set<() => void>>();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      get matches() {
        return matching.has(query);
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, cb: () => void) => {
        if (!listeners.has(query)) listeners.set(query, new Set());
        listeners.get(query)!.add(cb);
      },
      removeEventListener: (_: string, cb: () => void) => listeners.get(query)?.delete(cb),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  return {
    set(query: string, on: boolean) {
      if (on) matching.add(query);
      else matching.delete(query);
      act(() => listeners.get(query)?.forEach((cb) => cb()));
    },
  };
}

/** localStorage que lanza en cada acceso (ventana privada / bloqueado). */
function breakStorage() {
  const original = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("Acceso denegado", "SecurityError");
    },
  });
  return () => {
    if (original) Object.defineProperty(window, "localStorage", original);
  };
}

function shell() {
  return render(
    <AppShell>
      <p>Contenido</p>
    </AppShell>,
  );
}

beforeEach(() => {
  state.path = "/finanzas";
  state.access = { role: "admin", active: true, displayName: "Ana" };
  state.logout.mockReset();
  state.logout.mockResolvedValue(undefined);
  window.localStorage.clear();
  resetPreferencesForTests();
  html.removeAttribute("data-text-size");
  html.removeAttribute("data-sidebar");
});

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
  window.history.replaceState({}, "", "/");
});

describe("rail (1024–1279) con etiquetas cortas visibles", () => {
  it("cada módulo tiene etiqueta corta visible y el nombre accesible completo", () => {
    shell();
    const nav = screen.getByRole("navigation", { name: "Módulos" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.querySelector(".app-nav-short")?.textContent)).toEqual([
      "Finanzas",
      "Calendario",
      "Reportes",
      "Ajustes",
    ]);
    for (const a of links) expect(a.querySelector(".app-nav-short")).toHaveAttribute("aria-hidden", "true");
    // WCAG 2.5.3: el nombre accesible contiene la palabra visible ("Ajustes").
    expect(within(nav).getByRole("link", { name: "Ajustes · Configuración" })).toHaveAttribute("href", "/configuracion");
    for (const name of ["Finanzas", "Calendario", "Reportes"]) {
      expect(within(nav).getByRole("link", { name })).not.toHaveAttribute("aria-label");
    }
    expect(within(nav).getByRole("link", { name: "Finanzas" })).toHaveAttribute("aria-current", "page");
    // Sin tooltips como única etiqueta.
    expect(nav.querySelector("[class*='group-hover']")).toBeNull();
  });

  it("el pie conserva cuenta y 'Cerrar sesión' con el texto visible igual al nombre", () => {
    shell();
    const aside = screen.getByRole("complementary");
    expect(aside).toHaveAttribute("id", "app-sidebar");
    expect(within(aside).getByText("Ana")).toBeInTheDocument();
    const logout = within(aside).getByRole("button", { name: "Cerrar sesión" });
    expect(logout.textContent).toBe("Cerrar sesión");
    expect(logout.querySelector("[aria-hidden='true']:not(svg)")).toBeNull();
  });

  it("la barra superior es un <header> (banner) que contiene la hamburguesa, el rail y 'Aa'", () => {
    shell();
    const banner = screen.getByRole("banner");
    expect(banner.tagName).toBe("HEADER");
    expect(within(banner).getByRole("button", { name: "Abrir menú de navegación" })).toBeInTheDocument();
    expect(within(banner).getByRole("complementary")).toHaveAttribute("id", "app-sidebar");
    expect(within(banner).getByRole("button", { name: /^Tamaño del texto/ })).toBeInTheDocument();
  });

  it("barra inferior: la etiqueta corta lleva la clase que la muestra con texto grande", () => {
    shell();
    const bar = screen.getByRole("navigation", { name: "Barra de módulos" });
    const settings = within(bar).getByRole("link", { name: "Ajustes · Configuración" });
    expect(settings.querySelector(".bar-label-full")).toHaveTextContent("Configuración");
    expect(settings.querySelector(".bar-label-short")).toHaveTextContent("Ajustes");
    const css = fs.readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");
    expect(css).toMatch(/html\[data-text-size="xlarge"\] \.bar-label-full \{\s*display: none;/);
    expect(css).toMatch(/html\[data-text-size="xlarge"\] \.bar-label-short \{\s*display: block;/);
  });

  it("orden de foco: skip link → hamburguesa → rail → Aa → avatar → main", () => {
    shell();
    const order = [
      screen.getByRole("link", { name: "Saltar al contenido" }),
      screen.getByRole("button", { name: "Abrir menú de navegación" }),
      within(screen.getByRole("complementary")).getAllByRole("link")[0],
      screen.getByRole("button", { name: /^Tamaño del texto/ }),
      screen.getByRole("button", { name: "Cuenta" }),
      screen.getByRole("main"),
    ];
    for (let i = 1; i < order.length; i++) {
      // DOCUMENT_POSITION_FOLLOWING = 4
      expect(order[i - 1].compareDocumentPosition(order[i]) & 4, `paso ${i}`).toBe(4);
    }
  });
});

describe("hamburguesa y cajón (<1280)", () => {
  it("el cajón no se monta cerrado; abre, se cierra con 'Cerrar menú' y el foco vuelve a la hamburguesa", async () => {
    const user = userEvent.setup();
    shell();
    const burger = screen.getByRole("button", { name: "Abrir menú de navegación" });
    expect(burger).toHaveAttribute("aria-haspopup", "dialog");
    expect(burger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".app-drawer")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Cerrar sesión" })).toHaveLength(1);

    await user.click(burger);
    const drawer = screen.getByRole("dialog", { name: "Menú de navegación" });
    expect(burger).toHaveAttribute("aria-expanded", "true");
    expect(within(drawer).getByRole("button", { name: "Cerrar menú" })).toHaveFocus();
    const nav = within(drawer).getByRole("navigation", { name: "Módulos" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Finanzas",
      "Calendario",
      "Reportes",
      "Configuración",
    ]);
    expect(within(nav).getByRole("link", { name: "Finanzas" })).toHaveAttribute("aria-current", "page");
    expect(within(drawer).getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();

    await user.click(within(drawer).getByRole("button", { name: "Cerrar menú" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(burger).toHaveFocus();
    expect(burger).toHaveAttribute("aria-expanded", "false");
  });

  it("Esc (cancel) y clic en el fondo cierran; el foco vuelve a la hamburguesa", async () => {
    const user = userEvent.setup();
    shell();
    const burger = screen.getByRole("button", { name: "Abrir menú de navegación" });
    await user.click(burger);
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(burger).toHaveFocus();

    await user.click(burger);
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(burger).toHaveFocus();
  });

  it("navegar cierra el cajón (clic en un módulo y cambio de ruta)", async () => {
    const user = userEvent.setup();
    const view = shell();
    const burger = screen.getByRole("button", { name: "Abrir menú de navegación" });
    await user.click(burger);
    await user.click(within(screen.getByRole("dialog")).getByRole("link", { name: "Calendario" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(burger).toHaveFocus();

    await user.click(burger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    state.path = "/reportes";
    view.rerender(
      <AppShell>
        <p>Contenido</p>
      </AppShell>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("error de logout desde el cajón: un único role=alert, dentro del cajón", async () => {
    const user = userEvent.setup();
    state.logout.mockRejectedValueOnce({ code: "auth/network-request-failed" });
    shell();
    await user.click(screen.getByRole("button", { name: "Abrir menú de navegación" }));
    const drawer = screen.getByRole("dialog");
    await user.click(within(drawer).getByRole("button", { name: "Cerrar sesión" }));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(within(drawer).getByRole("alert")).toHaveTextContent("conexión");
    await user.click(within(drawer).getByRole("button", { name: "Cerrar menú" }));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});

describe("cajón: animación de salida y cambios de breakpoint", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("con movimiento: sale en 160ms (is-closing) y luego devuelve el foco a la hamburguesa", () => {
    vi.useFakeTimers();
    controllableMedia([]);
    shell();
    const burger = screen.getByRole("button", { name: "Abrir menú de navegación" });
    fireEvent.click(burger);
    const drawer = screen.getByRole("dialog", { name: "Menú de navegación" });
    fireEvent.click(within(drawer).getByRole("button", { name: "Cerrar menú" }));
    expect(drawer).toHaveClass("is-closing");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(159));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(burger).toHaveFocus();
  });

  it("el temporizador de salida se cancela al desmontar: no cierra un cajón reabierto", () => {
    vi.useFakeTimers();
    controllableMedia([]);
    const view = shell();
    const burger = screen.getByRole("button", { name: "Abrir menú de navegación" });
    fireEvent.click(burger);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cerrar menú" }));
    // Navegación durante la salida: el cajón se desmonta antes de los 160ms.
    state.path = "/calendario";
    view.rerender(
      <AppShell>
        <p>Contenido</p>
      </AppShell>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(burger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("abierto en 1024 → rotar a ≥1280 lo cierra y no se reabre al volver (foco en la hamburguesa)", async () => {
    const user = userEvent.setup();
    const media = controllableMedia(["(min-width: 768px)"]);
    shell();
    const burger = screen.getByRole("button", { name: "Abrir menú de navegación" });
    await user.click(burger);
    expect(screen.getByRole("dialog", { name: "Menú de navegación" })).toBeInTheDocument();

    media.set("(min-width: 1280px)", true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(burger).toHaveAccessibleName("Contraer barra lateral");
    expect(burger).toHaveFocus();

    media.set("(min-width: 1280px)", false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(burger).toHaveAccessibleName("Abrir menú de navegación");
    expect(burger).toHaveAttribute("aria-expanded", "false");
  });
});

describe("CSS del shell (revisión Atlas)", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");
  it("anillo de foco normal en las superficies claras de la barra; hacia adentro en el rail", () => {
    expect(css).toMatch(/\.app-topbar :is\(\.text-size-popover, dialog\) :focus-visible \{\s*outline-color: #7b9d56;/);
    expect(css).toMatch(/\.app-sidebar :focus-visible \{[^}]*outline-offset: -3px;/);
  });
  it("enlaces del sidebar expandido ≥44px; KPIs de Reportes refluyen al 110–125 %; backdrop sin movimiento", () => {
    expect(css).toMatch(/html:not\(\[data-sidebar="collapsed"\]\) \.app-logout \{[^}]*min-height: var\(--tap-min\);/);
    expect(css).not.toMatch(/\.app-nav-link,\s*html:not\(\[data-sidebar="collapsed"\]\) \.app-logout \{[^}]*min-height: 2\.5rem/);
    expect(css).toMatch(/html\[data-text-size="xlarge"\] \.kpi-grid,/);
    expect(css).toMatch(/\*::after,\s*\*::backdrop \{/);
    expect(css).toMatch(/\.chart-box \.recharts-label-list text \{\s*font-size: 0\.6875rem;/);
  });
});

describe("sidebar contraíble (≥1280)", () => {
  it("la hamburguesa alterna expandida/rail, persiste en cds.ui.sidebar y no abre cajón", async () => {
    const user = userEvent.setup();
    stubMedia(["(min-width: 1280px)", "(min-width: 768px)"]);
    const view = shell();
    const burger = screen.getByRole("button", { name: "Contraer barra lateral" });
    expect(burger).toHaveAttribute("aria-expanded", "true");
    expect(burger).toHaveAttribute("aria-controls", "app-sidebar");
    expect(burger).not.toHaveAttribute("aria-haspopup");
    expect(html).toHaveAttribute("data-sidebar", "expanded");

    await user.click(burger);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(burger).toHaveAccessibleName("Expandir barra lateral");
    expect(burger).toHaveAttribute("aria-expanded", "false");
    expect(html).toHaveAttribute("data-sidebar", "collapsed");
    expect(window.localStorage.getItem(SIDEBAR_KEY)).toBe("collapsed");

    view.unmount();
    shell();
    expect(screen.getByRole("button", { name: "Expandir barra lateral" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expandir barra lateral" }));
    expect(window.localStorage.getItem(SIDEBAR_KEY)).toBe("expanded");
    expect(html).toHaveAttribute("data-sidebar", "expanded");
  });
});

describe("sin parpadeo al hidratar", () => {
  it("con 125 % y rail guardados, la hidratación nunca vuelve <html> a normal/expanded", async () => {
    window.localStorage.setItem(TEXT_SIZE_KEY, "xlarge");
    window.localStorage.setItem(SIDEBAR_KEY, "collapsed");
    window.history.replaceState({}, "", "/finanzas");
    new Function(PREPAINT_SCRIPT)();
    const tree = (
      <AppShell>
        <p>Contenido</p>
      </AppShell>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    document.body.appendChild(container);
    // Cada registro guarda el valor ANTERIOR: valores anteriores + final =
    // todos los valores que tuvo <html> durante la hidratación.
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(html, { attributes: true, attributeOldValue: true, attributeFilter: ["data-text-size", "data-sidebar"] });
    const root = await act(async () => hydrateRoot(container, tree, { onRecoverableError: () => {} }));
    await act(async () => {});
    records.push(...observer.takeRecords());
    const values = records.map((r) => `${r.attributeName}=${r.oldValue}`);
    observer.disconnect();
    expect(values.filter((v) => /=(normal|expanded)$/.test(v)), values.join(", ")).toEqual([]);
    expect(html).toHaveAttribute("data-text-size", "xlarge");
    expect(html).toHaveAttribute("data-sidebar", "collapsed");
    act(() => root.unmount());
    container.remove();
  });
});

describe("control 'Aa' (tamaño del texto)", () => {
  it("<768: hoja con 3 radios; aplica al instante, anuncia, persiste y actualiza la etiqueta", async () => {
    const user = userEvent.setup();
    shell();
    expect(html).toHaveAttribute("data-text-size", "normal");
    // Cerrado no agrega regiones role=status (la del shell es única).
    expect(screen.getAllByRole("status")).toHaveLength(1);
    const button = screen.getByRole("button", { name: "Tamaño del texto (actual: Normal)" });
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    await user.click(button);
    const sheet = screen.getByRole("dialog", { name: "Tamaño del texto" });
    const radios = within(sheet).getAllByRole("radio");
    expect(radios.map((r) => r.closest("label")?.querySelector(".text-size-option-text")?.textContent)).toEqual([
      "Normal · 100 %",
      "Grande · 110 %",
      "Muy grande · 125 %",
    ]);
    expect(within(sheet).getByRole("radio", { name: /^Normal/ })).toBeChecked();
    expect(within(sheet).getByText("Se guarda en este dispositivo.")).toBeInTheDocument();

    await user.click(within(sheet).getByRole("radio", { name: /^Grande/ }));
    expect(html).toHaveAttribute("data-text-size", "large");
    expect(window.localStorage.getItem(TEXT_SIZE_KEY)).toBe("large");
    expect(within(sheet).getByRole("status")).toHaveTextContent("Tamaño del texto: Grande · 110 %");
    expect(screen.getByRole("button", { name: "Tamaño del texto (actual: Grande)" })).toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Tamaño del texto (actual: Grande)" })).toHaveFocus();
  });

  it("≥768: popover role=dialog; foco en la opción marcada; Esc cierra y devuelve el foco", async () => {
    const user = userEvent.setup();
    stubMedia(["(min-width: 768px)"]);
    window.localStorage.setItem(TEXT_SIZE_KEY, "xlarge");
    shell();
    expect(html).toHaveAttribute("data-text-size", "xlarge");
    const button = screen.getByRole("button", { name: "Tamaño del texto (actual: Muy grande)" });
    await user.click(button);
    const popover = screen.getByRole("dialog", { name: "Tamaño del texto" });
    expect(popover.tagName).toBe("DIV");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(within(popover).getByRole("radio", { name: /^Muy grande/ })).toHaveFocus();
    await user.click(within(popover).getByRole("radio", { name: /^Normal/ }));
    expect(html).toHaveAttribute("data-text-size", "normal");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Tamaño del texto (actual: Normal)" })).toHaveFocus();
  });

  it("sin localStorage (lanza en cada acceso) funciona en memoria y no falla", async () => {
    const user = userEvent.setup();
    const restore = breakStorage();
    try {
      shell();
      await user.click(screen.getByRole("button", { name: "Tamaño del texto (actual: Normal)" }));
      await user.click(screen.getByRole("radio", { name: /^Muy grande/ }));
      expect(html).toHaveAttribute("data-text-size", "xlarge");
      expect(screen.getByRole("button", { name: "Tamaño del texto (actual: Muy grande)" })).toBeInTheDocument();
      expect(getTextSize()).toBe("xlarge");
    } finally {
      restore();
    }
  });
});

describe("preferencias de interfaz (lib/ui)", () => {
  it("valores inválidos o ausentes vuelven a los valores por defecto", () => {
    window.localStorage.setItem(TEXT_SIZE_KEY, "gigante");
    window.localStorage.setItem(SIDEBAR_KEY, "a-medias");
    expect(getTextSize()).toBe("normal");
    expect(getSidebarPref()).toBe("expanded");
  });

  it("setTextSize persiste y fija <html data-text-size>", () => {
    act(() => setTextSize("large"));
    expect(window.localStorage.getItem(TEXT_SIZE_KEY)).toBe("large");
    expect(html).toHaveAttribute("data-text-size", "large");
  });

  it("script previo al pintado: aplica valores válidos, ignora inválidos y no toca rutas públicas", () => {
    const run = () => new Function(PREPAINT_SCRIPT)();
    window.history.replaceState({}, "", "/finanzas");
    window.localStorage.setItem(TEXT_SIZE_KEY, "xlarge");
    window.localStorage.setItem(SIDEBAR_KEY, "collapsed");
    run();
    expect(html).toHaveAttribute("data-text-size", "xlarge");
    expect(html).toHaveAttribute("data-sidebar", "collapsed");

    html.removeAttribute("data-text-size");
    html.removeAttribute("data-sidebar");
    window.localStorage.setItem(TEXT_SIZE_KEY, "<script>");
    run();
    expect(html).not.toHaveAttribute("data-text-size");

    html.removeAttribute("data-sidebar");
    window.localStorage.setItem(TEXT_SIZE_KEY, "large");
    for (const url of ["/calendario-publico", "/ofrendar", "/campanas/abc", "/c/xyz"]) {
      window.history.replaceState({}, "", url);
      run();
      expect(html, url).not.toHaveAttribute("data-text-size");
      expect(html, url).not.toHaveAttribute("data-sidebar");
    }
  });

  it("script previo al pintado: sin localStorage no lanza", () => {
    const restore = breakStorage();
    try {
      window.history.replaceState({}, "", "/finanzas");
      expect(() => new Function(PREPAINT_SCRIPT)()).not.toThrow();
      expect(html).not.toHaveAttribute("data-text-size");
    } finally {
      restore();
    }
  });

  it("cada ruta de primer nivel de app/ está clasificada: privada o excluida del script", () => {
    // Una ruta pública nueva no puede heredar en silencio el tamaño de texto
    // privado: debe agregarse a PUBLIC_PATH_PATTERN (o aquí, si es privada).
    const PRIVATE = new Set(["(private)", "login"]);
    const root = path.resolve(__dirname, "../../app");
    const dirs = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(dirs).toEqual(expect.arrayContaining([...PRIVATE]));
    for (const dir of dirs) {
      const isPublic = PUBLIC_PATH_PATTERN.test(`/${dir}`);
      expect(isPublic !== PRIVATE.has(dir), `app/${dir} sin clasificar (privada o PUBLIC_PATH_PATTERN)`).toBe(true);
    }
    // Rutas públicas que no son carpetas de app/ (rewrites de firebase.json).
    expect(PUBLIC_PATH_PATTERN.test("/c/abc")).toBe(true);
    expect(PUBLIC_PATH_PATTERN.test("/calendario")).toBe(false);
    expect(PUBLIC_PATH_PATTERN.test("/configuracion")).toBe(false);
  });

  it("las rutas y módulos públicos no importan las preferencias ni el shell", () => {
    const root = path.resolve(__dirname, "../..");
    const dirs = ["app/calendario-publico", "app/ofrendar", "app/campanas", "components/public-calendar", "components/public", "lib/shared"];
    const files = dirs.flatMap((d) =>
      fs
        .readdirSync(path.join(root, d), { recursive: true, encoding: "utf8" })
        .filter((f) => /\.(ts|tsx)$/.test(f))
        .map((f) => path.join(root, d, f)),
    );
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/@\/lib\/ui\b|lib\/ui\/|components\/layout\/(app-shell|nav-drawer|text-size-control)/);
      expect(src, file).not.toMatch(/cds\.ui\./);
    }
  });
});
