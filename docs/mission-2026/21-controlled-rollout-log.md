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

### A2 · Firestore Rules: desplegado; smoke de la UI en curso

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
