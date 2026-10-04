# 21 · Rollout controlado RC1: bitácora

> Registro operativo del rollout definido en el [doc 20](20-platform-calendar-rc1-readiness.md) §13–14, que es el runbook autoritativo. Cada fase se ejecuta sola, después de un **GO** explícito de Salvador, y la sesión se detiene al terminarla.
> **Sin datos sensibles:** no se registran tokens, correos, nombres, montos individuales ni ids de documentos financieros. Solo cifras agregadas cuando hacen falta para validar.

**Commits de referencia (verificados con `git fetch` el 2026-10-03):**
- producción: `648afd1`;
- Etapa A: `e6b2084` (PR #1, abierto, MERGEABLE, base `feature/preproduccion-mobile-v1` @ `648afd1`);
- RC1 (Etapa B): `c5ee8bf` (PR #5, Draft).

## Etapa A · Financial Core 2026 (`e6b2084`)

### A0 · Backup y prechecks: completada (2026-10-03)

**GO recibidos:**
- misión de rollout: A0 autorizada (lecturas + backup);
- "GO A0.2 feeAmount": solo el conteo de lectura en las 2 cuentas;
- A0.3: opción (b), baseline desde `financeMonthlySummaries`;
- "GO alerta": las dos condiciones propuestas, con el correo propuesto como canal.

| Fecha (UTC) | Paso | Comando / método | Resultado |
|---|---|---|---|
| 21:34 | Snapshot de producción (solo lectura) | APIs de Rules, Hosting y Functions; `firebase firestore:indexes`; `gcloud scheduler`/`firestore databases` | **PASS: producción = `648afd1`.** Firestore Rules: ruleset `8d0087d6-b9a3-4c68-8649-d2fb3744c51f`, byte a byte igual a `648afd1`. Storage Rules: `f700d246-6faf-4574-a5cc-047d2b30c2bc`. Hosting live: versión `f4591416f0474b0f` (2026-09-11). Functions: `sumupSyncNow` (west1), `sumupSyncScheduled` (east1) y `campaignShare` (west1), ACTIVE, con los 2 secretos SumUp. 5 índices. Scheduler ENABLED. PITR desactivado |
| 21:35 | A0.1: bucket | `gcloud storage buckets create gs://cds-administracion-backups --location=southamerica-west1 --uniform-bucket-level-access --public-access-prevention` | Creado en `southamerica-west1`, acceso uniforme, prevención de acceso público **enforced** |
| 21:35–21:36 | A0.1: export | `gcloud firestore export gs://cds-administracion-backups/pre-etapa-a-20261003-1835 --async` | **SUCCESSFUL.** Operación `ASBjMTRhNTNjOGMwYmEtZDhhOC01M2Y0LTQzYjYtYjcwY2EyODEkGnNlbmlsZXBpcAkKMxI`, 48.004/48.004 documentos, 31,4 MiB, `overall_export_metadata` presente |
| ~21:45 | A0.2: `feeAmount > 0` | `runAggregationQuery` con `count()` sobre `sumupIntegrations/{cuenta}/transactions`, filtro `feeAmount > 0`. Solo se leyeron los ids de las 2 cuentas y los conteos | **PASS. Cafetería: 0 · Ofrendas: 0 · total: 0** |
| ~21:50 | A0.3: baseline | GET de `financeMonthlySummaries/2026-01…2026-10` con `mask` (solo totales y mapas por categoría; sin `lastTransactionId` ni mapas diarios) y de `sumupIntegrations/{cuenta}` con `mask` (estado del último sync) | **PASS.** Cifras abajo |
| 21:55–22:00 | A0.4: alerta | Tarifa oficial verificada; serie verificada; API de Monitoring: 1 canal de correo + 1 política con 2 condiciones | **PASS. Creada y habilitada** |
| 22:02 | Verificación final de A0 | Se repitió el snapshot | Producción sigue en `648afd1` (mismo ruleset, versión de Hosting y Functions); export SUCCESSFUL; 1 política y 1 canal |

#### Baseline financiero (cifras agregadas, CLP)

Fuente: documentos agregados `financeMonthlySummaries`, leídos el 2026-10-03 ~21:50 UTC. Se usa para comparar en A4.

| Período | Ingresos | Egresos | Resultado | Diezmos | Movimientos |
|---|---:|---:|---:|---:|---:|
| 2026-09 | 7.661.647 | 6.860.000 | 801.647 | 2.926.397 | 789 |
| 2026 (ene–sep, suma de los 9 resúmenes) | 34.589.315 | 6.910.000 | 27.679.315 | 3.126.397 | 6.386 |

| Ingresos por categoría | 2026-09 | 2026 (ene–sep) |
|---|---:|---:|
| Ofrendas | 813.800 | 913.800 |
| Cafetería | 3.118.650 | 3.118.650 |
| SumUp histórico sin separar | 802.800 | 27.230.468 |
| Diezmos | 2.926.397 | 3.126.397 |
| Actividades y eventos | — | 200.000 |

**Notas:**
- **2026-10 no tiene resumen todavía:** no hay movimientos de octubre en los agregados. En A4 se verifica que aparezca completo tras el primer movimiento o run.
- **Por qué no coincide con el doc 10:** los totales de septiembre del doc 10 §4.7 se tomaron a mediados de septiembre. El resumen de septiembre se actualizó por última vez el 2026-10-01, así que **este baseline reemplaza a esas cifras** para la comparación de A4.
- Los resúmenes de ene–ago tienen `updatedAt` del 2026-09-09; el de septiembre, del 2026-10-01.

**Estado de SumUp:**
- Ofrendas: último sync 2026-10-03 21:21 UTC, `ok`, 70 revisados, sin error.
- Cafetería: último sync 2026-10-03 21:21 UTC, `ok`, 84 revisados, sin error.

#### Monitoring (A0.4)

- **Política:** "SumUp scheduler: errores o ausencia (sumupSyncScheduled)", id `13747596744746850802`, combiner OR, severidad ERROR, habilitada.
  1. **Respuesta no-2xx:** `run.googleapis.com/request_count` del servicio `sumupsyncscheduled` con `response_code_class` 4xx o 5xx; suma en 10 min > 0.
  2. **Sin ejecuciones durante 2 h:** ausencia de `run.googleapis.com/request_count` del servicio `sumupsyncscheduled` durante 7200 s.
- **Canal:** correo (id `3352787503000526147`). No se crearon otros recursos.
- **Serie verificada antes de crear la ausencia:** existe una serie (`southamerica-east1`, 2xx) con 6 ejecuciones en las 6 h previas.
- **Costo (tarifa oficial vigente, cloud.google.com/products/observability/pricing):**
  - Google empieza a cobrar el alerting **no antes del 1 de septiembre de 2027** y avisa 90 y 30 días antes. **Hoy cuesta USD 0.**
  - Después: USD 0,35 al mes por referencia de métrica × 2 = USD 0,70, más USD 0,50 por millón de puntos devueltos. Con una ejecución cada 30 s y alrededor de 1 punto por condición, son unos 173 mil puntos al mes, alrededor de USD 0,09.
  - **Total estimado desde septiembre de 2027: ~USD 0,79 al mes.** Las métricas de Cloud Run y el canal de correo no tienen costo.
- **Limitación:** si una instancia de Cloud Run quedara activa emitiendo puntos en cero, la condición de ausencia no se dispararía. El job escala a cero entre ejecuciones, así que en la práctica se dispara. La revisión manual del doc 20 §12 se mantiene durante A5.

#### A0 STATUS

| Ítem | Estado |
|---|---|
| Producción = `648afd1` | **PASS** |
| Backup | **PASS** |
| `feeAmount > 0` por cuenta | Cafetería 0 · Ofrendas 0 |
| `feeAmount > 0` total | **0** |
| Baseline financiero | **PASS** |
| Monitoring | **PASS** (alerta creada) |
| Costo estimado de monitoring | USD 0 hoy; ~USD 0,79 al mes desde el 2027-09-01 |
| **Resultado** | **READY FOR A1** (espera el GO explícito de Salvador) |

**Rollback requerido:** no. A0 no cambió nada desplegado; solo creó el bucket, el export, el canal y la alerta.

### A1 · Merge de PR #1: completada (2026-10-03)

**GO recibido:** "GO A1", que autoriza solo el merge de PR #1 y sus verificaciones, sin deploy. Antes se hizo el push de `e05a787` a `mission/platform-core-calendar-v1`; el remoto quedó sincronizado.

| Fecha (UTC) | Paso | Comando / método | Resultado |
|---|---|---|---|
| 22:08 | Verificación previa | `gh pr view 1`, `git fetch`, `gh api` | PR #1 OPEN, no draft, MERGEABLE, `mergeStateStatus` CLEAN. Head `e6b2084d9d3b…`, base `feature/preproduccion-mobile-v1` @ `648afd1` (**no avanzó**: slice6 39 por delante / 0 por detrás). Rama sin protección, sin checks. Política del repo: merge commit (precedente: PR #2) |
| 22:09 | Merge | `gh pr merge 1 --merge --match-head-commit e6b2084d9d3b9e1a73a2998d5ffa09e04e55ee3f` (sin `--delete-branch`) | **MERGED** a las 22:09:42. Merge commit **`0d1bb0d`** (padres `648afd1` y `e6b2084`) |
| 22:10 | Verificación posterior | `git fetch`; `git diff --stat e6b2084 origin/feature/preproduccion-mobile-v1`; hashes de árbol | **Diff vacío.** Árbol `55b29f6f…` idéntico en `e6b2084` y `0d1bb0d` |
| 22:10 | Ramas y PR | `git rev-parse`, `gh pr view 5` | `mission/slice6-usability` se conserva (`e6b2084`), porque es la base de PR #5. PR #5 sigue abierto en Draft, base `mission/slice6-usability`, sin cambios |
| 22:11 | Producción | APIs de Rules, Hosting y Functions | **SIN CAMBIOS:** ruleset `8d0087d6…`, Hosting `f4591416f0474b0f` y Functions con las fechas del 2026-09 |

#### A1 STATUS

| Ítem | Estado |
|---|---|
| PR #1 merged | **PASS** |
| Commit resultante | `0d1bb0d` en `feature/preproduccion-mobile-v1` |
| Diff contra `e6b2084` | **EMPTY** |
| Estado de producción | **SIN CAMBIOS** |
| **Resultado** | **READY FOR A2** (espera el GO explícito de Salvador) |

**Rollback requerido:** no. Si hiciera falta deshacer el merge sin desplegar, se haría con `git revert -m 1 0d1bb0d` en preproducción, con aprobación previa.

### A2 · Firestore Rules: completada (2026-10-03/04)

**GO recibido:** "GO A2", solo `firebase deploy --only firestore:rules`.

| Fecha (UTC) | Paso | Comando / método | Resultado |
|---|---|---|---|
| 22:13 | Prechecks | APIs de Rules, Hosting y Functions | Producción sin cambios desde A1. **Ruleset para rollback: `8d0087d6-b9a3-4c68-8649-d2fb3744c51f`** (2026-09-09). Métrica `firestore.googleapis.com/rules/evaluation_count`: **0 DENY en 7 días** (solo ALLOW, uso esporádico) |
| 22:12 | Checkout de deploy | `git clone` → `~/cds-deploy`, `checkout` + `reset --hard 0d1bb0d` | `git status --short` vacío. Árbol = `e6b2084`; blob de `firestore.rules` `3c65b290` igual en ambos |
| 22:14:23–22:14:33 | **Deploy** | `firebase deploy --only firestore:rules --project cds-administracion --non-interactive` (desde `~/cds-deploy` @ `0d1bb0d`) | ✔ compilado y publicado. Sin índices, Storage, Functions ni Hosting |
| 22:15 | Ruleset nuevo | API de Rules | **`2d9939ab-2a9e-491e-b176-1cafd939e568`** (22:14:32). Contenido **byte a byte = `e6b2084:firestore.rules`** |
| 22:15 | Otros componentes | APIs + `firebase firestore:indexes` | Storage `f700d246…` sin cambios · 5 índices · Hosting `f4591416f0474b0f` · Functions con fechas de 2026-09: **SIN CAMBIOS** |
| 22:15 | Acceso por rol (simulado) | API `rulesets/2d9939ab…:test`: evalúa el ruleset desplegado con perfiles simulados; no lee ni escribe datos | **29/29.** admin y pastor: ALLOW en movimientos, resumen, reportes anuales, diezmos (fichas y aportes), seguimiento pastoral, Ofrendas/SumUp, configuración de finanzas, `sumupSyncRuns` y su propio perfil; admin lista usuarios. DENY esperado: crear `financeTransactions/sumup_*` (G3), anónimo, inactivo |
| 22:15 | Denegaciones y errores reales | Métrica de reglas + `gcloud logging read severity>=ERROR` | Todavía sin evaluaciones (nadie usó la app). **0 errores** desde el deploy |

**Denegación esperada en la ventana A2 → A4:** la app que corre hoy (`648afd1`) muestra "Editar/Anular" también en los movimientos SumUp. Con G3, esas acciones darán permission-denied hasta que A4 despliegue la UI de Slice 1b, que las oculta. Es el efecto buscado del cambio. **No editar ni anular movimientos SumUp hasta A4.**

**Smoke de la UI (login real):** pendiente. Salvador inicia sesión en el navegador de la sesión; después se leen Resumen, Movimientos, Diezmos, Ofrendas y Reportes sin acciones de escritura, revisando la consola.

#### Smoke real de A2, sesión **Admin** (2026-10-03, 22:55–23:02 UTC)

Salvador inició sesión en el navegador de la sesión. El recorrido fue **solo lectura**: navegación por URL, filtros de mes y vista Mensual/Anual. No se guardó, editó, anuló ni sincronizó nada, ni se tocaron "Editar/Anular" de SumUp ni "Inicializar ahora". El rol se confirmó porque la lista de Configuración › Usuarios y permisos carga, y esa lectura solo la permiten las reglas a `admin()`.

| Pantalla | Resultado |
|---|---|
| Resumen (`/finanzas`) | **PASS.** Carga con KPIs; octubre sin movimientos, coherente con el baseline (no hay resumen 2026-10) |
| Movimientos (`/finanzas/movimientos`) | **PASS.** Octubre vacío; con el filtro en septiembre se ven los movimientos (30 filas en pantalla) |
| Diezmos (`/finanzas/diezmos`) | **PASS.** KPIs y fichas visibles |
| Ofrendas (`/finanzas/ofrendas`) | **PASS.** Caja del día, Ofrendas/Cafetería e integración SumUp visibles |
| Reportes (`/finanzas/reportes`) | **PASS.** Mensual sin error. **Anual 2026: ingresos $34.589.315 · gastos $6.910.000 · resultado $27.679.315, idénticos al baseline de A0.** Sin "sincronizando" |
| Configuración › Usuarios y permisos | Carga (confirma el rol admin) |
| Consola del navegador | Sin mensajes en todo el recorrido |
| Reglas desde el deploy | **22 ALLOW · 0 DENY** |
| Logs `severity>=ERROR` desde el deploy | **0** |


#### Smoke real de A2, sesión **Pastor** (2026-10-03 23:55 – 2026-10-04 00:01 UTC)

**Rol verificado:** el perfil de la sesión activa tiene `role: pastor`, `active: true` (lectura con `mask` de esos 2 campos). En un primer intento la sesión del panel seguía siendo la admin; se detectó y no se contó. Los otros 2 pastores no se repitieron: según el dry-run de A0 están activos y con rol pastor, y la simulación de reglas cubrió ese rol.

| Pantalla | Resultado |
|---|---|
| Resumen | **PASS.** KPIs; octubre sin movimientos |
| Movimientos | **PASS.** Septiembre visible (30 filas en pantalla) |
| Diezmos | **PASS.** KPIs y fichas visibles |
| Ofrendas | **PASS.** Caja del día, Ofrendas/Cafetería e integración SumUp |
| Reportes | **PASS.** Anual 2026: $34.589.315 / $6.910.000 / $27.679.315, **idéntico al baseline** |
| Consola del navegador | Sin mensajes |

#### A2 STATUS FINAL

| Ítem | Estado |
|---|---|
| Rules deploy | **PASS**: ruleset `2d9939ab-2a9e-491e-b176-1cafd939e568` (contenido = `e6b2084`) |
| Ruleset anterior (rollback) | `8d0087d6-b9a3-4c68-8649-d2fb3744c51f` |
| Admin real | **PASS** |
| Pastor real | **PASS** |
| Resumen / Movimientos / Diezmos / Ofrendas / Reportes | **PASS** (en ambos roles) |
| permission-denied inesperados | **0**. Reglas desde el deploy hasta 00:01 UTC: 229 ALLOW · 0 DENY |
| Errores nuevos (`severity>=ERROR`) | **0** |
| Functions | **SIN CAMBIOS** (fechas de 2026-09) |
| Hosting | **SIN CAMBIOS** (`f4591416f0474b0f`) |
| Rollback requerido | **NO** |
| **Resultado** | **READY FOR A3** (espera el GO explícito de Salvador) |

**Recordatorio:** hasta A4, no editar ni anular movimientos SumUp en la app actual (denegación esperada por G3).

### A3 · Functions: completada (2026-10-04)

**GO recibido:** "GO A3", solo `firebase deploy --only functions`, más dos syncs manuales controlados.

| Fecha (UTC) | Paso | Comando / método | Resultado |
|---|---|---|---|
| 00:27 | Prechecks | APIs + `gcloud` | Ruleset `2d9939ab…`; 445 ALLOW · 0 DENY desde A2; Hosting `f4591416f0474b0f`; Functions en revisiones de 2026-09 (`sumupsyncnow-00005`, `sumupsyncscheduled-00006`, `campaignshare-00001`); secretos `SUMUP_*_CONFIG` versión 1 (solo metadatos); scheduler "every 60 minutes" America/Santiago, ENABLED; 0 errores |
| 00:28 | Checkout y revalidación | `~/cds-deploy` @ `0d1bb0d` (`reset --hard`, status vacío); `npm ci`; `npm --prefix functions ci`; `npx vitest run tests/functions` y suite completa; `node --check` | Árbol = `e6b2084` (tree de `functions/` `48838198` idéntico). Tests de Functions/SumUp **50/50**, suite **174/174**, `node --check` OK; el árbol sigue limpio después de `ci` |
| 00:28:22–00:28:32 | Deploy, intento 1 | `firebase deploy --only functions --project cds-administracion` (CLI standalone `/usr/local/bin/firebase` 15.27.0) | **Falló antes de subir nada:** el Node empaquetado en el binario no carga `jose` (ESM), `ERR_REQUIRE_ESM`. Producción verificada sin cambios |
| 00:29:01–00:30:36 | Deploy, intento 2 | El mismo comando con el CLI fijado por el repo: `./node_modules/.bin/firebase` 15.28.2 (devDependency, sobre Node 24 del sistema) | ✔ **Las 3 Functions actualizadas**: `campaignShare` (west1) → `campaignshare-00002`, `sumupSyncNow` (west1) → `sumupsyncnow-00006`, `sumupSyncScheduled` (east1) → `sumupsyncscheduled-00007`. Runtime nodejs22, mismos timeouts (20/55/540 s), secretos en versión 1. Scheduler sin cambios, próxima ejecución 01:21 |
| 00:31:20 | **RUN 1** (botón "Sincronizar SumUp", sesión Pastor) | `POST /api/sumup-sync` → 200 en 12 s | Ver tabla abajo |
| 00:32:47 | **RUN 2** (mismo mecanismo) | → 200 en 8,5 s | Ver tabla abajo |
| 01:21:08 | Run programado (primero con el código nuevo) | Cloud Scheduler → 200 en 51 s | Ambas cuentas `completed` + barrido diario de 45 días |
| 01:40 | Verificación final | APIs, `gcloud logging`, resúmenes con `mask` | Ver abajo |

**Runs (solo conteos agregados, de `sumupSyncRuns`):**

| Run | Cuenta | Estado | Páginas | fetched | created | updated | unchanged | rawRefreshed | voided/reactivated | ignored | Duración |
|---|---|---|---:|---:|---:|---:|---:|---:|---|---|---:|
| RUN 1 manual | Ofrendas | partial | 1 | 100 | 0 | 0 | 0 | 0 | 0/0 | preSplit 100 | 11,5 s |
| RUN 1 manual | Cafetería | partial | 1 | 100 | 0 | 0 | 0 | 92 | 0/0 | other 8 | 4,7 s |
| RUN 2 manual | Ofrendas | **completed** | 5 | 434 | 0 | 0 | 0 | 70 | 0/0 | preSplit 358, other 6 | 5,7 s |
| RUN 2 manual | Cafetería | partial | 2 | 200 | 0 | 0 | 0 | 184 | 0/0 | other 16 | 8,3 s |
| Programado | Ofrendas | completed | 1 | 11 | 0 | 0 | **11** | 0 | 0/0 | — | 1,2 s |
| Programado | Cafetería | completed | 3 | 294 | 0 | 0 | 0 | 235 | 0/0 | other 10, nonPOS 49 | 39,7 s |
| Barrido 45 días | Ofrendas | completed | 6 | 512 | 0 | 0 | **70** | 0 | 0/0 | preSplit 436, other 6 | 3,8 s |
| Barrido 45 días | Cafetería | completed | 6 | 594 | 0 | 0 | **511** | 0 | 0/0 | other 34, nonPOS 49 | 3,9 s |

**Cómo se leen:**
- **`partial`** no es un error. Es el avance por cursor del motor nuevo: el sync manual tiene un presupuesto de 25 s y no empieza otra página si quedan menos de 20 s. Por eso el primer recorrido de la ventana de 45 días (sin watermark previo) avanza de a una o dos páginas. Cafetería terminó en el run programado (540 s).
- **`rawRefreshed`:** primera pasada del motor nuevo por cada transacción. Guarda el snapshot crudo con su hash y no toca el movimiento contable.
- **`created = updated = voided = reactivated = 0` en todos los runs:** el libro contable no cambió.
- **Idempotencia:** el run programado de Ofrendas dio `unchanged == fetched` (11/11). El barrido de 45 días releyó toda la ventana sin ningún cambio: Ofrendas 70 sin cambios + 442 ignorados = 512; Cafetería 511 sin cambios + 83 ignorados = 594.
- Los ignorados (`preSplit`: cobros anteriores a la separación del 09-09; `nonPOS`; `other`) no se escriben en el libro.

**UI vieja:** la app actual (`648afd1`) muestra "Con error" para cualquier estado que no sea `ok`, incluido `partial`. Es solo de presentación (los runs no tienen `errorClass`) y la corrige la UI de Slice 1b en A4. Desde el run programado de las 01:21, ambas cuentas quedaron `completed`.

**Verificación final (01:40 UTC):**
- **Montos:** los 9 resúmenes mensuales de 2026 son **idénticos al baseline de A0** (totales y categorías; `updatedAt` sin cambios). Anual: ingresos 34.589.315 · egresos 6.910.000 · diezmos 3.126.397 · 6.386 movimientos. 2026-10 sigue sin resumen.
- **Errores (`severity>=ERROR`) desde A3:** 0. **5xx desde A3:** 0. Los syncs manuales y el programado respondieron 200.
- **Scheduler:** ENABLED, "every 60 minutes"; último intento 01:21 (200), próximo 02:21.
- **Monitoring:** alerta habilitada; no se disparó.
- **Rules:** sin cambios (`2d9939ab…`; 650 ALLOW · 0 DENY desde A2). **Hosting:** sin cambios (`f4591416f0474b0f`).

#### A3 STATUS

| Ítem | Estado |
|---|---|
| Functions deploy | **PASS** (intento 2) |
| Commit desplegado | `0d1bb0d` (árbol = `e6b2084`) |
| Functions actualizadas | `campaignShare`, `sumupSyncNow`, `sumupSyncScheduled` |
| Regiones | **PASS** (west1, west1, east1) |
| Scheduler | **PASS** |
| Idempotencia | **PASS** |
| Baseline financiero consistente | **PASS** |
| Monitoring | **PASS** |
| Rules / Hosting | SIN CAMBIOS |
| Rollback requerido | **NO** |
| **Resultado** | **READY FOR A4** (espera el GO explícito de Salvador) |

**Nota operativa:** para los próximos deploys usar el CLI del repo (`./node_modules/.bin/firebase` en `~/cds-deploy`). El binario standalone instalado en `/usr/local/bin` no puede analizar el código de Functions.

### A4 · Hosting: desplegado; falta el smoke Admin

**GO recibido:** "GO A4", solo Hosting.

| Fecha (UTC) | Paso | Comando / método | Resultado |
|---|---|---|---|
| 02:31 | Prechecks | APIs + `gcloud` + resúmenes | Árbol `0d1bb0d` = `e6b2084`; ruleset `2d9939ab…`; Functions ACTIVE (`-00006`/`-00007`/`-00002`); scheduler ENABLED (run de las 02:21: Ofrendas 11/11 y Cafetería 1/1 sin cambios); alerta habilitada; 0 errores · 0 5xx desde A3; montos = baseline. **Hosting para rollback: `f4591416f0474b0f`** |
| 02:32 | Build | `cp .env.local` (configuración web real, ignorada por git) → `rm -rf out && npm run build` en `~/cds-deploy` | ✓ Compilado; **15 rutas estáticas, 131 archivos**. Sin `/preview`, Integrantes ni Calendario; sin datos demo (`demo-cds-suite`, `@cds.test`); sin emuladores en el bundle. La única coincidencia con "payouts" es el texto veraz de Slice 1b ("la comisión se registrará… cuando se conecten los payouts"), no código de Slice 3A |
| 02:33:02–02:33:14 | **Deploy** | `./node_modules/.bin/firebase deploy --only hosting --project cds-administracion --non-interactive` (CLI del repo 15.28.2) | ✔ Release completo. **Versión nueva `edb77ffc04532a95`**; rewrites `/api/sumup-sync`, `/c/**`, `/campanas/**` |
| 02:33 | Smoke técnico | `curl` | 200 en `/`, `/login`, `/dashboard`, `/finanzas` y sus subrutas (`movimientos`, `ofrendas`, `diezmos`, `diezmos/perfil`, `reportes`, `campanas`), `/configuracion`, `/campanas`, `/ofrendar`, manifest y `sw.js`. `POST /api/sumup-sync` sin token → 401 (la Function responde y exige autenticación). `/calendario` → 404 (correcto: no es parte de la Etapa A) |

#### Smoke real, sesión **Pastor** (02:34–02:37 UTC; rol verificado: `role: pastor`)

Solo lectura: navegación, filtros de mes y vistas Diario/Mensual/Anual. No se registró, editó, anuló ni sincronizó nada.

| Pantalla | Verificación | Resultado |
|---|---|---|
| Resumen | Interfaz nueva visible: acciones rápidas (+ Registrar efectivo, + Diezmo, + Gasto, Otro movimiento, Reporte del mes), **Ingresos por tipo de dinero**, **Ingresos por fuente**, **Días por revisar (0)**, calendario del mes, "Gastos y resultado". Anual 2026: total ingresos **$34.589.315**, gastos **$6.910.000**, resultado **$27.679.315**; fuentes = categorías de A0. "Tarjeta SumUp · bruto", "Comisión SumUp: pendiente de datos de SumUp", **sin "líquido"** | **PASS** |
| Movimientos | Septiembre carga; grupos "SumUp · Ofrendas" y "SumUp · Cafetería" marcados **"solo lectura"**; **0 botones Editar/Anular en las 14 filas o grupos SumUp**; los 32 Editar/Anular están solo en movimientos manuales | **PASS** |
| Ofrendas y Cafetería | "Tarjeta SumUp (bruto)"; sin "líquido"; estado **"SumUp Ofrendas: ✓ Conectado"** y **"SumUp Cafetería: ✓ Conectado"** (ya no "Con error") | **PASS** |
| Diezmos | Lista "Personas y familias" (fichas con "Registrar"); una ficha abierta solo para ver su estructura: registros de 12 meses, **historial de registros**, selector de años y acompañamiento pastoral | **PASS** |
| Reportes | **Septiembre 2026: ingresos $7.661.647 · egresos $6.860.000 · resultado $801.647 · diezmos $2.926.397 · movimientos 789, idénticos al baseline.** **Anual 2026: $34.589.315 · $6.910.000 · $27.679.315 · diezmos $3.126.397 · 6.386 movimientos, idénticos al baseline.** Secciones de Slice 6: resumen ejecutivo, alertas veraces (SumUp en bruto, histórico sin separar), por tipo de dinero, por fuente, días de culto | **PASS** |
| Octubre | Sigue sin resumen mensual (`financeMonthlySummaries/2026-10` no existe): **no hay movimientos en octubre**. La app muestra "Aún no hay movimientos en octubre 2026". No se crearon movimientos para forzarlo; se verifica en A5 con el primer movimiento real (domingo de culto) | Documentado |
| Consola del navegador | Sin mensajes | 0 errores |

**Verificación (02:37 UTC):**
- Reglas desde A4: 104 ALLOW · **0 DENY**. Errores y 5xx desde A4: **0**. Los 9 resúmenes mensuales siguen = baseline.
- Rules sin cambios (`2d9939ab…`). Functions sin cambios (`-00006`/`-00007`/`-00002`).
- Scheduler ENABLED (próximo 03:21). Alerta habilitada y sin disparos.

**Smoke real Admin:** pendiente (Salvador cambia la sesión del navegador a la cuenta admin).
