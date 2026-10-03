# 19 · Platform Core V1 + Calendario en producción: validación

> **NO DEPLOY · NO PRODUCTION DATA · EMULATOR VALIDATED.**
> Es código de producción validado solo con Firebase Emulator Suite y datos ficticios. No se desplegaron reglas, Functions, índices ni Hosting, y no se ejecutó la migración contra Firebase real.

**Fecha:** 2026-10-03
**Rama:** `mission/platform-core-calendar-v1`, desde `origin/mission/slice6-usability` @ `e6b2084` (PR #1)
**Especificación:** [18](18-platform-core-calendar-production-spec.md), con anexos [18a](18a-atlas-production-architecture.md) (Atlas) y [18b](18b-designer-production-ux-port.md) (Designer)

## 1. Estado inicial

| Chequeo | Resultado |
|---|---|
| Checkout | `~/Documents/Proyectos Desarrollo/Proyects/CDS/cds-suite`, árbol limpio |
| `origin/mission/slice6-usability` | `e6b2084`, igual a la local; 39 commits por delante de preproducción y 0 por detrás |
| PR #1 / #3 / #4 | #1 abierto, no draft, MERGEABLE. #3 y #4 son Drafts de preview. Ninguno se fusionó |
| Rama nueva | `mission/platform-core-calendar-v1` creada desde el remoto. merge-base `e6b2084` |
| Slice 3A | `mission/slice3a-sumup-fees` @ `6d67de5`, sin tocar |
| Hallazgo de entorno | **`.env.local` apunta al proyecto real `cds-administracion`.** Toda la validación se hizo con `npm run dev:platform`, que fuerza `demo-cds-suite` y los emuladores. El bundle de dev contiene `demo-cds-suite` y **ninguna** referencia al proyecto real |
| Herramientas | Java 21, firebase-tools 15.28.2, Node 24 (engines de Functions: 22; el emulador lo acepta con advertencia) |

## 2. Proceso

```
Preflight → Atlas (18a) ∥ Designer (18b) → doc 18 + conciliación (antes de implementar)
→ Fase 1: núcleo compartido + Functions ∥ Firestore Rules
→ Fase 2: acceso/shell ∥ Calendario ∥ Configuración ∥ Reportes/página pública
→ Fase 3: migración + seed + dev:platform + e2e con emuladores
→ Validación: capturas reales (login por perfil) → Designer UX ∥ Atlas seguridad → correcciones (3 fixers) → ciclo 2
→ Gates finales, doc 19, PROJECT_CONTEXT, push, Draft PR. Detenerse.
```

**Notas de proceso:**
- Dos agentes se detuvieron por inactividad (watchdog): Calendario y fase 3. Se retomaron sin pérdida. El de la fase 3 no había escrito nada todavía y rehízo su tarea.
- Las capturas usan Playwright con login real contra el emulador de Auth. La franja "Running in emulator mode" que inyecta el SDK de Auth se ocultó en las capturas.

## 3. Commits

| Commit | Qué |
|---|---|
| `a03aaf7` | docs: especificación (doc 18 + 18a + 18b) |
| `385db29` | `lib/shared` (acceso, fechas, recurrencia, proyección pública), `build-shared` → `functions/shared`, Functions del calendario público, `requireFinanceUser` por permisos |
| `eafdfe1` | Firestore Rules: permisos por módulo con fallback legacy, `users` v1, áreas, calendario auditado, enlaces privados; índice |
| `81e46f4` | Shell global, acceso en el cliente, guardia de rutas, aterrizaje, base de áreas |
| `920573b` | Módulo Calendario (vistas, gestión, publicación, enlace compartido) |
| `861d563` | Configuración › Áreas y Usuarios y permisos (evolución del panel existente) |
| `90614fa` | Reportes › Calendario + PDF y página pública |
| `30b52ec` | Migración de acceso v1, seed de emuladores, `dev:platform`, e2e |
| `184fc54` | Correcciones de seguridad (auditoría con valores verificados, sin mover actividades al pasado, área existente) |
| `8f20d0d` | Correcciones UX del Calendario, Reportes y página pública |
| `b61e5d9` | Correcciones UX del shell y Configuración |
| `102c32c` | Correcciones del ciclo 3 (visibilidad en texto en el reporte/PDF, orden de Configuración, `addedKeys` en el historial, nada publicado tras el corte de una serie, paridad del seed) |
| *(este doc)* | docs: validación, capturas y PROJECT_CONTEXT |

## 4. Arquitectura final

- **`lib/shared/`** (TS puro, fuente única):
  - `access` (catálogo, cierre, fallback legacy, módulos, módulo inicial, planner de migración);
  - `dates` (hora de pared de Santiago);
  - `recurrence` (V1);
  - `calendar-core`;
  - `public-calendar` (lista blanca `toPublicEvent`/`buildPublicCalendar`);
  - `share-token-format`.
  - Se compila a **`functions/shared/*.js`** (CommonJS commiteado) con `scripts/build-shared.mjs`. Un test de frescura y otro de paridad TS ↔ CJS lo protegen, y el `predeploy` de Functions corre `--check`.
- **Cliente:**
  - `lib/access/` (modelo de acceso, registro de módulos, guardia de rutas, intención de aterrizaje);
  - `lib/calendar/` (permisos de eventos, auditoría que replica las reglas, clientes Firestore/Functions, reporte y PDF);
  - `components/layout/` (AppShell evolucionado con el mismo export, RouteGuard, avisos, sin módulos);
  - `components/calendar/`, `components/reports/`, `components/settings/` y `components/public-calendar/`.
- **Rutas privadas:** `/calendario`, `/calendario/mis-actividades`, `/calendario/compartir`, `/reportes`, `/reportes/calendario`, `/configuracion` (General), `/configuracion/finanzas`, `/configuracion/areas`, `/configuracion/usuarios` e `/inicio`. Las rutas de Finanzas no cambian.
- **Página pública:** `/calendario-publico`, estática y sin shell. En Hosting, `/calendario/compartir/<token>` llega por rewrite a `/calendario-publico.html`. La página de administración `/calendario/compartir` es un archivo estático exacto y gana al rewrite.
- **Functions** (región `southamerica-west1`, inyectables y testeables):
  - `calendarPublicFeed` (HTTP GET);
  - `calendarShareLinkManage` (callable).

## 5. Modelo Firestore

| Colección | Forma | Acceso |
|---|---|---|
| `users/{uid}` | Legacy `{displayName,email,role,active,createdAt}` **o** v1: + `baseRole`, `position`, `permissions[]` (catálogo sin `settings.manage`, ≤8), `areaIds[]` (≤20), `homeModule` (finance\|calendar), `accessSchemaVersion: 1`, `updatedAt`, `updatedBy`. `role` se conserva siempre y es coherente (derivado) | Lectura: el propio doc o `settings.manage`. Escritura: solo `settings.manage`, con auto-protección |
| `areas/{slug}` | `name`, `slug` (inmutable), `color` (paleta cerrada de 10), `description`, `active` y auditoría | Lectura: `calendar.read` (incluye inactivas). Escritura: `settings.manage` |
| `calendarEvents/{id}` | Hora de pared de Santiago: `startDate/endDate/startTime/endTime/allDay`, `lastDate`, `title`, `responsibleAreaId`, `participantAreaIds[]`, `location`, `publicDescription`, `internalNotes`, `visibility` (internal\|public), `status` (scheduled\|cancelled\|archived), `recurrence`, `exceptions[]`, `seriesCancellation?`, `cancelReason?`, `archivedAt?`, `archiveReason?`, `revision`, `lastChangeId` y auditoría | Lectura: `calendar.read`. Escritura según §6. Sin borrado |
| `calendarEvents/{id}/changes/r{rev}` | `revision`, `action`, `scope?`, `occurrenceDate?`, `actorUid`, `at`, `changedFields`, `before`, `after`, `reason` | Solo creación, en el mismo batch que el evento. Lectura: `manage_all` o quien gestiona el área |
| `calendarShareLinks/public` | `tokenHash` (SHA-256), `active`, `createdAt/By`, `regeneratedAt/By?`, `disabledAt/By?`, `rotation`, `updatedAt/By` | **Ningún acceso desde el cliente.** Solo Functions/Admin SDK |

**Índice nuevo:** `calendarEvents (visibility ASC, lastDate ASC)`.

**Desviación documentada (18 §10 R5):** las horas del evento se guardan como hora de pared (`startDate/startTime`), no como `startAt/endAt` en Timestamp, para que las series no se corran con el cambio de horario de Chile.

## 6. Modelo de acceso y reglas

- **Helpers centrales:**
  - acceso: `isActive`, `legacyRole`, `legacyPermissions`, `permissions` (v1 si `accessSchemaVersion==1`; si no, el mapeo legacy), `can(p)` con listas de implicantes, `hasArea`;
  - calendario: `calendarRead`, `calendarManageAll`, `calendarManageAssigned(area)`, `publishAreaOf` (publicar por área);
  - otros: `settingsManage`, `financeSummaryRead`, `financeDetailsRead`, `financeRecordsManage`, `financePastoralManage`.
- **Equivalencia financiera:** las reglas de Finanzas solo cambian el nombre del helper (lecturas → DetailsRead, escrituras → RecordsManage, pastoral → PastoralManage, resumen → SummaryRead, admin → settingsManage). El resultado es el mismo para los 4 roles legacy: **los 22 tests de reglas existentes pasan sin cambios**, y hay una matriz de paridad v1 ↔ legacy.
- **Calendario:**
  - **gestión:** el área responsable debe ser una de las áreas activas del actor, antes **y** después del cambio. `manage_all` gestiona todo, pero el área responsable debe existir. El área participante no da edición. `manage_assigned` no puede mover el inicio al pasado ni editar el pasado. Una serie iniciada no cambia día, hora ni frecuencia;
  - **publicación:** pasar a pública, crear como pública o editar los campos públicos de una actividad pública exige `publish_assigned` en el área o `manage_all`. Despublicar, cancelar y archivar no lo exigen (R10);
  - **transiciones:** cancelar (solo eventos no recurrentes, motivo 3–300), excepción de una fecha, cancelación de serie desde hoy y archivar con motivo. **Sin borrado físico.**
- **Auditoría:** cada escritura de evento exige su `changes/r{rev}` en el mismo batch (`!exists` + `getAfter` + acción esperada), con `actorUid == auth.uid` y `at == request.time`.
  - `changedFields` debe ser igual al diff real.
  - `before`/`after` deben ser **exactamente** el estado real de los 13 campos auditados, o null si no cambian.
  - `internalNotes` nunca lleva su valor.
- **Límite de 1000 expresiones de Firestore:** la especificación literal lo superaba. Las reglas se reestructuraron sin cambiar el comportamiento:
  - fast-path `gate(...)` con listas verificadas contra `implicants()`/`legacyPermissions()` por un test estático;
  - las fechas se validan en el documento de auditoría, que es obligatorio en toda escritura.
  - El peor caso legítimo tiene test de presupuesto.

## 7. Functions

- **`calendarPublicFeed`** (GET `?t=`):
  - **Token:** se valida el formato (43 caracteres base64url), se calcula el SHA-256 y se busca un enlace activo.
  - **Datos:** se leen solo eventos `public` no archivados, se expande la recurrencia en el servidor y se aplica la lista blanca compartida.
  - **Qué se omite:** las ocurrencias cortadas por la cancelación de una serie (las excepciones de una fecha se muestran como "Cancelada" sin motivo).
  - **404 uniforme:** byte por byte igual (status, headers y cuerpo) para un token mal formado, inexistente o desactivado. Verificado en vivo contra el emulador.
  - **Headers:** `Cache-Control: private, max-age=60` (sin CDN), `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` y `X-Robots-Tag: noindex, nofollow`. CORS solo en el emulador.
  - **Logs:** nunca se loguea el token.
- **`calendarShareLinkManage`** (callable, solo `manage_all`, con fallback legacy y chequeo de cuenta activa):
  - acciones `status`, `create`, `regenerate`, `activate` y `deactivate`, en transacciones;
  - el token (32 bytes) se devuelve **una sola vez** y se guarda solo el hash;
  - regenerar invalida el anterior al instante, y activar rehabilita el **mismo** enlace (R4);
  - `status` incluye los nombres (nunca correos ni uids) de quien creó, regeneró o desactivó;
  - los errores son claves `share/*`, traducidas en el cliente.
- **`requireFinanceUser`** (SumUp) pasa a `can(userDoc, 'finance.records.manage')`. Es equivalente para los roles legacy, con test.

## 8. Migración

`scripts/migrate-access-v1.mjs`:
- **Modo por defecto:** dry-run.
- **Salida por usuario:** uid, nombre, correo enmascarado, rol anterior, estado, rol base, cargo, permisos guardados y efectivos, módulo inicial, `areaIds []` (nunca inventa áreas), avisos y el diff exacto.
- **`--apply`:** idempotente (salta los usuarios v1), conserva `role` y escribe en batches con precondición.
- **Interlocks:**
  - en el emulador solo acepta proyectos `demo-`;
  - en producción exige `--project` explícito y, para `--apply`, además `--confirm <id>`, `CDS_ALLOW_PRODUCTION_MIGRATION=<id>` y escribir el id en una TTY.

**En esta misión solo se ejecutó contra el emulador** (dry-run y `--apply`, verificados por e2e). El acceso financiero quedó igual antes y después, comprobado a través de las reglas.

## 9. Tests

| Gate | Base (`e6b2084`) | Final |
|---|---|---|
| `npm run lint` | ✓ | ✓ (0 warnings) |
| `npm run typecheck` | ✓ | ✓ |
| `npm test` / `npm run test` (vitest) | 174 | **768/768** (48 archivos) |
| `npm run test:rules` | 22/22 | **115/115** (los 22 existentes sin cambios + 93 nuevos) |
| `npm run test:emulator` (nuevo) | — | **15/15** (feed real, callable, migración y seed) |
| `node scripts/build-shared.mjs --check` | — | ✓ (7 archivos al día) |
| `npm run build` (×2) | ✓ | ✓ (todas las rutas nuevas estáticas; `out/calendario/compartir.html` y `out/calendario-publico.html` presentes; sin datos demo en `out/`) |

**Cobertura nueva, por pedido de la misión:**

| Tema | Tests |
|---|---|
| Migración dry-run | `tests/platform/migration-plan.test.ts`, `tests/emulator/migration.e2e.test.ts` |
| Compatibilidad legacy | `shared-access`, `finance-parity-client`, `require-finance-user`, `platform-access` (matriz de paridad de reglas) |
| Cierre de permisos | `shared-access`, `platform-access` |
| Módulo inicial | `shared-access`, `routes` (propiedad sin loops), `app-shell` |
| Áreas | `areas`, `platform-access` |
| Calendario | `calendar-permissions`, `calendar-screens`, `calendar-cycle1-ux`, `platform-calendar` |
| Recurrencia | `shared-dates-recurrence` (fechas verificadas y DST de abril y septiembre de 2027) |
| Auditoría | `calendar-audit`, `platform-calendar-audit` (valores reales; negativos con before/after falsos) |
| Proyección pública | `shared-public-calendar`, `public-calendar-page`, `calendar-feed.e2e` |
| Hash del token y regeneración | `calendar-share-token`, `calendar-share-links`, `calendar-feed.e2e` |
| Sanitización | canarios en notas, motivos, excepciones y series, en unit, Functions y e2e |
| PDF | `calendar-report-pdf` (layout igual al PDF real y sin textos de demo) |
| Navegación | `routes`, `route-coverage`, `app-shell`, `settings-layout` |
| Security rules | `platform-access`, `platform-calendar` y `platform-calendar-audit`, con batería negativa: escalada, IDOR, asignación masiva, área ajena, participante, publicar sin permiso, auditoría falsa, inactivo, enlaces privados |
| Aislamiento del código compartido | `shared-build`, `shared-parity`, `shared-purity` |

**Tests existentes:** `git diff --name-status e6b2084..HEAD -- tests` muestra solo archivos nuevos. **Ningún test previo a la misión se modificó.** Dentro de la misión, varios tests creados en ella ajustaron aserciones por cambios funcionales aprobados en la revisión, sin rebajar su fuerza:
- `app-shell` (sin "Más" en la barra móvil);
- `calendar-share-links` (claves de nombre en el estado);
- `migration.e2e` (usuario sin módulos sembrado);
- `platform-fixtures` (before/after reales);
- `settings-screens` (orden de la subnav);
- `shared-public-calendar` (sin excepciones tras el corte).

## 10. Revisión (Designer UX + Atlas seguridad)

| Ciclo | Designer (UX, capturas reales) | Atlas (seguridad y privacidad) |
|---|---|---|
| 1 | **PASS WITH FIXES.** 2 Alta: Fecha/Hora pegadas en el reporte, "Crear" sin acceso visible en móvil. 4 Media: barra móvil truncada, patrón de Configuración, pestaña Mis actividades sin áreas, alineación de Agenda. Además, estados inactivos sin ícono propio y Baja (targets, "por {nombre}", modal ancho, lang) | **PASS WITH FIXES.** Sin Crítico ni Alto. M1: valores de `before`/`after` del historial no verificados. B1: mover una actividad al pasado al editar. B4: área responsable inexistente con `manage_all`. Además: token en logs de plataforma (aceptado), costo del feed ante abuso, `storage.rules` por rol |
| 2 | **PASS WITH FIXES.** Los 13 hallazgos del ciclo 1 están resueltos y los estados pedidos se capturaron: Pública bloqueada, detalle propio, toast, permisos del editor, Quitar acceso, PDF, sin módulos, Mes público y Compartir desactivado. 1 Media: la visibilidad del reporte y del PDF solo se veía como ícono. Baja: orden de la subnav de Configuración, subnavs de una sola opción | **PASS.** M1, B1 y B4 cerrados, con tests negativos. Las rutas cliente pasan las reglas estrictas tal cual. El 404 en vivo es byte-idéntico en 4 variantes. Baja: claves extra en before/after, excepciones posteriores al corte de una serie, triple copia de la lista de auditoría, test del centinela de cargo |
| 3 | Corrección aplicada: la visibilidad aparece como texto en pantalla y en el PDF (sin agregar columnas). Subnav de Configuración reordenada. Verificado con capturas nuevas (09, 30, 32, 36, 26, 28) | Correcciones aplicadas: `addedKeys` en `changeValuesOk` (el hueco existía y quedó cubierto por un test negativo), nada publicado tras el corte de una serie, lista única de auditoría en el seed con test de paridad, test de "Otro cargo…" |

### 10.1 Cierre

- **Designer:** el ciclo 2 dejó como única Media la visibilidad en texto, corregida en el ciclo 3 y verificada en las capturas 09, 30, 32 y 36. Ningún criterio de 18b §6.2 queda en ✗. Algunos no son verificables con capturas (teclado, reduced motion, copy de errores de red) y quedan para la prueba humana.
- **Atlas:** **PASS** en seguridad y privacidad. Los residuales están documentados en §12.
- **Tests de la misión ajustados por cambios aprobados** (ninguno existía en `e6b2084`):
  - `settings-screens`: nuevo orden de la subnav;
  - `shared-public-calendar`: ya no se publican excepciones posteriores al corte de una serie.

## 11. Capturas

En [screens-platform-core-calendar/](screens-platform-core-calendar/): 48 imágenes de la ronda 3 (emuladores, login real, datos ficticios; las móviles a 1x) y las métricas.

| Pedido por la misión | Archivo |
|---|---|
| Admin Calendario desktop | `24-admin-calendario-1440.jpg` |
| Líder Calendario desktop | `01-lider-aterriza-calendario-1440.jpg`, `02-lider-calendario-mes-1440.jpg`, `03-lider-calendario-semana-1440.jpg` |
| Líder Calendario móvil | `10-lider-calendario-390.jpg` |
| Crear actividad | `05-lider-crear-actividad-1440.jpg`, `11-lider-crear-actividad-390.jpg`, `17-lider-form-publica-bloqueada-1440.jpg` |
| Actividad área ajena sin edición | `04-lider-actividad-ajena-1440.jpg` |
| Publicar actividad | `14-diacono-publicar-actividad-1440.jpg`, `19-diacono-toast-publicada-1440.jpg`, `15-diacono-form-publicable-1440.jpg`, `18-lider-detalle-propio-sin-publicar-1440.jpg` |
| Mis actividades | `06-lider-mis-actividades-1440.jpg`, `16-lider-sinarea-mis-actividades-1440.jpg` |
| Configuración áreas | `26-admin-configuracion-areas-1440.jpg`, `27-admin-area-editor-1440.jpg` |
| Configuración usuario | `28-admin-usuarios-1440.jpg`, `29-admin-usuario-editor-1440.jpg`, `34-admin-usuario-editor-permisos-1440.jpg`, `35-admin-quitar-acceso-1440.jpg`, `33-admin-usuarios-390.jpg` |
| Reporte calendario | `09-lider-reporte-calendario-1440.jpg`, `30-admin-reporte-calendario-1440.jpg`, `32-admin-reporte-calendario-390.jpg`, `36-admin-pdf-reporte-pagina1.jpg` |
| Calendario público desktop | `50-publico-1440.jpg`, `54-publico-mes-1440.jpg` |
| Calendario público móvil | `51-publico-390.jpg`, `53-publico-375-detalle.jpg`, `55-publico-no-disponible-390.jpg` |
| Resumen Finanzas Líder | `07-lider-resumen-finanzas-1440.jpg` |
| Finanzas Admin | `21-admin-finanzas-1440.jpg`, `22-admin-finanzas-1024.jpg`, `23-admin-finanzas-390.jpg` |
| Extra: acceso | `08-lider-sin-acceso-configuracion-1440.jpg`, `45-inactivo-1440.jpg`, `46-sin-modulos-1440.jpg`, `20/40/60-*-aterriza-1440.jpg` |
| Extra: compartir | `61-pastor-compartir-activo-1440.jpg`, `62-pastor-compartir-recien-generado-1440.jpg`, `63-pastor-compartir-desactivado-1440.jpg` |

**Aterrizaje verificado tras el login real:**
- Líder → `/calendario`;
- Admin, Finanzas y Pastor → `/finanzas` (Pastor por la decisión Q3);
- usuario sin módulos → pantalla "Aún no tienes módulos asignados";
- inactivo → pantalla de acceso no autorizado (flujo existente).

## 12. Riesgos residuales

1. **Token en logs de plataforma** (Cloud Run registra la query `?t=`; Hosting registra la ruta si su logging está activo) y en el historial del navegador. La app nunca lo loguea, y la página usa `no-referrer` y `noindex`. **Mitigación futura:** enviar el token al feed por header o POST.
2. **Caché del navegador:** hasta 60 s después de desactivar o regenerar el enlace.
3. **"Activar" revive el mismo enlace:** si se filtró, hay que regenerarlo.
4. **`internalNotes`** lo ven todos los que tienen `calendar.read`, incluido el rol legacy `finance`. La UI advierte "No escribas datos personales".
5. **Campos del historial que declara el cliente:** solo el formato de `reason`, `scope` y `occurrenceDate`. Los valores de los 13 campos auditados sí se verifican, sin claves extra.
6. **`storage.rules` sigue por rol.** Falla hacia denegar para usuarios v1 con detalle financiero sin `records.manage`. Hay que migrarlo en otra misión.
7. **Costo del feed ante abuso** (lectura de todos los eventos públicos por request; `maxInstances: 5`). **Mitigación futura:** caché en memoria por `rotation`.
8. **"Hoy" en las reglas** usa UTC−4 fijo: hay 1 h de holgura con horario de verano.
9. **Caveat de rollback:** un usuario v1 sin permisos financieros queda con `role: leader`, que vería el resumen si se vuelven a desplegar las reglas legacy.
10. **El `--json` de la migración** contiene nombres reales: es un archivo sensible.
11. **Dependencia de PR #1:** esta rama se apoya en Financial Core 2026, que tampoco está desplegado.

## 13. Pendientes

- **Siguiente slice de recurrencia:** "editar solo esta", "esta y las siguientes", "mismo día N".
- **Finanzas en la sidebar:** mover las secciones de Finanzas a la sidebar (hoy son subnav en el contenido, R1).
- **Permisos financieros finos:** botones de registro con `records.manage` en vez de `details.read`.
- **Storage:** migrar `storage.rules` al mismo modelo de permisos.
- **Feed:** token por header o POST, y caché en memoria.
- **Reglas:** existencia de las áreas participantes; ligar `reason`/`occurrenceDate` del historial a los campos reales.
- **Branding:** unificar "CDS Administración" → "CDS Suite" en login y en la pantalla de cuenta inactiva.
- **Fallback legacy:** retirarlo tras la migración en producción.
- **Fuera de alcance, por la misión:** Integrantes/Consolidación backend, colección `people`, fe, bautismo, menores y WhatsApp.

## 14. Cómo probar (emuladores, sin Firebase real)

```bash
cd ~/Documents/Proyectos\ Desarrollo/Proyects/CDS/cds-suite
git switch mission/platform-core-calendar-v1
npm ci
npm --prefix functions ci
npm run dev:platform
```

`dev:platform` levanta Auth + Firestore + Functions con el proyecto `demo-cds-suite`, siembra los datos ficticios, imprime **una vez** la URL del calendario público (`http://localhost:3000/calendario-publico?t=…`) y arranca Next en http://localhost:3000. Ctrl+C lo detiene todo. **No uses `npm run dev` a secas:** usa `.env.local`, que apunta al proyecto real.

**Cuentas ficticias** (contraseña `PruebaCDS2026!`):

| Cuenta | Perfil | Qué probar |
|---|---|---|
| `admin@cds.test` | Admin (doc legacy: prueba el fallback) | Finanzas completo, Calendario, Configuración › Áreas y Usuarios, Compartir |
| `pastor@cds.test` | Pastor v1 (`manage_all`) | Gestionar y publicar todo, Compartir (generar, desactivar, activar) |
| `finanzas@cds.test` | Finanzas (doc legacy) | Finanzas con movimientos, Calendario en lectura |
| `lider.jovenes@cds.test` | Líder v1 (Jóvenes, sin publicar) | Entra a Calendario; crea "Solo equipo" en Jóvenes; "Pública" bloqueada; actividad ajena sin edición; resumen financiero |
| `diacono.publica@cds.test` | Diácono v1 (Multimedia y Varones, con publicar) | Publicar y dejar de publicar actividades de sus áreas |
| `lider.sinarea@cds.test` | Líder v1 sin áreas | Mis actividades vacío ("Aún no tienes áreas asignadas") |
| `sinmodulos@cds.test` | v1 activo sin permisos | "Aún no tienes módulos asignados" |
| `inactivo@cds.test` | Inactivo | Acceso no autorizado |

**Pasos sueltos:**

```bash
npm run emulators:platform
```

```bash
npm run seed:platform
```

```bash
npm run dev:emulators
```

```bash
npm run migrate:access:dry
```

**Tests con emuladores:**

```bash
npm run test:rules
```

```bash
npm run test:emulator
```

## 15. Rollout propuesto (misión futura, con aprobación humana en cada paso)

1. Revisión y merge de este PR (y el destino de PR #1 resuelto: desplegarlo antes o junto).
2. Confirmar qué reglas y Functions corren hoy en producción.
3. Backup con `gcloud firestore export`.
4. `firebase deploy --only firestore:indexes` y esperar a que estén `READY`.
5. Deploy de **reglas** con el fallback legacy activo (nada cambia para los usuarios actuales).
6. Deploy de **Functions** (`calendarPublicFeed`, `calendarShareLinkManage`, `requireFinanceUser` ajustado). El `predeploy` verifica `functions/shared`. Sin enlace creado, el feed responde 404 a todos.
7. Deploy de **Hosting** (shell, calendario, página pública, rewrites y headers).
8. `node scripts/migrate-access-v1.mjs --project cds-administracion` en **dry-run**; Salvador revisa la salida.
9. Con aprobación explícita: `--apply --confirm cds-administracion` con `CDS_ALLOW_PRODUCTION_MIGRATION` en una TTY.
10. Verificar por usuario que entra al módulo esperado y ve las mismas finanzas; revisar las denegaciones de reglas.
11. Crear las áreas, asignar áreas a los líderes y otorgar `publish_assigned` donde corresponda.
12. Crear el enlace público y compartirlo.
13. Tras ≥2 semanas estables y con el 100% de los docs en v1, retirar el fallback legacy.

## 16. Rollback propuesto

- **Hosting:** volver al release anterior desde el historial de Hosting.
- **Reglas:** volver a desplegar el `firestore.rules` previo.
  - `role` se conserva y es coherente, así que los docs v1 siguen funcionando en lectura.
  - Las colecciones nuevas quedan inaccesibles por el catch-all, sin pérdida de datos.
  - Caveat del riesgo 9.
- **Functions:** kill switch `calendarShareLinks/public.active=false` desde la consola, o eliminar las dos funciones nuevas.
- **Datos:** la migración no requiere reversa, porque las reglas legacy ignoran los campos v1.

## 17. Qué NO se hizo

- **Sin deploy:** ni `firebase deploy`, ni canales, ni cambios en Hosting, Firestore, Functions, Storage ni Authentication reales.
- **Sin datos reales:** no se escribió ninguno ni se ejecutó la migración contra producción. Todo usó `demo-cds-suite`, con correos `@cds.test` (dominio reservado) y sin teléfonos.
- **Sin merges:** no se mergeó PR #1, #3 ni #4, y la default branch no cambió.
- **Fuera de alcance:** sin backend de Integrantes/Consolidación, sin colección `people`, sin fe, bautismo ni menores, sin WhatsApp ni Brother. Slice 3A no se tocó.
