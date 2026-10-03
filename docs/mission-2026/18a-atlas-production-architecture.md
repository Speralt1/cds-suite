# Platform Core V1 + Calendario en producción: arquitectura (Atlas)

**Estado:** decisión lista para Builder. Lo visual pasa por Designer. Las preguntas abiertas (§M) van a Salvador, cada una con mi decisión por defecto.
**Rama:** `mission/platform-core-calendar-v1`, desde `origin/mission/slice6-usability` @ `e6b2084`. Las ramas PR #3 y PR #4 son solo de referencia: se consultan con `git show`, no se fusionan.
**Convenciones:** FACT = verificado en el código. DEC = decisión. RISK = riesgo. Todo lo escrito aquí es código de producción; nada se despliega en esta misión.

---

## 0. Decisiones en una tabla

| Tema | Decisión |
|---|---|
| Lógica pura compartida (cliente + Functions) | **Fuente única en TypeScript `lib/shared/*.ts`** (pura, solo imports relativos). Se compila a CommonJS en **`functions/shared/*.js`**, que se commitea, con `scripts/build-shared.mjs` (usa `typescript.transpileModule`). Un test de frescura falla si el JS generado no coincide con el TS. El `predeploy` de Functions corre `--check`. |
| Modelo de acceso | Se agrega `users/{uid}` v1 con `accessSchemaVersion: 1`. **`role` se conserva siempre** y se deriva de forma coherente: `baseRole=='admin'` ⟺ `role=='admin'`. Las reglas y el cliente leen v1 si existe y, si no, hacen *fallback* al rol. La tabla `legacyPermissions(role)` es **idéntica** al mapeo de la migración. |
| Equivalencia financiera | `details()` (lecturas) pasa a `financeDetailsRead()` y `details()` (escrituras) a `financeRecordsManage()`. `pastoral()` pasa a `financePastoralManage()`, `approved()` a `financeSummaryRead()` y `admin()` a `settingsManage()`. Para los 4 roles legacy el resultado es bit a bit igual. |
| Fechas de eventos | **Hora de pared de America/Santiago**: `startDate`/`endDate` (`YYYY-MM-DD`), `startTime`/`endTime` (`HH:mm`\|null) y `allDay`. **No se usan Timestamps para los horarios del evento.** Para consultar por rango se agrega `lastDate`. Es una desviación deliberada del nombre `startAt/endAt` (ver §C.3 y la pregunta Q1). |
| Auditoría | Subcolección `calendarEvents/{id}/changes/r{revision}`, atómica con el evento: `revision` + `lastChangeId` + `getAfter`/`existsAfter` en ambas direcciones (el patrón de `summaryLinked`). Las reglas exigen además que `changedFields` sea exactamente lo que cambió en el evento. |
| Publicar vs gestionar | Gestionar = `manage_all`, o `manage_assigned` ∧ el área responsable ∈ `areaIds` ∧ el área está activa. Publicar (interno→público, o editar campos públicos de un evento público) **además** exige `publish_assigned` para esa área o `manage_all`. Se valida en la UI y en las reglas. |
| Calendario público | `calendarShareLinks` sin ningún acceso desde el cliente (`read, write: if false`). La HTTP Function `calendarPublicFeed` hace SHA-256 del token, lee con Admin SDK y aplica `buildPublicCalendar()`/`toPublicEvent()` compartidos (lista blanca). Responde **404 idéntico** para token inexistente, desactivado o mal formado. Cache `private, max-age=60` y sin CDN, así revocar tiene efecto inmediato. |
| Gestión del enlace | Callable `calendarShareLinkManage` (`status`/`create`/`regenerate`/`activate`/`deactivate`). Solo `manage_all`. El token en claro se devuelve **una sola vez** y nunca se persiste. |
| Página pública | `app/calendario-publico/page.tsx`, estática y sin shell. Rewrite de Hosting `/calendario/compartir/**` → `/calendario-publico.html`. El token se lee de `location`; en dev se usa `?t=`. La página de administración `/calendario/compartir` es un archivo estático exacto, que **gana al rewrite** (FACT superstatic: redirects → files → rewrites). |
| Entrada `/` y `/login` | Se **conserva** `router.replace("/finanzas")`, porque los tests existentes lo fijan, y se agrega una **intención de aterrizaje en memoria** (`markLandingIntent()`). `RouteGuard` la consume una sola vez y redirige al módulo inicial resuelto. No hay loops ni storage. |
| Shell | `components/layout/app-shell.tsx` evoluciona en el mismo lugar y con el mismo export. Registro de módulos `finance | calendar | reports | settings`. **Integrantes no existe** en el registro. |
| Migración | `scripts/migrate-access-v1.mjs`: dry-run por defecto, con interlocks de seguridad. Usa el planner puro compartido. Es idempotente (salta los v1), nunca inventa áreas y nunca borra `role`. |
| Emuladores | Auth + Firestore + Functions (puerto 5001). El seed `.mjs` usa Admin SDK resuelto desde `functions/node_modules` y se niega a correr si no está en el emulador `demo-*`. |

---

## 1. Evidencia que condiciona el diseño (FACT)

1. **`firestore.rules` (708 líneas)**:
   - `role()` lee `users/{uid}.role`. `details()` = admin/pastor/finance y se usa tanto para leer como para escribir finanzas. `pastoral()` = admin/pastor. `approved()` = los 4 roles (solo `financeMonthlySummaries` read). `admin()` cubre `users` y `appSettings`.
   - `validUser` usa `hasOnly(['displayName','email','role','active','createdAt'])`.
   - Hay auto-protección (`uid != auth.uid || (role=='admin' && active)`).
   - Ya existen `auditCreate`/`auditUpdate`.
   - Hay un catch-all `/{document=**}` deny.
2. **Tests que fijan contratos y que no se pueden modificar:**
   - `tests/auth.test.tsx` exige que `Home` y `LoginPage` llamen `replace("/finanzas")` con sesión activa. Renderiza `AppShell` **sin** `AccessProvider` y exige un botón "Cerrar sesión" y un único `role="alert"`.
   - `tests/finance.test.tsx`:
     - `/dashboard` → `replace("/finanzas")`;
     - `FinanceNav` muestra 6 links para admin/pastor/finance y 1 para leader;
     - `DetailGuard` no monta contenido para leader;
     - `canSeeDetails`, `canSeePastoral` e `isAuthorized` conservan sus firmas.
   - `tests/settings.test.tsx`:
     - mockea `useAccess` como `{ role, active }`, **sin** campos v1;
     - `validateManagedUserUpdate` devuelve exactamente `{displayName, role, active}`.
   - `tests/access.test.tsx` emite perfiles `{role, active}`.
   - `tests/rules/finance.test.ts` siembra users legacy con id = rol y prueba que el admin edita al usuario finance con `{displayName, role, active}`.
   - **Consecuencia:** los guards deben calcular permisos con una función pura sobre el objeto de `useAccess()`, con fallback legacy. **No** puede haber un hook nuevo en `access-provider`, porque los mocks no lo tienen.
3. **`functions/`**:
   - CommonJS, `firebase-functions` 7.3.2 (API v2), `firebase-admin` 14.3.0, Node 22, `REGION = "southamerica-west1"`. No tiene paso de build.
   - Los tests de Functions usan vitest con `createRequire` sobre los CJS (`tests/functions/sumup-*.test.ts`, `// @vitest-environment node`).
   - `requireFinanceUser` valida `role in [admin,pastor,finance]`.
4. **`firebase.json`**:
   - el bloque de emuladores no incluye functions;
   - Hosting usa `cleanUrls: true` y `trailingSlash: false`;
   - el precedente es el rewrite `/campanas/**` → `/campanas.html`, más rewrites hacia Functions por `functionId` + `region`.
   - El export genera `out/<ruta>.html` **y** un directorio `out/<ruta>/` con los `__next.*.txt` (verificado en `out/finanzas/`).
5. **Next 16.3.3 con `output: "export"`:**
   - no admite rewrites, redirects ni headers de Next, ni rutas dinámicas sin `generateStaticParams` (`node_modules/next/dist/docs/01-app/02-guides/static-exports.md`);
   - el router inicial toma la URL canónica desde `window.location` (`create-initial-router-state.js`), así que una página servida por rewrite conserva su URL real, como ya pasa con `/campanas/<slug>`.
6. **Superstatic** (lo que usa el emulador de Hosting): el orden de middleware es `redirects → files → rewrites` (`node_modules/superstatic/lib/middleware/index.js`). Un archivo estático exacto siempre gana.
7. **El root layout monta `AuthProvider`**, así que la página pública carga Firebase Auth. Se hereda del precedente `/campanas`; no hace lecturas de Firestore.
8. **Usuarios:** `createManagedUser` crea la cuenta en una app secundaria, hace `setDoc` con el admin y envía el reset por correo. `resendPasswordSetup` y la desactivación vía `updateManagedUser({active:false})` funcionan y **se conservan**.
9. **PR #4** (`lib/suite-preview/*`) es puro y fue revisado. Fechas y horas son locales (`Ymd`/`HHmm`) con epoch-days. `toPublicEvent` arma la proyección con literales. `report-pdf.ts` trae la banda "Vista previa" y un nombre de archivo `DEMO`.

---

## A. Arquitectura y layout de módulos

### A.1 Código compartido (DEC y justificación)

**Problema.** `toPublicEvent()`, la recurrencia y `effectivePermissions()` deben correr igual en el cliente (Next/webpack y vitest jsdom) y en Functions (CJS, sin build), y además en los scripts `.mjs`.

| Opción | Veredicto |
|---|---|
| CJS escrito a mano en `functions/shared` y consumido por el cliente | ❌ Vitest (vite module runner) no transforma CJS fuera de `node_modules`: los tests de componentes que lo importen fallan. |
| ESM `.mjs` + `.d.mts` a mano, Functions con `await import()` | ⚠️ Funciona, pero los tipos a mano se desvían del JS (`allowJs: false`): sin typecheck real. |
| **TS fuente → CJS generado y commiteado + test de frescura** | ✅ Una sola fuente, typecheckeada. El cliente importa TS. Functions hace `require` de JS ya compilado del mismo TS. Un test garantiza la paridad. No hace falta ningún paso de build en el deploy. |

**Implementación:**
- `lib/shared/` contiene solo TS puro:
  - sin React, sin Firebase, sin `window`/`document`;
  - sin `Date.now()`/`new Date()` fuera de `dates.ts`, porque el reloj se inyecta;
  - **solo imports relativos `./x`** (sin `@/`).
- `scripts/build-shared.mjs` funciona así:
  ```js
  // node scripts/build-shared.mjs            → escribe functions/shared/*.js
  // node scripts/build-shared.mjs --check    → exit 1 si algún archivo difiere (no escribe)
  import ts from "typescript";
  const FILES = ["types","access","dates","recurrence","calendar-core","public-calendar","share-token-format"];
  const HEADER = (f) => `// GENERADO por scripts/build-shared.mjs desde lib/shared/${f}.ts — NO EDITAR.\n`;
  // transpileModule(src, { compilerOptions: { module: CommonJS, target: ES2022, esModuleInterop: false,
  //   importsNotUsedAsValues: remove, removeComments: false }, fileName })
  ```
- `package.json` agrega `"build:shared": "node scripts/build-shared.mjs"`.
- `firebase.json` agrega `"functions": { …, "predeploy": ["node scripts/build-shared.mjs --check"] }`.
- **Tests obligatorios:**
  - `tests/functions/shared-build.test.ts`: frescura (recompila en memoria y compara byte a byte);
  - `tests/functions/shared-parity.test.ts`: ejecuta los mismos vectores sobre el TS importado y sobre el CJS con `require`, y compara con `toEqual`;
  - `tests/platform/shared-purity.test.ts`: escaneo estático de `lib/shared/*.ts`, sin `@/`, `firebase`, `react`, `window`, `document`, `Date.now`/`new Date(` fuera de `dates.ts`.

### A.2 Árbol objetivo

```
lib/shared/                      (puro, compartido; compila a functions/shared/)
  types.ts                       Ymd/HHmm/LocalDateTime, PERMISSIONS, Permission, BaseRole, LegacyRole,
                                 HomeModule, ModuleId, AreaColor, AREA_COLORS, CalendarEvent*, PublicEvent*
  access.ts                      IMPLIES, closure, LEGACY_ROLE_ACCESS, normalizeAccess, effectivePermissions,
                                 can, deriveLegacyRole, visibleModules, resolveHome, planAccessMigration
  dates.ts                       port PR#4 dates.ts + localNow(date, tz) / localToday(date, tz)
  recurrence.ts                  port PR#4 recurrence.ts (estados en inglés, excepciones sin `at`)
  calendar-core.ts               occurrencesInRange, compareDayOrder, sortOccurrences, lastDateOf, eventSpan
  public-calendar.ts             PUBLIC_*_KEYS, toPublicArea, toPublicEvent, publicRecurrenceLabel,
                                 publicRange, buildPublicCalendar, sortPublicEvents, fnv1a64
  share-token-format.ts          SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/, isWellFormedShareToken
lib/access/                      (cliente)
  model.ts                       accessModel(user) → { perms:Set, areaIds, modules, home, fingerprint }
  modules.ts                     registro de módulos (label, href, iconName, requisitos)
  routes.ts                      ROUTE_RULES, moduleOfPath, guardRoute(user, pathname, intent)
  landing-intent.ts              markLandingIntent / peekLandingIntent / consumeLandingIntent
  labels.ts                      PERMISSION_LABEL/DESCRIPTION/GROUPS, POSITION_PRESETS (UI)
lib/calendar/                    (cliente)
  areas.ts                       AREA_PALETTE, slugify, validateArea, freeColors, eventColor, selectableAreas
  calendar.ts                    canManageEvent, canManageSeries, canArchiveEvent, canPublishEvent,
                                 creatableAreas, myActivities, filterByAreas, monthGrid, weekRange,
                                 agendaGroups, validateEvent, validateSeriesPatch, isSeriesStarted
  audit.ts                       buildChange(before, after, op, actorUid) → ChangeDoc (espejo de expectedAction)
  events-client.ts               useCalendarEvents(from), createEvent, updateEvent, cancelEvent,
                                 cancelOccurrence, cancelSeriesFrom, archiveEvent (writeBatch evento + change)
  areas-client.ts                useAreas, createArea, updateArea, setAreaActive
  share-client.ts                callShareLink(action) + SHARE_ERROR_MESSAGES + publicCalendarUrl(token)
  public-feed-client.ts          calendarFeedUrl(), fetchPublicCalendar(token)
  report.ts, report-pdf.ts       port PR#4 sin "Vista previa"/DEMO
  use-now.ts                     hook "ahora" en Santiago (tick por minuto)
components/layout/               app-shell.tsx (evoluciona), route-guard.tsx, notice.tsx, no-modules.tsx
components/calendar/             UI portada de PR#4 (ver §K) + calendar.css (scoped .cds-calendar)
components/public-calendar/      presentacional puro + public-calendar.css
components/reports/              reports-hub.tsx, calendar-report.tsx
components/settings/             users-permissions-panel.tsx (evoluciona), areas-panel.tsx, settings-nav.tsx
functions/
  shared/*.js                    GENERADO
  calendar/share-token.js        generateShareToken, hashShareToken (node:crypto)
  calendar/public-feed.js        createPublicFeedHandler({ store, clock, isEmulator })
  calendar/share-links.js        createShareLinkService({ store, clock, randomBytes })
  calendar/firestore-store.js    adaptador Admin SDK
  index.js                       + exports calendarPublicFeed, calendarShareLinkManage
scripts/
  build-shared.mjs, migrate-access-v1.mjs, seed-platform-calendar-emulator.mjs
```

---

## B. Modelo de acceso

### B.1 Tipos (`lib/shared/types.ts`)

```ts
export const PERMISSIONS = [
  "finance.summary.read","finance.details.read","finance.records.manage","finance.pastoral.manage",
  "calendar.read","calendar.events.manage_assigned","calendar.events.manage_all",
  "calendar.events.publish_assigned","settings.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export type BaseRole = "admin" | "standard";
export type LegacyRole = "admin" | "pastor" | "finance" | "leader";
export type HomeModule = "finance" | "calendar";
export type ModuleId = "finance" | "calendar" | "reports" | "settings";
export const STORABLE_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter(p => p !== "settings.manage");

/** Datos crudos de Firestore (tolerante: nada se confía). */
export interface UserAccessDoc { role?: unknown; active?: unknown; accessSchemaVersion?: unknown;
  baseRole?: unknown; permissions?: unknown; areaIds?: unknown; homeModule?: unknown; position?: unknown; }
export interface AccessProfile { schema: "legacy" | "v1"; active: boolean; baseRole: BaseRole;
  permissions: Permission[]; areaIds: string[]; homeModule: HomeModule | null;
  position: string; legacyRole: LegacyRole | null; }
```

`lib/finance/types.ts → AccessUser` agrega campos **opcionales**: `baseRole?`, `position?`, `permissions?`, `areaIds?`, `homeModule?`, `accessSchemaVersion?: 1`, `updatedAt?`, `updatedBy?`. `Role` no cambia.

### B.2 Cierre, fallback y `effectivePermissions` (`lib/shared/access.ts`)

```ts
export const IMPLIES: Readonly<Partial<Record<Permission, readonly Permission[]>>> = {
  "finance.details.read": ["finance.summary.read"],
  "finance.records.manage": ["finance.details.read"],
  "finance.pastoral.manage": ["finance.details.read"],
  "calendar.events.manage_all": ["calendar.events.manage_assigned"],
  "calendar.events.manage_assigned": ["calendar.read"],
  "calendar.events.publish_assigned": ["calendar.read"],
};
export const LEGACY_ROLE_ACCESS: Record<LegacyRole, {
  baseRole: BaseRole; position: string; permissions: Permission[]; homeModule: HomeModule }> = {
  admin:   { baseRole: "admin",    position: "Administración", permissions: [], homeModule: "finance" },
  pastor:  { baseRole: "standard", position: "Pastor", homeModule: "finance",
             permissions: ["finance.summary.read","finance.details.read","finance.records.manage",
                           "finance.pastoral.manage","calendar.read","calendar.events.manage_all"] },
  finance: { baseRole: "standard", position: "Finanzas", homeModule: "finance",
             permissions: ["finance.summary.read","finance.details.read","finance.records.manage","calendar.read"] },
  leader:  { baseRole: "standard", position: "Líder", homeModule: "calendar",
             permissions: ["finance.summary.read","calendar.read","calendar.events.manage_assigned"] },
};
export function closure(perms: Iterable<Permission>): Set<Permission>;
export function normalizeAccess(doc: UserAccessDoc | null | undefined): AccessProfile | null;
//  v1 (accessSchemaVersion===1): baseRole del doc, permissions ∩ STORABLE, areaIds strings ≤20, homeModule válido o null
//  legacy: role válido → LEGACY_ROLE_ACCESS[role] con areaIds [] ; role inválido → perfil sin permisos
export function effectivePermissions(doc): ReadonlySet<Permission>;
//  null o !active → ∅ ; baseRole admin → catálogo completo ; si no → closure(permissions) \ {settings.manage}
export const can = (doc: UserAccessDoc | null | undefined, p: Permission) => effectivePermissions(doc).has(p);
export function deriveLegacyRole(baseRole: BaseRole, perms: readonly Permission[]): LegacyRole;
//  admin si baseRole admin ; "pastor" si eff ⊇ {records.manage, pastoral.manage} ; "finance" si records.manage ; si no "leader"
```

**Invariante probado (test de propiedad):** para todo conjunto de permisos, `capacidades(deriveLegacyRole(p)) ⊆ eff(p) ∪ {finance.summary.read}`. El rol derivado nunca otorga más que lo actual, con una sola excepción documentada: un usuario sin ningún permiso financiero queda con `role:"leader"`, que en un rollback a reglas legacy le daría ver el resumen (§L).

### B.3 Equivalencia exacta con el comportamiento financiero actual

| Hoy (regla y cliente) | Nuevo | admin | pastor | finance | leader |
|---|---|---|---|---|---|
| `details()` en read/get/list | `financeDetailsRead()` = `can('finance.details.read')` | ✓ | ✓ | ✓ | ✗ |
| `details()` en create/update | `financeRecordsManage()` = `can('finance.records.manage')` | ✓ | ✓ | ✓ | ✗ |
| `pastoral()` | `financePastoralManage()` | ✓ | ✓ | ✗ | ✗ |
| `approved()` | `financeSummaryRead()` | ✓ | ✓ | ✓ | ✓ |
| `admin()` | `settingsManage()` (baseRole admin / role admin) | ✓ | ✗ | ✗ | ✗ |
| `canSeeDetails(role)` (cliente) | `can(access,'finance.details.read')` | ✓ | ✓ | ✓ | ✗ |
| `canSeePastoral(role)` | `can(access,'finance.pastoral.manage')` | ✓ | ✓ | ✗ | ✗ |
| `requireFinanceUser` (Function SumUp) | `can(userDoc,'finance.records.manage')` | ✓ | ✓ | ✓ | ✗ |
| `SettingsGuard` / nav "Configuración" | `can(access,'settings.manage')` | ✓ | ✗ | ✗ | ✗ |

- `canSeeDetails`, `canSeePastoral`, `isAuthorized` y `ROLES` **se conservan** con la misma firma, marcados `@deprecated`. Internamente delegan en `can({role, active:true}, …)`.
- Los call sites de producción (`shared.tsx`, `summary-page.tsx`, `offerings-page.tsx`, `campaigns-page.tsx`, `profile-page.tsx`, `app-shell.tsx`, `settings-guard.tsx`) pasan a `can(access, …)`.
- **Qué ve el Líder en Finanzas:** igual que hoy. `summary-page.tsx` con `details=false` muestra solo las cifras agregadas; `FinanceNav` muestra 1 link ("Resumen"); `DetailGuard` muestra el `Empty` actual en las subrutas. **No** se cambia a redirect.

### B.4 `isAuthorized` y `AccessProvider`

- `isAuthorized` **no cambia de semántica** (activo + `role` ∈ ROLES). Los docs v1 siempre llevan `role`, porque las reglas lo exigen.
- "Autorizado pero sin módulos" lo resuelve `RouteGuard` con la pantalla "Tu cuenta aún no tiene módulos asignados".
- `AccessProvider` solo cambia la `key`: `${uid}:${accessModel(profile).fingerprint}`. El fingerprint = `active | permisos efectivos ordenados | areaIds ordenados | homeModule`. Así, cualquier cambio de permisos desmonta los datos (sustituye a `:${role}`).

### B.5 Módulos y módulo inicial

```ts
// lib/shared/access.ts
export const MODULE_ORDER: readonly ModuleId[] = ["finance","calendar","reports","settings"];
export const MODULE_HREF: Record<ModuleId,string> = { finance:"/finanzas", calendar:"/calendario",
  reports:"/reportes", settings:"/configuracion" };
export function visibleModules(doc): ModuleId[];
//  finance: summary.read · calendar: calendar.read · reports: details.read || calendar.read · settings: settings.manage
export type Landing = { kind: "inactive" } | { kind: "no-modules" }
  | { kind: "module"; module: ModuleId; href: string; source: "configured"|"default"|"first";
      invalidConfigured?: HomeModule };
export function defaultHomeModule(p: AccessProfile): HomeModule;
//  legacy: LEGACY_ROLE_ACCESS[role].homeModule ; v1: details.read → finance ; calendar.read → calendar ; si no finance
export function resolveHome(doc): Landing;
//  1) homeModule configurado si es visible → 2) defaultHomeModule si es visible → 3) primero de visibleModules
//  → 4) no-modules ("Tu cuenta aún no tiene módulos asignados")
```

---

## C. Modelo Firestore

### C.1 `users/{uid}`: forma v1, con la legacy aún válida

```ts
{ displayName: string(1..120), email: string(3..160), role: LegacyRole /* derivado y coherente */,
  active: boolean, createdAt: Timestamp,
  baseRole: "admin"|"standard", position: string(0..60),
  permissions: Permission[] /* ⊆ STORABLE, sin duplicados, ≤8 */, areaIds: string[] /* ≤20 */,
  homeModule: "finance"|"calendar", accessSchemaVersion: 1,
  updatedAt: Timestamp /* == request.time */, updatedBy: uid /* == auth.uid */ }
```

- **Auto-protección:**
  - un admin no puede quitarse admin ni desactivarse (regla);
  - **≥1 admin activo sin contar:** quitar admin a X solo lo puede hacer otro admin activo Y, y Y no puede degradarse a sí mismo. Por inducción, el actor siempre queda como admin. La única vía de dejar el sistema sin admin es la consola o Admin SDK, fuera del alcance (se documenta).
  - El cliente además valida "debe quedar ≥1 admin activo" sobre la lista cargada.
- **Edición desde la UI nueva:** toda edición **promueve a v1** con el mapeo exacto (§B.2). La UI nueva siempre escribe el payload v1 completo con `updatedAt: serverTimestamp()`, incluso para desactivar.

### C.2 `areas/{areaId}`

```ts
{ name: string(1..40), slug: string /* == areaId, ^[a-z0-9]+(-[a-z0-9]+)*$, ≤40, inmutable */,
  color: AreaColor /* paleta cerrada PR#4: azul,indigo,naranjo,ambar,frambuesa,cafe,teal,pizarra,verde,carmin */,
  description: string(0..200), active: boolean, createdAt, createdBy, updatedAt, updatedBy }
```

- Id = slug generado al crear, con sufijo `-2`, `-3`… si ya existe.
- Renombrar no cambia el slug, para que el público siga estable.
- La unicidad de nombre y de color entre áreas activas la valida el cliente (`validateArea`); las reglas no pueden consultar.

### C.3 `calendarEvents/{eventId}`: decisión de representación

**DEC: hora de pared local, sin instantes.** Un Timestamp ancla un instante. "Todos los domingos 11:00" expandido sumando 7 días UTC se corre 1 h al cruzar el cambio de horario de Chile (primer sábado de abril y primer sábado de septiembre). El motor de PR #4 (epoch-days sobre `Ymd`) es correcto por construcción y ya está revisado. Las reglas validan strings con regex y comparan lexicográficamente. Los rangos se consultan con `lastDate`.

```ts
{ title: string(1..120), responsibleAreaId: string, participantAreaIds: string[] /* ≤8, únicos, ∌ responsable */,
  startDate: Ymd, endDate: Ymd /* ≥ startDate, ≤ startDate+31d */, allDay: boolean,
  startTime: HHmm|null, endTime: HHmm|null /* allDay ⇒ ambos null ; si no, startTime requerido */,
  location: string(0..120), publicDescription: string(0..1000), internalNotes: string(0..1000),
  visibility: "internal"|"public", status: "scheduled"|"cancelled"|"archived",
  recurrence: { freq: "none"|"weekly"|"biweekly"|"monthly", until?: Ymd /* req. si freq≠none, ≤ +1 año */,
                monthly?: { mode: "nth_weekday", weekday: 0..6, ordinal: 1|2|3|4|-1 } },
  exceptions: { date: Ymd, type: "cancelled", reason: string(3..300), by: uid }[] /* ≤60; sin `at`: serverTimestamp no se admite dentro de arrays; el cuándo vive en el change */,
  seriesCancellation?: { from: Ymd, reason: string(3..300), by: uid, at: Timestamp },
  lastDate: Ymd /* none: == endDate ; recurrente: until o until+1 (span ≤1) */,
  cancelReason?: string(3..300) /* status cancelled|archived */, archivedAt?: Timestamp, archiveReason?: string(3..300),
  revision: int, lastChangeId: "r"+revision, createdBy, createdAt, updatedBy, updatedAt }
```

**Reglas del modelo:**
- "Realizada" es derivada (fin de la ocurrencia < ahora en Santiago); nunca se guarda.
- `status:"cancelled"` solo existe en eventos **no recurrentes**. Una serie se cancela con `exceptions` (una fecha) o `seriesCancellation` (desde una fecha); así el historial pasado queda "Realizada" y es honesto.
- No hay borrado físico: "Eliminar" en la UI = archivar con motivo.
- Una serie recurrente tiene `span ≤ 1` día (vigilia); los eventos de varios días no se repiten.

### C.4 `calendarEvents/{eventId}/changes/{changeId}`

```ts
// changeId = "r" + revision (determinista: un change por revisión, imposible duplicar)
{ revision: int, action: "created"|"updated"|"cancelled"|"archived"|"recurrence_updated"|"visibility_changed",
  scope?: "event"|"occurrence"|"series", occurrenceDate?: Ymd, actorUid: uid, at: Timestamp,
  changedFields: string[], before: map|null, after: map|null, reason: string|null }
```

- **Sin duplicación sensible:**
  - `created` lleva `before=after=null` y `changedFields=[]` (el estado inicial ya está en el evento);
  - `internalNotes` aparece solo en `changedFields`, nunca su valor;
  - en las excepciones solo va `occurrenceDate` + `reason`.
- La lectura se limita a `manage_all` o a quien gestiona el área responsable.

### C.5 `calendarShareLinks/{shareId}`

V1 = singleton `public`:

```ts
{ tokenHash: string /* sha256 hex del token, 64 chars */, active: boolean, createdAt: Timestamp, createdBy: uid,
  regeneratedAt?: Timestamp, disabledAt?: Timestamp, rotation: int, updatedAt: Timestamp, updatedBy: uid }
```

Solo lo tocan Admin SDK y Functions.

### C.6 Índices (`firestore.indexes.json`, se agregan)

```json
{ "collectionGroup": "calendarEvents", "queryScope": "COLLECTION",
  "fields": [ { "fieldPath": "visibility", "order": "ASCENDING" }, { "fieldPath": "lastDate", "order": "ASCENDING" } ] }
```

- El cliente consulta `where('lastDate','>=',from)` y filtra `startDate <= to` y `status != archived` en memoria (índice automático de un campo). Con el volumen de una iglesia (cientos de eventos al año) esto basta. La optimización futura es una segunda desigualdad con índice compuesto.
- `calendarShareLinks where tokenHash == h`, `changes orderBy at` y `areas orderBy name` usan índices automáticos.
- El emulador no exige índices: hay que desplegarlos **antes** que las Functions (§L).

---

## D. Firestore Rules

Hay que reemplazar el bloque de helpers de acceso y `match /users`, y agregar los bloques nuevos. El resto de finanzas solo cambia el nombre del helper según §B.3.

### D.1 Helpers centrales

```
function userPath() { return /databases/$(database)/documents/users/$(request.auth.uid); }
function userDoc() { return get(userPath()).data; }
function isActive() { return signedIn() && exists(userPath()) && userDoc().active == true; }
function member() { return isActive(); }                       // alias histórico
function legacyRole() { return userDoc().get('role', ''); }
function isAccessV1() { return userDoc().get('accessSchemaVersion', 0) == 1; }
function isAdminUser() { return isAccessV1() ? userDoc().get('baseRole', '') == 'admin' : legacyRole() == 'admin'; }
function legacyPermissions(r) {
  return r == 'pastor' ? ['finance.summary.read','finance.details.read','finance.records.manage','finance.pastoral.manage','calendar.read','calendar.events.manage_all']
    : r == 'finance' ? ['finance.summary.read','finance.details.read','finance.records.manage','calendar.read']
    : r == 'leader' ? ['finance.summary.read','calendar.read','calendar.events.manage_assigned']
    : [];
}
function permissions() { return isAccessV1() ? userDoc().get('permissions', []) : legacyPermissions(legacyRole()); }
function implicants() {
  return {
    'finance.summary.read': ['finance.summary.read','finance.details.read','finance.records.manage','finance.pastoral.manage'],
    'finance.details.read': ['finance.details.read','finance.records.manage','finance.pastoral.manage'],
    'finance.records.manage': ['finance.records.manage'],
    'finance.pastoral.manage': ['finance.pastoral.manage'],
    'calendar.read': ['calendar.read','calendar.events.manage_assigned','calendar.events.manage_all','calendar.events.publish_assigned'],
    'calendar.events.manage_assigned': ['calendar.events.manage_assigned','calendar.events.manage_all'],
    'calendar.events.manage_all': ['calendar.events.manage_all'],
    'calendar.events.publish_assigned': ['calendar.events.publish_assigned'],
    'settings.manage': []
  };
}
function can(p) { return isActive() && (isAdminUser() || permissions().hasAny(implicants()[p])); }
function userAreaIds() { return isAccessV1() ? userDoc().get('areaIds', []) : []; }
function hasArea(areaId) { return userAreaIds().hasAny([areaId]); }
function areaActive(areaId) { let p = /databases/$(database)/documents/areas/$(areaId); return exists(p) && get(p).data.active == true; }
function calendarRead() { return can('calendar.read'); }
function calendarManageAll() { return can('calendar.events.manage_all'); }
function calendarManageAssigned(areaId) { return calendarManageAll() || (can('calendar.events.manage_assigned') && hasArea(areaId) && areaActive(areaId)); }
function calendarPublish(areaId) { return calendarManageAll() || (can('calendar.events.publish_assigned') && hasArea(areaId)); }
function settingsManage() { return isActive() && isAdminUser(); }
function financeSummaryRead() { return can('finance.summary.read'); }
function financeDetailsRead() { return can('finance.details.read'); }
function financeRecordsManage() { return can('finance.records.manage'); }
function financePastoralManage() { return can('finance.pastoral.manage'); }
function admin() { return settingsManage(); }
// Fechas locales (hora de pared Santiago). localToday() ≤ fecha local real; difiere ≤1 h/día en horario de verano (UTC-3).
function pad2(n) { return n < 10 ? '0' + string(n) : string(n); }
function ymdOf(t) { return string(t.year()) + '-' + pad2(t.month()) + '-' + pad2(t.day()); }
function localToday() { return ymdOf(request.time - duration.value(4, 'h')); }
function isYmd(v) { return v is string && v.matches('^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'); }
function isHHmm(v) { return v is string && v.matches('^([01][0-9]|2[0-3]):[0-5][0-9]$'); }
function dateTs(s) { let p = s.split('-'); return timestamp.date(int(p[0]), int(p[1]), int(p[2])); }
function plusOneYear(s) { let p = s.split('-'); return string(int(p[0]) + 1) + '-' + p[1] + '-' + p[2]; }
```

- Se **elimina** `role()`. `details()`, `pastoral()` y `approved()` se eliminan y cada uso se reemplaza:
  - `appSettings` read → `financeDetailsRead()`;
  - `financeTransactions`, `titheProfiles` y `titheAttributions`: read → `financeDetailsRead()`, create/update → `financeRecordsManage()`;
  - `financeMonthlySummaries` read → `financeSummaryRead()`, write → `financeRecordsManage()`;
  - `pastoralFollowups` → `financePastoralManage()`;
  - `publicGivingSettings` write → `financeRecordsManage()`;
  - `sumupIntegrations/**` y `sumupSyncRuns` get/list → `financeDetailsRead()`;
  - `fundraisingCampaigns`, `campaignContributions` y `campaignSubmissions`: get/list → `financeDetailsRead()`, create/update → `financeRecordsManage()`;
  - `campaignPublicViews` write → `financeRecordsManage()`.
- `admin()` se mantiene como alias en `appSettings`.

### D.2 `users`

```
function permissionCatalogNoSettings() { return ['finance.summary.read','finance.details.read','finance.records.manage','finance.pastoral.manage','calendar.read','calendar.events.manage_assigned','calendar.events.manage_all','calendar.events.publish_assigned']; }
function v1UserKeys() { return ['displayName','email','role','active','createdAt','baseRole','position','permissions','areaIds','homeModule','accessSchemaVersion','updatedAt','updatedBy']; }
function validLegacyUser(d) { /* cuerpo actual de validUser, intacto */ }
function validUserV1(d) {
  return d.keys().hasAll(v1UserKeys()) && d.keys().hasOnly(v1UserKeys())
    && text(d.displayName,1,120) && text(d.email,3,160)
    && d.role in ['admin','pastor','finance','leader'] && d.active is bool && d.createdAt is timestamp
    && d.baseRole in ['admin','standard'] && ((d.baseRole == 'admin') == (d.role == 'admin'))
    && text(d.position,0,60)
    && d.permissions is list && d.permissions.size() <= 8 && d.permissions.hasOnly(permissionCatalogNoSettings())
    && d.permissions.toSet().size() == d.permissions.size()
    && d.areaIds is list && d.areaIds.size() <= 20
    && d.homeModule in ['finance','calendar'] && d.accessSchemaVersion == 1
    && d.updatedAt == request.time && d.updatedBy == request.auth.uid;
}
function validUser(d) { return d.get('accessSchemaVersion', 0) == 1 ? validUserV1(d) : validLegacyUser(d); }
function isAdminDoc(d) { return d.get('accessSchemaVersion', 0) == 1 ? d.baseRole == 'admin' : d.role == 'admin'; }
match /users/{uid} {
  allow get: if signedIn() && (request.auth.uid == uid || settingsManage());
  allow list: if settingsManage();
  allow create: if settingsManage() && validUser(request.resource.data);
  allow update: if settingsManage() && validUser(request.resource.data)
    && request.resource.data.createdAt == resource.data.createdAt
    && request.resource.data.email == resource.data.email
    && request.resource.data.get('accessSchemaVersion', 0) >= resource.data.get('accessSchemaVersion', 0)
    && (uid != request.auth.uid || (isAdminDoc(request.resource.data) && request.resource.data.active == true));
  allow delete: if false;
}
```

**Nota:** un cliente viejo (cacheado) que intente editar un usuario v1 queda denegado, porque falta `updatedAt == request.time`. Falla de forma segura; se documenta "recargar tras el deploy".

### D.3 `areas`

```
function areaKeys() { return ['name','slug','color','description','active','createdAt','createdBy','updatedAt','updatedBy']; }
function validArea(d, areaId) {
  return d.keys().hasAll(areaKeys()) && d.keys().hasOnly(areaKeys())
    && text(d.name,1,40) && d.slug == areaId && d.slug.size() <= 40 && d.slug.matches('^[a-z0-9]+(-[a-z0-9]+)*$')
    && d.color in ['azul','indigo','naranjo','ambar','frambuesa','cafe','teal','pizarra','verde','carmin']
    && text(d.description,0,200) && d.active is bool;
}
match /areas/{areaId} {
  allow get, list: if calendarRead() || settingsManage();          // incluye inactivas (Q2)
  allow create: if settingsManage() && validArea(request.resource.data, areaId) && auditCreate(request.resource.data);
  allow update: if settingsManage() && validArea(request.resource.data, areaId) && auditUpdate(request.resource.data, resource.data);
  allow delete: if false;
}
```

### D.4 `calendarEvents`

```
function eventKeys() { return ['title','responsibleAreaId','participantAreaIds','startDate','endDate','allDay','startTime','endTime','location','publicDescription','internalNotes','visibility','status','recurrence','exceptions','seriesCancellation','lastDate','cancelReason','archivedAt','archiveReason','revision','lastChangeId','createdBy','createdAt','updatedBy','updatedAt']; }
function eventRequired() { return ['title','responsibleAreaId','participantAreaIds','startDate','endDate','allDay','startTime','endTime','location','publicDescription','internalNotes','visibility','status','recurrence','exceptions','lastDate','revision','lastChangeId','createdBy','createdAt','updatedBy','updatedAt']; }
function publicFields() { return ['title','responsibleAreaId','participantAreaIds','startDate','endDate','allDay','startTime','endTime','location','publicDescription','recurrence']; }
function temporalFields() { return ['startDate','endDate','allDay','startTime','endTime']; }
function metaFields() { return ['revision','lastChangeId','updatedBy','updatedAt']; }
function validMonthly(m) { return m is map && m.keys().hasAll(['mode','weekday','ordinal']) && m.keys().hasOnly(['mode','weekday','ordinal'])
  && m.mode == 'nth_weekday' && m.weekday is int && m.weekday >= 0 && m.weekday <= 6 && m.ordinal in [1,2,3,4,-1]; }
function validRecurrence(d) {
  let r = d.recurrence;
  return r is map && r.keys().hasOnly(['freq','until','monthly']) && r.freq in ['none','weekly','biweekly','monthly']
    && (r.freq == 'none' ? r.keys().hasOnly(['freq'])
      : isYmd(r.until) && r.until >= d.startDate && r.until <= plusOneYear(d.startDate)
        && dateTs(d.endDate) <= dateTs(d.startDate) + duration.value(1, 'd')
        && (r.freq == 'monthly' ? validMonthly(r.get('monthly', null)) : !r.keys().hasAny(['monthly'])));
}
function validLastDate(d) { return isYmd(d.lastDate) && (d.recurrence.freq == 'none' ? d.lastDate == d.endDate
  : d.lastDate >= d.recurrence.until && dateTs(d.lastDate) <= dateTs(d.recurrence.until) + duration.value(1, 'd')); }
function validEvent(d) {
  return d.keys().hasAll(eventRequired()) && d.keys().hasOnly(eventKeys())
    && text(d.title,1,120) && text(d.responsibleAreaId,1,40)
    && d.participantAreaIds is list && d.participantAreaIds.size() <= 8
    && d.participantAreaIds.toSet().size() == d.participantAreaIds.size() && !d.participantAreaIds.hasAny([d.responsibleAreaId])
    && isYmd(d.startDate) && isYmd(d.endDate) && d.endDate >= d.startDate
    && dateTs(d.endDate) <= dateTs(d.startDate) + duration.value(31, 'd')
    && d.allDay is bool
    && (d.allDay ? (d.startTime == null && d.endTime == null)
        : (isHHmm(d.startTime) && (d.endTime == null || (isHHmm(d.endTime) && (d.endDate > d.startDate || d.endTime > d.startTime)))))
    && text(d.location,0,120) && text(d.publicDescription,0,1000) && text(d.internalNotes,0,1000)
    && d.visibility in ['internal','public'] && d.status in ['scheduled','cancelled','archived']
    && validRecurrence(d) && validLastDate(d)
    && d.exceptions is list && d.exceptions.size() <= 60 && (d.recurrence.freq != 'none' || d.exceptions.size() == 0)
    && d.revision is int && d.revision >= 1 && d.lastChangeId == 'r' + string(d.revision)
    && (d.status in ['cancelled','archived'] || !d.keys().hasAny(['cancelReason']))
    && (!d.keys().hasAny(['cancelReason']) || text(d.cancelReason,3,300))
    && (d.status == 'archived' ? (d.archivedAt is timestamp && text(d.archiveReason,3,300)) : !d.keys().hasAny(['archivedAt','archiveReason']));
}
function eventPath(id) { return /databases/$(database)/documents/calendarEvents/$(id); }
function changePath(id, c) { return /databases/$(database)/documents/calendarEvents/$(id)/changes/$(c); }
function changeLinked(id, n, action) {
  return !exists(changePath(id, n.lastChangeId)) && existsAfter(changePath(id, n.lastChangeId))
    && getAfter(changePath(id, n.lastChangeId)).data.revision == n.revision
    && getAfter(changePath(id, n.lastChangeId)).data.actorUid == request.auth.uid
    && getAfter(changePath(id, n.lastChangeId)).data.at == request.time
    && getAfter(changePath(id, n.lastChangeId)).data.action == action;
}
function expectedAction(n, o) {
  let k = n.diff(o).affectedKeys();
  return (n.status == 'archived' && o.status != 'archived') ? 'archived'
    : ((n.status == 'cancelled' && o.status != 'cancelled') || k.hasAny(['exceptions','seriesCancellation'])) ? 'cancelled'
    : k.hasAny(['visibility']) ? 'visibility_changed'
    : k.hasAny(['recurrence']) ? 'recurrence_updated' : 'updated';
}
function publishOk(n, o) {
  let k = n.diff(o).affectedKeys();
  let publishing = n.visibility == 'public' && o.visibility != 'public';
  let editsPublic = n.visibility == 'public' && o.visibility == 'public' && n.status == 'scheduled' && k.hasAny(publicFields());
  return !(publishing || editsPublic) || calendarPublish(n.responsibleAreaId);
}
function startedLockOk(n, o) {   // serie/evento iniciado: no cambia día, hora ni frecuencia (aplica a todos)
  return o.startDate >= localToday()
    || (!n.diff(o).affectedKeys().hasAny(temporalFields())
        && n.recurrence.freq == o.recurrence.freq && n.recurrence.get('monthly', null) == o.recurrence.get('monthly', null)
        && (n.recurrence.get('until', '') == o.recurrence.get('until', '') || n.recurrence.until >= localToday()));
}
function appendOneException(n, o) {
  let k = o.exceptions.size();
  let x = n.exceptions[k];
  return n.exceptions.size() == k + 1 && n.exceptions[0:k] == o.exceptions
    && x.keys().hasAll(['date','type','reason','by']) && x.keys().hasOnly(['date','type','reason','by'])
    && isYmd(x.date) && x.type == 'cancelled' && text(x.reason,3,300) && x.by == request.auth.uid
    && x.date >= localToday() && x.date >= n.startDate && x.date <= n.recurrence.until;
}
function validTransition(n, o) {
  let k = n.diff(o).affectedKeys();
  return
    // (a) editar
    (o.status == 'scheduled' && n.status == 'scheduled'
      && k.hasOnly(['title','responsibleAreaId','participantAreaIds','startDate','endDate','allDay','startTime','endTime','location','publicDescription','internalNotes','visibility','recurrence','lastDate'].concat(metaFields()))
      && (!o.keys().hasAny(['seriesCancellation']) || calendarManageAll())
      && startedLockOk(n, o))
    // (b) cancelar evento simple
    || (o.status == 'scheduled' && n.status == 'cancelled' && n.recurrence.freq == 'none'
      && k.hasOnly(['status','cancelReason'].concat(metaFields())))
    // (c) cancelar una ocurrencia
    || (o.status == 'scheduled' && n.status == 'scheduled' && n.recurrence.freq != 'none'
      && k.hasOnly(['exceptions'].concat(metaFields())) && appendOneException(n, o))
    // (d) cancelar la serie desde una fecha
    || (o.status == 'scheduled' && n.status == 'scheduled' && n.recurrence.freq != 'none'
      && !o.keys().hasAny(['seriesCancellation']) && k.hasOnly(['seriesCancellation'].concat(metaFields()))
      && n.seriesCancellation.keys().hasOnly(['from','reason','by','at']) && isYmd(n.seriesCancellation.from)
      && n.seriesCancellation.from >= localToday() && text(n.seriesCancellation.reason,3,300)
      && n.seriesCancellation.by == request.auth.uid && n.seriesCancellation.at == request.time)
    // (e) archivar ("Eliminar")
    || (o.status in ['scheduled','cancelled'] && n.status == 'archived'
      && k.hasOnly(['status','archivedAt','archiveReason'].concat(metaFields()))
      && n.archivedAt == request.time && (calendarManageAll() || o.startDate >= localToday()));
}
match /calendarEvents/{eventId} {
  allow get, list: if calendarRead();
  allow create: if calendarManageAssigned(request.resource.data.responsibleAreaId)
    && validEvent(request.resource.data) && auditCreate(request.resource.data)
    && request.resource.data.status == 'scheduled' && request.resource.data.revision == 1
    && request.resource.data.exceptions.size() == 0
    && !request.resource.data.keys().hasAny(['seriesCancellation','cancelReason','archivedAt','archiveReason'])
    && (calendarManageAll() || request.resource.data.startDate >= localToday())
    && (request.resource.data.visibility == 'internal' || calendarPublish(request.resource.data.responsibleAreaId))
    && changeLinked(eventId, request.resource.data, 'created');
  allow update: if validEvent(request.resource.data) && auditUpdate(request.resource.data, resource.data)
    && request.resource.data.revision == resource.data.revision + 1
    && resource.data.status != 'archived'
    && calendarManageAssigned(resource.data.responsibleAreaId)            // participante ≠ editar
    && calendarManageAssigned(request.resource.data.responsibleAreaId)    // no mover a un área ajena
    && (calendarManageAll() || resource.data.lastDate >= localToday())    // pasado = solo lectura
    && publishOk(request.resource.data, resource.data)
    && validTransition(request.resource.data, resource.data)
    && changeLinked(eventId, request.resource.data, expectedAction(request.resource.data, resource.data));
  allow delete: if false;

  match /changes/{changeId} {
    allow get, list: if calendarManageAll() || calendarManageAssigned(get(eventPath(eventId)).data.responsibleAreaId);
    allow create: if validChange(request.resource.data)
      && changeId == 'r' + string(request.resource.data.revision)
      && request.resource.data.actorUid == request.auth.uid && request.resource.data.at == request.time
      && getAfter(eventPath(eventId)).data.lastChangeId == changeId
      && getAfter(eventPath(eventId)).data.revision == request.resource.data.revision
      && getAfter(eventPath(eventId)).data.updatedAt == request.time
      && changedFieldsMatch(eventId, request.resource.data);
    allow update, delete: if false;
  }
}
function validChange(d) {
  return d.keys().hasAll(['revision','action','actorUid','at','changedFields','before','after','reason'])
    && d.keys().hasOnly(['revision','action','scope','occurrenceDate','actorUid','at','changedFields','before','after','reason'])
    && d.revision is int && d.action in ['created','updated','cancelled','archived','recurrence_updated','visibility_changed']
    && d.changedFields is list && d.changedFields.size() <= 30
    && (d.before == null || (d.before is map && d.before.keys().hasOnly(d.changedFields)))
    && (d.after == null || (d.after is map && d.after.keys().hasOnly(d.changedFields)))
    && (d.reason == null || text(d.reason,3,300))
    && (!d.keys().hasAny(['scope']) || d.scope in ['event','occurrence','series'])
    && (!d.keys().hasAny(['occurrenceDate']) || isYmd(d.occurrenceDate));
}
function changedFieldsMatch(id, d) {
  return !exists(eventPath(id))
    ? (d.action == 'created' && d.changedFields.size() == 0 && d.before == null && d.after == null)
    : d.changedFields.toSet() == getAfter(eventPath(id)).data.diff(get(eventPath(id)).data).affectedKeys()
        .difference(['revision','lastChangeId','updatedBy','updatedAt','lastDate'].toSet());
}
match /calendarShareLinks/{shareId} { allow read, write: if false; }
```

**Por qué sostiene la atomicidad:**
- el evento exige que exista `changes/r{rev}` *después* del batch, y no antes;
- el change exige que el evento *después* del batch tenga `lastChangeId == changeId` y `updatedAt == request.time`;
- por lo tanto ninguno puede escribirse sin el otro, nadie puede escribir un change en nombre de otro actor, y no se puede editar ni borrar el historial.

**Presupuesto de `get`:** `users` (cacheado), 1–2 `areas`, `getAfter` del evento y `exists`/`getAfter` del change: alrededor de 6 dentro de un batch, bajo el límite de 20.

**`localToday()`** es indulgente: como mucho 1 h al día en verano. La regla exacta de "pasado" la aplica la UI con `Intl` en Santiago.

---

## E. Functions

### E.1 `calendarPublicFeed` (HTTP GET)

```js
// functions/index.js
const { createPublicFeedHandler } = require("./calendar/public-feed");
exports.calendarPublicFeed = onRequest(
  { region: REGION, timeoutSeconds: 15, memory: "256MiB", maxInstances: 5 },
  createPublicFeedHandler({ store: calendarStore, clock, isEmulator: process.env.FUNCTIONS_EMULATOR === "true" }),
);
```

**Contrato:**
- **Método:** `GET` y `OPTIONS` (este último solo con CORS de dev). Cualquier otro método responde `405 {ok:false,error:"method_not_allowed"}`.
- **Entrada:** query `?t=<token>`. Se valida con `SHARE_TOKEN_RE` (compartido): 43 caracteres base64url, equivalentes a 32 bytes.
- **Flujo:**
  1. token mal formado → respuesta `UNAVAILABLE`;
  2. `h = sha256hex(t)`;
  3. `store.findShareLinkByHash(h)` (`where('tokenHash','==',h).limit(1)`); si no existe o `active !== true` → `UNAVAILABLE`;
  4. `today/now = localNow(clock.now(), "America/Santiago")`;
  5. `range = publicRange(today)`: desde el primer día del mes anterior hasta el último día de hoy + 6 meses;
  6. `events = store.listPublicEventsFrom(range.from)` (`visibility=='public'`, `lastDate>=from`), y en código se excluye `status=='archived'` y `startDate > range.to`;
  7. `areas = store.listAreas()`;
  8. `calendar = buildPublicCalendar({ events, areas, today, now })`, compartido, que expande la recurrencia en el servidor y aplica `toPublicEvent` por lista blanca.
- **Respuesta 200:** `{ ok: true, calendar: { churchName, timeZone: "America/Santiago", range, areas: PublicArea[], events: PublicEvent[] } }`.
  - `PublicEvent` = `{ id: "pe_"+fnv1a64(eventId@date), title, startDate, endDate, allDay, startTime|null, endTime|null, location|null, publicDescription|null, responsibleArea:{slug,name,color}, participantAreas:[…], status:"scheduled"|"cancelled", recurrenceLabel|null }`.
  - **Nunca** incluye `internalNotes`, `cancelReason`, `archiveReason`, motivos de excepciones o series, `createdBy`/`updatedBy`/uids, correos, permisos ni finanzas.
- **`UNAVAILABLE`:** status 404, cuerpo `{"ok":false,"error":"unavailable"}` y headers **idénticos** para inexistente, desactivado y mal formado. Lo verifica un test con deep equal de status, headers y body.
- **Headers:**
  - 200: `Cache-Control: private, max-age=60` (**sin** `s-maxage`: la CDN de Hosting no cachea y regenerar o desactivar tiene efecto inmediato);
  - 404/5xx: `Cache-Control: no-store`;
  - siempre: `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex, nofollow` y `Content-Type: application/json; charset=utf-8`.
- **CORS:** solo si `isEmulator` y `Origin ∈ {http://localhost:3000, http://127.0.0.1:3000}` (más `Vary: Origin`). En producción es mismo origen por el rewrite, así que no se emite ningún header CORS.
- **Enumeración y costo:** 256 bits hacen inviable la fuerza bruta. `maxInstances: 5` acota el gasto por abuso. Nunca se loguean token ni hash: solo `console.info("calendarPublicFeed", { ok, count })`.
- **Error interno:** `500 {ok:false,error:"internal"}` con `no-store`, y log del error sin token.

### E.2 `calendarShareLinkManage` (callable)

**DEC: onCall en vez de HTTP + Bearer.** Trae verificación de ID token, CORS y códigos `HttpsError` integrados, y no requiere un rewrite.

```js
exports.calendarShareLinkManage = onCall({ region: REGION, timeoutSeconds: 15, maxInstances: 3 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "share/unauthenticated");
  const action = request.data?.action;               // "status"|"create"|"regenerate"|"activate"|"deactivate"
  return shareLinks.handle(uid, action);             // lanza HttpsError con message = clave traducible
});
```

**`createShareLinkService({ store, clock, randomBytes })`:**
- `authorize(uid)`: lee `users/{uid}`; `can(userDoc,'calendar.events.manage_all')` del shared, con fallback legacy. Inactivo o inexistente → `permission-denied` / `share/forbidden`.
- `status()` devuelve `{ exists, active, createdAt, regeneratedAt, disabledAt }` en ISO. **Nunca** devuelve hash ni token.
- `create(uid)`, en transacción:
  - si `calendarShareLinks/public` existe → `failed-precondition` / `share/already-exists`;
  - si no, `token = randomBytes(32).toString("base64url")` y se guarda `{tokenHash: sha256(token), active:true, createdAt, createdBy, rotation:1, updatedAt, updatedBy}`;
  - devuelve `{ status, token }`.
- `regenerate(uid)`, en transacción:
  - si no existe → `share/not-found`;
  - si no, nuevo token, se **sobrescribe** `tokenHash` (el anterior muere al instante), `active:true`, `regeneratedAt`, `rotation+1` y se borra `disabledAt`;
  - devuelve `{ status, token }`;
  - **no es idempotente por diseño**: cada llamada rota el token.
- `deactivate(uid)` deja `active:false` y `disabledAt`. `activate(uid)` deja `active:true` y borra `disabledAt`; reactiva el **mismo** token. Ambos son idempotentes.
- Códigos: `share/unauthenticated`, `share/forbidden`, `share/invalid-action`, `share/not-found`, `share/already-exists`, `share/internal`. El cliente los mapea a español en `lib/calendar/share-client.ts → SHARE_ERROR_MESSAGES`.

**UX de "Copiar" (DEC):**
- el token en claro existe solo en la respuesta de `create`/`regenerate`;
- la UI lo guarda en el estado del componente, nunca en storage y nunca en logs, y muestra el enlace con "Copiar" y el aviso "Guárdalo ahora. Por seguridad no podremos mostrarlo de nuevo. Si lo pierdes, regenera el enlace (el anterior dejará de funcionar).";
- cuando el estado se pierde, la tarjeta muestra "Enlace activo desde {fecha}", con Regenerar, Desactivar y Activar.
- **Alternativa descartada:** guardar el token cifrado con KMS. Agrega un secreto y una superficie de ataque por un beneficio menor.

### E.3 Otras piezas

- `functions/calendar/share-token.js`: `generateShareToken(rb = randomBytes)`, `hashShareToken(t)` (sha256 hex) y re-export de `SHARE_TOKEN_RE`.
- `requireFinanceUser` pasa a `can(user.data(), 'finance.records.manage')`. Es equivalente para los legacy y correcto para los v1 (Q11).
- Todo se escribe por inyección (store, clock, randomBytes) para poder testearlo con fakes en memoria, igual que `sumup-memory-store.ts`. `index.js` solo cablea Admin SDK.
- Sin secretos nuevos y sin deploy.

### E.4 Emuladores y URLs

- **`firebase.json`:**
  - `emulators.functions: { "host": "127.0.0.1", "port": 5001 }`;
  - rewrites nuevos: `{ "source": "/api/calendario-publico", "function": { "functionId": "calendarPublicFeed", "region": "southamerica-west1" } }` y `{ "source": "/calendario/compartir/**", "destination": "/calendario-publico.html" }`;
  - headers para `/calendario/compartir/**` y `/calendario-publico`: `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow` y `Cache-Control: no-cache`.
- **`lib/firebase.ts`:**
  - agrega `functions = getFunctions(app, FUNCTIONS_REGION)`;
  - `connectFunctionsEmulator(functions,"127.0.0.1",5001)` bajo la misma guardia actual (dev + `NEXT_PUBLIC_USE_FIREBASE_EMULATORS` + proyecto `demo-`);
  - `FUNCTIONS_REGION = "southamerica-west1"`, con un test de paridad contra `functions/index.js`.
- **`calendarFeedUrl()`:**
  - en dev con emuladores → `http://127.0.0.1:5001/${NEXT_PUBLIC_FIREBASE_PROJECT_ID}/southamerica-west1/calendarPublicFeed`;
  - en cualquier otro caso → `/api/calendario-publico`;
  - no hay env vars nuevas.
- **`publicCalendarUrl(token)`:**
  - en producción → `${location.origin}/calendario/compartir/${token}`;
  - en dev → `${location.origin}/calendario-publico?t=${token}`.
- **RISK:** el emulador de Functions carga `sumupSyncNow` con secretos. Si se queja, se agrega `functions/.secret.local` con JSON ficticio. Se commitea `functions/.secret.local.example` y se agrega `.secret.local` a `.gitignore`, que hoy no lo incluye. `onSchedule` se ignora sin el emulador de Pub/Sub.

---

## F. Rutas y hosting estático

```
app/page.tsx                         markLandingIntent(); replace("/finanzas")   (URL intacta por test)
app/login/page.tsx                   ídem al detectar sesión
app/(private)/layout.tsx             <AuthGuard><AccessProvider><NoticeProvider><AppShell>
                                       <RouteGuard>{children}</RouteGuard></AppShell></NoticeProvider></AccessProvider></AuthGuard>
app/(private)/inicio/page.tsx        HomeRedirect (link del logo / "Inicio"): resolveHome → replace(href) | NoModules
app/(private)/dashboard/page.tsx     sin cambios de URL (markLandingIntent + replace("/finanzas"))
app/(private)/finanzas/**            SIN CAMBIOS (incluido /finanzas/reportes)
app/(private)/calendario/layout.tsx  CalendarNav + import "@/components/calendar/calendar.css"
app/(private)/calendario/page.tsx                  Mes / Semana / Agenda (Agenda por defecto en <768px)
app/(private)/calendario/mis-actividades/page.tsx
app/(private)/calendario/compartir/page.tsx        administración del enlace (manage_all)
app/(private)/reportes/page.tsx                    hub: "Calendario" + tarjeta "Reportes financieros" → /finanzas/reportes
app/(private)/reportes/calendario/page.tsx
app/(private)/configuracion/page.tsx               existente (General, Finanzas) + subnav con links
app/(private)/configuracion/areas/page.tsx
app/(private)/configuracion/usuarios/page.tsx      UsersPermissionsPanel (el mismo componente, evolucionado)
app/calendario-publico/page.tsx                    pública, sin shell; importa solo components/public-calendar/**
```

**Guardia (`lib/access/routes.ts`, puro):**

| Prefijo (gana el más largo) | Requisito |
|---|---|
| `/inicio` | resolver |
| `/finanzas` | `finance.summary.read` (las subrutas de detalle las sigue cubriendo `DetailGuard`, sin redirect) |
| `/calendario` | `calendar.read` |
| `/calendario/mis-actividades` | `calendar.read` (el link de la subnav aparece solo si `areaIds.length > 0`) |
| `/calendario/compartir` (exacto) | `manage_all` |
| `/reportes` | `details.read` o `calendar.read` |
| `/reportes/calendario` | `calendar.read` |
| `/configuracion` | `settings.manage` |

`guardRoute(user, pathname, intentPending)` devuelve una de estas decisiones:
- `allow`;
- `landing` (hay intención de aterrizaje y el path es `/finanzas`), que resuelve `resolveHome` y, si el módulo inicial ≠ finance, hace `redirect(home.href)`;
- `redirect{to, notice}`:
  - si el módulo es visible pero la subruta no → raíz del módulo, con el aviso "No tienes acceso a {sección}";
  - si el módulo no es visible → `home.href`, con el aviso "No tienes acceso a {Módulo}";
- `no-modules` → pantalla in situ, sin redirect;
- `inactive`.

`RouteGuard` hace `router.replace` una sola vez (con un ref anti-StrictMode) y, mientras tanto, renderiza `SessionLoading`. **Nunca** monta la ruta prohibida, así que no arranca listeners de Firestore. El aviso usa `role="status"`, **no** `alert`, y se limpia en el siguiente cambio de pathname.

**Sin loops:** los destinos son siempre hrefs de módulos visibles. Un test de propiedad recorre todos los perfiles × todas las rutas y verifica que `guardRoute(destino).type === "allow"`. La intención de aterrizaje se consume exactamente una vez.

**Página pública:**
- Hosting sirve `/calendario/compartir` → `out/calendario/compartir.html` (estático exacto, **gana**).
- `/calendario/compartir/<token>` no tiene archivo, así que el rewrite lo lleva a `/calendario-publico.html`.
- Los tokens son base64url sin `.`, así que no pueden chocar con `out/calendario/compartir/__next.*.txt`.
- La página lee el token así: si `location.pathname` empieza con `/calendario/compartir/`, toma el último segmento; si no, `?t=`. Lo hace en un efecto, con un hook propio y sin `useSearchParams`, que exigiría Suspense en el prerender.
- El HTML prerenderizado es un skeleton y **no lleva datos**.
- Sin `<Link>` a rutas privadas. Las vistas (Agenda/Mes), el filtro por área y el detalle viven en estado local.
- "No disponible" es un texto único para 404, red y token mal formado: "Este calendario no está disponible".

---

## G. Shell: restricciones técnicas (para coordinar con Designer)

1. `AppShell` mantiene el export y la ruta, y debe renderizar **sin** `AccessProvider` (`useOptionalAccess()` null → solo "Finanzas", como hoy).
2. Conserva el skip link, `<main id="main-content">`, el botón con nombre exacto **"Cerrar sesión"** y el único `role="alert"` para el error de logout (`tests/auth.test.tsx`).
3. **Registro único** `lib/access/modules.ts`:
   ```ts
   export const MODULES = [
     { id: "finance",  label: "Finanzas",      href: "/finanzas",      icon: "Wallet" },
     { id: "calendar", label: "Calendario",    href: "/calendario",    icon: "CalendarDays" },
     { id: "reports",  label: "Reportes",      href: "/reportes",      icon: "ChartColumn" },
     { id: "settings", label: "Configuración", href: "/configuracion", icon: "Settings" },
   ] as const;  // filtrado con visibleModules(); "Integrantes" no existe
   ```
   `<nav aria-label="Módulos">` con `aria-current="page"` en el módulo activo (`moduleOfPath`). `/finanzas/reportes` activa Finanzas.
4. **Las subnavs viven en los layouts de cada módulo:**
   - `FinanceNav`: no se toca, con su contrato de 6/1 links;
   - `CalendarNav`: Calendario, Mis actividades y Compartir según permisos;
   - `SettingsNav`: General y Finanzas, Áreas, Usuarios y permisos.
   - Nunca hay dos navs con el mismo `aria-label`.
5. **Estilos:**
   - se usan los tokens de Tailwind de `app/globals.css`;
   - el CSS de calendario se porta a `components/calendar/calendar.css`, con scope `.cds-calendar` y prefijo `cal-`;
   - prohibido `fx-`/`sx-`, sentinels, "Vista previa", "Demo" y "Simulación" en código de producción (test de escaneo);
   - la paleta de áreas va como variables `--area-{color}-{swatch|ink|soft}`;
   - la página pública tiene su propio CSS y **no** importa el CSS del shell.
6. **Responsive y accesibilidad:**
   - en móvil, barra inferior con ≤4 módulos (Designer decide);
   - objetivos táctiles ≥44px;
   - foco visible (el `:focus-visible` actual);
   - Agenda por defecto bajo 768px.
7. El logo/marca enlaza a `/inicio`. La migaja muestra la etiqueta del módulo.

---

## H. Migración `scripts/migrate-access-v1.mjs`

**Planner puro** en `lib/shared/access.ts`, compilado y compartido:

```ts
export interface MigrationPlanRow { uid: string; displayName: string; emailMasked: string; oldRole: string | null;
  status: "migrate" | "skip_already_v1" | "skip_invalid_role"; baseRole?: BaseRole; position?: string;
  permissions?: Permission[]; effective?: Permission[]; homeModule?: HomeModule; areaIds: string[];
  changes: Record<string, unknown>; warnings: string[]; }
export function planAccessMigration(uid: string, doc: UserAccessDoc & { displayName?: unknown; email?: unknown },
  opts: { pastorHome: HomeModule }): MigrationPlanRow;
```

**Comportamiento del planner:**
- docs con `accessSchemaVersion === 1` → `skip_already_v1` (no pisa ediciones de un admin);
- rol inválido → `skip_invalid_role` (se reporta y da exit 2);
- si no:
  - `changes = { baseRole, position, permissions: LEGACY_ROLE_ACCESS[role].permissions, areaIds: [], homeModule, accessSchemaVersion: 1, updatedAt: <serverTimestamp>, updatedBy: "system:migrate-access-v1" }`;
  - para pastor, `homeModule = opts.pastorHome` (por defecto `finance`);
  - **nunca** toca `role`, `displayName`, `email`, `active` ni `createdAt`, y **nunca** inventa `areaIds`;
  - leader recibe la advertencia "Líder sin áreas: solo verá el calendario hasta que se le asignen".

**CLI:**
```
node scripts/migrate-access-v1.mjs --emulator [--apply] [--pastor-home finance|calendar] [--only <uid>] [--json out.json]
node scripts/migrate-access-v1.mjs --project <id> [--apply --confirm <id>]
```
- `parseMigrationArgs(argv, env)` exportado y puro. El bloque `main()` solo corre si es el entrypoint.
- Admin SDK con `createRequire(new URL("../functions/package.json", import.meta.url))("firebase-admin/app")`. No agrega dependencias en la raíz.

**Interlocks:**
1. Sin destino → error con ayuda (exit 1).
2. `--emulator`: el proyecto debe empezar con `demo-` (por defecto `demo-cds-suite`). Fija o verifica `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`.
3. `--project X` sin `--emulator`: se rechaza si `FIRESTORE_EMULATOR_HOST` está seteado (ambiguo). El dry-run se permite.
4. `--apply` sobre un proyecto no `demo-` exige **las tres** condiciones: `--confirm X` idéntico, `CDS_ALLOW_PRODUCTION_MIGRATION=X` y una TTY interactiva donde se escribe X. Si no hay TTY, se rechaza. Además imprime la recomendación de backup (`gcloud firestore export`).
5. **En esta misión solo se ejecuta `--emulator`.**

**Escritura:**
- `ref.update(changes, { lastUpdateTime: snap.updateTime })`: si un admin editó en paralelo, falla y se reporta;
- lotes de ≤400;
- es idempotente: una segunda corrida marca todo como `skip_already_v1`.

**Salida:** una tabla por usuario (uid, nombre, `s***@g***.com`, rol anterior, baseRole, permisos guardados y efectivos, homeModule, áreas, cambios y advertencias) y un resumen con conteos. `--json` deja el reporte en un archivo.

---

## I. Seed `scripts/seed-platform-calendar-emulator.mjs`

- **Se niega a correr** salvo que se cumplan todas: `CDS_SEED_LOCAL=true`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` y proyecto `demo-cds-suite`. Es el mismo patrón que `scripts/seed-emulators.ts`.
- Usa Admin SDK desde `functions/node_modules` vía `createRequire`. Auth con `getAuth().createUser({ uid, email, password })`, que respeta el emulador, y Firestore con Admin SDK.
- **Usuarios** (uids fijos, correos `@cds.test`, contraseña `PruebaCDS2026!` documentada en el propio seed):
  - `seed-admin` (v1 admin);
  - `seed-pastor`;
  - `seed-finanzas`;
  - `seed-lider-jovenes` (`areaIds:["jovenes"]`, `manage_assigned` + `publish_assigned`, home calendar);
  - `seed-lider-sin-area` (`manage_assigned`, sin áreas);
  - `seed-inactivo` (`active:false`);
  - `seed-legado` (doc **legacy** con `role:"finance"`, para probar el fallback y la migración dry-run).
- **Áreas:**
  - `pastoral` (azul);
  - `jovenes` (naranjo);
  - `alabanza` (indigo);
  - `ninos` (verde);
  - `damas` (frambuesa);
  - `matrimonios` (cafe, **inactiva**).
- **Eventos**, relativos a "hoy" en Santiago, cada uno con su change `r1` y los cambios posteriores que correspondan:
  1. Culto dominical: semanal, domingo 11:00–13:00, pastoral, público, participa alabanza, una ocurrencia cancelada con motivo canario `CANARIO_EXCEPCION_9P`.
  2. Reunión de jóvenes: semanal, sábado 19:00, jovenes, público.
  3. Ensayo de alabanza: semanal, jueves 20:00, interno, `internalNotes` con `CANARIO_NOTA_INTERNA_7Q`.
  4. Reunión de líderes: mensual, primer sábado, interno.
  5. Vigilia: simple, 22:00 → 02:00 del día siguiente, público.
  6. Campamento: 3 días todo el día, jovenes, público.
  7. Evangelismo en la plaza: cancelado, `cancelReason` con `CANARIO_MOTIVO_CANCELACION_3K`, público.
  8. Actividad archivada: título `CANARIO_ARCHIVADA_2M`.
  9. Serie iniciada hace 3 semanas, para ver el bloqueo temporal.
  10. Evento pasado del área inactiva.
- **Share link:** genera el token, guarda solo el hash e imprime **una vez** `http://localhost:3000/calendario-publico?t=<token>`. Es solo local y ficticio.
- Es idempotente: `set` con ids fijos, así que re-correrlo resetea los fixtures.
- Los canarios se centralizan en `tests/fixtures/calendar-canaries.ts`, y el seed declara los mismos literales.

**`package.json`:**
```json
"emulators": "firebase emulators:start --only auth,firestore,functions --project demo-cds-suite",
"seed:platform": "CDS_SEED_LOCAL=true FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GCLOUD_PROJECT=demo-cds-suite node scripts/seed-platform-calendar-emulator.mjs",
"build:shared": "node scripts/build-shared.mjs",
"test:emulator": "firebase emulators:exec --only auth,firestore,functions --project demo-cds-suite \"vitest run --config vitest.emulator.config.mts\""
```
`test:rules` no cambia.

**Corrida local:**
1. `npm --prefix functions ci`;
2. `.env.development.local` con `demo-cds-suite` y `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true`;
3. `npm run emulators`, después `npm run seed:platform`, después `npm run dev`.

---

## J. Plan de tests

### J.1 Unitarios (`npm test`; jsdom por defecto, `// @vitest-environment node` donde aplique)

| Archivo | Cubre |
|---|---|
| `tests/platform/access.test.ts` | <ul><li>Cierre (cada implicación); `settings.manage` solo con baseRole admin, aunque esté guardado; inactivo da ∅; permisos desconocidos se ignoran.</li><li>`normalizeAccess` legacy/v1/basura.</li><li>**Compatibilidad exacta:** para cada rol legacy, `eff(docLegacy) == eff(planAccessMigration(docLegacy) aplicado)`.</li><li>Propiedad de `deriveLegacyRole`.</li><li>`visibleModules` por perfil: admin 4; pastor F/C/R; finance F/C/R; leader F/C/R; v1 solo `calendar.read` C/R; v1 sin nada [].</li></ul> |
| `tests/platform/home-module.test.ts` | <ul><li>configurado → default → primero → no-modules; inactivo.</li><li>Configurado inválido marca `invalidConfigured`.</li><li>Pastor `finance` y `calendar`.</li></ul> |
| `tests/platform/routes.test.ts` | <ul><li>Tabla `guardRoute`; propiedad sin loops.</li><li>Intención de aterrizaje consumida una vez; `/finanzas` sin intención no redirige.</li><li>`/calendario/compartir` sin `manage_all` → `/calendario` con aviso.</li></ul> |
| `tests/platform/rules-parity.test.ts` | Parsea `firestore.rules` y compara `implicants()`, `legacyPermissions()`, `permissionCatalogNoSettings()`, la paleta de `validArea` y la lista de `homeModule` contra `lib/shared` (cierre de `IMPLIES`, `LEGACY_ROLE_ACCESS`, `AREA_COLORS`). |
| `tests/platform/shared-purity.test.ts`, `tests/platform/no-preview-leak.test.ts` | <ul><li>Pureza.</li><li>`app/`, `components/` y `lib/` no importan `suite-preview`/`finance-preview` ni contienen "Vista previa", "Simulación", "DEMO" ni `_SENTINEL_`.</li></ul> |
| `tests/calendar/recurrence.test.ts` | <ul><li>Port de PR #4: weekly/biweekly con `until` inclusivo; mensual 1.º/2.º/último con fechas exactas; ordinales (28-11 → `[4,-1]`); 12 meses; ≤60.</li><li>Vigilia y campamento.</li><li>**DST:** una serie que cruza el 4-abr-2027 y el 5-sep-2027 conserva las 11:00.</li><li>Excepciones; `seriesCancellation`; "Realizada" en el borde.</li></ul> |
| `tests/calendar/calendar.test.ts` | <ul><li>Matriz `canManageEvent`/`canPublishEvent`: participante ≠ editar; área inactiva; pasado; archivada.</li><li>`creatableAreas`; `validateEvent`; `validateSeriesPatch` (bloqueo de serie iniciada); `lastDateOf`.</li></ul> |
| `tests/calendar/audit.test.ts` | `buildChange`: `changedFields` exactos; acción igual a la tabla `expectedAction` (mismos casos que las reglas); `internalNotes` sin valor; `created` sin before/after. |
| `tests/calendar/public-calendar.test.ts` | <ul><li>Claves exactas en profundidad (`PUBLIC_EVENT_KEYS`/`PUBLIC_AREA_KEYS`).</li><li>Ningún canario, `@` ni uid en `JSON.stringify`.</li><li>Internos y archivados fuera; cancelada sin motivo.</li><li>Áreas del encabezado; rango.</li></ul> |
| `tests/calendar/areas.test.ts`, `report.test.ts`, `report-pdf.test.ts` | <ul><li>Paleta, `slugify`, `validateArea`.</li><li>Filtros del reporte (período, área, solo responsable, estado, visibilidad); columnas.</li><li>PDF: `pageCount ≥ 1`; el texto del PDF no contiene "Vista previa"/"Demo"/"DEMO" y sí los filtros; el nombre del archivo no lleva DEMO.</li></ul> |
| `tests/calendar/public-page.test.tsx` | <ul><li>`fetch` mockeado: token desde el path y desde `?t`.</li><li>404, error de red y token mal formado muestran el mismo texto.</li><li>Sin links a rutas privadas.</li><li>Ningún canario en `innerHTML`.</li></ul> |
| `tests/calendar/calendar-screens.test.tsx` | <ul><li>El Líder solo elige sus áreas activas; participante en solo lectura.</li><li>Toggle "Pública" deshabilitado sin publicar.</li><li>Cancelar y archivar exigen motivo.</li><li>Serie iniciada con campos temporales deshabilitados.</li></ul> |
| `tests/layout/suite-shell.test.tsx` | <ul><li>Módulos por perfil; "Integrantes" nunca aparece.</li><li>Null access seguro; "Cerrar sesión".</li><li>`RouteGuard`: redirect único y sin montar hijos; no-modules.</li></ul> |
| `tests/settings/users-v1.test.tsx` | <ul><li>Crear escribe la forma v1 completa (mock de Firestore).</li><li>Editar un legacy lo promueve a v1 con el mapeo exacto.</li><li>Reenviar acceso y desactivar se conservan.</li><li>Auto-protección; `settings.manage` nunca se guarda; módulo inicial solo entre los permitidos; advertencias (`manage_assigned` sin áreas; publicar sin gestionar).</li></ul> |
| `tests/scripts/migrate-access-v1.test.ts` | <ul><li>Planner por rol; idempotencia (v1 → skip); rol inválido; `areaIds` siempre []; `role` intacto; `--pastor-home`.</li><li>`parseMigrationArgs`: sin destino; `--apply` sin `--confirm`; `--project` real con `FIRESTORE_EMULATOR_HOST`; demo obligatorio con `--emulator`.</li></ul> |

### J.2 Functions (`tests/functions/*`, vitest node, `createRequire`)

- `shared-build.test.ts` (frescura) y `shared-parity.test.ts`.
- `calendar-share-token.test.ts`:
  - 43 caracteres base64url, 32 bytes, 1000 tokens únicos;
  - vector conocido de SHA-256 (`"abc"` → `ba7816bf…`);
  - `SHARE_TOKEN_RE`.
- `calendar-public-feed.test.ts`:
  - 200 con forma exacta y canarios ausentes;
  - inexistente, desactivado y mal formado dan respuestas idénticas (status + headers + body);
  - POST → 405;
  - headers de cache y privacidad;
  - CORS solo en emulador y con origen permitido;
  - token anterior a una regeneración → unavailable;
  - recurrencia expandida;
  - archivados e internos fuera.
- `calendar-share-links.test.ts`:
  - autorización: admin v1 sí; pastor legacy sí (`manage_all`); leader no; inactivo no; sin doc no; sin auth no;
  - `create` guarda solo el hash (escaneo profundo del doc: el token no aparece) y una segunda llamada da `already-exists` sin token;
  - `regenerate` cambia el hash y el token viejo deja de funcionar;
  - `activate`/`deactivate` son idempotentes;
  - `status` nunca expone hash ni token.
- `require-finance-user.test.ts`: equivalencia legacy/v1.

### J.3 Rules (`tests/rules/platform-access.test.ts`, `tests/rules/platform-calendar.test.ts`; `npm run test:rules`)

**Fixtures de usuarios:**
- legacy: `admin`, `pastor`, `finance`, `leader`, `inactive`;
- v1: `v1-admin`, `v1-pastor`, `v1-finance`, `v1-leader-jovenes` (`manage_assigned`, `["jovenes"]`), `v1-publisher-jovenes` (`+publish_assigned`), `v1-leader-sin-area`, `v1-reader` (solo `calendar.read`), `v1-inactive`.
- Áreas `jovenes` y `alabanza` activas, `matrimonios` inactiva.

**Positivos:**
- Paridad financiera v1: `v1-finance` crea una transacción y lee `appSettings`; `v1-leader-jovenes` lee el resumen pero no las transacciones; `v1-reader` no lee el resumen; `v1-pastor` crea un seguimiento pastoral.
- Admin crea y edita usuarios v1; promueve legacy → v1.
- Calendario:
  - `calendar.read` lista eventos y áreas;
  - `manage_assigned` crea un evento interno de su área (batch evento + `r1`);
  - un publisher crea uno público de su área y publica internal → public;
  - `manage_all` (legacy pastor) crea y publica en cualquier área y crea en el pasado;
  - cancelar evento simple con motivo; cancelar una ocurrencia (append); cancelar la serie desde hoy; archivar con `manage_all`;
  - quitar publicación (public → internal) sin permiso de publicar;
  - editar el título de una serie iniciada; extender `until`;
  - manager del área lee `changes`.

**Negativos (seguridad):**
- **Escalada de privilegios:**
  - un leader escribe su propio `permissions`, `areaIds`, `baseRole` o `role`;
  - el admin se degrada o se desactiva (legacy y v1);
  - `permissions` con `settings.manage`, con un string desconocido o con duplicados;
  - 21 `areaIds`; `homeModule: "reports"`;
  - `baseRole` y `role` incoherentes;
  - downgrade v1 → legacy;
  - v1 sin `updatedAt == request.time`, o con `updatedBy` falso;
  - campo extra `isSuperAdmin` (asignación masiva).
- **IDOR:** un leader lee el doc de otro usuario; un leader lista users.
- **Calendario:**
  - crear en un área ajena; crear con responsable ajeno aunque el propio participe;
  - editar un evento ajeno; mover `responsibleAreaId` a un área ajena; un leader de un área participante edita;
  - pasar a público sin permiso de publicar, al crear o al actualizar; editar el título de un evento público sin permiso de publicar;
  - cambiar `createdBy` o `createdAt`;
  - `delete` (incluso admin);
  - escribir un evento sin change; escribir un change solo; un change con otro `actorUid`; un change con una acción incorrecta (cambia la visibilidad con acción `updated`); `changedFields` que no coinciden; actualizar o borrar un change;
  - `manage_assigned` crea en el pasado o edita un evento pasado;
  - una serie iniciada cambia hora o frecuencia (también admin); `until` en el pasado;
  - cancelar sin motivo; cancelar una serie vía `status`;
  - modificar una excepción existente; excepción con `by` falso; `seriesCancellation.from` en el pasado;
  - `manage_assigned` archiva un evento iniciado; des-archivar;
  - área inactiva con `manage_assigned`; un leader legacy (sin áreas) crea;
  - recurrencia > 1 año, span de 2 días en una serie, ordinal inválido, `lastDate < until`, excepciones en un evento no recurrente;
  - `v1-reader` lee `changes`;
  - un usuario v1 sin permisos de calendario lee eventos;
  - un inactivo lee lo que sea.
- **Áreas:**
  - un leader crea un área; cambio de slug; borrar;
  - un usuario sin calendario lee áreas.
- **`calendarShareLinks`:** get, list, create y update **denegados para todos, incluido admin**. Nadie puede escribir `tokenHash`.
- **Regresión:** `finance.test.ts` e `integrations.test.ts` sin cambios y en verde.

### J.4 Smoke con emuladores (`npm run test:emulator`, `tests/emulator/calendar-feed.e2e.test.ts`)

- Escribe un link con un token conocido vía `withSecurityRulesDisabled` y eventos con canarios.
- Hace `fetch` a `http://127.0.0.1:5001/demo-cds-suite/southamerica-west1/calendarPublicFeed?t=…` y verifica claves y ausencia de canarios.
- Desactiva el link → 404 idéntico.

**Validación manual documentada (doc 18):**
1. `npm run build`, después `firebase emulators:start --only hosting,functions,firestore --project demo-cds-suite`;
2. `curl -I /calendario/compartir` → HTML de administración;
3. `/calendario/compartir/abc…` → HTML público;
4. `/api/calendario-publico?t=x` → 404 JSON;
5. `grep -c CANARIO out/calendario-publico.html` → 0.

**Gates:** `lint`, `typecheck`, `npm test` (los existentes intactos más los nuevos), `test:rules`, `test:emulator`, `build`, `node scripts/build-shared.mjs --check`.

---

## K. Qué se porta de PR #4

| Origen (`mission/calendar-integrantes-preview`) | Destino | Cómo |
|---|---|---|
| `lib/suite-preview/dates.ts` | `lib/shared/dates.ts` | Tal cual, más `localNow`/`localToday` (Intl, America/Santiago) |
| `recurrence.ts` | `lib/shared/recurrence.ts` | Adaptar: estados `scheduled/cancelled/archived`; `startTime`/`endTime` `string\|null`; excepción sin `at` |
| `calendar.ts` (ocurrencias y orden) | `lib/shared/calendar-core.ts` | `occurrencesInRange`, `compareDayOrder`, `sortOccurrences`, más `lastDateOf` |
| `calendar.ts` (permisos, grillas, validación) | `lib/calendar/calendar.ts` | Adaptar a `can(user,…)` y `areaIds`; agregar `canPublishEvent`; `cancel` solo en simples |
| `share.ts` | `lib/shared/public-calendar.ts` | Mantener `toPublicArea`, `toPublicEvent`, `publicRecurrenceLabel`, `publicRange`, `sortPublicEvents` y `PUBLIC_*_KEYS`. `resolvePublicCalendar` pasa a ser `buildPublicCalendar` (sin comparar token). **Eliminar** `PREVIEW_SHARE_TOKENS`, `DEFAULT_PRESENTED_TOKEN`, `nextPreviewToken`, `previewShareHref`, `PRODUCTION_SHARE_ORIGIN` y `productionShareUrl`. `fnv1a` → `fnv1a64` |
| `access.ts` | `lib/shared/access.ts` + `lib/access/labels.ts` | Catálogo sin `members.*` y con `publish_assigned`. `legacyRoleToProfile` pasa a `LEGACY_ROLE_ACCESS` + planner. `resolveInitialModule` pasa a `resolveHome` (finance/calendar). Las etiquetas y grupos van a `labels.ts`. `validateProfileChange` va a `lib/settings/users.ts` |
| `routes.ts`, `modules.ts` | `lib/access/routes.ts`, `modules.ts` | Rutas de producción; sin `perfil`/`withProfile`; sin Integrantes |
| `areas.ts` | `lib/calendar/areas.ts` | Tal cual (paleta, `validateArea`, `slugify`, `freeColors`, `areaUsage`), con `selectableAreas` sobre el acceso nuevo |
| `report.ts` | `lib/calendar/report.ts` | Columnas de la misión (8). La visibilidad queda como filtro y en el encabezado (Q4) |
| `report-pdf.ts` | `lib/calendar/report-pdf.ts` | Quitar `PDF_PREVIEW_LABEL` y su banda; nombre `reporte-calendario-{from}_{to}.pdf`; `generatedBy` = nombre real; recalcular anchos de columna |
| `components/suite-preview/calendar/*` | `components/calendar/*` | Agenda, Mes, Semana, toolbar, detalle, formulario, diálogos y sheets, `my-activities`, labels y bits. Datos vía hooks de Firestore; sin `useSuite`/`simulate`/toast de simulación |
| `calendar/share-screen.tsx` | `components/calendar/share-admin.tsx` | Reescrito sobre el callable (mostrar el token una vez) |
| `public/public-calendar.tsx`, `public/model.ts` | `components/public-calendar/*` | Presentacional. `public-adapter.tsx` se reescribe sobre `fetchPublicCalendar` |
| `reports/calendar-report.tsx` | `components/reports/calendar-report.tsx` | Datos reales |
| `settings/areas-screen.tsx` | `components/settings/areas-panel.tsx` | Sobre `areas-client` |
| `settings/users-screen.tsx` | **se fusiona dentro de** `components/settings/users-permissions-panel.tsx` | Solo la UI de permisos, áreas y módulo inicial; el flujo de crear, reenviar y desactivar existente se conserva |
| Tests `access`, `routes`, `areas`, `calendar`, `recurrence`, `share`, `report`, `public-view`, `calendar-screens`, `suite-shell` | `tests/platform`, `tests/calendar`, `tests/layout` | Adaptados |

**No se porta:**
- `store.ts`, `fixtures.ts`, `clock.ts`, `sentinel.ts`, `consolidation.ts`, `phone.ts`;
- `provider.tsx`, `access-gate.tsx` (se reemplaza por `RouteGuard`), `login.tsx`, `demo-banner.tsx`, `placeholders.tsx`, `toast-context.ts`, `members/**`;
- todo `lib/finance-preview/**` y `components/finance-preview/**` (PR #3);
- los tests de store, consolidation, phone, members, isolation, deploy-guard y structure.

---

## L. Riesgos, rollout, rollback y alcance

### L.1 Riesgos, por orden

1. **Regresión de acceso financiero en las reglas.**
   - **Mitigación:** tests existentes sin cambios, matriz de paridad v1, test de paridad del texto de las reglas, y fallback legacy idéntico al mapeo.
2. **Fuga de datos internos por el feed.**
   - **Mitigación:** lista blanca con literales; canarios en unit, Functions y e2e; 404 uniforme; sin CDN; `calendarEvents` nunca abierto al público.
3. **Escalada vía `users`.**
   - **Mitigación:** `validUserV1` estricto (`hasOnly`, catálogo sin `settings`, coherencia de rol); auto-protección; batería negativa.
4. **Divergencia del código compartido** entre cliente y Functions.
   - **Mitigación:** TS como fuente única, test de frescura, `predeploy --check` y paridad de vectores.
5. **Errores de zona horaria o DST.**
   - **Mitigación:** hora de pared; `localToday()` indulgente en reglas; reglas exactas en la UI; tests que cruzan abril y septiembre de 2027.
6. **Colisión de ruteo** entre `/calendario/compartir` (administración) y la pública.
   - **Mitigación:** precedencia files > rewrites (FACT) y smoke con el emulador de Hosting.
7. **Complejidad y límites de las reglas.**
   - **Mitigación:** ~6 `get` por batch; funciones cortas; tests de cada transición.
8. **Clientes cacheados viejos tras el deploy.**
   - **Mitigación:** escrituras v1 denegadas (seguro); el calendario es invisible para ellos; se recarga.
9. **Contrato de tests en `/finanzas`.**
   - **Mitigación:** intención de aterrizaje en memoria (Q7).
10. **Token en la URL y en logs** (Hosting y Cloud Run).
    - **Mitigación:** `no-referrer`, `noindex`, nunca loguear el token y regenerar en un clic. El riesgo residual (logs solo visibles para IAM) se acepta.
11. **`internalNotes` con datos personales.**
    - **Mitigación:** ayuda visible "No escribas datos personales de integrantes" (la ven todos con `calendar.read`).
12. **El emulador de Functions** con secretos SumUp y Node 24 local frente a engines 22.
    - **Mitigación:** `.secret.local` ficticio y advertencia aceptada.
13. **PR #1 aún no desplegado** (`PROJECT_CONTEXT` §9). El rollout de esta misión depende de desplegar antes, o junto, la base de Financial Core 2026.

### L.2 Rollout (misión futura, con aprobación humana en cada paso)

1. Merge revisado.
2. Confirmar qué reglas y Functions corren hoy en producción.
3. Backup con `gcloud firestore export`.
4. `firebase deploy --only firestore:indexes` y esperar a que estén `READY`.
5. Deploy de **reglas** con el fallback legacy activo: para los usuarios actuales no cambia nada.
6. Deploy de **Functions** (`calendarPublicFeed`, `calendarShareLinkManage`, la auth de SumUp ajustada). Sin enlace creado, el feed responde 404 a todos.
7. Deploy de **Hosting** (shell, calendario, página pública y rewrites).
8. `migrate-access-v1.mjs --project cds-administracion` en **dry-run**; Salvador revisa la salida.
9. Con aprobación explícita: `--apply --confirm …` en una TTY.
10. Verificar: cada usuario entra y ve las mismas finanzas; métricas de denegaciones de reglas.
11. Crear áreas, asignar áreas a los líderes y otorgar `publish_assigned` donde corresponda.
12. Crear el enlace público.
13. **Más adelante**, tras ≥2 semanas estables y con el 100% de docs en v1: retirar el fallback (`permissions()` exige v1).

### L.3 Rollback

- **Hosting:** release anterior desde el historial de Hosting.
- **Reglas:** re-desplegar el `firestore.rules` previo (tag `rules-pre-platform-v1`).
  - Como `role` se conserva y es coherente, los docs v1 siguen funcionando para leer.
  - Las ediciones de usuarios quedan bloqueadas por el `hasOnly` legacy hasta que se haga roll-forward.
  - Las colecciones nuevas quedan inaccesibles por el catch-all, sin pérdida de datos.
  - Caveat: los v1 sin permisos financieros quedan con `role: leader`, que da ver el resumen.
- **Functions:** kill switch = `calendarShareLinks/public.active=false` desde la consola; o borrar las dos funciones.
- **Datos:** la migración no necesita reversa, porque los campos v1 se ignoran con las reglas legacy.

### L.4 Fuera de alcance (no tocar)

- Backend de Integrantes/Consolidación y la colección `people`.
- Fe, bautismo y menores.
- WhatsApp.
- Slice 3A.
- Deploy, cambio de rama default y merges.
- Edición de una sola ocurrencia, "esta y las siguientes" y "día N del mes".
- Custom claims.
- ICS y notificaciones.
- Auditoría de cambios de usuarios (propuesta futura: `users/{uid}/accessChanges`).

---

## M. Preguntas abiertas para Salvador (con decisión por defecto)

1. **Q1. Representación de fechas.** La misión dice `startAt/endAt`, pero un Timestamp corre la hora de las series al cambiar el horario de verano. **Por defecto:** `startDate/startTime/endDate/endTime/allDay` en hora de pared de Santiago, más `lastDate`.
2. **Q2. Áreas inactivas.** ¿`calendar.read` puede leer también las áreas inactivas, que hacen falta para mostrar el nombre y color de eventos antiguos? **Por defecto:** sí, todas. No contienen datos sensibles.
3. **Q3. Módulo inicial del pastor.** **Por defecto:** `finance`, para conservar su aterrizaje actual. Es configurable por usuario y con `--pastor-home`.
4. **Q4. Columnas del reporte.** **Por defecto:** exactamente las 8 de la misión. La visibilidad aparece como filtro aplicado en el encabezado.
5. **Q5. Copiar el enlace después.** No se puede copiar más tarde, porque el token no se guarda. **Por defecto:** se muestra una sola vez y, si se pierde, se regenera.
6. **Q6. Regenerar un enlace desactivado.** **Por defecto:** regenerar lo deja activo.
7. **Q7. Tests de aterrizaje.** ¿Se permite actualizar 3 aserciones de tests existentes para que `/` y `/login` vayan a `/inicio`? **Por defecto:** no; se usa la intención de aterrizaje en memoria.
8. **Q8. "Mis actividades" para lectura.** **Por defecto:** visible si el usuario tiene áreas asignadas, aunque solo lea (en solo lectura).
9. **Q9. Historial de cambios.** **Por defecto:** lo ven `manage_all` y quien gestiona el área. El nombre del actor solo se resuelve para `settings.manage`; los demás ven "Otro usuario" o "Tú".
10. **Q10. Rango público.** **Por defecto:** desde el mes anterior hasta hoy + 6 meses.
11. **Q11. Auth de SumUp.** ¿`requireFinanceUser` usa los permisos compartidos? **Por defecto:** sí. Es equivalente para los legacy.
12. **Q12. Cargo.** **Por defecto:** texto libre con presets (Administración, Pastor, Finanzas, Líder) que solo pre-llenan permisos.
13. **Q13. Valor de visibilidad.** **Por defecto:** `internal` (etiqueta "Solo equipo").
14. **Q14. Publicación de líderes.** **Por defecto:** la migración **no** otorga `publish_assigned`; Salvador lo asigna explícitamente.
15. **Q15. Estado "Realizada" en el público.** **Por defecto:** no se expone; la página pública lo infiere por la fecha.

---

## Handoff para Builder: orden sugerido de commits

1. `lib/shared/*` + `scripts/build-shared.mjs` + `functions/shared/*` + tests (`access`, `home`, `dates`, `recurrence`, `public-calendar`, frescura y paridad).
2. `firestore.rules` (helpers + renombre financiero) + `tests/rules/platform-access.test.ts`. Verificar `finance.test.ts` sin cambios y en verde.
3. Reglas de `areas`, `calendarEvents`, `changes` y `calendarShareLinks` + `tests/rules/platform-calendar.test.ts` + índices.
4. Acceso en el cliente: `lib/access/*`, `can()` en los call sites, la key de `AccessProvider`, `RouteGuard`, intención de aterrizaje, `/inicio` y la evolución de `AppShell`.
5. Functions (`share-token`, `public-feed`, `share-links`, store) + `index.js` + `firebase.json` (emulador y rewrites) + tests.
6. Calendario: `events-client`, `areas-client`, UI portada, Mis actividades y Compartir.
7. Configuración: Áreas y la evolución de Usuarios y permisos (el mismo panel).
8. Reportes: hub, Calendario y PDF.
9. Página pública + headers de Hosting.
10. Scripts de migración y seed + `test:emulator` + doc 18 de validación con la evidencia de gates y del smoke con el emulador de Hosting.

**Invariantes que no se negocian:**
- ningún test existente se modifica;
- `role` nunca se borra y se mantiene coherente;
- `settings.manage` solo existe vía admin;
- ningún borrado físico;
- `calendarEvents` nunca es público;
- el token en claro nunca se persiste ni se loguea;
- toda escritura de evento va con su change en el mismo batch;
- la lógica compartida tiene una sola fuente, en `lib/shared`;
- sin deploy.
