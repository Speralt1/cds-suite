# 20 · Platform + Calendar RC1: preparación para el deploy

> **NO DEPLOY · NO MERGE · NO MIGRACIÓN REAL · NADA ESCRITO EN FIREBASE REAL.**
> Este documento deja PR #1 + PR #5 como Release Candidate y escribe el runbook del rollout. **No autoriza a desplegar.** El rollout es otra misión y requiere la aprobación explícita de Salvador en cada fase.

> **Actualización R1/R4 (2026-10-08) — baseline post-CASH / post-R0G.** Producción ya no es `e6b2084`/`648afd1`: la rama productiva es `feature/preproduccion-mobile-v1` @ **`a312c96`** (Etapa A `0d1bb0d` + SumUp CASH `ee33aa9` + recuperación del Hosting 05/10 `06301ae` + PR #11 seguridad del modal de efectivo), desplegada como **Hosting `3d1dc8bc8d1bcc29`**, Rules `2d9939ab-2a9e-491e-b176-1cafd939e568`, Functions `campaignshare-00002-dij`, `sumupsyncnow-00007-wut`, `sumupsyncscheduled-00008-nek`. Baseline financiero vigente: **A9 post-CASH** (`~/cds-ops/baseline-a9.json`); los valores de A0 / §4 quedan solo como evidencia histórica pre-CASH. PR #5 integró ese baseline con el merge `be5ebb1` (ver §19). La Etapa B (§13) y el rollback (§14) quedaron actualizados: **Functions solo por nombre** y **nunca** redeploy de las funciones SumUp desde un checkout anterior.

**Fecha:** 2026-10-03
**Rama:** `mission/platform-core-calendar-v1` (PR #5). Último commit con código: `aed6f7d`. Los commits posteriores son solo de documentación.
**Docs previos:** [10](10-implementation-plan.md) (checklist de PR #1), [18](18-platform-core-calendar-production-spec.md) + [18a](18a-atlas-production-architecture.md) + [18b](18b-designer-production-ux-port.md), [19](19-platform-core-calendar-validation.md).

## 0. Resumen

| Tema | Resultado |
|---|---|
| Estrategia | **Opción A:** primero PR #1 solo (Etapa A), observación, después PR #5 (Etapa B). §2 |
| Rama RC | **No se creó** `release/platform-calendar-rc1`: sería redundante. RC1 = cabeza de PR #5; la Etapa A = `e6b2084`. §3 |
| Producción hoy | `648afd1` (preproducción), desplegado el 2026-09-11. Las reglas de Firestore coinciden byte a byte. §4 |
| Token público | **Endurecido e implementado:** `/calendario-publico#<token>` + POST. Ya no llega a ningún log. §5 |
| Storage | No lo usa Calendar. Falla hacia denegar, sin escalada. **DEFERRED.** §6 |
| PR #1 | Gates verdes. Quedan 2 condiciones previas para la Fase A0: la consulta `feeAmount` y la decisión sobre la alerta. §7 |
| Integración | Gates completos verdes sobre una copia limpia del commit RC. §8 |
| Dry-run de producción | 4 usuarios, 4 por migrar, 0 advertencias. Solo se imprimieron conteos. §9 |
| Veredicto | **GO FOR CONTROLLED DEPLOYMENT**, con las condiciones previas de la Fase 0. No es una autorización para desplegar. §15 |

## 1. Topología Git (verificada con `git fetch`, 2026-10-03)

```
feature/base-cds-suite              084bd4d  (default de GitHub; +6 commits de CI/Project Control que no se despliegan)
        ·
feature/preproduccion-mobile-v1     648afd1  ← lo que corre en producción (§4)
        │ +39
mission/slice6-usability            e6b2084  ← PR #1 (abierto, no draft, MERGEABLE) → base: preproducción
        │ +15
mission/platform-core-calendar-v1   aed6f7d+ ← PR #5 (Draft, MERGEABLE) → base: slice6-usability
```

| Chequeo | Resultado |
|---|---|
| `mission/slice6-usability` frente a preproducción | 39 por delante, **0 por detrás**; merge-base `648afd1` |
| PR #5 frente a `slice6-usability` | 15 por delante, **0 por detrás**; merge-base `e6b2084` |
| Commits exclusivos de `feature/base-cds-suite` | Solo `.github/workflows`, sin efecto en el deploy |
| PR #3 / PR #4 (previews) | **No** son ancestros de PR #5 |
| Slice 3A (`6d67de5`) | **No** es ancestro de PR #5. Ninguno de sus 26 archivos propios aparece en el RC con su contenido (verificado blob por blob) |
| Local frente a remoto | En sincronía antes de esta misión. Esta misión solo agrega commits a `mission/platform-core-calendar-v1` |

## 2. Estrategia de release

**Decisión: Opción A, en dos etapas.**

| | A. PR #1 → producción → PR #5 | B. Release integrada |
|---|---|---|
| Riesgo por deploy | Separa el motor SumUp (dinero) del modelo de acceso (permisos) | Mezcla los dos. Ante un fallo, cuesta saber cuál fue |
| Validación | La de PR #1 (totales de septiembre, runs de sync) se hace sola, sin ruido del calendario | Se mezcla con el smoke del calendario |
| Rollback | **[HISTÓRICO — NO USAR: anterior a SumUp CASH/R0G]** Hay tres puntos limpios: `648afd1` ← `e6b2084` ← RC1. Cada uno es un árbol probado | Un único salto `648afd1` ↔ RC1 que revierte también lo de SumUp |
| Costo | Dos ventanas de deploy y una semana de observación entre ellas | Una ventana |

La opción A tiene el menor riesgo operacional y el rollback más claro, que es lo que pide la misión.

**Flujo Git (lo hace Salvador; esta misión no mergea nada):**
1. **Etapa A:** mergear PR #1 en `feature/preproduccion-mobile-v1`. Como preproducción tiene 0 commits propios, el árbol resultante es idéntico a `e6b2084`. Desplegar desde ese commit.
2. Observar al menos 7 días, incluido al menos un domingo de culto (el día con más SumUp).
3. **Etapa B:** cambiar la base de PR #5 a `feature/preproduccion-mobile-v1` (GitHub no lo hace solo si `slice6-usability` no se borra) y sacarlo de Draft. Mergear. El árbol resultante es idéntico a la cabeza de PR #5. Desplegar desde ese commit.
4. **No** cambiar la default branch ni tocar Slice 3A, PR #3 ni PR #4.

## 3. Rama RC

**`release/platform-calendar-rc1` no se creó.** Después de analizar la topología:
- PR #5 ya contiene exactamente PR #1 + Platform + Calendar, sin nada más (0 por detrás de `slice6-usability`, sin previews ni Slice 3A).
- La Etapa A despliega `e6b2084`, que ya existe como cabeza de PR #1.
- Una rama extra sería una tercera copia del mismo árbol que habría que mantener sincronizada. No agrega seguridad.

**Definición de RC1:** la cabeza de `mission/platform-core-calendar-v1` al cerrar esta misión. Antes de desplegar la Etapa B hay que comprobar que el árbol que se va a desplegar coincide con ella:

```bash
git diff --stat <commit-a-desplegar> origin/mission/platform-core-calendar-v1
```

Con la salida vacía, se puede seguir.

## 4. Estado desplegado hoy (snapshot de solo lectura, 2026-10-03)

Se obtuvo con `firebase functions:list`, `firebase firestore:indexes`, `gcloud` y lecturas GET a las APIs de Rules y Hosting. **No se modificó nada.** No se leyó ningún documento financiero ni personal; solo hubo el dry-run agregado del §9.

| Componente | Estado | Coincide con |
|---|---|---|
| **Firestore Rules** | Ruleset `8d0087d6-b9a3-4c68-8649-d2fb3744c51f`, publicado el 2026-09-09 16:26 UTC | **Byte a byte** con `firestore.rules` de `648afd1` |
| **Storage Rules** | Ruleset `f700d246-6faf-4574-a5cc-047d2b30c2bc`, del 2026-09-09 17:32 UTC | **Idéntico** a `storage.rules` del RC: el release no lo cambia |
| **Hosting** | Sitio `cds-administracion`, versión live `f4591416f0474b0f` (release del 2026-09-11 13:01 UTC), 132 archivos. Rewrites `/api/sumup-sync`, `/c/**` y `/campanas/**`; 2 bloques de headers; `cleanUrls` | `648afd1` (commit de las 10:00 −03; el deploy fue a las 10:01 −03) |
| **Functions** | `sumupSyncNow` (west1, 2026-09-11), `sumupSyncScheduled` (**east1**, 2026-09-11, cada 60 min) y `campaignShare` (west1, 2026-09-09). nodejs22, v2 | `648afd1`. Las regiones coinciden con el código del RC, incluido `southamerica-east1` del scheduler |
| **Índices** | 5 compuestos, equivalentes a los 5 de `firestore.indexes.json` (la API agrega `__name__`) | El RC agrega **uno**: `calendarEvents (visibility, lastDate)` |
| **Firestore** | `(default)`, `southamerica-west1`, Native. **PITR desactivado, sin protección contra borrado y sin backups programados** | — |
| **Buckets** | Solo el de Storage y los de código de Functions. **No hay bucket de backups** | — |
| **Cloud Scheduler** | `firebase-schedule-sumupSyncScheduled-southamerica-east1`, ENABLED; último intento hoy | — |
| **Salud** | 0 errores (severity ≥ ERROR) en Cloud Run/Functions desde el 2026-09-26. Las últimas 30 ejecuciones programadas respondieron 200 | — |
| **Monitoring** | **0 políticas de alerta y 0 canales de notificación** | El checklist de PR #1 (doc 10 §4.5) pide una alerta que todavía no existe |
| **Auth** | Correo/contraseña habilitado; 4 dominios autorizados | — |
| **Usuarios (`users`)** | 4: 1 admin y 3 pastor, todos legacy y activos (§9) | — |

## 5. Endurecimiento del token público (implementado)

**Problema (doc 19 §12.1):** el enlace era `/calendario/compartir/<token>` y la página pedía `GET /api/calendario-publico?t=<token>`. Por eso el token quedaba en los logs de solicitudes de Cloud Run (la query) y de Hosting (la ruta).

**Arquitectura nueva** (commit `894e79f`):

```
Enlace compartido:  https://cds-administracion.web.app/calendario-publico#<token>
                    └─ el fragmento (#…) no viaja al servidor ni en el Referer
Página (estática):  lee location.hash → ref en memoria → POST /api/calendario-publico
                    body: {"token":"<token>"}   credentials: omit · cache: no-store · referrerPolicy: no-referrer
Hosting rewrite:    /api/calendario-publico → calendarPublicFeed (sin cambios)
Function:           solo POST · token solo del cuerpo JSON · nunca lee la query
```

**Por qué se usó `/calendario-publico#` y no `/calendario/compartir/#`:** con `cleanUrls` y `trailingSlash: false`, `/calendario/compartir/` redirige a `/calendario/compartir`, que es la página de **administración** (detrás de RouteGuard). Un visitante anónimo terminaría en el login. `/calendario-publico` ya es la página pública estática y no necesita rewrite.

**Cambios:**
- `functions/calendar/public-feed.js`:
  - acepta solo `POST`; cualquier otro método recibe `405` con `Allow: POST`, aunque traiga `?t=`;
  - `tokenFromBody` acepta solo un objeto JSON `{token}` (un string, un Buffer o un arreglo se tratan como inválidos);
  - el 404 es el mismo de antes, idéntico para token ausente, mal formado, inexistente o desactivado;
  - **`Cache-Control: no-store` en toda respuesta**, lo que cierra también el riesgo de los 60 s de caché (doc 19 §12.2).
- `lib/calendar/public-feed-client.ts`: `publicCalendarUrl` arma `/calendario-publico#<t>` (igual en desarrollo y en producción), `shareTokenFromLocation` lee solo el `hash` y `fetchPublicCalendar` hace el POST.
- `app/calendario-publico/public-calendar-route.tsx`: el token vive en un `ref`. Si se pega otro enlace en la misma pestaña, `hashchange` lo vuelve a leer.
- `firebase.json`: se eliminaron el rewrite `/calendario/compartir/**` → `/calendario-publico.html` y su bloque de headers. Nunca se desplegaron, así que no existen enlaces con ese formato.
- Seed, `dev:platform` y tests pasan al contrato nuevo. El emulador acepta CORS para POST.

**Requisitos de la misión:**

| Requisito | Cómo se cumple | Evidencia |
|---|---|---|
| Nuestra app nunca loguea el token | Los logs solo llevan `{ok}`/`{ok,count}`, y en los errores `scrub` reemplaza token y hash | `calendar-public-feed.test.ts` (logs espiados en 200, 404, regeneración y 500) |
| Respuesta uniforme para inválido o desactivado | 404 idéntico en status, headers y cuerpo | Unit: 15 variantes, incluidas formas de cuerpo y `?t=`. E2E: 6 variantes contra el emulador |
| No está en el HTML | La página prerenderizada es solo el skeleton | `public-calendar-page.test.tsx` revisa el `outerHTML` del documento |
| No sale por el Referer | Un fragmento nunca va en el Referer; además la página, la respuesta y el fetch usan `no-referrer` | Headers de `firebase.json` y de la Function, y metadata de la página |
| No se guarda en localStorage ni en cookies | Solo `useRef` | Test que revisa localStorage, sessionStorage y `document.cookie` |
| Fuera de la analítica | No existe analítica (sin `getAnalytics` ni scripts de terceros). `public/sw.js` solo deja pasar GET, no cachea y no intercepta el POST | Revisión de Atlas |
| El enlace sigue siendo compartible | Es una URL normal que se puede guardar en favoritos | `publicCalendarUrl` |
| Regenerar y desactivar siguen funcionando | Sin cambios en `share-links.js`. Con `no-store`, el corte es inmediato | E2E: desactivar → 404, activar → 200 con el mismo enlace, regenerar → el anterior da 404 |
| E2E real en el emulador | `calendar-feed.e2e.test.ts`, con un caso nuevo: el token en la query nunca se acepta (GET → 405; POST con `?t=` y sin cuerpo → el mismo 404) | `npm run test:emulator` |

**Lo que queda (aceptado):**
- **Historial del navegador:** el fragmento queda en el historial y en la sincronización del navegador del visitante, como pasaba con la ruta. No se borra con `replaceState` a propósito, para no romper los favoritos. Es local al dispositivo.
- **JSON mal formado enviado a mano** (no por nuestro cliente): el framework responde 400 antes del handler y *podría* loguear un fragmento del cuerpo (hipótesis de Atlas, Bajo). Para eso alguien tendría que fabricar la petición con el token en la mano.
- Un cuerpo `x-www-form-urlencoded` (`token=…`) también se acepta. Sigue siendo cuerpo, no URL, así que no tiene impacto.

**Veredicto de Atlas:** PASS. Tiene estrictamente menos riesgo que el diseño anterior y no deja bloqueantes.

## 6. Auditoría de Storage

`storage.rules` (idéntico en producción y en el RC) da acceso a `tithe-receipts` y `campaign-receipts` con `financeTeam()`: `users/{uid}.active == true && role in ['admin','pastor','finance']`.

| Pregunta | Respuesta |
|---|---|
| ¿Afecta a Platform/Calendar V1? | **No.** Calendario, Configuración, Reportes y la página pública no importan Storage. Lo usan solo Finanzas (formulario de movimiento, ficha de diezmos, vista de comprobante) y Campañas |
| ¿Puede un usuario v1 ver un comportamiento inconsistente? | **Sí, en un caso.** Un v1 con `finance.details.read` (o `pastoral.manage`) sin `records.manage` recibe el rol derivado `leader`. Firestore le deja leer los movimientos, pero Storage le niega el comprobante. Es un problema de UX (Medio), no de seguridad. **Hoy no existe ese perfil** (3 pastor + 1 admin) |
| ¿Hay escalada de privilegios? | **No.** Para documentos v1, las reglas exigen `role == deriveLegacyRole(baseRole, permissions)` (firestore.rules:131-145) y solo `settings.manage` escribe en `users`. Entonces `role ∈ {admin,pastor,finance}` equivale a admin o `records.manage`, que es exactamente quien también escribe esos datos en Firestore. Storage nunca da más que Firestore |
| ¿Falla hacia denegar o hacia permitir? | **Hacia denegar** |
| ¿Bloquea el release? | **No. DEFERRED**, para la misión que migre `storage.rules` al modelo de permisos |

La coherencia de `role` solo se rompe con una edición manual en la consola o con Admin SDK. `--summary` ahora la detecta ("v1 con role incoherente", commit `aed6f7d`).

## 7. PR #1: revisión previa al deploy

**Código y gates:** sobre una copia limpia de `e6b2084`:
- `npm ci` ✓, `npm --prefix functions ci` ✓;
- lint ✓, typecheck ✓;
- vitest **174/174**, `test:rules` **22/22**;
- build ✓ (15 rutas);
- `node --check` de todas las Functions ✓.

**Checklist original (doc 10 §4), revisado:**

| # | Ítem | Estado hoy | Qué se hace |
|---|---|---|---|
| 1–3 | Rules, gates y build | ✓ (arriba) | — |
| 4 | **Consulta previa `feeAmount > 0`** (se espera 0) | **PENDIENTE.** La lectura de solo lectura se intentó desde esta sesión y el control de seguridad la bloqueó (lee datos financieros reales). No se reintentó | **Fase A0:** Salvador la corre (consulta de conteo, §13). Si da >0, **STOP** |
| 5 | **Alerta de Cloud Monitoring** sobre errores de `sumupsyncscheduled` | **No existe** (0 políticas, 0 canales) | **Fase A0:** Salvador decide entre crearla (revisar el costo vigente de alerting) o aceptar la revisión manual diaria del §12. Esta misión no crea recursos |
| 6 | Deploy | — | Se divide en rules → functions → hosting, con verificación entre cada paso (§13, Etapa A) |
| 7 | Validación posterior | — | Igual que el doc 10 §4.7. Los totales de septiembre de referencia se vuelven a anotar desde la app en A0, por si cambiaron |
| 8 | "1 de octubre: el resumen `2026-10` tiene 9 campos" | **Desactualizado**: octubre ya empezó con el código viejo | Se cambia por: el resumen `2026-10` se ve completo tras el primer run y el próximo cambio de mes (1 de noviembre) se verifica |
| 9 | Rollback a `648afd1` | **[HISTÓRICO — NO USAR: anterior a SumUp CASH/R0G]** Era vigente el 2026-10-03; hoy revertiría SumUp CASH y R0G. Objetivos válidos: §14 | — |

**Otros puntos sensibles de PR #1:**
- **Functions:** `sumupSyncNow` y `sumupSyncScheduled` cambian de motor (Slice 1). Mantienen la región, los secretos y el horario.
- **Reglas:** `financeTransactions/sumup_*` pasa a backend-only (G3). El cliente actual (`648afd1`) ¿escribe `sumup_*`? Slice 1b ya dejó SumUp en solo lectura en la UI. Se verifica en el smoke A3 con un sync manual y el registro normal de movimientos.
- **Datos nuevos aditivos** (`sumupSyncRuns`, `versions`, `adjustments`): el código viejo los ignora, así que el rollback no necesita tocar datos.

**Conclusión:** PR #1 está **listo en código**. El deploy de la Etapa A queda condicionado a los ítems 4 y 5 de la Fase A0.

## 8. Integración PR #1 + PR #5 (composición exacta)

La composición desplegable de la Etapa B es la cabeza de PR #5, que contiene PR #1 completo (0 por detrás). Se exportó con `git archive` a un directorio limpio, sin `node_modules` ni `.env.local`, con variables de build de relleno (`rc1-build-check`), y se corrió:

| Gate | Etapa A (`e6b2084`) | RC1 (`f3403cd`*) |
|---|---|---|
| `npm ci` | ✓ | ✓ |
| `npm --prefix functions ci` | ✓ | ✓ |
| `npm run lint` | ✓ | ✓ (0 warnings) |
| `npm run typecheck` | ✓ | ✓ |
| `npm test` | 174/174 | **779/779** |
| `npm run test` (2 veces) | — | 779/779 · 779/779 |
| `npm run build` | ✓ 15 rutas | ✓ 24 rutas, todas estáticas |
| `node scripts/build-shared.mjs --check` | n/a | ✓ |
| `npm run test:rules` | 22/22 | **115/115** (los 22 de PR #1 sin cambios) |
| `npm run test:emulator` | n/a | **18/18** (antes 15: +1 del token en la query, +2 de `--summary`) |
| `node --check` de Functions | ✓ | ✓ |

\* `aed6f7d` agrega un test unitario y una aserción e2e sobre `f3403cd`. Los gates finales sobre la cabeza de la rama están en §17.

**Verificaciones de contenido:**
- **Tests financieros existentes:** pasan los 22 de reglas de PR #1 y todos los de vitest de `e6b2084`. `git diff --name-status e6b2084..HEAD -- tests` sigue mostrando solo archivos nuevos o tests creados en PR #5.
- **SumUp:** pasan los tests de motor, núcleo y store de Slice 1; `requireFinanceUser` tiene paridad con los roles legacy.
- **Platform/Calendar:** acceso, rutas, calendario, auditoría, recurrencia, proyección pública y PDF verdes.
- **Previews fuera del build:** `out/` no tiene rutas `preview` ni `integrantes`, ni rastros de datos demo (`demo-cds-suite`, `@cds.test`, `PruebaCDS`).
- **Slice 3A fuera:** no es ancestro, y sus archivos propios (`payouts-core.js`, `sumup-settlement.ts`, etc.) no están en el RC.
- **Dependencias:** `functions/package.json` no cambia entre producción y el RC.

## 9. Migración: dry-run de producción (solo lectura)

**Antes de correrlo:**
- Se verificó en el código que sin `--apply` no se llama a `batch`/`commit`; solo hay `get()`.
- Se agregó `--summary` (commit `f3403cd`): imprime solo conteos, sin uid, nombre ni correo, ni siquiera enmascarados. Tiene test unitario y e2e que lo comprueban.
- No se usó `--json`.

```bash
node scripts/migrate-access-v1.mjs --project cds-administracion --summary
```

**Resultado (2026-10-03):**

| Métrica | Valor |
|---|---|
| Total de usuarios | **4** |
| Legacy (por migrar) / ya v1 / rol inválido | 4 / 0 / 0 |
| Por rol | admin 1 · pastor 3 (no hay `finance` ni `leader`) |
| Activos / inactivos | 4 / 0 |
| Módulo inicial tras migrar | finance 4 (Pastor conserva Finanzas, decisión aprobada) |
| Advertencias | ninguna |
| Activos que quedarían sin módulo | 0 |
| Activos que requieren asignar áreas | 0 (pastor y admin tienen `manage_all`) |
| v1 con riesgo de rollback / con role incoherente | 0 / 0 |

"Simulación: no se escribió nada."

**Consecuencias para el rollout:**
- Con 3 pastores y 1 admin, la migración **no cambia** el acceso financiero de nadie. Nadie recibe `publish_assigned` por migración; pastor y admin publican por `manage_all`, igual que con el fallback legacy.
- Los líderes con áreas aparecerán solo cuando Salvador los cree en la Fase 8.

## 10. Áreas iniciales (propuesta, NO ejecutada)

No se crea nada en producción. Se crean en la Fase 8 desde **Configuración › Áreas**, con la app y bajo las reglas, después de que Salvador confirme la lista. No hay script que escriba áreas en producción.

**Fuente:** los nombres son los únicos presentes en el proyecto: el modelo de Navigator (doc 16a §J) y el seed. **Salvador debe confirmarlos**: son nombres de referencia, no un registro verificado de los ministerios de CDS. Los colores salen de la paleta cerrada (doc 16b) y se pueden cambiar.

| Área | Slug | Color | Propuesta |
|---|---|---|---|
| Pastoral | `pastoral` | azul | Activa |
| Alabanza | `alabanza` | indigo | Activa |
| Jóvenes | `jovenes` | naranjo | Activa |
| Niños (Escuela Dominical) | `ninos` | ambar | Activa |
| Damas | `damas` | frambuesa | Activa |
| Varones | `varones` | cafe | Activa |
| Intercesión | `intercesion` | teal | Activa |
| Multimedia (sonido y transmisión) | `multimedia` | pizarra | Activa |
| Consolidación | `consolidacion` | verde | **Pendiente de decisión.** Se propone no crearla todavía, para no confundirla con el módulo Integrantes/Consolidación, que no existe en producción |
| Matrimonios | `matrimonios` | carmin | **Inactiva** (así figura en el modelo) o no crearla |

**Responsables:** pendientes de asignación en todas las áreas. No se inventa ninguno. En producción no hay ningún usuario con rol líder, así que asignar áreas solo tiene sentido al crear los usuarios líderes en la Fase 8. El slug no se puede cambiar después de crear el área.

## 11. Cambios respecto de producción

De `648afd1` a RC1: 54 commits (39 de PR #1 + 15 de PR #5).

| Componente | Etapa A (`648afd1` → `e6b2084`) | Etapa B (`e6b2084` → RC1) |
|---|---|---|
| Firestore Rules | +G3 (`sumup_*` backend-only), lectura de `sumupSyncRuns`/`versions`/`adjustments` | Helpers de permisos con fallback legacy, `users` v1, `areas`, `calendarEvents` + `changes`, `calendarShareLinks` (sin acceso) |
| Índices | — | +`calendarEvents (visibility, lastDate)` |
| Storage Rules | sin cambios | sin cambios |
| Functions | Motor SumUp nuevo (`functions/sumup/*`) | +`calendarPublicFeed`, +`calendarShareLinkManage`, `requireFinanceUser` por permisos, `functions/shared/*` |
| Hosting | Slice 6 (Resumen, Ofrendas, Diezmos, Reportes, Movimientos) | Shell por módulos, Calendario, Reportes › Calendario, Configuración › Áreas y Usuarios, `/calendario-publico`, rewrite `/api/calendario-publico`, headers |
| Datos | Aditivos: `sumupSyncRuns`, `versions`, `adjustments` | Aditivos: `areas`, `calendarEvents`, `calendarShareLinks/public` y campos v1 en `users` (`role` se conserva) |

## 12. Observabilidad durante el rollout

No se crean alertas ni recursos. Son consultas manuales con `gcloud` (cuenta con acceso al proyecto) o desde la consola. Los servicios de Cloud Run llevan el nombre de la Function en minúsculas.

| Qué | Cómo mirarlo | Normal | STOP |
|---|---|---|---|
| **Errores de Functions** | `gcloud logging read 'severity>=ERROR AND resource.type="cloud_run_revision" AND timestamp>="<inicio-fase>"' --project cds-administracion --limit 50 --format="table(timestamp,resource.labels.service_name,severity)"` | 0 (línea base: 0 desde el 26-09) | Cualquier error nuevo sin explicación |
| **`calendarPublicFeed` 4xx/5xx** | `gcloud logging read 'resource.labels.service_name="calendarpublicfeed" AND httpRequest.status>=400' --project cds-administracion --limit 50 --format="table(timestamp,httpRequest.status,httpRequest.requestMethod)"` | 404 esporádicos (enlaces viejos o mal copiados); 405 solo de bots | Cualquier 5xx; ráfaga de 404 (posible barrido); un 200 tras desactivar |
| **El token no aparece en logs** | `gcloud logging read 'resource.labels.service_name="calendarpublicfeed"' --project cds-administracion --limit 20 --format="value(httpRequest.requestUrl)"` | URLs sin query | Cualquier `?t=` o token |
| **`calendarShareLinkManage`** | `gcloud logging read 'resource.labels.service_name="calendarsharelinkmanage" AND (severity>=WARNING OR httpRequest.status>=400)' --project cds-administracion --limit 50` | Vacío | 5xx; 403 de un admin o pastor |
| **SumUp sync** | (a) colección `sumupSyncRuns` en la consola: estado del último run por cuenta. (b) `gcloud logging read 'resource.labels.service_name="sumupsyncscheduled" AND httpRequest.status>0' --project cds-administracion --limit 24 --format="value(timestamp,httpRequest.status)"`. (c) `gcloud scheduler jobs describe firebase-schedule-sumupSyncScheduled-southamerica-east1 --location southamerica-east1 --project cds-administracion` | Un run por hora con 200; segundo run con `unchanged == fetched` | Un run con error, más de 2 horas sin run, `updated` sin causa |
| **permission-denied de Firestore** | Consola › Firestore › **Uso** › evaluaciones de reglas (Allow/Deny/Error). En Metrics Explorer, la métrica de evaluaciones de reglas de Firestore filtrada por resultado DENY (verificar el nombre exacto en la consola). Además, el smoke humano con la consola del navegador abierta | Deny casi en 0 | Aumento de Deny tras desplegar reglas |
| **Login y acceso** | Smoke humano con los 4 usuarios: cada uno inicia sesión, aterriza en Finanzas y ve lo mismo que antes. Consola › Authentication › Usuarios: último inicio de sesión | Los 4 entran | Un usuario que no entra o ve "sin módulos" o "no autorizado" |
| **Hosting** | `curl -s -o /dev/null -w '%{http_code}\n' https://cds-administracion.web.app/<ruta>` para `/`, `/login`, `/finanzas`, `/calendario`, `/calendario-publico`. Consola › Hosting › historial de versiones | 200 | 404/5xx en rutas conocidas |
| **Costo del feed** | Consola › Firestore › Uso (lecturas) y Cloud Run › `calendarpublicfeed` › solicitudes | Pocas por día | Lecturas desproporcionadas (§16, riesgo R6) |

## 13. Rollout por fases (NO ejecutado)

**Reglas comunes a todas las fases:**
- Cada fase empieza solo con un "GO" explícito de Salvador.
- Se trabaja desde un **checkout limpio del commit exacto** (no desde el checkout de trabajo).
- Se usa `--project cds-administracion` explícito y se anota la hora de inicio.
- `.env.local` (configuración web del proyecto real; no es un secreto, pero no se versiona) se copia al checkout de deploy solo para el build de Hosting.

```bash
git clone https://github.com/Speralt1/cds-suite.git ~/cds-deploy && cd ~/cds-deploy
```

```bash
git checkout <commit-a-desplegar>
```

```bash
npm ci && npm --prefix functions ci
```

### Etapa A: PR #1 (Financial Core 2026) sobre `e6b2084`

> **HISTÓRICO — EJECUTADA el 2026-10-03/04 (doc 21). NO USAR sus comandos ni sus rollbacks:** `648afd1`, `f4591416f0474b0f`, `8d0087d6…` y "deploy de Functions desde `648afd1`" son anteriores a SumUp CASH (`ee33aa9`) y a R0G (`a312c96`) y los quitarían de producción. Los únicos objetivos de rollback válidos hoy son Hosting `3d1dc8bc8d1bcc29`, Rules `2d9939ab-2a9e-491e-b176-1cafd939e568` y las revisiones `campaignshare-00002-dij` · `sumupsyncnow-00007-wut` · `sumupsyncscheduled-00008-nek` (que no se redespliegan: §13 Fase 3, §14).

| Fase | Comando | Qué debería pasar / cómo verificar | GO | STOP | Rollback |
|---|---|---|---|---|---|
| **A0 · Backup, snapshot y consultas previas** | Crear el bucket (primera vez): `gcloud storage buckets create gs://cds-administracion-backups --location=southamerica-west1 --project cds-administracion` · Export: `gcloud firestore export gs://cds-administracion-backups/pre-etapa-a-$(date +%Y%m%d-%H%M) --project cds-administracion` · Volver a correr los comandos de solo lectura del §4 · Consulta `feeAmount`: en la consola, `sumupIntegrations/{cuenta}/transactions` filtrado por `feeAmount > 0` (o una consulta de conteo) para cada cuenta · Anotar los totales de septiembre desde Reportes de la app · Decidir la alerta del ítem 5 | Export SUCCESSFUL (`gcloud firestore operations list --project cds-administracion`); snapshot igual al §4 | Export OK, `feeAmount > 0` = 0, snapshot igual, alerta decidida | El export falla, `feeAmount > 0` ≠ 0 o producción no coincide con el §4 | Nada cambió |
| **A1 · Merge** | Salvador mergea PR #1 en `feature/preproduccion-mobile-v1` (GitHub) | `git diff --stat e6b2084 origin/feature/preproduccion-mobile-v1` vacío | Diff vacío | Diff no vacío | `git revert` del merge |
| **A2 · Rules** | `firebase deploy --only firestore:rules --project cds-administracion` | Release nuevo en Rules; la app actual sigue funcionando para los 4 usuarios | Sin permission-denied en el uso normal | Cualquier denegación nueva | Consola › Firestore › Reglas › historial → restaurar `8d0087d6…`, o deploy de reglas desde un checkout de `648afd1` |
| **A3 · Functions** | `firebase deploy --only functions --project cds-administracion` | 3 funciones actualizadas, mismas regiones. Sync manual desde la app: responde en menos de 30 s con estado por cuenta. Primer run: `rawRefreshed` alto y **0 `updated` sin causa**. Segundo run: `unchanged == fetched` | Igual a lo esperado | Error, timeout, `updated` sin causa | `firebase deploy --only functions --project cds-administracion` desde un checkout de `648afd1` |
| **A4 · Hosting** | `npm run build && firebase deploy --only hosting --project cds-administracion` | La app Slice 6 en vivo. Totales de septiembre **idénticos** a los de A0; reporte anual 2026 sin "sincronizando"; resumen 2026-10 completo | Totales iguales | Cualquier diferencia de montos | Consola › Hosting › historial → revertir a `f4591416f0474b0f` |
| **A5 · Observación** | §12, una vez al día | ≥ 7 días, incluido ≥ 1 domingo de culto, sin errores | Estable → Etapa B | Errores o diferencias | Rollback completo a `648afd1` (rules + functions + hosting; los datos son aditivos) |

### Etapa B: Platform + Calendar (RC1)

Antes de la Fase 0: PR #5 con base cambiada a preproducción (ya integra `a312c96`), mergeado, y `git diff --stat <commit> origin/mission/platform-core-calendar-v1` vacío (§3). El deploy se hace desde `~/cds-deploy` en el commit exacto del merge, con `./node_modules/.bin/firebase` (CLI del repo). Orden general: C-A0 fresco → backup Firestore → snapshot → fases 1–5 → validación de Calendario → (doc 25) integración/deploy de Consolidación → piloto Salvador Admin → validación operativa → monitoreo.

| Fase | Comando exacto | Qué debería pasar / cómo verificar | GO | STOP | Rollback |
|---|---|---|---|---|---|
| **0 · C-A0, backup y snapshot** | A5 fresco (`node ~/cds-ops/a5-check.mjs`) + `~/cds-ops/prod-snap.sh` + `node ~/cds-ops/r0g-fin-snap.mjs snap …` · `gcloud firestore export gs://cds-administracion-backups/pre-etapa-b-$(date +%Y%m%d-%H%M) --project cds-administracion` · anotar los IDs vigentes como objetivos de rollback | Export SUCCESSFUL; producción = `a312c96` / Hosting `3d1dc8bc8d1bcc29` / Rules `2d9939ab…` / Functions `-00002-dij`, `-00007-wut`, `-00008-nek`; montos = A9 post-CASH (oct. resumen = ledger 9/9) | OK | El export falla, producción distinta, o cualquier diferencia financiera sin explicar | Nada cambió |
| **1 · Índices** | `./node_modules/.bin/firebase deploy --only firestore:indexes --project cds-administracion` | Se crea `calendarEvents (visibility, lastDate)`. `firebase firestore:indexes --project cds-administracion` lo lista; en la consola pasa a **Habilitado** | Índice READY | Error, o el CLI propone **borrar** índices (responder **No**) | No hace falta: es aditivo y no se usa sin el código nuevo |
| **2 · Rules (con fallback legacy)** | `./node_modules/.bin/firebase deploy --only firestore:rules --project cds-administracion` (**sin** `storage`) | Los 4 usuarios legacy, con el Hosting vigente (`3d1dc8bc8d1bcc29`), ven y hacen exactamente lo mismo: resumen, movimientos, diezmos, ofrendas (incluido el modal de efectivo R0G y el aviso SumUp CASH, abrir sin guardar), reportes, sync manual. A5: 0 DENY nuevos y sin diferencias financieras | Sin denegaciones nuevas | Cualquier denegación en Finanzas | Restaurar el ruleset anotado en la Fase 0 (hoy `2d9939ab-2a9e-491e-b176-1cafd939e568`, consola › Reglas › historial) o `firebase deploy --only firestore:rules` desde un checkout de `a312c96` (sus reglas = `e6b2084` = `0d1bb0d`, byte a byte). Sin v1 todavía, no aplica el caveat del §14 |
| **3 · Functions (solo las nuevas, por nombre)** | `./node_modules/.bin/firebase deploy --only functions:calendarPublicFeed,functions:calendarShareLinkManage --project cds-administracion` (el `predeploy` corre `build-shared --check`). **Prohibido** `--only functions` sin nombres: redesplegaría `sumupSyncNow`, `sumupSyncScheduled` y `campaignShare` | `firebase functions:list` → 5 funciones (+`calendarPublicFeed`, +`calendarShareLinkManage` en west1). **`campaignshare-00002-dij`, `sumupsyncnow-00007-wut`, `sumupsyncscheduled-00008-nek` sin cambios** (`prod-snap.sh`). El scheduler SumUp sigue 2xx y A5 sin diferencias financieras. Si el CLI avisa que no puede dar acceso público (`allUsers`) a una función HTTP/callable: **STOP** | 2 funciones nuevas ACTIVE y las 3 existentes en la misma revisión | Error de deploy o de IAM; cualquier cambio de revisión en una función existente | **Nunca** redeploy de Functions desde un checkout anterior (quitaría SumUp CASH de producción). Funciones nuevas: sin enlace creado, el feed responde 404 a todos; borrarlas solo si hace falta: `firebase functions:delete calendarPublicFeed calendarShareLinkManage --region southamerica-west1 --project cds-administracion` |
| **4 · Hosting** | En `~/cds-deploy` @ commit exacto: `git merge-base --is-ancestor a312c96 HEAD` (debe dar 0) · `rm -rf out .next && npm run build` (build con `.env.local` real) · comprobar en `out/` el modal R0G (`grep -rlF "Cargar valores vigentes" out`, `grep -rlF "no pudimos confirmar los datos con el servidor" out`) y el aviso SumUp CASH (`grep -rl "SumUp ya registr" out`) · exclusiones de preview (`node ~/cds-ops/check-no-preview-exclusions.mjs ~/cds-ops/check-no-preview.gate.mjs out .`) · `./node_modules/.bin/firebase deploy --only hosting --project cds-administracion --dry-run` y luego sin `--dry-run` | `curl -sI https://cds-administracion.web.app/calendario-publico` → 200 con `referrer-policy: no-referrer` · `curl -s -X POST -H 'Content-Type: application/json' -d '{}' https://cds-administracion.web.app/api/calendario-publico` → `404 {"ok":false,"error":"unavailable"}` · `curl -s -o /dev/null -w '%{http_code}\n' https://cds-administracion.web.app/api/calendario-publico` (GET) → 405 | Los 3 curl dan lo esperado | Otra cosa | Consola › Hosting › historial → revertir a la versión anotada en la Fase 0 (hoy `3d1dc8bc8d1bcc29`) |
| **5 · Smoke antes de migrar** | Manual, con la consola del navegador abierta, **sin guardar nada** | Los 4 usuarios (aún legacy) entran y aterrizan en **Finanzas**; Finanzas idéntico (KPIs = A5); modal de efectivo R0G: carga → formulario, registro existente prellenado, aviso SumUp CASH, fecha vacía validada, Cancelar; sync manual visible para admin/pastor/finanzas; Calendario visible (pastor y admin por fallback); Configuración › Áreas y Usuarios solo para admin; Reportes › Calendario abre; sin errores de permisos. §12 limpio | Todo igual | Cualquier diferencia en Finanzas o acceso | Hosting → Fase 4; reglas → Fase 2 |
| **6 · Dry-run final** | `node scripts/migrate-access-v1.mjs --project cds-administracion --summary` y, solo en la terminal (sin `--json`, sin guardar), `node scripts/migrate-access-v1.mjs --project cds-administracion` para que Salvador revise el plan por usuario | Igual al §9: 4 por migrar, admin 1 / pastor 3, sin advertencias, 0 sin módulo, 0 riesgo, 0 incoherente | Igual al §9 o con diferencias explicadas | Diferencias sin explicar | Nada se escribió |
| **7 · Migración `--apply` (aprobación humana)** | Hacerla **fuera de las ventanas de carga de efectivo** y avisar a los usuarios: el cambio de `homeModule` remonta la app de cada sesión abierta y se pierde un borrador sin guardar del modal de efectivo (Atlas R1 MINOR-4). Backup de `users`: `gcloud firestore export gs://cds-administracion-backups/pre-migracion-$(date +%Y%m%d-%H%M) --collection-ids=users --project cds-administracion` · Después: `CDS_ALLOW_PRODUCTION_MIGRATION=cds-administracion node scripts/migrate-access-v1.mjs --project cds-administracion --apply --confirm cds-administracion --summary` (pide escribir el id en la TTY) | "Escritos: 4". Volver a correr `--summary` → ya v1 4, migrar 0, incoherente 0, riesgo 0. Cada usuario vuelve a entrar: mismo aterrizaje y mismas finanzas | Todo igual | Escritura fallida o acceso distinto | **Código:** no hace falta (las reglas leen v1). **Datos:** `gcloud firestore import gs://cds-administracion-backups/pre-migracion-… --collection-ids=users --project cds-administracion` restaura la forma legacy (sobrescribe por id) |
| **8 · Áreas y permisos** | En la app: Configuración › Áreas (lista confirmada del §10) y Usuarios y permisos (líderes nuevos, sus áreas, `publish_assigned` solo donde Salvador lo decida). Después: `--summary` | Áreas visibles en Calendario; un líder con áreas crea "Solo equipo" en su área; publicar sin permiso queda bloqueado. Anotar en `--summary` los "v1 con riesgo de rollback" (líderes sin finanzas) | Comportamiento según el doc 18 | Un líder edita fuera de su área o publica sin permiso | Desactivar el área (no se borra); quitar permisos desde la UI |
| **9 · Calendario público** | En la app (pastor o admin): Calendario › Compartir › Generar enlace. Copiarlo (se muestra una sola vez) | En una ventana privada, `https://cds-administracion.web.app/calendario-publico#…` muestra solo actividades públicas. Verificar el §12 "el token no aparece en logs" | Página OK y logs sin token | Datos internos visibles; token en logs | **Desactivar** (corte inmediato, `no-store`); si se filtró, **Regenerar** |
| **10 · Observación** | §12, una vez al día durante ≥ 2 semanas | Sin errores; Deny estable; sync normal | Estable → otra misión para retirar el fallback legacy (100 % v1) y migrar Storage | Errores o denegaciones | Según el componente (§14) |

## 14. Rollback

| Componente | Rollback de código | Rollback de datos |
|---|---|---|
| **Hosting** | Consola › Hosting › historial de versiones → "Revertir" a la versión anterior. Etapa B: la que se anote en la Fase 0 (hoy `3d1dc8bc8d1bcc29`; API: `POST …/sites/cds-administracion/channels/live/releases?versionName=sites/cds-administracion/versions/3d1dc8bc8d1bcc29`). (Alternativa por CLI: `firebase hosting:clone`; verificar la sintaxis con `--help` antes de usarla). `f4591416f0474b0f` (Etapa A) es **histórico, NO USAR**: no tiene CASH ni R0G | No hay datos |
| **Firestore Rules** | Consola › Firestore › Reglas › historial → restaurar el ruleset anterior (Etapa B: el anotado en la Fase 0, hoy `2d9939ab-2a9e-491e-b176-1cafd939e568`; `8d0087d6…` de la Etapa A es **histórico, NO USAR**), o `firebase deploy --only firestore:rules` desde un checkout de `a312c96` | Las colecciones nuevas quedan inaccesibles por el catch-all, sin pérdida |
| **Functions** | Etapa B solo agrega `calendarPublicFeed` y `calendarShareLinkManage`: kill switch = desactivar el enlace desde la app; borrarlas solo si hace falta (Fase 3). **Nunca** `firebase deploy --only functions` desde un checkout anterior: el código previo a `ee33aa9` no tiene SumUp CASH y el redeploy lo quitaría de producción | `sumupSyncRuns`/`versions`/`adjustments` son aditivos; el código viejo los ignora |
| **Índices** | No se revierten: son aditivos e inofensivos | — |
| **Migración de usuarios** | No hace falta: `role` se conserva y las reglas RC1 leen v1 | Import del export de la Fase 7 (`--collection-ids=users`) si se vuelve del todo a las reglas legacy y hay que editar usuarios desde la app vieja (ver abajo) |
| **Share link** | Desactivar desde la app (inmediato) | Regenerar si se filtró; activar rehabilita el **mismo** enlace |

**Preferencia de rollback en la Etapa B:** si falla Hosting o Functions, se revierte **solo ese componente** y se **conservan las reglas RC1**. Son un superconjunto con fallback legacy, y la app de la Etapa A funciona igual sobre ellas (verificado en la Fase 2). Las reglas se revierten a las legacy **solo si el problema son las reglas mismas**.

### Caveat del doc 19 §12.9: v1 sin finanzas + reglas legacy

**Escenario:** un usuario v1 sin `finance.summary.read` (por ejemplo, un líder solo de calendario creado en la Fase 8) tiene el `role` derivado `leader`. Si se redespliegan las reglas legacy (`e6b2084`), ese rol da lectura del **resumen financiero** mensual. No da movimientos ni diezmos.

**Por qué el riesgo es acotado:**
- Hacen falta tres condiciones a la vez: migración aplicada, un admin que crea o recorta a un usuario sin finanzas, y un rollback de reglas a las legacy.
- Hoy el conteo es **0**. Antes de la Fase 8 no puede ser otro: los 4 usuarios son admin y pastor, y la migración no recorta permisos.

**Cómo se evita:**
1. Se prefiere conservar las reglas RC1 (arriba).
2. Si hay que volver a las reglas legacy, **antes** del redeploy de reglas y con las reglas RC1 todavía activas:
   1. correr `node scripts/migrate-access-v1.mjs --project cds-administracion --summary`;
   2. si "v1 con riesgo de rollback" > 0, identificar a esos usuarios en Configuración › Usuarios y permisos (son los v1 sin el permiso "Ver resumen financiero");
   3. ponerles **"Quitar acceso"** (`active=false`) desde la app. No pierden nada: con las reglas legacy el calendario no es accesible;
   4. anotar a quiénes se desactivó fuera del repo y fuera de cualquier `--json`.
3. **Ojo:** las reglas legacy validan `users` con `keys().hasOnly([5 campos legacy])`. Con ellas vigentes, **la app no puede editar ningún usuario migrado**. Hay que desactivar **antes** del rollback, o después desde la consola de Firebase (que no pasa por las reglas), o restaurar `users` con el import de la Fase 7.
4. Al volver a desplegar RC1, reactivar a esos usuarios desde Configuración.

**Decisión:** no se cambia el código en RC1 (por ejemplo, con un `role` que no sea legacy y falle hacia denegar). Tocaría reglas, el planner, tests y la UI legacy. Atlas lo recomienda para después de RC1, y queda en el backlog del §16.

## 15. GO / NO-GO (Atlas)

| ITEM | STATUS | EVIDENCE | BLOCKER? |
|---|---|---|---|
| PR #1 listo | **PASS** (código y gates) | §7: 174/174, 22/22, build, `node --check` sobre `e6b2084` | No. La Fase A0 exige `feeAmount` = 0 y la decisión de la alerta antes de A2 |
| PR #5 listo | **PASS** | §8: 779/779 ×3, 115/115, 18/18, build, `build-shared --check` sobre una copia limpia | No |
| Rules | **PASS** | Fallback legacy exacto; los 22 tests de PR #1 sin cambios; coherencia de `role` (firestore.rules:145); `users` solo los escribe un admin; `calendarShareLinks` cerrado | No |
| Functions | **PASS** | Feed solo POST, sin token en logs, 404 uniforme, `no-store`; callable con `manage_all`, token devuelto una sola vez, solo se guarda el hash; regiones iguales a producción | No |
| Migración | **PASS** | Dry-run de producción `--summary` (§9): 4/4 limpios; `--apply` con 4 interlocks; backup de `users` previsto | No |
| Seguridad del token | **PASS** | §5: fragmento + POST; unit + e2e; revisión de Atlas | No |
| Storage | **DEFERRED** | §6: Calendar no lo usa; falla hacia denegar; sin escalada | No |
| Rollback | **PASS** | §14: por componente, con IDs concretos; caveat con procedimiento y detector (`--summary`) | No |
| Monitoring | **PASS** (documentado) | §12: consultas y umbrales. Sin alertas (decisión en A0) | No |
| Backup | **PENDIENTE (Fase 0)** | PITR desactivado, sin backups programados y sin bucket. Comandos en A0/0/7 | No para el RC; **sí para iniciar la Fase 1** |

### Veredicto: **GO FOR CONTROLLED DEPLOYMENT**

No queda ningún blocker en el código ni en el diseño. **Esto no autoriza a desplegar.** Significa solo que Salvador puede decidir abrir la misión de rollout. Esa misión empieza por la Fase A0, cuyas condiciones (backup, `feeAmount`, alerta) son gates obligatorios.

## 16. Riesgos

**Bloqueantes:** ninguno.

**Condiciones previas** (gates del rollout, no del RC):
- **C1:** backup antes de cada etapa y antes de migrar.
- **C2:** consulta `feeAmount > 0` = 0, que corre Salvador.
- **C3:** decisión sobre la alerta del scheduler.

**Aceptados:**

| # | Riesgo | Mitigación / estado |
|---|---|---|
| R1 | Fragmento en el historial del navegador del visitante | Local al dispositivo; se conserva por los favoritos |
| R2 | "Activar" revive el mismo enlace | Por diseño. Si se filtró, **Regenerar** |
| R3 | `internalNotes` visible para todos con `calendar.read` | Decisión de producto; la UI advierte que no se escriban datos personales |
| R4 | Campos del historial declarados por el cliente (formato de `reason`/`scope`/`occurrenceDate`) | Bajo. Los valores auditados sí se verifican |
| R5 | Storage por rol | DEFERRED (§6) |
| R6 | Costo/DoS del feed (lee todos los públicos por request; `maxInstances: 5` acota el costo pero facilita saturar la página) | Observar (§12). Caché en memoria por `rotation` en otra misión |
| R7 | "Hoy" en las reglas con UTC−4 fijo | 1 h de holgura con horario de verano |
| R8 | Caveat de rollback a reglas legacy | Procedimiento del §14 + `--summary` |
| R9 | El `--json` completo de la migración tiene nombres reales | Usar `--summary`; el plan por usuario solo en la terminal |
| R10 | JSON mal formado a mano podría quedar en un log del framework | Solo con la petición fabricada y el token en la mano |
| R11 | Documentos v1 incoherentes por edición manual | `--summary` los cuenta; no editar `users` desde la consola |

**Cerrados en esta misión:**
- doc 19 §12.1 (token en logs);
- doc 19 §12.2 (60 s de caché);
- doc 19 §12.10, parcial (`--summary`);
- doc 19 §12.11, convertido en el plan de etapas del §2.

**Backlog post-RC1** (otras misiones):
- `role` legacy de mínimo privilegio;
- Storage por permisos;
- caché del feed;
- retirar el fallback legacy;
- unificar la marca "CDS Suite" en login.

## 17. Cambios hechos sobre PR #5 en esta misión

| Commit | Cambio | Por qué |
|---|---|---|
| `894e79f` | Token en el fragmento + POST al feed; `no-store`; se quita el rewrite `/calendario/compartir/**`; seed, `dev:platform` y tests al contrato nuevo | §5. Cierra doc 19 §12.1 y §12.2 antes del primer deploy |
| `f3403cd` | `--summary` en la migración (agregado sin datos personales) + riesgo de rollback | §9 y §14 |
| `aed6f7d` | `--summary` cuenta los v1 con role incoherente | Observación baja de Atlas (§6) |
| *(docs)* | Este documento; notas "Actualización RC1" en los docs 18, 18a y 19; token de demo retirado de `_metricas.txt`; `PROJECT_CONTEXT.md` | Documentación y runbook |

**Tests:**
- **Nuevos:** `tests/platform/migration-summary.test.ts` y `tests/emulator/migration-summary.e2e.test.ts`.
- **Ajustados por el cambio de contrato** (todos creados en PR #5; ninguno existía en `e6b2084`): `calendar-public-feed`, `calendar-wiring`, `public-feed-client`, `public-calendar-page`, `seed-platform-data`, `calendar-screens`, el helper y `calendar-feed.e2e`.
- Los casos de 404 uniforme, sanitización y regeneración se conservaron y se ampliaron.

**Gates finales sobre la cabeza de la rama** (después de `aed6f7d`, en el checkout de trabajo):
- lint ✓ y typecheck ✓;
- vitest **780/780**;
- `test:emulator` **18/18** y `test:rules` **115/115**;
- `build-shared --check` ✓ y build ✓.

## 18. Qué NO se hizo

- **Sin deploy:** ni `firebase deploy`, ni canales, ni cambios en Hosting, Rules, Functions, índices, Storage ni Auth reales.
- **Sin escrituras en Firebase real:** solo lecturas de metadatos (Rules, Hosting, Functions, índices, Scheduler, Monitoring, configuración de Auth) y el dry-run agregado de `users`. La consulta `feeAmount` se bloqueó y no se reintentó.
- **Sin migración `--apply`**, sin crear áreas y sin crear el enlace público en producción.
- **Sin merges:** PR #1, #3, #4 y #5 siguen abiertos. Sin cambio de default branch y sin force push. Push solo a `mission/platform-core-calendar-v1`.
- **Sin features nuevas:** sin Integrantes/Consolidación, Brother, WhatsApp, módulos ni reportes nuevos. Slice 3A no se tocó.
- **Nada sensible versionado:** sin tokens reales, secretos, credenciales, dumps de usuarios, correos ni nombres reales.

## 19. Integración del baseline productivo `a312c96` (R1/R4, 2026-10-08)

- Merge no destructivo `be5ebb1` = `73b9040` (PR #5) + `a312c96` (producción). Sin rebase, squash ni force push.
- Conflictos textuales (2), resueltos por semántica y no por "ours/theirs":
  - `.gitignore`: un solo comentario y una sola entrada `.secret.local`.
  - `firebase.json` › `functions`: `ignore` de CASH (6 entradas, gate de secretos del paquete) **y** `predeploy` de Platform (`build-shared --check`).
- Auto-merges auditados: `app/globals.css` (+80 líneas de tokens de Platform, 0 eliminadas); `summary-page.tsx` y `offerings-page.tsx` solo difieren de producción en `can(access, "finance.details.read")` en lugar de `canSeeDetails`.
- Idénticos byte a byte a producción: `cash-modal.tsx`, `lib/finance/hooks.ts` (`synced`), `lib/offerings/cash.ts`, `functions/sumup/**` y sus tests (R0G/PR #11 y CASH intactos).
- `firebase.json` vs producción: solo agrega el header y el rewrite de `/calendario-publico`, el emulador de Functions y `predeploy`. Hosting, rewrites de SumUp y Campañas, Firestore, Storage y `ignore` sin cambios.
- **Acciones de escritura (Atlas R1 MINOR-2):** en Resumen y en Ofrendas, registrar efectivo, diezmo, gasto u otro movimiento, sincronizar SumUp y configurar la página pública ahora exigen `finance.records.manage`, igual que las Rules y `sumupSyncNow`. Para los roles legacy (admin, pastor, finanzas) es lo mismo que `finance.details.read`, así que no cambia nada hoy. Un perfil v1 de solo lectura ya no ve acciones que terminarían en permission-denied. El modal R0G no cambia por dentro.
- **Contrato de Functions (verificado por exports y diff):**
  - Nuevas: `calendarPublicFeed` y `calendarShareLinkManage`.
  - Sin cambios de código: `campaignShare` y `sumupSyncScheduled` (`functions/sumup/**` idéntico).
  - **`sumupSyncNow` sí cambia en el árbol:** `requireFinanceUser` pasa al modelo de acceso compartido (`can(userDoc, "finance.records.manage")`, equivalente a la regla legacy). La Etapa B **no** la despliega. La revisión viva `-00007-wut` conserva la verificación legacy por rol, equivalente para los usuarios actuales porque la migración está diferida (D4). Desplegarla requiere un GO separado, con revisión propia. Por eso **todo** deploy de Functions (Etapa B, Consolidación doc 25, hotfix) es **por nombre**, y `~/cds-ops/prod-snap.sh` + A5 verifican antes y después que `sumupsyncnow-00007-wut`, `sumupsyncscheduled-00008-nek` y `campaignshare-00002-dij` no cambian.

