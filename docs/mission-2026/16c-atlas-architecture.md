# Calendario + Integrantes / Consolidación: decisión de arquitectura (Atlas)

**Estado:** decisión para Builder. Pasa por Designer en lo visual y por Salvador en las preguntas abiertas.
**Rama:** `mission/calendar-integrantes-preview`, creada desde `mission/ux-finanzas-2026-preview` @ `8e79cd1`.
**Convenciones:** FACT = verificado en el código. HYPOTHESIS = hay que validarlo. RISK = riesgo. REC = recomendación.

---

## 0. Las decisiones en una tabla

| Tema | Decisión |
|---|---|
| Shell global | Un solo componente `SuiteShell` (`components/suite-preview/shell.tsx`) que crece desde el shell financiero y reutiliza sus clases `fx-*`. `FinancialShell` **se conserva** y pasa a componer `SuiteShell`; su contrato de test no cambia. |
| URL de Finanzas | Se queda en `/preview/finanzas-2026/*` y su `layout.tsx` no se toca. Las rutas nuevas viven en el route group `app/preview/(suite)/`. La página pública vive en `app/preview/(publico)/`, sin shell. |
| Estado global de la preview | Nuevo `app/preview/layout.tsx` con `SuiteProvider` (perfil + store + toast + aviso) y `AccessGate`. Envuelve a Finanzas, a los módulos nuevos y a la página pública. |
| Segmentos dinámicos | **Ninguno en la preview.** La ficha es `/preview/integrantes/consolidacion/persona?id=…`. El enlace público es la ruta estática `/preview/calendario/compartir/demo`, y un token regenerado se presenta con `?t=…`. |
| Perfil simulado | La fuente de verdad es la URL `?perfil=<uid>`. Vive en memoria en el provider, que lo vuelve a poner en la URL al navegar. Sin `?perfil` se entra como Administración (compatibilidad con los links de PR #3). Sin localStorage ni sessionStorage. |
| Datos mutables | Un reducer puro en memoria, sembrado desde las fixtures. Sobrevive a la navegación cliente y se reinicia al recargar. Todo `dispatch` muestra "Simulación: no se guardó nada." |
| Flag de build | Se reutiliza `CDS_FINANCE_PREVIEW`. **No** se crea otra bandera y `next.config.ts` no cambia. |
| Guardia de deploy | `scripts/check-no-preview.mjs` se extiende con el sentinel `SX_PREVIEW_SENTINEL_V1_…` y con las rutas nuevas. `firebase.json` no cambia. |
| Tests existentes | **No se modifican.** El aislamiento nuevo va en `tests/suite-preview/isolation.test.ts`, con un walker en `tests/helpers/import-graph.ts`. |
| Recurrencia | Confirmo E.2 de Navigator con 5 enmiendas (§C). La más importante: en una serie ya iniciada, "Editar toda la serie" **no** permite cambiar día, hora ni frecuencia. |
| PDF | Generación local con jspdf + jspdf-autotable mediante `import()` dinámico en el handler. **No** se puede reutilizar `lib/finance/report-pdf.ts`, porque arrastra Firestore. |
| WhatsApp en la preview | **No abre `wa.me`.** El botón simula. `waLink()` existe y tiene test, pero no se renderiza como enlace externo. |

---

## 1. Evidencia que condiciona el diseño (FACT)

1. **El root layout monta `AuthProvider`.** `app/layout.tsx` monta `AuthProvider` (`firebase/auth`), así que toda ruta de la preview, incluida la página pública, carga el SDK de Firebase Auth. Es el riesgo 5 heredado del doc 15. Cambiarlo exigiría tocar el root layout productivo, así que no se hace.
2. **El test del shell financiero fija el contrato de `FinancialShell`.** `tests/finance-preview/components.test.tsx`:
   - hace `vi.mock("next/navigation", () => ({ usePathname: () => "/preview/finanzas-2026" }))`; **solo existe `usePathname`**, y si algo dentro de `FinancialShell` llama `useRouter` o `useSearchParams`, el test revienta;
   - renderiza `<FinancialShell>` **sin provider externo**;
   - espera:
     - `getAllByRole("note")[0]` con el texto "Vista previa · datos de demostración";
     - **una sola** `navigation` llamada "Finanzas", con un link único por cada etiqueta (Hoy … Configuración) y además "Atención, N pendientes";
     - "Hoy" con `aria-current="page"`;
     - `[data-preview="FX_PREVIEW_SENTINEL_V2_7f3a"]`.
3. **Qué impone el test de aislamiento a lo que agreguemos.** `tests/finance-preview/isolation.test.ts`:
   - recorre de forma transitiva los imports desde `app/preview`, `components/finance-preview` y `lib/finance-preview`;
   - prohíbe `firebase*` y `lib/{firebase,auth,finance,offerings,campaigns,settings}`, `components/{finance,layout,settings}` y `app/(private)`;
   - prohíbe `fetch(`, `XMLHttpRequest`, `localStorage`, `indexedDB` y `sendBeacon`, pero **solo** en los archivos de sus `ENTRY_DIRS`;
   - exige que todo archivo especial bajo `app/preview` sea `.preview.tsx`, salvo `layout.tsx`, y que haya al menos 11 `page.preview.tsx`.
   - Como el recorrido parte de `app/preview`, todo lo que importen las páginas nuevas ya queda cubierto de forma transitiva, pero el chequeo de red y almacenamiento no.
4. **Configuración de build.** `next.config.ts` agrega `preview.tsx` solo en dev o con `CDS_FINANCE_PREVIEW=1`, con `output: "export"`. Next 16 en export estático **no admite** rutas dinámicas sin `generateStaticParams` ni con `dynamicParams: true` (`node_modules/next/dist/docs/01-app/02-guides/static-exports.md`).
5. **El `tsconfig.json` incluye `.next/types/**` y `.next/dev/types/**`.** Es el origen del problema P3 del doc 15: los tipos de rutas de dev y de build no coincidían. Con un segmento dinámico en un `.preview.tsx` habría params tipados distintos según la fase. Este choque es una HYPOTHESIS que no voy a pagar: por eso no hay segmentos dinámicos.
6. **jspdf solo lo usa `lib/finance/report-pdf.ts`, con import estático.** Ese archivo importa `./formatters`, que importa `firebase/firestore` (P2 del doc 15). El walker lo marcaría como prohibido. La pantalla productiva lo carga con `await import(...)`.
7. **Exports de `components/finance-preview/shell.tsx` y sus usuarios.**
   - Exporta `BASE`, `NAV_GROUPS`, `REGISTER_ACTIONS`, `FinancialShell`, `PeriodSelector`, `RegisterMenu`, `FinancialHeader` y `TODAY_LABEL`.
   - Las screens importan `BASE`, `FinancialHeader` y `TODAY_LABEL`.
   - `NAV_GROUPS` solo lo usa el propio shell.
8. **Utilidades de PR #3 que se pueden reutilizar.**
   - `lib/finance-preview/format.ts` es puro (usa `Date.UTC`/`getUTCDay`) y se puede importar.
   - `DEMO_TODAY = "2026-10-04"` y `DEMO_NOW = "2026-10-04T13:30"` viven en `lib/finance-preview/fixtures.ts`, junto con los generadores financieros.
9. **Firestore hoy.** `firestore.rules`:
   - `validUser` exige `hasOnly(['displayName','email','role','active','createdAt'])`;
   - `details()`, `pastoral()`, `admin()` y `approved()` dependen de `role`;
   - existe el precedente de la proyección pública `campaignPublicViews` (`allow get` si `isPublic`, `list: false`) y de la Function `campaignShare` detrás del rewrite `/c/**`.

---

## A. Arquitectura de la preview

### A.1 Árbol de rutas (definitivo)

```
app/preview/
  layout.tsx                         NUEVO · server. Gate notFound() (barrera 2), import de
                                     finance-preview.css + suite-preview.css,
                                     <SuiteProvider><AccessGate>{children}</AccessGate></SuiteProvider>
  page.preview.tsx                   /preview → login simulado ("Ingresar como…")
  finanzas-2026/                     SIN CAMBIOS de ubicación ni de layout.tsx
    layout.tsx                       (sigue: <FinancialShell>{children}</FinancialShell>)
    resumen/page.preview.tsx         NUEVO: resumen agregado para quien solo tiene finance.summary.read
    …11 rutas existentes
  (suite)/
    layout.tsx                       NUEVO: <SuiteShell>{children}</SuiteShell>
    calendario/page.preview.tsx                       Mes / Semana / Agenda + panel Compartir (manage_all)
    calendario/mis-actividades/page.preview.tsx
    integrantes/page.preview.tsx                      reemplaza a /integrantes/consolidacion (efecto cliente)
    integrantes/consolidacion/page.preview.tsx        dashboard
    integrantes/consolidacion/personas/page.preview.tsx
    integrantes/consolidacion/nueva/page.preview.tsx
    integrantes/consolidacion/persona/page.preview.tsx   ficha (?id=)
    integrantes/consolidacion/ajustes/page.preview.tsx   parámetros en solo lectura
    reportes/page.preview.tsx                         hub (sección Calendario + link a Finanzas › Reportes)
    reportes/calendario/page.preview.tsx
    configuracion/page.preview.tsx                    reemplaza a /configuracion/areas
    configuracion/areas/page.preview.tsx
    configuracion/usuarios/page.preview.tsx
  (publico)/
    calendario/compartir/demo/page.preview.tsx        vista pública, sin shell
```

**Reglas de estructura** (las vigila un test nuevo):
- solo hay `layout.tsx` en `app/preview/`, `app/preview/(suite)/` y `app/preview/finanzas-2026/`;
- no existe `layout.preview.tsx`;
- no hay carpetas `[...]`;
- todo `page` es `.preview.tsx`.

**Patrón y por qué así:**
- Los layouts compilan en ambos builds, pero sin páginas no emiten ruta. Es el mismo patrón que ya se validó en PR #3 (ATLAS-L-009). Un layout sin página hija en el build por defecto no genera HTML.
- HYPOTHESIS a validar en el primer commit de scaffold: Next acepta que `(suite)/calendario/…` y `(publico)/calendario/compartir/demo` compartan el prefijo `calendario` en grupos distintos. Es el uso documentado de los route groups y las rutas finales no coinciden.
  - **Validación:** `npm run dev` y abrir ambas rutas; después `npm run typecheck`, `npm run build`, `npm run build:preview` y `node scripts/check-no-preview.mjs`. Es la secuencia exacta que hizo aparecer P3.
  - **Fallback si falla:** mover la pública a `(suite)/calendario/compartir/demo` y hacer que `SuiteShell` devuelva `children` sin chrome cuando `isPublicPath(pathname)`. Es peor, porque el bundle público arrastraría el código del shell, pero funciona.

### A.2 Shell global y convivencia con PR #3

**REC (minimal-diff, sin mover archivos):**

1. **`components/finance-preview/nav.ts` (nuevo).**
   - Mueve hacia acá `BASE` y `NAV_GROUPS`.
   - `shell.tsx` los re-exporta (`export { BASE, NAV_GROUPS } from "./nav"`), así que las screens no cambian.
   - Evita el ciclo shell financiero ↔ `SuiteShell`.
2. **`components/suite-preview/shell.tsx` → `SuiteShell({ children })`.**
   - Usa **solo** `usePathname` de `next/navigation`. Ni `useRouter` ni `useSearchParams`, por el mock del test.
   - Obtiene el perfil con `useSuiteOptional()`. Si es `null` (render aislado, como en el test de PR #3), usa `UNSIMULATED_ADMIN`, que da la navegación completa: exactamente el comportamiento de PR #3.
   - Raíz: `<div className="fx sx" lang="es-CL" data-preview={FX_PREVIEW_SENTINEL} data-suite-preview={SX_PREVIEW_SENTINEL}>`. Conserva el sentinel FX que espera el test.
   - **Estructura de nav (contrato):**
     - `<nav aria-label="Módulos">` con Finanzas · Calendario · Integrantes · Reportes · Configuración, filtrados por `visibleModules(profile)`. El link de módulo "Configuración" va **fuera** de la nav "Finanzas".
     - El módulo activo despliega su subnavegación como `<nav aria-label="{Módulo}">`. Para Finanzas es `financeNavFor(eff)`, construido desde `NAV_GROUPS`, que sigue siendo la única fuente.
     - **Nunca** puede haber dos navs llamadas "Finanzas" ni dos links con la misma etiqueta dentro de ella.
   - **Registro de módulos:** `MODULES: Record<ModuleId, { label, icon, href(profile), subnav(profile): NavGroup[], mobileTabs(profile) }>`. Designer decide el layout visual de la sidebar, el rail y la bottom nav. El contrato estructural es uno solo: un componente y un registro.
   - Mantiene, en este orden, el banner `role="note"` "Vista previa · datos de demostración" como **primer** `note` del DOM, el skip link y `<main id="fx-main">`.
   - Muestra el aviso de acceso (`notice`) arriba del main, con `role="status"`.
   - Muestra el selector "Perfil demo: {nombre} · Cambiar" solo si hay provider.
3. **`FinancialShell` (mismo export y misma firma):**
   ```tsx
   export function FinancialShell({ children }: { children: React.ReactNode }) {
     const pathname = usePathname() ?? BASE;
     return (
       <PreviewProvider>
         <KeepPeriodInUrl pathname={pathname} />
         <SuiteShell>{children}</SuiteShell>
       </PreviewProvider>
     );
   }
   ```
   - Se eliminan el `Sidebar` y el `MobileNav` propios, que pasan a `SuiteShell` y a la definición del módulo Finanzas.
   - El "Registrar" móvil de Finanzas (`usePreview().simulate`) funciona porque `PreviewProvider` queda **por fuera** de `SuiteShell`.
   - "Registrar" solo aparece con `finance.records.manage`.
4. **`PreviewProvider` (finanzas):**
   - Si existe `SuiteToastContext` (`useContext`, sin hook que lance), delega `toast` y `simulate` y **no** renderiza su propia región `role="status"`.
   - Sin suite (los tests de PR #3), se comporta igual que hoy.
5. **`financeNavFor(eff)`:**
   - sin `finance.details.read`, solo `[Resumen → /preview/finanzas-2026/resumen]`;
   - con `details`, `NAV_GROUPS` completo, menos "Configuración" financiera si no tiene `settings.manage`.
   - Con admin (y en el test sin provider) quedan exactamente los links actuales.
6. **Costo aceptado:** al cruzar entre Finanzas y otro módulo, `SuiteShell` se remonta, porque son layouts hermanos. El estado no se pierde: perfil, store y toast viven en `app/preview/layout.tsx`.
   - **Alternativa descartada:** mover `finanzas-2026` dentro de `(suite)`. Duplicaría el shell o dejaría `FinancialShell` como export usado solo por tests.
7. **`/preview/finanzas-2026/resumen` → `FinanceSummaryScreen`** (`components/suite-preview/finance-summary.tsx`):
   - las 3 cifras agregadas de `lib/finance-preview/selectors`;
   - sin drill-down, sin Atención, sin actividad, sin nombres;
   - `FinancialHeader primary="none"`.
   - Cumple el criterio 6 de Navigator: el Líder no llega a Hoy, que sí trae detalle.
8. **Reportes:**
   - `/preview/reportes` es un hub: la sección Calendario con `calendar.read` y la tarjeta "Reportes financieros" que lleva a `/preview/finanzas-2026/reportes`, solo con `finance.details.read`;
   - no se embebe `ReportesScreen`.
   - La "Configuración" financiera (integraciones, días de culto) se queda en Finanzas y exige `settings.manage`. Áreas y Usuarios viven en el módulo global Configuración.
   - Designer puede reemplazar la sección "usuarios (ficticios)" de la configuración financiera por un link.

### A.3 Rutas sin segmentos dinámicos

- **Ficha:** `/preview/integrantes/consolidacion/persona?id=<personId>`.
  - Con `generateStaticParams`, las personas creadas en la sesión (`p-new-1`) no tendrían HTML ni payload RSC, y darían 404 en export y en dev con `dynamicParams=false`.
  - Además, producción también es `output: "export"` en Hosting: su ficha tampoco podrá ser un segmento dinámico (ver §D.6). La preview usa el mismo patrón que tendrá producción.
- **Enlace público:** la ruta estática `/preview/calendario/compartir/demo`. El token presentado es `?t=` si existe y, si no, `"demo"`.
  - El panel de administración muestra la URL con formato de producción (`https://…/calendario/compartir/<token>`) solo como texto.
  - "Abrir vista pública (demo)" navega con `<Link>` a `/compartir/demo?t=<token>`.
  - Después de "Regenerar", `/compartir/demo` sin `t` muestra "no disponible", tal como pide el criterio 17.
- **Lectura de query:** **no** se usa `useSearchParams`. Se usa un hook propio, `useQueryParam(name)` (`components/suite-preview/use-query.ts`), que lee `window.location` en un efecto y escucha `popstate`.
  - Es el patrón de `PreviewProvider` en PR #3.
  - Evita el requisito de Suspense de `useSearchParams` en prerender estático y los desajustes de hidratación.
  - Mientras no hay valor se muestra un skeleton.

### A.4 Perfil simulado, login y guardia

**`SuiteProvider`** (`components/suite-preview/provider.tsx`, client):
```ts
interface SuiteContextValue {
  ready: boolean;                       // URL leída tras hidratar
  profileId: string;                    // default "admin" si falta ?perfil
  profile: AccessProfile | null;        // null si ?perfil inválido
  eff: ReadonlySet<Permission>;
  state: SuiteState;
  dispatch(action: SuiteAction, label?: string): ActionResult; // aplica + toast "{label}. Simulación: no se guardó nada."
  toast(message: string): void;
  notice: { text: string; forPath: string } | null;
  setNotice(n: SuiteContextValue["notice"]): void;
  switchProfile(uid: string): void;     // resuelve Landing y router.replace(withProfile(href, uid))
  resetDemo(): void;
}
export function useSuite(): SuiteContextValue;          // lanza fuera del provider
export function useSuiteOptional(): SuiteContextValue | null;
```
- **`?perfil` en la URL** es la fuente de verdad cuando se recarga.
  - Permite URLs de capturas deterministas por perfil, por ejemplo `/preview/calendario?perfil=lider`.
  - `KeepProfileInUrl`, un efecto que corre cuando cambia `pathname`, repone `perfil` con `history.replaceState`, igual que `KeepPeriodInUrl`.
  - En rutas públicas **quita** `perfil`: el enlace público nunca lleva la sesión interna.
- **Valores por defecto:**
  - sin `?perfil`, el perfil es `admin`, para que los links y las capturas de PR #3 sigan funcionando igual;
  - con un `?perfil` desconocido, `replace("/preview")` y el aviso "Perfil de demostración no válido".
- **Por qué no sessionStorage:**
  - el regex del test actual no la detecta, pero contradice el espíritu de "sin almacenamiento persistente";
  - haría que las capturas no fueran reproducibles.
  - El test nuevo la prohíbe explícitamente.

**Login simulado: `/preview` (`components/suite-preview/login.tsx`).**
- Muestra tarjetas con los perfiles fixture: nombre, cargo y lo que demuestra.
- Al hacer clic, llama a `switchProfile(uid)`:
  - si `resolveInitialModule` da `kind:"module"`, hace `router.replace(withProfile(href, uid))` sin pantalla intermedia (criterio 2);
  - si da `kind:"no-modules"` o `kind:"inactive"`, muestra la pantalla correspondiente **en el mismo lugar**, sin navegar.
- No es un selector de módulo, sino la elección de qué usuario inicia sesión. Así se cumple el §18: Consolidación no pasa por Administración.

**`AccessGate`** (`components/suite-preview/access-gate.tsx`; es el único lugar con `useRouter`):
```tsx
const d = ready ? guardRoute(profile, pathname) : null;
useEffect(() => {
  if (d?.type !== "redirect" || lastTo.current === d.to) return;
  lastTo.current = d.to;                       // anti doble efecto (StrictMode) y anti-loop
  setNotice({ text: d.notice, forPath: d.to.split("?")[0] });
  router.replace(withProfile(d.to, profileId));
}, [d?.type, d?.type === "redirect" ? d.to : null]);
if (!d) return <GateSkeleton/>;               // HTML estático = skeleton (sin flash de contenido)
switch (d.type) {
  case "public": case "login": case "allow": return children;
  case "inactive": return <InactiveScreen/>;  // "Tu cuenta no tiene acceso autorizado"
  case "no-modules": return <NoModulesScreen/>; // sin redirect, sin loop
  case "redirect": return <GateSkeleton/>;    // nunca renderiza la ruta prohibida
}
```
- **Sin loops:** el destino es siempre `moduleHref(module visible)` o `landing.href`, que por construcción son permitidos. Un test de propiedad recorre todos los perfiles por todas las rutas y verifica `guardRoute(destino).type === "allow"`.
- **Aviso:** se muestra cuando `pathname === notice.forPath` y se limpia en el siguiente cambio de pathname.
- **Hidratación:** el prerender siempre muestra el skeleton, porque `ready=false` en el build. El perfil se lee en un efecto, así que no hay mismatch.

### A.5 Store de la sesión

`lib/suite-preview/store.ts` es puro: no usa React y es testeable sin DOM.
```ts
export interface SuiteState {
  seq: number;                       // ids deterministas: "ev-new-1", "p-new-1", "v-new-3"…
  areas: Area[]; users: AccessProfile[];
  events: CalendarEvent[]; eventChanges: EventChange[]; shareLink: ShareLink;
  persons: Person[]; visits: Visit[]; followUps: FollowUp[]; personChanges: PersonChange[];
  settings: ConsolidationSettings;
}
export type SuiteAction =
  | { type: "event/create"; by: string; input: EventInput }
  | { type: "event/updateSeries"; by: string; id: string; patch: EventPatch }
  | { type: "event/cancel"; by: string; id: string; reason: string }
  | { type: "event/cancelOccurrence"; by: string; id: string; date: Ymd; reason: string }
  | { type: "event/cancelSeriesFrom"; by: string; id: string; reason: string }   // from = hoy
  | { type: "event/archive"; by: string; id: string; reason: string }
  | { type: "share/regenerate" | "share/deactivate" | "share/activate"; by: string }
  | { type: "area/upsert"; by: string; area: AreaInput } | { type: "area/setActive"; by: string; id: string; active: boolean }
  | { type: "user/update"; by: string; profile: AccessProfile }
  | { type: "person/create"; by: string; input: PersonInput }      // crea también la 1.ª visita (date = entryDate)
  | { type: "visit/register"; by: string; input: VisitInput }
  | { type: "followup/register"; by: string; input: FollowUpInput; confirmStatus?: ConsolidationStatus }
  | { type: "person/changeStatus"; by: string; personId: string; to: ConsolidationStatus; reason?: string }
  | { type: "person/assignOwner"; by: string; personId: string; ownerUid: string | null }
  | { type: "demo/reset" };
export type ActionResult = { ok: true; state: SuiteState } | { ok: false; error: string; state: SuiteState };
export function initialSuiteState(): SuiteState;
export function applyAction(s: SuiteState, a: SuiteAction, now: LocalDateTime = DEMO_NOW): ActionResult;
```

**Invariantes del reducer:**
- **Revalida permisos con el perfil del actor** (`by`): `canManageEvent`, `can(members.consolidation.manage)`, `settings.manage`. Es defensa en profundidad y espeja lo que harán las reglas.
- Nunca muta objetos existentes (lo verifica un test con `Object.freeze` profundo).
- `visit/register` **agrega** un registro.
- Cada cambio de estado, responsable, fe o bautismo agrega un `PersonChange`, y cada acción sobre eventos agrega un `EventChange`.
- `followup/register` **nunca** cambia el estado si falta `confirmStatus`.
- "Integrado" cambia `lifecycleStage` a `integrante` (D.2).

**Resultado visible y tiempo:**
- Lo creado o registrado se ve de inmediato en la lista, la ficha, el dashboard y el calendario, como exige el §11.
- Al recargar vuelve al estado de las fixtures. El menú de perfil tiene "Reiniciar demo".
- El reloj es siempre `DEMO_NOW`. Prohibidos `Date.now()` y `new Date()` fuera de `dates.ts` (lo vigila un test).

### A.6 Módulos y firmas

**`lib/suite-preview/`** (todo puro, sin React; diseñado para promoverse a producción sin cambios: no importa fixtures, salvo `fixtures.ts` y `store.ts`):

| Archivo | Contenido |
|---|---|
| `clock.ts` | `export { DEMO_TODAY, DEMO_NOW } from "@/lib/finance-preview/clock"`. **Cambio mínimo en PR #3:** crear `lib/finance-preview/clock.ts` con ambas constantes y reemplazar sus dos declaraciones en `fixtures.ts` por `export { DEMO_TODAY, DEMO_NOW } from "./clock"`. Los valores son idénticos y los tests de PR #3 no cambian. Así el calendario y la página pública no arrastran los generadores ni las cifras financieras. |
| `types.ts` | Todas las entidades de C (Navigator), más `Occurrence`, `PublicEvent`, `PublicCalendar`, `Alert`, `TimelineItem`, `Ymd`, `HHmm` y `LocalDateTime` (`"YYYY-MM-DDTHH:mm"`). |
| `dates.ts` | `toEpochDay(ymd)`, `fromEpochDay(n)`, `addDays`, `daysBetween`, `weekdayOf` (0=dom), `daysInMonth(y,m)`, `addMonthsClamped(ymd,n)`, `nthWeekdayOfMonth(y,m,wd,ord)`, `isLeap`, `compareLocal(a,b)`. **Único** archivo con `Date.UTC`/`getUTCDay`. Para formato visual se reutiliza `lib/finance-preview/format.ts` (`shortDate`, `longDate`, `numericDate`, `capitalize`). |
| `access.ts` | Ver §D. |
| `routes.ts` | `PREVIEW_ROOT`, `ROUTE_RULES`, `moduleOfPath`, `isPublicPath`, `canSeeRoute`, `guardRoute`, `withProfile(href, uid)`. |
| `areas.ts` | `AREA_PALETTE` (unos 10 tokens con contraste ≥3:1), `areaById`, `selectableAreas(profile, areas)`, `eventColor(event, areas)` (siempre el responsable), `validateArea(input, areas)` (color único entre las activas, nombre único sin distinguir mayúsculas). |
| `recurrence.ts` | Ver §C. |
| `calendar.ts` | `occurrencesInRange`, `canManageEvent`, `canManageSeries`, `creatableAreas`, `myActivities(profile, …)`, `filterByAreas(occ, areaIds, onlyResponsible)`, `sortOccurrences` (todo el día primero, después hora de inicio), `monthGrid` (semana lunes–domingo), `weekRange`, `agendaGroups`, `validateEvent`, `validateSeriesPatch`. |
| `share.ts` | Ver §E. |
| `report.ts` / `report-pdf.ts` | Ver §G. |
| `phone.ts` | Ver §F. |
| `consolidation.ts` | `ageAt`, `nextBirthday`, `personStats`, `currentNextAction`, `computeAlerts`, `attentionQueue`, `dashboard`, `timeline`, `findDuplicates`, `duplicateCandidates`, `suggestStatusAfterFollowUp`, `isActiveForAlerts`. |
| `fixtures.ts` | `SX_PREVIEW_SENTINEL = "SX_PREVIEW_SENTINEL_V1_c41e"`, `AREAS`, `USERS`, `EVENTS`, `SHARE_LINK` (token `"demo"`), `PREVIEW_SHARE_TOKENS` (pool fijo de 4 tokens con aspecto demo), `PERSONS`, `VISITS`, `FOLLOWUPS`, `PERSON_CHANGES`, `LEAK_CANARIES`. |
| `store.ts` | Ver A.5. |

**`components/suite-preview/`:** `provider.tsx`, `access-gate.tsx`, `shell.tsx`, `use-query.ts`, `login.tsx`, `finance-summary.tsx`, `calendar/*`, `public/*`, `members/*`, `settings/*`, `reports/*` y `suite-preview.css`.
- `public/*` es **solo presentacional**: recibe `PublicCalendar | null` por props.
- El adaptador `public-route.tsx` vive en `calendar/`, lee el store, llama `resolvePublicCalendar` y entrega la proyección.

---

## B. Guardia de deploy y aislamiento

1. **`next.config.ts`:** sin cambios. `next-config.test.ts` sigue válido, porque los módulos nuevos usan el mismo mecanismo de `.preview.tsx`.
2. **`scripts/check-no-preview.mjs`** (se modifica; no es un test):
   ```js
   const OUT = join(process.cwd(), process.env.CDS_OUT_DIR ?? "out");
   const SENTINELS = ["FX_PREVIEW_SENTINEL_V2_7f3a", "SX_PREVIEW_SENTINEL_V1_c41e"];
   const PATHS = ["/preview/finanzas-2026", "/preview/calendario", "/preview/integrantes",
                  "/preview/configuracion", "/preview/reportes"];
   ```
   - Se conserva el chequeo de `out/preview/`, que ya cubre todas las rutas nuevas.
   - Los mensajes cambian a "preview de CDS Suite".
   - `CDS_OUT_DIR` existe solo para poder testear la guardia.
   - **No** se busca el texto genérico `"/preview/"`: es un riesgo de falso positivo con internals de Next.
3. **El sentinel SX se usa en runtime** (`data-suite-preview` en `SuiteShell` y en la raíz de la página pública). Así no se elimina por tree-shaking y delata cualquier chunk filtrado.
4. **`firebase.json`:** sin cambios. El `hosting.predeploy` existente ya ejecuta la guardia extendida.
5. **Flag:** se mantiene `CDS_FINANCE_PREVIEW`. Hay que documentar en el doc 17 que habilita toda la preview de la Suite.
6. **Tests existentes intactos.** Se agregan:
   - `tests/helpers/import-graph.ts`, una copia del walker con las listas como parámetros;
   - `tests/suite-preview/isolation.test.ts` (ver §H).
7. **El build por defecto no emite rutas nuevas.** Lo garantizan la extensión `.preview.tsx` (barrera 1), `notFound()` en `app/preview/layout.tsx` (barrera 2), la guardia sobre `out/` (barrera 3) y el test de estructura.
   - **Verificación obligatoria:** `rm -rf out && npm run build && node scripts/check-no-preview.mjs` debe terminar con ✓. Después, `npm run build:preview` y la guardia debe **fallar** con exit 1. Al final, de nuevo `rm -rf out && npm run build`.

---

## C. Recurrencia: confirmo E.2 con enmiendas

**En la preview:**
- el modelo;
- 4 opciones con `until`;
- la expansión con tests;
- "Editar toda la serie";
- "Cancelar solo esta";
- "Cancelar la serie desde hoy".

**En el siguiente slice**, visibles y deshabilitadas con la pill "Propuesta":
- "Editar solo esta";
- "Esta y las siguientes";
- "Mismo día N del mes".

**Enmiendas:**
1. **Editar una serie ya iniciada** (primera ocurrencia < hoy) permite cambiar solo campos no temporales: título, lugar, descripciones, participantes, visibilidad y notas. También se puede mover `until`, siempre que quede ≥ hoy.
   - `startDate`, horas, `allDay`, `freq`, la regla mensual y la duración quedan deshabilitados, con la ayuda "Para cambiar día u hora desde una fecha: Esta y las siguientes (Propuesta)".
   - **Motivo:** cambiar la hora de toda la serie reescribe las ocurrencias pasadas, que ya son historial. Es justamente el "split" que se difiere. Si la serie aún no empezó, se puede editar todo.
2. **"Cancelar la serie desde hoy"** se guarda como `seriesCancellation: { from: today, reason, by, at }` y **no** acortando `until`.
   - Las ocurrencias ≥ `from` se muestran "Cancelada", que es auditable y honesto.
   - Las pasadas quedan "Realizada".
3. **Modelo extensible:**
   - `monthly: { mode: "nth_weekday", weekday, ordinal }`, con discriminador `mode` para agregar `day_of_month` sin migración;
   - `exceptions[].type: "cancelled"`, con `"modified"` reservado para el siguiente slice.
4. **Límites:**
   - `until` ≤ `addMonthsClamped(startDate, 12)`;
   - tope duro de 60 ocurrencias por serie (12 meses semanal da 53);
   - una serie recurrente tiene una duración `span = daysBetween(startDate, endDate)` ≤ 1 (cubre la vigilia que cruza medianoche). Los eventos de varios días (campamento) no son recurrentes.
5. **Cancelaciones en series:**
   - "Cancelar solo esta" exige motivo (3–300, interno) y solo aplica a ocurrencias con fecha ≥ hoy;
   - archivar ("Eliminar") una serie con ocurrencias pasadas solo lo puede hacer `manage_all`, porque si no se ocultaría historial ajeno al alcance de `manage_assigned`.

**Algoritmo exacto** (`expandRecurrence(e, from, to, now): Occurrence[]`). Todo se calcula en fechas locales `YYYY-MM-DD` mediante epoch-days. Nunca se construyen instantes y nunca se usa `new Date("YYYY-MM-DD")`.
```
si e.status === "archivada" → []
span = daysBetween(e.startDate, e.endDate)            // 0 normal, 1 vigilia, n campamento
candidatos:
  none     → [e.startDate]
  weekly   → step 7 ; biweekly → step 14:
             k0 = max(0, floor((toEpochDay(from) - span - toEpochDay(e.startDate)) / step))
             d_k = startDate + k*step, k ≥ k0, mientras d_k ≤ until (INCLUSIVO) y d_k ≤ to
  monthly  → para cada mes M desde mes(startDate) hasta mes(min(until,to)):
             d = nthWeekdayOfMonth(Y, M, weekday, ordinal); incluir si startDate ≤ d ≤ until
nthWeekdayOfMonth(y,m,wd,ord):
  ord>0 : first = 1 + ((wd - weekdayOf(y,m,1) + 7) % 7); day = first + 7*(ord-1); day ≤ daysInMonth ? ymd : null
  ord=-1: last = daysInMonth; day = last - ((weekdayOf(y,m,last) - wd + 7) % 7)
filtrar por intersección: d ≤ to && addDays(d, span) ≥ from     // la vigilia aparece también el día siguiente
estado de cada ocurrencia d:
  excepción cancelled en d            → "cancelada" (+ cancelReason interno)
  seriesCancellation && d ≥ from      → "cancelada"
  e.status === "cancelada"            → "cancelada"
  fin < now                           → "realizada" (derivado)
  si no                               → "programada"
  fin = `${addDays(d,span)}T${endTime ?? (allDay ? "23:59" : startTime)}`; comparación lexicográfica con DEMO_NOW
```

**Opciones de ordinal al crear** (`monthlyOrdinalOptions(date)`):
- `n = ceil(day/7)`;
- si `n === 5`, solo `[-1]`;
- si además `day + 7 > daysInMonth`, `[n, -1]` (cuarto o último);
- si no, `[n]`.
- Validación: la `startDate` debe cumplir la regla. Una excepción en una fecha que la regla no genera es inválida.

**Hora y zona horaria:**
- Los eventos guardan la hora de pared de America/Santiago. Los cambios de horario (septiembre y abril) no afectan nada, porque nunca se convierte a UTC.
- La hora inexistente del día del cambio de septiembre (00:00–00:59) solo importa en producción al convertir a instantes (ICS o notificaciones): se resuelve hacia adelante.
- La semana empieza el lunes.

**Fechas verificadas para las fixtures** (1-oct-2026 es jueves):
- 1.er sábado: 03-10, 07-11, 05-12, 02-01-2027, 06-02, 06-03.
- Último viernes: 30-10 (5.º viernes, así que solo `-1`), 27-11, 25-12, 29-01-2027, 26-02.
- 28-11-2026 es 4.º y último sábado: opciones `[4,-1]`.

---

## D. Motor de permisos y producción

### D.1 API (`lib/suite-preview/access.ts`)
```ts
export const PERMISSIONS = ["finance.summary.read","finance.details.read","finance.records.manage",
  "finance.pastoral.manage","calendar.read","calendar.events.manage_assigned","calendar.events.manage_all",
  "members.consolidation.read","members.consolidation.manage","settings.manage"] as const;
export type Permission = (typeof PERMISSIONS)[number];
export const IMPLIES: Readonly<Partial<Record<Permission, readonly Permission[]>>> = {
  "finance.details.read": ["finance.summary.read"],
  "finance.records.manage": ["finance.details.read"],
  "finance.pastoral.manage": ["finance.details.read"],
  "calendar.events.manage_all": ["calendar.events.manage_assigned"],
  "calendar.events.manage_assigned": ["calendar.read"],
  "members.consolidation.manage": ["members.consolidation.read"],
};
export type ModuleId = "finanzas" | "calendario" | "integrantes" | "reportes" | "configuracion";
export const MODULE_ORDER: readonly ModuleId[];
export type InitialModule = "finanzas" | "calendario" | "integrantes/consolidacion";

export function effectivePermissions(p: AccessProfile): ReadonlySet<Permission>;
//  !active → ∅ ; admin → catálogo completo ; standard → cierre(filtrar(permissions ∈ catálogo)) \ {settings.manage}
export function can(p: AccessProfile, perm: Permission): boolean;
export function visibleModules(p: AccessProfile): ModuleId[];
//  finanzas: summary | calendario: calendar.read | integrantes: consolidation.read
//  reportes: details || calendar.read | configuracion: settings.manage
export type Landing =
  | { kind: "inactive" } | { kind: "no-modules" }
  | { kind: "module"; module: ModuleId; href: string; source: "initial" | "preset" | "first";
      invalidInitial?: InitialModule };            // para la advertencia en Usuarios
export function resolveInitialModule(p: AccessProfile): Landing;   // B.7 literal, pasos 1–7
export function moduleHref(m: ModuleId, p: AccessProfile): string;
//  finanzas → details ? "/preview/finanzas-2026" : "/preview/finanzas-2026/resumen"
//  calendario → "/preview/calendario" ; integrantes → "/preview/integrantes/consolidacion"
//  reportes → "/preview/reportes" ; configuracion → "/preview/configuracion/areas"
export const CARGO_PRESETS: Record<Cargo, { baseRole: BaseRole; permissions: Permission[];
  initialModule: InitialModule; requiresAreas: boolean }>;          // tabla B.3
export function legacyRoleToProfile(role: "admin"|"pastor"|"finance"|"leader",
  base: { uid: string; displayName: string; email: string; active: boolean }): AccessProfile;
//  admin → admin/Administración/finanzas ; pastor → preset Pastor con initialModule "finanzas"
//  finance → preset Finanzas ; leader → preset Líder, areaIds [] , calendario
export function validateProfileChange(actorUid: string, users: AccessProfile[], next: AccessProfile,
  areas: Area[]): { errors: string[]; warnings: string[] };
//  errores: ≥1 admin activo ; actor no se quita admin ni se desactiva ; permisos ⊆ catálogo ;
//           settings.manage nunca en permissions (solo vía baseRole) ; areaIds existentes ;
//           initialModule ∈ visibleModules al guardar
//  warnings: manage_assigned sin áreas ; initialModule actual ya no permitido
```

**`lib/suite-preview/calendar.ts`:**
```ts
export function canManageEvent(p: AccessProfile, e: CalendarEvent, areas: Area[], today: Ymd,
  occurrenceDate?: Ymd): boolean;
//  archivada → false ; manage_all → true ; !manage_assigned → false
//  área responsable inexistente o inactiva → false ; responsable ∉ p.areaIds → false
//  (occurrenceDate ?? e.endDate) < today → false   (pasado = solo lectura, B.5.6)
export function canManageSeries(...): boolean;   // igual, sin la regla de pasado; las acciones solo tocan ≥ hoy
export function creatableAreas(p, areas): Area[]; // manage_all: activas ; manage_assigned: activas ∩ p.areaIds
```

**`lib/suite-preview/routes.ts`:**
```ts
export function canSeeRoute(p: AccessProfile, pathname: string): boolean;
export type GuardDecision = { type: "allow" } | { type: "public" } | { type: "login" } | { type: "inactive" }
  | { type: "no-modules" } | { type: "redirect"; to: string; notice: string };
export function guardRoute(p: AccessProfile | null, pathname: string): GuardDecision;
```

**Tabla de rutas** (gana el prefijo más largo; se normaliza la barra final):

| Prefijo | Acceso |
|---|---|
| `/preview` exacto | login |
| `/preview/calendario/compartir/` | público |
| `/preview/finanzas-2026/resumen` | summary |
| `/preview/finanzas-2026/configuracion` | `settings.manage` |
| `/preview/finanzas-2026` | details |
| `/preview/calendario` | `calendar.read` |
| `/preview/integrantes` | `consolidation.read` |
| `/preview/integrantes/consolidacion/ajustes` | `consolidation.read` (solo lectura) |
| `/preview/reportes/calendario` | `calendar.read` |
| `/preview/reportes` | details o `calendar.read` |
| `/preview/configuracion` | `settings.manage` |

**Cómo decide el redirect:**
- Si el módulo es visible pero la subruta no, va a `moduleHref(módulo)`. Ejemplo: Líder en `/movimientos` termina en `/resumen`, con el aviso "No tienes acceso a Movimientos".
- Si el módulo no es visible, va a `landing.href`, con el aviso "No tienes acceso a {Módulo}".

### D.2 Plan de migración a producción (solo documentado; las reglas **no** se tocan ahora)

1. **Fase 1, modelo con doble lectura.**
   - `users/{uid}` agrega opcionalmente `schemaVersion: 2`, `baseRole`, `cargo`, `permissions[]`, `areaIds[]` e `initialModule`, y **conserva `role`** como `legacyRole` de facto.
   - `validUser` amplía `hasOnly` con esas claves y valida:
     - `permissions.hasOnly(CATÁLOGO_SIN_SETTINGS)`;
     - `baseRole in ['admin','standard']`;
     - `areaIds is list && size() <= 20`;
     - `initialModule in [...]`.
   - `access-provider` calcula `effectivePermissions`: si `schemaVersion==2`, usa los campos nuevos; si no, `legacyRoleToProfile(role)`. Hay que cambiar el `key` del provider de `role` a un hash de `eff`.
2. **Reglas con cierre estático.** Las reglas no pueden iterar, así que cada permiso se evalúa contra su lista de implicantes:
   ```
   function u() { return get(/databases/$(database)/documents/users/$(request.auth.uid)).data; }
   function isAdmin() { return member() && (u().get('baseRole','') == 'admin' || u().role == 'admin'); }
   function can(implicantes, legacyRoles) { return member() && (isAdmin()
       || u().get('permissions', []).hasAny(implicantes) || u().role in legacyRoles); }
   // details()  = can(['finance.details.read','finance.records.manage','finance.pastoral.manage'], ['pastor','finance'])
   // approved() = can([...summary y sus implicantes...], ['pastor','finance','leader'])
   ```
   - Las escrituras de finanzas pasan a requerir `finance.records.manage`. Hoy las da `details()`.
   - Durante la transición, la rama `legacyRoles` mantiene vigentes los permisos actuales. Se retira cuando el backfill terminó y se verificó.
   - Un test de paridad (`test:rules` + unitario) verifica que las listas de implicantes de las reglas coinciden con el cierre de `IMPLIES`. Es el riesgo de divergencia de PR #3.
3. **Backfill.** Un script Admin SDK idempotente, con `--dry-run`, que escribe `legacyRoleToProfile(role)` y deja a los leader sin áreas, con su advertencia. Se ejecuta con aprobación humana.
4. **Claims vs documento.** Se descartan las custom claims: la revocación tarda hasta que se refresca el token. Con menos de 30 usuarios, `get(users/uid)` por request basta y la revocación es inmediata.
5. **Integrantes.**
   - Colecciones `people/{id}`, `people/{id}/visits`, `/followUps` y `/changes`.
   - **Separadas** de `titheProfiles`, sin referencias cruzadas en esta etapa.
   - Lectura con `can([consolidation.read, consolidation.manage])` y escritura con `manage`.
   - `allow delete: if false`.
   - `visits` y `changes` son solo de creación. Una visita solo se puede actualizar para anularla, con `diff().affectedKeys().hasOnly(['voided','voidReason','updatedBy','updatedAt'])`.
   - **Prohibido guardar** `age` e `isMinor`: el `hasOnly` del documento no los incluye.
   - Para el costo de la lista con 2.000 personas se desnormalizan `visitCount`, `lastVisitDate` y `nextAction*` en `people/{id}`, con consistencia forzada en reglas: `getAfter` de la visita o seguimiento con `revision+1`, el mismo patrón que `summaryLinked`. La fuente de verdad siguen siendo las visitas. La edad nunca se guarda, porque cambia sola cada día.
6. **Auditoría.**
   - Un cambio de estado y su `PersonChange` se escriben en el mismo batch. El documento lleva `revision` y `lastChangeId`, y las reglas exigen que `getAfter(changes/lastChangeId)` coincida en campo, `from` y `to`.
   - `EventChange` funciona igual sobre `calendarEvents`.
7. **Rutas en producción (export estático).**
   - La ficha usa `?id=`, igual que en la preview.
   - El enlace público usa el rewrite de Hosting `/calendario/compartir/**` hacia `/calendario/compartir.html`, como `/campanas/**`, y el token se lee del path en el cliente.
8. **Enlace público (decisión):** una Function `calendarPublicFeed`, con rewrite `/api/calendario-publico/**`, que:
   - recibe el token;
   - compara `sha256(token)` con el `tokenHash` guardado en `calendarShareLinks/{id}` (solo admin o `manage_all`; el token en claro **no** se guarda);
   - lee los eventos con Admin SDK;
   - aplica el **mismo** `toPublicEvent`, promovido a un módulo puro compartido;
   - responde JSON con `Cache-Control: public, max-age=120`;
   - devuelve la misma respuesta "no disponible" para un token inválido y para uno desactivado.
   - La página pública lleva `Referrer-Policy: no-referrer`.
   - **Se descarta la colección de proyección** sincronizada por triggers: se puede desincronizar y la revocación no es atómica. **Nunca** se abre `calendarEvents` al público.
   - El token tiene 128 bits de `crypto.getRandomValues` en base64url. Regenerar sobrescribe el hash, así que el token anterior muere al instante.
9. **Zona horaria en producción.**
   - Se agrega `TIMEZONE = "America/Santiago"`.
   - "Hoy" se calcula con `Intl.DateTimeFormat(..., { timeZone })`, nunca con la zona del dispositivo.
   - Las reglas comparan fechas locales con una tolerancia de ±1 día respecto de `request.time`.

---

## E. Proyección pública

```ts
export const PUBLIC_EVENT_KEYS = ["id","title","startDate","endDate","allDay","startTime","endTime",
  "location","publicDescription","responsibleArea","participantAreas","status"] as const;
export const PUBLIC_AREA_KEYS = ["slug","name","color"] as const;
export function toPublicArea(a: Area): PublicArea;            // literal explícito, nunca spread
export function toPublicEvent(o: Occurrence, e: CalendarEvent, areas: ReadonlyMap<string, Area>): PublicEvent;
//  id = "pe_" + fnv1a(`${e.id}@${o.date}`) (opaco, sin el id interno)
//  status: o.status === "cancelada" ? "cancelada" : "programada"   ("realizada" no se expone)
//  claves ausentes → null (forma estable para el test de claves exactas)
export function resolvePublicCalendar(i: { link: ShareLink; events: CalendarEvent[]; areas: Area[];
  presentedToken: string | null; today: Ymd; now: LocalDateTime }): PublicCalendar | null;
//  null si !link.active || presentedToken !== link.token
//  rango = primer día del mes anterior .. último día de hoy+6 meses
//  solo visibility==="public" y status!=="archivada"; las canceladas sin motivo
//  areas del encabezado = activas que tienen ≥1 evento público en el rango
```

**Estrategia de test contra fugas:**
1. **`LEAK_CANARIES` en las fixtures:**
   - `CANARIO_NOTA_INTERNA_7Q`, en las `internalNotes` de varios eventos, incluido uno **público**;
   - `CANARIO_MOTIVO_CANCELACION_3K`, en el motivo de "Evangelismo en la plaza";
   - `CANARIO_EXCEPCION_9P`, en la excepción de la reunión de jóvenes;
   - `CANARIO_ARCHIVADA_2M`, en el título de la actividad archivada.
   - Además: correos `@demo.invalid`, nombres de usuarios, nombres y teléfonos de `PERSONS`, y títulos de eventos de equipo ("Ensayo de alabanza", "Reunión de líderes").
2. **Unitario sobre `resolvePublicCalendar`:**
   - un recorrido profundo verifica que las claves de cada evento son exactamente `PUBLIC_EVENT_KEYS` y las de cada área `PUBLIC_AREA_KEYS`;
   - `JSON.stringify` no contiene ningún canario, `"@"`, `uid`, `"5555"` ni nombres;
   - un token regenerado o desactivado da `null`, y el token nuevo resuelve.
3. **Render de `PublicCalendarPage`** con la proyección, en todas sus vistas y abriendo **cada** detalle (incluido el cancelado):
   - `container.innerHTML` no contiene canarios, títulos de equipo, correos ni nombres de personas;
   - no hay ningún `href` hacia `/preview/` salvo `/compartir/`, ni `perfil=`;
   - los estados no disponible e inválido muestran el mismo texto.
4. **Estático:** `components/suite-preview/public/**` solo importa `lib/suite-preview/types`, `lib/finance-preview/format`, `lucide-react` y react. Nunca `provider`, `store`, `fixtures`, `consolidation` ni `access`.
5. **Validación manual en el doc 17:** después de `npm run build:preview`, `grep -c CANARIO out/preview/calendario/compartir/demo.html` debe dar 0. Para la fuga en sí, la evidencia es el HTML prerenderizado, no el JS: el bundle del store contiene las fixtures por diseño.

**RISK de privacidad:** la fixture de Navigator pone "un nombre ficticio" en las `internalNotes` de la reunión de consolidación. Las notas internas las ve todo `calendar.read`, incluidos Finanzas y Líder.
- **REC:** usar el canario y **no** un nombre de `PERSONS`; si no, se rompe el criterio 30.
- **REC para producción:** el campo debe decir "No escribas datos personales de integrantes".

---

## F. Teléfono, correo y duplicados

**API:**
```ts
export type PhoneResult = { ok: true; e164: string; isChile: boolean; display: string }
                        | { ok: false; reason: "empty" | "invalid" };
export function normalizePhone(raw: string): PhoneResult;
export function formatPhone(e164: string, raw?: string): string;
export function waLink(e164: string): string;            // "https://wa.me/" + dígitos, sin texto
export function normalizeEmail(raw: string): { ok: true; value: string } | { ok: false };
```

**Reglas de Navigator, validadas con enmiendas**, en orden:
1. `trim`. Quitar espacios, guiones, puntos, paréntesis y barras. **Enmienda:** un `00` inicial se trata como `+`.
2. Con `+`:
   - el resto debe ser solo dígitos, con un total de 8–15 (E.164);
   - si empieza con `56`, el número nacional debe tener exactamente 9 dígitos; si no, es inválido (por ejemplo `+56 9 1234 567`);
   - los números extranjeros no se transforman. Limitación conocida: `+58 0412…` con el 0 troncal no coincidirá con `+58 412…`.
3. 11 dígitos que empiezan con `56` → `+56` + 9.
4. 9 dígitos que empiezan con `9` → `+56` + dígitos (celular).
5. 9 dígitos que empiezan con 2–8 → `+56` + dígitos (fijo).
6. **Enmienda:** 10 dígitos que empiezan con `0` y cuyo resto cumple 4 o 5 → quitar el 0 (`09 1234 5678` y `022 123 4567` antiguos).
7. 8 dígitos → `+569` + dígitos (celular anterior a 2012). Queda como HYPOTHESIS aceptada y documentada.
8. Cualquier otra cosa es inválida, con la ayuda "Si es extranjero, escribe el código de país con +".

**Formato visible:**
- celular: `+56 9 1234 5678`;
- Santiago: `+56 2 1234 5678`;
- otros fijos chilenos: `+56 XX XXX XXXX`;
- extranjeros: el `phoneRaw` limpio, porque no conocemos el largo del código de país.

**Correo:** `trim().toLowerCase()`, con el mismo regex y el mismo máximo de 160 que `lib/settings/users.ts`. Se copia, no se importa, porque ese módulo está prohibido; un comentario indica de dónde viene. Sin normalizar puntos ni `+` de Gmail.

**Duplicados:**
- `findDuplicates(persons)` arma `Map<e164, id[]>` y `Map<email, id[]>` sobre **todas** las personas, incluidas las cerradas o integradas. Es O(n).
- Un grupo con ≥2 personas genera `posible_duplicado_telefono` o `posible_duplicado_correo` para cada miembro, con `otherIds`.
- `duplicateCandidates(input, persons, excludeId?)` se usa en el formulario. La advertencia **no bloquea** y ofrece 3 opciones (E.5).
- Las alertas de duplicado ignoran `doNotContact`, como dice E.6. WhatsApp se oculta con `doNotContact`.

**RISK:** los teléfonos `+56 9 5555 01xx` tienen formato válido y podrían estar asignados a personas reales.
- **REC (decidido):** en la preview, "Abrir WhatsApp" llama a `simulate("Abrir WhatsApp")` y muestra el número. **No** se renderiza `<a href="https://wa.me…">`. Lo vigila un test de componente.

---

## G. PDF del reporte de calendario

- **No se reutiliza** `lib/finance/report-pdf.ts`: importa `./formatters`, que importa Firestore (FACT). El walker lo rechazaría.
- **REC: generación local.** `lib/suite-preview/report-pdf.ts`:
  ```ts
  export async function buildCalendarPdf(rows: CalendarReportRow[], meta: ReportMeta): Promise<{ save(name: string): void; pageCount: number }> {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
    // encabezado "Casa de Salvación · {período} · filtros · Generado por {perfil demo} el {DEMO_TODAY}"
    // banda "Vista previa · datos de demostración" en cada página (didDrawPage); sin logo, sin fetch
  }
  ```
  - La llamada ocurre solo en el `onClick` de "Descargar PDF". El archivo se llama `reporte-calendario-DEMO-2026-10.pdf`.
  - **Seguridad:** jsPDF usa fuentes estándar embebidas y no hace red salvo que se le pida `addFont` con una URL o `addImage` con URL (prohibido). `save()` genera la descarga por blob local.
  - **Build:** el chunk de jspdf solo se emite si una página compilada lo importa. Como las páginas son `.preview.tsx`, el build por defecto no lo incluye por esta vía (producción ya trae jspdf para finanzas, así que tampoco hay impacto en tamaño).
  - El test nuevo exige que jspdf se importe **solo** de forma dinámica y **solo** en `report-pdf.ts`.
- **`lib/suite-preview/report.ts`:**
  ```ts
  export function calendarReportRows(i: { events; areas; from: Ymd; to: Ymd; areaId?: string; onlyResponsible: boolean;
    statuses: ("programada"|"realizada"|"cancelada")[]; visibility: "all"|"public"|"team"; now }): CalendarReportRow[];
  ```
  - Las filas tienen exactamente fecha · hora · actividad · responsable · participantes · lugar · estado · visibilidad · descripción pública.
  - **Nunca** incluyen `internalNotes` ni motivos de cancelación. Las archivadas no aparecen.

---

## H. Plan de tests (`tests/suite-preview/`)

| Archivo | Casos (y mapeo al §22) |
|---|---|
| `access.test.ts` | **Permisos simulados y módulo inicial.** <ul><li>Cierre de cada implicación; `settings.manage` solo con admin, aunque esté en `permissions`; inactivo da ∅; permisos desconocidos se ignoran.</li><li>Matriz de `visibleModules` por perfil fixture: admin 5; pastor sin Configuración; líder `[finanzas, calendario, reportes]`; finanzas ídem; consolidación `[calendario, integrantes, reportes]`; sin-permisos `[]`.</li><li>`resolveInitialModule` pasos 1–7: lider-fallback va a calendario con `invalidInitial`; consolidación a `/integrantes/consolidacion`; finanzas a `/finanzas-2026`; líder a `/calendario`.</li><li>`legacyRoleToProfile` para los 4 roles; `validateProfileChange` (último admin, autodegradación, settings, áreas inexistentes, advertencia sin áreas).</li></ul> |
| `routes.test.ts` | **Navegación según permisos.** <ul><li>Tabla `canSeeRoute`.</li><li>Propiedad: para todo perfil y toda ruta, el redirect termina en una ruta permitida (sin loop).</li><li>No-modules e inactivo no redirigen.</li><li>Público y login exentos.</li><li>Líder en `/finanzas-2026/movimientos` va a `/resumen` con aviso.</li><li>`withProfile` conserva el query; el público nunca lleva `perfil`.</li></ul> |
| `areas.test.ts` | **Colores por área.** <ul><li>`eventColor` = color del responsable en todas las fixtures; los participantes nunca lo cambian.</li><li>Un área inactiva no está en `creatableAreas`, pero sus eventos conservan nombre y color.</li><li>Color único entre las activas.</li></ul> |
| `calendar.test.ts` | **Filtrado por áreas; públicos vs internos.** <ul><li>Matriz de `canManageEvent`: Líder Jóvenes responsable sí; solo participante no; otra área no; pasado no; área inactiva no; `manage_all` en pasado sí; archivada no.</li><li>`creatableAreas` del Líder.</li><li>`filterByAreas`, responsable o participante y "solo responsable".</li><li>`myActivities` con bandera de solo lectura.</li><li>Orden por día; archivadas fuera de todas las vistas; canceladas visibles.</li></ul> |
| `recurrence.test.ts` | <ul><li>Semanal y quincenal con `until` inclusivo.</li><li>Mensual 1.er sábado, 2.º sábado y último viernes con las fechas exactas de §C; cruce de mes y de año; febrero.</li><li>Opciones de ordinal (28-11 da `[4,-1]`, 30-10 da `[-1]`).</li><li>`until` < inicio y > 12 meses inválidos; tope de 60.</li><li>Excepción solo en esa fecha; excepción fuera de la regla inválida.</li><li>`seriesCancellation`.</li><li>Vigilia 22:00–02:00 visible en la consulta del día siguiente; campamento en ambos días.</li><li>Realizada derivada en el borde `DEMO_NOW`.</li><li>Serie que cruza abril de 2027 conserva la hora de pared.</li><li>`validateSeriesPatch` bloquea campos temporales en una serie iniciada.</li></ul> |
| `share.test.ts` | **Calendario compartido sanitizado.** Ver §E.2: claves exactas en profundidad, canarios, team y archivadas fuera, cancelada sin motivo, tokens regenerado, desactivado y reactivado, rango y áreas del encabezado. |
| `public-view.test.tsx` | Ver §E.3 (render, `innerHTML` y links). |
| `phone.test.ts` | **Duplicados.** <ul><li>Equivalencia `+56 9 1234 5678` = `912345678` = `56912345678` = `(+56) 9-1234-5678` = `0912345678` = `0056912345678`.</li><li>8 dígitos; fijo `221234567`; `+58 412 1234567` aceptado.</li><li>Inválidos: vacío, `123`, 16 dígitos, `+56 9 1234 567`, letras.</li><li>Formato visible; `waLink`; `normalizeEmail`.</li></ul> |
| `consolidation.test.ts` | **Edad derivada, registro de visitas, timeline, alertas y duplicados.** <ul><li>`ageAt`: cumpleaños hoy y mañana; 29-02 en año no bisiesto el 28-02; sin fecha da `null` y "—".</li><li>`nextBirthday` con cruce de año.</li><li>`personStats` sin visitas anuladas.</li><li>Las 8 alertas con fixture y contra-fixture cada una.</li><li>`doNotContact` suprime alertas excepto duplicados.</li><li>`attentionQueue`: orden F y una fila por persona.</li><li>Ventanas del dashboard.</li><li>`timeline` ordenado e incluye creación, visitas, seguimientos y cambios.</li><li>`findDuplicates`, teléfono y correo.</li><li>"Sin información" se conserva y no cuenta como "No".</li><li>`suggestStatusAfterFollowUp` propone "En seguimiento" sin aplicarlo.</li></ul> |
| `store.test.ts` | <ul><li>Pureza (`Object.freeze` profundo).</li><li>`visit/register` incrementa, actualiza la última visita y no toca las visitas previas.</li><li>`person/create` crea la 1.ª visita.</li><li>`followup/register` sin `confirmStatus` no cambia el estado.</li><li>Integrado cambia la etapa y conserva el historial.</li><li>El reducer rechaza a un Líder que archiva un evento de otra área y a calendar.read que crea una persona.</li><li>Ids deterministas; `demo/reset`.</li></ul> |
| `report.test.ts` | <ul><li>Filtros (período, área responsable o participante, solo responsable, estados incluida la realizada derivada, visibilidad).</li><li>Orden; columnas sin notas ni motivos; nunca archivadas.</li><li>Smoke de `buildCalendarPdf` (`pageCount ≥ 1`).</li></ul> |
| `components.test.tsx` | <ul><li>`SuiteShell` por perfil: la sidebar, el rail y la bottom nav muestran solo `visibleModules`.</li><li>Líder: la subnav Finanzas tiene solo "Resumen"; sin "Registrar".</li><li>`FinancialShell` dentro de `SuiteProvider`(admin): una sola nav "Finanzas" con los links de PR #3 y un solo `role="status"`.</li><li>Formulario de actividad del Líder: solo sus áreas activas.</li><li>Crear actividad: aparece en la Agenda y muestra el toast "Simulación: no se guardó nada.".</li><li>Cancelar y Eliminar exigen motivo; Eliminar oculta.</li><li>Registrar visita actualiza cantidad y última visita en la lista y en la ficha.</li><li>Seguimiento con sugerencia.</li><li>Nueva persona: aviso de duplicado no bloqueante con 3 opciones; tri-estado por defecto "Sin información".</li><li>Sin `a[href^="https://wa.me"]`.</li><li>Calendar.read: sin navegación ni conteos de Integrantes.</li></ul> `next/navigation` se mockea con `usePathname` y `useRouter`. |
| `access-gate.test.tsx` | <ul><li>Skeleton antes de `ready`.</li><li>Redirect con aviso y sin renderizar la ruta prohibida.</li><li>`replace` llamado una sola vez (ref).</li><li>Pantallas no-modules e inactivo.</li></ul> |
| `isolation.test.ts` | **Aislamiento Firebase.** <ul><li>Walker transitivo desde `app/preview`, `components/suite-preview`, `lib/suite-preview` y `lib/finance-preview/clock.ts`, con las mismas listas prohibidas.</li><li>Prohibidos `fetch(`, `XMLHttpRequest`, `localStorage`, **`sessionStorage`**, `indexedDB`, `sendBeacon` y `document.cookie` en esos directorios.</li><li>`Date.now(`/`new Date(` solo en `dates.ts`.</li><li>jspdf solo dinámico y solo en `report-pdf.ts`.</li><li>Imports permitidos de `public/**`.</li><li>El walker detecta Firebase (control positivo).</li></ul> |
| `structure.test.ts` | **Estructura de rutas.** <ul><li>Existe cada ruta esperada de A.1 como `page.preview.tsx`.</li><li>No hay carpetas `[`.</li><li>Layouts solo en las 3 ubicaciones permitidas.</li><li>`app/preview/layout.tsx` contiene el gate `CDS_FINANCE_PREVIEW`.</li><li>No hay `layout.preview.tsx`.</li></ul> |
| `deploy-guard.test.ts` | Ejecuta `node scripts/check-no-preview.mjs` con `CDS_OUT_DIR` apuntando a carpetas temporales: limpia termina con exit 0; con el sentinel SX, el FX, `/preview/integrantes` o `out/preview/` termina con exit 1. |

**Gates:**
- lint, typecheck, `npm test` (los 223 existentes intactos más los nuevos);
- `npm run build` + guardia ✓;
- `npm run build:preview` (la guardia falla, como se espera);
- `npm run test:rules` no aplica, porque las reglas no se tocan.

---

## I. Riesgos (por orden)

1. **RISK: refactor del shell que rompe PR #3.** El contrato de §1.2 es estricto: solo `usePathname`, una nav "Finanzas", el primer `note`, `aria-current` en Hoy y el sentinel FX. Mitigación: las restricciones de A.2 y un test nuevo con el shell embebido. Si `FinancialShell` empieza a usar `useRouter`, el test de PR #3 falla, y es correcto que falle.
2. **RISK: route groups con prefijo compartido** (`calendario` en dos grupos). Es una HYPOTHESIS que se valida en el primer commit con la secuencia de A.1; el fallback está definido.
3. **RISK: datos sensibles.** La confesión de fe y el bautismo son **datos sensibles** (creencias religiosas) según la ley chilena de protección de datos; la Ley 21.719 entra en vigencia en diciembre de 2026. Además se registran menores. Es un bloqueante de producción: base de licitud o consentimiento, finalidad, retención y, para menores, consentimiento del adulto responsable. **Validar con asesoría legal.**
   - Hay una tensión entre "nunca se borra físicamente" y el derecho de supresión. Se necesita un procedimiento de anonimización o supresión solo para admin, mediante Function.
4. **RISK: la preview publicada por error.** Mitigado con 3 barreras, la guardia extendida y su propio test.
5. **RISK: recurrencia incorrecta por alcance.** Mitigado con las enmiendas de §C (sin edición temporal de series iniciadas) y los tests de fechas exactas.
6. **RISK: hidratación, flash o loops.** Mitigado con el gate con skeleton, el ref anti-doble y el test de propiedad.
7. **RISK: divergencia preview–producción**, la lección P2 y riesgo 3 del doc 15. `lib/suite-preview/*` es puro y sin dependencias de UI, para **promoverlo** a `lib/calendar` y `lib/members` en el slice real, no reescribirlo.
8. **RISK: números de las fixtures posiblemente reales.** Mitigado: WhatsApp no navega.
9. **RISK: `AuthProvider` en el root layout.** Firebase Auth también carga en la página pública de la preview. Se hereda; no hay lecturas de Firestore.
10. **RISK: notas internas con datos de integrantes**, visibles para todo `calendar.read` (§E).

### Lo que necesita producción (checklist)

- [ ] **Reglas:** `validUser` v2, `can()` con implicantes y doble lectura `legacyRoles`, colecciones `areas`, `calendarEvents` (+ `changes`), `calendarShareLinks` (privada), `people/**`. Test de paridad entre `IMPLIES` y las reglas. `test:rules` completo.
- [ ] **Functions:**
  - `calendarPublicFeed` (hash de token, `toPublicEvent` compartido, caché corta, respuesta uniforme);
  - una Function de supresión o anonimización de personas;
  - opcional: un script de backfill de usuarios.
- [ ] **Hosting:** rewrites `/calendario/compartir/**` → HTML estático y `/api/calendario-publico/**` → Function; `Referrer-Policy: no-referrer` en la página pública.
- [ ] **Índices:**
  - `calendarEvents(status, seriesEnd)`, donde `seriesEnd = until + span` o `endDate`, para la consulta por rango;
  - `people(lifecycleStage, consolidationStatus, entryDate)`;
  - `visits` y `followUps` por `personId, date`.
- [ ] **Migración:** backfill idempotente con `--dry-run` y aprobación humana; `access-provider` con doble lectura; retiro posterior de `legacyRoles`.
- [ ] **Desnormalización** de `visitCount`, `lastVisitDate` y `nextAction*` con consistencia en reglas; edad nunca guardada.
- [ ] **Auditoría:** `PersonChange` y `EventChange` en el mismo batch, con `revision`/`lastChangeId`.
- [ ] **Zona horaria:** `TIMEZONE` constante, "hoy" en Santiago, tolerancia de ±1 día en reglas.
- [ ] **Privacidad:** asesoría legal sobre datos sensibles y menores, política de retención para "Sin continuidad" e integrados, procedimiento de supresión, aviso en las notas internas.
- [ ] Vincular `titheProfiles` con `Person` queda para Directorio, sin exponer diezmos a Consolidación.

---

## Handoff para Builder

**PROBLEM / GOAL**
Construir una preview navegable de Calendario + Integrantes/Consolidación + Reportes de calendario + Configuración (Áreas y Usuarios), dentro de un shell global que evoluciona desde Financial UX V2. Solo fixtures, sin Firebase y sin deploy.

**CONTEXT (causa raíz de las restricciones)**
- El export estático impide segmentos dinámicos para entidades creadas en la sesión.
- Los tipos de rutas de dev y de build divergen (P3).
- `lib/finance` arrastra Firestore (P2).
- El test de PR #3 fija el contrato de `FinancialShell` y mockea `next/navigation` solo con `usePathname`.

**DECISIONS**
Las de §0. En particular:
- route groups `(suite)` y `(publico)` bajo el nuevo `app/preview/layout.tsx`;
- `FinancialShell` compone `SuiteShell`;
- `?perfil` en la URL y store en memoria;
- sin segmentos dinámicos;
- recurrencia según §C;
- PDF local con import dinámico;
- WhatsApp simulado.

**INVARIANTS**
- Ningún test existente se modifica.
- No hay imports de Firebase ni de módulos prohibidos.
- Todo archivo especial es `.preview.tsx`, salvo los 3 layouts.
- El cierre de permisos es único (`access.ts`) y `settings.manage` solo existe por `baseRole` admin.
- El color de una actividad es el de su área responsable.
- Nada se borra: cancelar y archivar exigen motivo.
- Las visitas solo se agregan.
- Ningún estado cambia sin confirmación.
- La proyección pública se arma por lista blanca y nunca con spread.
- El reloj es único (`DEMO_NOW`).
- Todo `dispatch` muestra "Simulación: no se guardó nada.".

**REQUIREMENTS**
§A.1–A.6, §B, §C, §D.1, §E, §F, §G.

**ACCEPTANCE CRITERIA**
- Los criterios 1–32 de Navigator, con dos cambios de ruta: la ficha es `persona?id=` y la pública es `/compartir/demo?t=`.
- Los tests de §H en verde.
- Los gates de §H.
- La secuencia de validación de A.1 documentada en el doc 17.

**RISKS**
§I, puntos 1, 2, 5 y 6 durante la construcción.

**OPEN QUESTIONS**
1. Salvador: ¿acepta que, sin `?perfil`, se entre como Administración (compatibilidad con PR #3) en vez de mandar al login?
2. Salvador: ¿acepta las rutas `persona?id=` y `/compartir/demo?t=` en lugar de los segmentos literales del brief?
3. Designer: la disposición visual de los módulos y subnavs en la sidebar, el rail y la bottom nav, y la presentación de las series canceladas.
4. Navigator: confirmar que se reemplaza el "nombre ficticio" de las notas internas por un canario.
5. Legal: datos sensibles y menores, antes de cualquier slice productivo.

**RELEVANT ARTIFACTS**

Archivos que se modifican:
- `components/finance-preview/shell.tsx`
- `components/finance-preview/context.tsx` (delegación de toast)
- `lib/finance-preview/fixtures.ts` (re-export desde `clock.ts`)
- `scripts/check-no-preview.mjs`

Archivos que se agregan: `components/finance-preview/nav.ts`, `lib/finance-preview/clock.ts`, `app/preview/layout.tsx`, `app/preview/page.preview.tsx`, `app/preview/(suite)/**`, `app/preview/(publico)/**`, `app/preview/finanzas-2026/resumen/page.preview.tsx`, `components/suite-preview/**`, `lib/suite-preview/**`, `tests/helpers/import-graph.ts` y `tests/suite-preview/**`.

No se tocan:
- `next.config.ts`, `firebase.json`, `package.json` y `firestore.rules`;
- `app/layout.tsx`, `app/preview/finanzas-2026/layout.tsx` y todos los tests de `tests/finance-preview/`.

Referencias:
- `node_modules/next/dist/docs/01-app/02-guides/static-exports.md`, `.../04-functions/generate-static-params.md`;
- `docs/mission-2026/15-financial-ux-v2-validation.md` (P1–P3, P8);
- `lib/finance/report-pdf.ts` (no reutilizable);
- `firestore.rules` (`validUser`, `details`/`approved`, precedente `campaignPublicViews`).

---

## Aprendizaje

- **Brain:** el repositorio `salva-ai-brain` **no está accesible** en esta sesión: no aparece entre los directorios de trabajo. No se consultó ni se escribió nada.
- **Evidencia potencial para ATLAS-L-009** (exclusión en compilación de rutas preview en export estático, con el layout en ambos builds): extender el patrón a varios layouts y route groups. **Solo vale como evidencia después** de que Builder ejecute la secuencia de validación de A.1. Hoy no hay evidencia nueva.
- **LEARNING CANDIDATE** (para registrar con la autorización de Salvador):
  - **ID:** ATLAS-L-0xx (asignar).
  - **Título:** en apps con export estático, las entidades creadas en runtime se direccionan por query param y no por segmento dinámico.
  - **Agente / Proyecto / Fecha:** Atlas / CDS Suite / 2026-10-02.
  - **Problema:** las rutas de ficha y token de la preview no pueden prerenderizar ids creados en la sesión ni tokens regenerados.
  - **Causa raíz:** `output: "export"` exige `generateStaticParams` con `dynamicParams: false`. Además, los route types de dev y de build divergen cuando las páginas dependen de una bandera (P3).
  - **Intervención:** `?id=` / `?t=` leídos tras hidratar, sin segmentos dinámicos en la preview. Producción usa rewrites de Hosting hacia HTML estático (precedente `/campanas/**`).
  - **Evidencia:** solo diseño; falta validar con builds.
  - **Hipótesis generalizable:** las rutas de entidades dinámicas en un SPA con export estático conviene diseñarlas con query o rewrite desde la preview, para que preview y producción compartan el patrón.
  - **Contextos aplicables:** Next.js con `output: "export"` en hosting estático.
  - **Contraejemplos conocidos:** apps con servidor o ISR.
  - **Confianza:** media.
  - **Estado:** CANDIDATE.
  - **Validación requerida:** que el Builder demuestre dev + build + build:preview en verde, con navegación y recarga funcionando.
