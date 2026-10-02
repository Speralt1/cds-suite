# 18 · Platform Core V1 + Calendario en producción: especificación

> **NO DEPLOY · NO PRODUCTION DATA · EMULATOR VALIDATED.**
> Es código de producción, pero en esta misión no se despliega nada, no se escriben datos reales y no se ejecuta ninguna migración contra Firebase real. Todo se valida con Firebase Emulator Suite y datos ficticios.

**Fecha:** 2026-10-02
**Rama:** `mission/platform-core-calendar-v1`, creada desde `origin/mission/slice6-usability` @ `e6b2084` (la base productiva de Financial Core 2026, PR #1)
**Referencias de diseño, no se fusionan:** PR #3 (`mission/ux-finanzas-2026-preview`) y PR #4 (`mission/calendar-integrantes-preview`, docs 16–17)

**Anexos:**
- [18a · Arquitectura productiva (Atlas)](18a-atlas-production-architecture.md): modelo Firestore, reglas, Functions, rutas, migración, seed, plan de tests, port de PR #4, riesgos, rollout y rollback.
- [18b · Plan de port UX a producción (Designer)](18b-designer-production-ux-port.md): shell, Calendario, publicación, enlace de un solo uso, Configuración, Reportes, copy y capturas.

Este documento resume los anexos y **manda sobre ellos** donde dicen algo distinto (§10).

---

## 1. Estado inicial (preflight)

| Chequeo | Resultado |
|---|---|
| Checkout | `~/Documents/Proyectos Desarrollo/Proyects/CDS/cds-suite`, árbol limpio en `mission/calendar-integrantes-preview` @ `b65e85b` |
| `origin/mission/slice6-usability` | `e6b2084`, igual a la rama local. Está 39 commits por delante de `origin/feature/preproduccion-mobile-v1` y 0 por detrás |
| PR #1 | Abierto, no draft, MERGEABLE (`mission/slice6-usability` → `feature/preproduccion-mobile-v1`) |
| PR #3 / PR #4 | Drafts de solo preview, MERGEABLE. **No se fusionan**: solo se consultan con `git show` |
| Rama nueva | `mission/platform-core-calendar-v1` no existía; se creó desde `origin/mission/slice6-usability`. merge-base = `e6b2084` |
| Slice 3A | `mission/slice3a-sumup-fees` no se toca |
| Entorno | Java 21 (emulador de Firestore), firebase-tools 15.28.2, Node 24 local (engines de Functions: 22) |
| `.env.local` | **Apunta al proyecto real `cds-administracion`**. Por eso la experiencia local usa un script propio que fuerza `demo-cds-suite` y los emuladores (§8). `npm run dev` sin esas variables **no** se usa en esta misión |

## 2. Objetivo y alcance

**Entra (código de producción, sin deploy):**
1. Shell global de CDS Suite con los módulos **Finanzas · Calendario · Reportes · Configuración**. **Integrantes no aparece.**
2. Modelo real de usuarios y permisos por módulo, compatible con los roles actuales.
3. Áreas.
4. Calendario con recurrencia V1.
5. Calendario público por enlace seguro.
6. Reporte de Calendario + PDF.
7. Módulo inicial por usuario.

**No entra:**
- backend de Integrantes/Consolidación, colección `people`, fe, bautismo y menores;
- WhatsApp y Brother;
- Slice 3A;
- deploy, cambio de rama default y merges de PR #1/#3/#4;
- recurrencia avanzada ("solo esta", "esta y las siguientes", "día N");
- custom claims, ICS y notificaciones.

## 3. Modelo de acceso

`users/{uid}` = `role` (legacy, **se conserva siempre**) + `baseRole` + `position` + `permissions[]` + `areaIds[]` + `homeModule` + `active` + `accessSchemaVersion: 1`.

**Catálogo:** `finance.summary.read`, `finance.details.read`, `finance.records.manage`, `finance.pastoral.manage`, `calendar.read`, `calendar.events.manage_assigned`, `calendar.events.manage_all`, `calendar.events.publish_assigned`, `settings.manage`.

**Cierre:**
- `records.manage` → `details.read` → `summary.read`;
- `pastoral.manage` → `details.read`;
- `manage_all` → `manage_assigned` → `calendar.read`;
- `publish_assigned` → `calendar.read`.

`settings.manage` **solo** existe vía `baseRole = admin`: nunca se guarda en `permissions`.

**Fallback legacy, idéntico al mapeo de la migración:**

| Rol | baseRole | Permisos | Módulo inicial |
|---|---|---|---|
| admin | admin | todos | finance (configurable) |
| pastor | standard | summary + details + records + pastoral + calendar.read + manage_all | finance (configurable; conserva su aterrizaje actual) |
| finance | standard | summary + details + records + calendar.read | finance |
| leader | standard | summary + calendar.read + manage_assigned, **sin áreas** | calendar |

**Equivalencia financiera bit a bit:**
- `details()` de lectura pasa a `financeDetailsRead()`;
- `details()` de escritura pasa a `financeRecordsManage()`;
- `pastoral()` pasa a `financePastoralManage()`;
- `approved()` pasa a `financeSummaryRead()`;
- `admin()` pasa a `settingsManage()`.

Ningún usuario existente pierde ni gana acceso financiero (18a §B.3). Los tests de reglas financieros existentes siguen sin cambios.

**Módulo inicial** (`finance | calendar`): el configurado si está permitido → el predeterminado según el perfil → el primer módulo permitido → la pantalla "Tu cuenta aún no tiene módulos asignados". Sin loops: lo prueba un test de propiedad sobre todos los perfiles × todas las rutas.

**Visibilidad de módulos:**
- Finanzas: `summary.read`;
- Calendario: `calendar.read`;
- Reportes: `details.read` o `calendar.read`;
- Configuración: `settings.manage`.

El Líder con `finance.summary.read` ve **exactamente lo que ve hoy** en Finanzas: el resumen agregado. Sin movimientos, sin diezmantes, y `DetailGuard` conserva su comportamiento.

## 4. Calendario

**Modelo (18a §C.3): hora de pared de America/Santiago.**
- `startDate`/`endDate` (`YYYY-MM-DD`), `startTime`/`endTime` (`HH:mm` o null), `allDay` y `lastDate` para consultas por rango.
- Es una **desviación deliberada** del nombre `startAt/endAt` del brief: un Timestamp corre 1 hora las series al cambiar el horario de Chile. El motor de recurrencia de PR #4 trabaja sobre fechas locales y está revisado.
- **Estados:** `scheduled`, `cancelled` (solo en eventos no recurrentes) y `archived`. "Realizada" es derivada.
- **Visibilidad:** `internal` ("Solo equipo") o `public`.
- **Nada se borra:** "Eliminar" archiva con motivo; "Cancelar" conserva la actividad visible con su motivo.

**Auditoría** en `calendarEvents/{id}/changes/r{revision}`:
- es atómica con el evento (mismo batch, enlazados con `revision`/`lastChangeId` y `getAfter`/`existsAfter`);
- acciones: `created`, `updated`, `cancelled`, `archived`, `recurrence_updated` y `visibility_changed`;
- `actorUid` y `at` los valida la regla;
- `internalNotes` solo aparece en `changedFields`, nunca con su valor.

**Permisos:**
- `calendar.read` ve el calendario interno.
- `manage_assigned` gestiona actividades cuya área responsable es una de sus áreas activas. Ser área participante **no** da edición.
- `manage_all` gestiona todo.
- **Publicar está separado de gestionar:** marcar una actividad como pública, o editar los campos públicos de una actividad ya pública, exige `publish_assigned` para esa área o `manage_all`. Se valida en la UI y en las reglas.
- Las actividades pasadas son de solo lectura para `manage_assigned`.

**Recurrencia V1** (motor puro de PR #4):
- `none`, `weekly`, `biweekly` y `monthly` por día de la semana (1.º–4.º o último), con `until` obligatorio, como máximo 12 meses y 60 ocurrencias.
- **Entra en V1:** crear una serie; editar la serie antes de que empiece; cancelar una ocurrencia (excepción con motivo); cancelar la serie desde una fecha.
- Una serie ya iniciada no cambia día, hora ni frecuencia.

**Rutas:** `/calendario` (Mes, Semana y Agenda; Agenda por defecto en móvil), `/calendario/mis-actividades` y `/calendario/compartir` (administración del enlace, solo `manage_all`).

## 5. Calendario público

- **Colección privada** `calendarShareLinks/public`: `{ tokenHash (SHA-256), active, createdAt, createdBy, regeneratedAt?, disabledAt?, rotation, updatedAt, updatedBy }`. El cliente no tiene ningún acceso: `read, write: if false`.
- **Callable `calendarShareLinkManage`** (solo `manage_all`): `status | create | regenerate | activate | deactivate`.
  - Genera 32 bytes aleatorios en base64url y guarda solo el hash.
  - El token en claro se devuelve **una sola vez** y nunca se persiste ni se loguea.
  - Regenerar invalida el anterior en el acto. Activar vuelve a habilitar el mismo enlace (§10, R4).
- **HTTP `calendarPublicFeed`**:
  1. recibe el token y calcula su hash;
  2. busca el enlace activo;
  3. lee solo eventos `public` no archivados y expande la recurrencia en el servidor;
  4. aplica `buildPublicCalendar()`/`toPublicEvent()`, una lista blanca **compartida** con el cliente desde `lib/shared`, compilada a `functions/shared` y verificada con un test de frescura y paridad.
  - Responde **404 idéntico** para un token inexistente, desactivado o mal formado.
  - Headers: `Cache-Control: private, max-age=60` (sin CDN, así revocar es inmediato), `no-referrer`, `noindex` y `nosniff`.
- **Página pública:** `app/calendario-publico/page.tsx`, estática y sin shell.
  - En Hosting, `/calendario/compartir/<token>` llega por rewrite a `/calendario-publico.html`. La página de administración `/calendario/compartir` es un archivo estático exacto y gana al rewrite.
  - En dev se usa `/calendario-publico?t=`.
  - El HTML prerenderizado no contiene datos.

## 6. Reportes y Configuración

- **Reportes:**
  - `/reportes` es un hub;
  - `/reportes/calendario` (`calendar.read`) tiene filtros de período, área, solo responsable, estado y visibilidad;
  - las columnas son fecha, hora, actividad, área responsable, participantes, lugar, estado y descripción pública;
  - el PDF productivo indica los filtros aplicados y no lleva "Vista previa", "Demo" ni datos sintéticos;
  - los reportes financieros siguen en `/finanzas/reportes`, sin cambios, enlazados desde el hub.
- **Configuración** (`settings.manage`):
  - **Áreas:** paleta cerrada de 10 colores, solo colores libres, activar y desactivar;
  - **Usuarios y permisos:** evoluciona el `UsersPermissionsPanel` y el `users-client` existentes, sin una segunda implementación. Conserva crear usuario, correo para definir contraseña, reenviar acceso y desactivar acceso, y agrega rol base, cargo, permisos (implicados marcados y deshabilitados; `settings.manage` solo vía rol base admin), áreas, módulo inicial y activo;
  - **Finanzas e integraciones** y **General** se mantienen.

## 7. Arquitectura del código

```
lib/shared/          TS puro, fuente única: types, access (cierre, fallback, módulos, home, planner de migración),
                     dates, recurrence, calendar-core, public-calendar, share-token-format
functions/shared/    CommonJS GENERADO por scripts/build-shared.mjs (commiteado; test de frescura y paridad;
                     el predeploy de Functions corre --check)
lib/access/          modelo de acceso del cliente, registro de módulos, guardia de rutas, intención de aterrizaje
lib/calendar/        áreas, permisos de eventos, auditoría, clientes Firestore/Functions, reporte, PDF
components/layout/   AppShell evolucionado (mismo export), RouteGuard, avisos, NoModules
components/calendar/ UI portada de PR #4 con CSS propio (sin fx-/sx-, sin fixtures ni simulación)
components/public-calendar/  presentacional, sin shell
components/reports/, components/settings/ (evolución del panel existente + áreas)
functions/calendar/  share-token, public-feed, share-links, firestore-store (inyectables y testeables)
scripts/             build-shared.mjs, migrate-access-v1.mjs, seed-platform-calendar-emulator.mjs, dev-platform.mjs
```

## 8. Emuladores y prueba local

- **`firebase.json`:**
  - agrega `emulators.functions` (127.0.0.1:5001);
  - rewrites `/api/calendario-publico` → `calendarPublicFeed` y `/calendario/compartir/**` → `/calendario-publico.html`;
  - headers de privacidad para la página pública;
  - `functions.predeploy` con `build-shared --check`.
- **Proyecto local:** `demo-cds-suite`. Los scripts se niegan a correr si el proyecto no empieza con `demo-` o si no están las variables del emulador.
- **Experiencia local:** un comando (`npm run dev:platform`) levanta Auth + Firestore + Functions, siembra los datos ficticios y arranca Next con `NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-cds-suite` y `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true`, sobrescribiendo `.env.local` sin modificarlo. También existen los pasos sueltos: `npm run emulators:platform`, `npm run seed:platform` y `npm run dev:emulators`.
- **Seed ficticio:** admin, pastor, finance, líder de Jóvenes, líder sin área, usuario inactivo y un líder con permiso de publicar; áreas; eventos, series, una actividad cancelada y una archivada; y un enlace compartido. Usa correos `@cds.test` (dominio reservado) y ningún teléfono.

## 9. Tests

Además de los gates (lint, typecheck, `npm test`, build), se agregan:

- **Unitarios:** cierre de permisos, fallback legacy, módulo inicial, módulos y rutas (propiedad sin loops), áreas, permisos de eventos (gestionar frente a publicar), recurrencia (fechas verificadas y cruces de DST en abril y septiembre de 2027), auditoría, proyección pública (claves exactas y canarios), PDF y navegación.
- **Código compartido:** frescura del CJS generado, paridad TS ↔ CJS y pureza.
- **Functions:** hash del token, generación, regeneración (el token anterior falla), activar y desactivar, autorización (`manage_all` con fallback), feed con 404 uniforme (deep equal de status, headers y body), sanitización con canarios, headers y CORS solo en el emulador. Se agrega el fallback de `requireFinanceUser`.
- **Migración:** planner puro y dry-run sobre el emulador (idempotente, nunca inventa áreas, nunca borra `role`).
- **Rules (`npm run test:rules`), con batería negativa:**
  - perfiles: admin, pastor, finance, leader sin área, leader con área, inactivo y calendar.read;
  - eventos: crear en área propia y ajena; editar propia y ajena; cambiar `responsibleAreaId` a un área ajena; editar como participante; publicar sin y con permiso; voltear la visibilidad en un update; archivar; cancelar; auditoría ajena o falsificada; cambiar `createdBy`/`createdAt`; borrar;
  - colecciones: `areas`, settings y `calendarShareLinks` (sin acceso);
  - escalada en `users`: un líder edita sus propios permisos, áreas o rol; IDOR sobre otro usuario; asignación masiva de campos.
  - Los tests de reglas financieros existentes corren sin cambios.
- **Smoke con emuladores:** feed real contra los emuladores de Functions y Firestore con el seed.

No se modifica ni se rebaja ningún test existente.

## 10. Conciliación del Conductor (manda sobre 18a y 18b)

| # | Tema | Atlas (18a) | Designer (18b) | Resolución |
|---|---|---|---|---|
| R1 | Navegación de Finanzas | `FinanceNav` intacta dentro del contenido; la sidebar lista módulos | Mover las secciones de Finanzas a la sidebar y retirar `FinanceNav` | **Atlas.** `tests/finance.test.tsx` fija el contrato de `FinanceNav` (6 links / 1 link), que no se puede modificar, y mover la navegación arriesga regresiones en pantallas productivas. Cada módulo tiene su subnav en el contenido (Finanzas, Calendario, Configuración), con el mismo estilo. La sidebar, el rail y la barra móvil muestran los módulos. Mover las secciones a la sidebar queda como siguiente slice |
| R2 | Reportes financieros | Se quedan en `/finanzas/reportes`; el hub `/reportes` enlaza | Mover a `/reportes/finanzas` con redirect | **Atlas.** Las URLs y los tests productivos se quedan iguales. El hub `/reportes` muestra Calendario y la tarjeta "Reportes financieros" (solo con `details.read`) |
| R3 | Configuración | Página existente + subnav con links a Áreas y Usuarios | Una ruta por sección | **Atlas** en las rutas (`/configuracion` existente + `/configuracion/areas` + `/configuracion/usuarios`) y **Designer** en el contenido de cada sección |
| R4 | Activar un enlace desactivado | Reactiva el **mismo** enlace | "Activar con un enlace nuevo" | **Atlas.** Desactivar es una pausa: el enlace ya impreso o compartido vuelve a funcionar al activarlo, y el administrador no necesita verlo. Para cortar un enlace filtrado está "Generar enlace nuevo". La copy lo explica |
| R5 | Fechas | `startDate/startTime…` + `lastDate` | — | **Atlas** (DST). Se documenta la desviación del brief |
| R6 | Aterrizaje `/` y `/login` | Conservar `replace("/finanzas")` (tests) + intención de aterrizaje en memoria | — | **Atlas** |
| R7 | Barra móvil | ≤4 módulos | `bottomTabs` por módulo con secciones | **Designer** en el layout: módulos permitidos (≤4) + "Más". Las secciones de cada módulo viven en su subnav del contenido (coherente con R1) |
| R8 | Comando local | — | — | **Conductor:** `npm run dev:platform` (un comando) y los pasos sueltos (§8). `npm run dev` no se cambia, para no alterar el flujo del equipo; la documentación advierte que usa `.env.local` |
| R9 | Preguntas de Atlas (18a §M) | — | — | Se aplican sus decisiones por defecto (Q1–Q15) y se listan en §11 para que Salvador las valide |
| R10 | Preguntas de Designer (18b §8.1) | — | — | El permiso de publicar es por área (`publish_assigned` sobre las áreas del usuario). Editar los campos públicos de una actividad ya pública sin permiso de publicar está **bloqueado**: el líder puede editar sus campos internos (notas) y cancelar o archivar según sus permisos de gestión, pero cambiar título, fecha, lugar o descripción pública de una actividad pública exige publicar (18a §D.4) |

## 11. Decisiones que Salvador debe validar

1. Fechas en hora de pared con `startDate/startTime` en vez de `startAt/endAt` (R5).
2. `calendar.read` lee también las áreas inactivas, que hacen falta para mostrar el nombre y el color de actividades antiguas.
3. El pastor migrado conserva `finance` como módulo inicial.
4. El reporte tiene las 8 columnas del brief; la visibilidad aparece como filtro aplicado.
5. El enlace se copia solo al crearlo o regenerarlo (Q5), y activar reutiliza el mismo enlace (R4).
6. Tests de aterrizaje: se usa una intención en memoria en vez de cambiar los tests.
7. "Mis actividades" aparece con áreas asignadas, aunque solo se lea.
8. Historial de cambios: lo ven `manage_all` y quien gestiona el área.
9. Rango público: desde el mes anterior hasta 6 meses adelante.
10. `requireFinanceUser` (SumUp) usa los permisos compartidos, con fallback equivalente.
11. Cargo: texto libre con presets que solo pre-llenan permisos.
12. La migración **no** otorga `publish_assigned` a nadie; se asigna a mano.
13. "Realizada" no se expone en el público.
14. La navegación de Finanzas se queda como subnav del contenido en V1 (R1).

## 12. Rollout y rollback

**Rollout** (misión futura, con aprobación humana en cada paso; resumen de 18a §L.2):
1. Merge revisado (y PR #1 desplegado antes o junto).
2. Backup con `gcloud firestore export`.
3. Índices.
4. Reglas con el fallback legacy activo.
5. Functions.
6. Hosting.
7. `migrate-access-v1.mjs` en dry-run sobre producción, revisado por Salvador; después `--apply` con confirmación explícita.
8. Verificación por usuario.
9. Crear áreas, asignar áreas y publicar.
10. Crear el enlace.
11. Retirar el fallback más adelante.

**Rollback:**
- releases anteriores de Hosting y de las reglas;
- kill switch del enlace (`active=false`);
- los datos son compatibles porque `role` se conserva y es coherente.

## 13. Plan de construcción

1. **Fase 1, en paralelo:**
   - (a) `lib/shared` + `build-shared` + `functions/shared` + Functions (`share-token`, `public-feed`, `share-links`, store, `index.js`) + `firebase.json` + sus tests;
   - (b) `firestore.rules` (helpers, renombre financiero, `users` v1, `areas`, `calendarEvents`, `changes`, `calendarShareLinks`) + índices + tests de reglas.
2. **Fase 2, en paralelo** con propiedad de archivos:
   - (a) acceso en el cliente + shell + `RouteGuard` + aterrizaje;
   - (b) clientes y UI del Calendario + Mis actividades + Compartir;
   - (c) Configuración (Áreas + Usuarios);
   - (d) Reportes + PDF + página pública.
3. **Fase 3:** migración + seed + `dev:platform` + smoke con emuladores.
4. **Validación:** emuladores, capturas, Designer (UX) y Atlas (seguridad), hasta 3 ciclos.
5. Gates, doc 19, PROJECT_CONTEXT, push y Draft PR. **Detenerse.**
