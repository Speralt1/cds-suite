# 25 · Consolidación V1: runbook del rollout controlado (miércoles 7-10-2026)

> **NO EJECUTADO.** Este documento solo prepara el rollout. Cada fase exige un **GO explícito de Salvador** y termina en **HARD STOP**.
> **Actualización R1/R4 (2026-10-08).** El baseline productivo cambió: SumUp CASH (05/10), la recuperación del Hosting del 05/10 (R0B–R0D) y la seguridad del modal de efectivo (PR #11, R0E–R0G) ya están en producción. Rama productiva `feature/preproduccion-mobile-v1` @ **`a312c96`**; Hosting **`3d1dc8bc8d1bcc29`**; Rules `2d9939ab-2a9e-491e-b176-1cafd939e568`; Functions `campaignshare-00002-dij`, `sumupsyncnow-00007-wut`, `sumupsyncscheduled-00008-nek`; baseline financiero **A9 post-CASH**. La pila quedó `a312c96` → PR #5 `a8d782d` → PR #7 (este PR). Los valores de la Etapa A (`edb77ffc04532a95`, `-00006/-00007`, montos A0) quedan **solo como evidencia histórica pre-CASH**. El C-A0 del 08/10 terminó en STOP (doc 21) por ese cambio de baseline; el próximo C-A0 parte de estos valores.
> **Actualización R2.7 + PR #32 (2026-10-16) · VALORES VIGENTES: reemplazan a los de abajo.** Ver §0.
> Spec: [doc 23](23-consolidation-v1-production-spec.md) · Seguridad: [doc 24](24-consolidation-v1-security-review.md) · Etapa B (Platform + Calendar): [doc 20](20-platform-calendar-rc1-readiness.md) §13–14 · Bitácora: [doc 21](21-controlled-rollout-log.md).

## 0. Valores vigentes (R2.7 + PR #32 diezmantes, 16/10/2026)

Entre el 14 y el 15/10 se desplegaron C-A1 completo (C-A1.2–C-A1.6), R2 (R2.1–R2.4), R2.5, R2.6 (paleta de 24 colores: R2.6.2 Rules, R2.6.3 `calendarPublicFeed`, R2.6.4 Hosting) y R2.7 (política financiera: líderes y diáconos sin Finanzas por defecto; R2.7.1 Rules, R2.7.2 Hosting). El 16/10 se fusionó PR #32 (diezmantes, `1951f2b`) y se publicó **solo Hosting** `ec3d614eb95dc213` (sin Rules ni Functions). Esta PR quedó integrada sobre ese HEAD (doc 32 §9–§12). **Todo valor de producción citado más abajo (`a312c96`, `18925d6`, `35a234c`, `2d9939ab…`, `3d1dc8bc8d1bcc29`, `72e014e5861a25ac`, `9e449d0e…`, `cbe11685…`, `calendarpublicfeed-00001-huh`, `a9eea40`, `80a69cd5…`, `0a6ab8858afd6a23`, `638ea1f` como ancestro, "baseline A9") es histórico**; `2efde71606a551ae` (Hosting R2.7.2) queda solo como rollback de segundo nivel (§5); se usan estos:

| Pieza | Valor vigente |
|---|---|
| Rama productiva (HEAD de GitHub) | `feature/preproduccion-mobile-v1` @ **`1951f2b071499c6278f30c0fc282f7054b006fcc`** (merge de PR #32, diezmantes; CI post-merge 38851373833 SUCCESS). Contiene `638ea1f` (R2.7) |
| Ancestro obligatorio en cada fase | `git merge-base --is-ancestor 1951f2b071499c6278f30c0fc282f7054b006fcc HEAD` → 0 (contiene PR #32, R2.7 `638ea1f`, R2.6 `a9eea40`, R2.5 `35a234c`, `18925d6` y el fix del doc 26) |
| Código efectivamente desplegado | Hosting = `1951f2b` (verificado 16/10 ~12:00 UTC por contenido de los chunks públicos: textos de diezmantes presentes, mapeo `leader` solo Calendario, 24 colores, sin "Ver movimientos del día", sin código de Consolidación; Firebase no guarda el SHA). Rules = `firestore.rules` de `638ea1f` = de `1951f2b` (PR #32 no tocó Rules). Functions = las 6 de la fila de abajo, sin cambios. **Un merge en GitHub no equivale a un deploy:** en C-A0 volver a consultar el estado real |
| Firestore Rules | **`5df51b09-b460-4515-8fb5-505983c8f1c8`** (R2.7.1, política financiera) → objetivo de rollback de C-A4 (R4). Las Rules de esta PR = ese ruleset + solo los bloques de Consolidación |
| Storage Rules | `f700d246` (no se tocan) |
| Hosting (real) | **`ec3d614eb95dc213`** (PR #32 sobre R2.7; deploy CLI del 16/10 04:36:06 UTC con la cuenta del administrador, no registrado aún en el repo) → objetivo de rollback de C-A6 (R1). Segundo nivel, solo si `ec3d614e` fallara: `2efde71606a551ae` (R2.7.2; conserva la política, pierde el panel de diezmantes) |
| Índices | 7 READY → 10 tras C-A3 (3 `members*`) |
| Functions que NO deben cambiar de revisión | `calendarpublicfeed-00002-ver`, `calendarsharelinkmanage-00001-jek`, `campaignshare-00002-dij`, `sumupsyncnow-00007-wut`, `sumupsyncscheduled-00008-nek` (southamerica-east1), `sumuppayoutsreconciliation-00001-bog` |
| Baseline financiero | **A10 r2 aprobado** (`~/cds-ops/baseline-a10-20261014-r2.json`) + deltas explicados por A6 (no A9) |
| Monitores | A5 (`~/cds-ops/a5-check.mjs`, EXPECT por fase, D2) y A6 (`a6-snap.mjs` + `scripts/ops/finance-monitor/run.mjs`): 0 STOP |
| Checkout de deploy | `~/cds-deploy-r2` (o uno nuevo), detached en el **commit de merge de C-A2.5**, limpio |

**Estado de las fases previas**

| Fase | Estado |
|---|---|
| C-A1 (Etapa B: Rules, Functions de calendario, Hosting) | **Hecho** (C-A1.2–C-A1.6, 14/10), y además R2, R2.5 y R2.6 |
| C-A2 · smoke Admin | **PASS** (post-deploy de R2.4, R2.5 y R2.6.4, sesión propia del administrador) |
| C-A2 · Pastor, Pastora y Líder | **VALIDACIÓN FUNCIONAL INFORMADA POR EL ADMINISTRADOR (18/10/2026), con excepciones.** Pastor y Pastora: el administrador informa que hicieron sus pruebas reales y que sus accesos funcionan. Líder: el administrador lo comprobó desde una cuenta de líder (no necesariamente por su titular): solo Calendario. Colores nuevos: confirmados por el administrador. **Excepciones:** (1) son validaciones reportadas por el dueño del sistema, sin horarios, dispositivos ni inicios de sesión verificados en logs; (2) la prueba del líder no la hizo el titular de la cuenta; (3) el 16/10 un agente Codex usó una sesión abierta de un pastor (incidente registrado en el expediente privado). Evidencia técnica separada: matriz de accesos en emulador (doc 32 §13). |
| C-A2.5 · merge de esta PR | Pendiente de GO (C-A2 cerrado por validación del administrador, §0) |
| C-A3 … C-A12 | Sin ejecutar; un GO por fase |

**Política financiera R2.7 (vigente)**
- Líderes y diáconos sin Finanzas por defecto; «Ver resumen financiero» solo por otorgamiento individual del administrador.
- Antes y después de cada fase que despliega: `~/cds-ops/check-leader-finance.sh` debe dar 0 líderes/diáconos con Finanzas no autorizados y 0 perfiles legacy.
- Consolidación no cambia esa política: `members.consolidation.*` solo por permiso explícito o admin; un perfil solo de Integrantes se guarda como `leader` sin Finanzas.
- El panel de diezmantes (PR #32) solo consulta con `finance.details.read` (página tras `DetailGuard`; Rules de `titheProfiles`, `titheAttributions` y `financeTransactions`). «Ver resumen financiero» o `members.consolidation.*` solos no abren fichas, aportes, movimientos ni el conteo de fichas (prueba de Rules en `tests/rules/platform-access.test.ts`).

**Cambios al procedimiento por R2/R2.5**
- En C-A0, C-A4, C-A5 y C-A6 la comparación de montos es contra A10 r2 + A6 (0 STOP), no contra A9. Las escrituras `system:sumup` POS nuevas (rev 1) son normales y A5 las marca como "escritura sobre POS": se aceptan si A6 las informa como `SUMUP_CREATIONS` legítimas.
- En C-A5, `functions:list` debe mostrar las **6** Functions de la tabla con la misma revisión (antes eran 3).
- En C-A6, además de los `grep` de R0G y SumUp CASH, verificar en `out/` que sigan los textos de R2.5: "Resumen del día", "Efectivo pendiente de confirmar", "Depósitos", "Nueva actividad", "Antes de crear actividades"; la política R2.7 (mapeo `leader` solo Calendario, sin el arreglo antiguo con `finance.summary.read`), los 24 colores de R2.6 (tokens `--area-*` de los 24, p. ej. `--area-petroleo-swatch:#114e5b`, y "Disponibles: N de 24"); y que **no** esté "Ver movimientos del día". Además, el panel de diezmantes de PR #32: "Diezmantes del mes", "Fichas distintas con diezmos" y "Personas/familias registradas". Posición de fondos: la bandera `FINANCE_FEATURES.fundsPosition = false` (doc 32 §13) la oculta en la pantalla, pero el texto sigue en el bundle porque el código se conserva; por eso **no** se comprueba con `grep` en `out/`, sino en el smoke de C-A7: en `/finanzas` no aparecen "Posición de fondos" ni "Saldo bancario estimado". La configuración bancaria y la conciliación siguen en sus pantallas.
- Navegación: con Integrantes, el admin ve 5 módulos; en móvil la barra usa la etiqueta corta "Ajustes".

## 1. Decisiones humanas (RESUELTAS por Salvador el 2026-10-05)

| # | Decisión | Estado | Alcance exacto |
|---|---|---|---|
| D1 | Iniciar la Etapa B antes del cierre formal de A5 (11-10) | **APROBADO** | **No** autoriza ningún deploy inmediato: cada fase C-A0…C-A12 mantiene su propio GO explícito |
| D2 | Baseline técnico del checker A5 | **APROBADO** | Tras cada cambio productivo **esperado** de Rules, Functions o Hosting se actualiza el baseline técnico esperado (§1.2). **No** se relajan ni eliminan los controles de montos, summaries, SumUp, scheduler, 5xx, permission-denied, errores ni diferencias financieras. Un cambio técnico esperado no produce un falso STOP; **una diferencia financiera sigue siendo STOP** |
| D3 | Piloto inicial | **RESUELTO: Salvador como Admin** | Acceso implícito por rol admin: **no** se otorga `members.consolidation.*` a ningún otro usuario para el primer smoke y **no** se migra a Salvador. C-A8 no aplica |
| D4 | Migración masiva de usuarios | **APROBADO: diferida** | **No** se ejecuta `migrate-access-v1 --apply` durante el rollout inicial de Consolidación (tampoco las Fases 6–7 del doc 20). Sí se puede correr `--summary` (solo lectura) |
| D5 | PR #5 + PR #7 listos para rollout controlado | **APROBADO** | Sujeto a: C-A0 PASS; A5 sin STOP; backup exitoso; commit exacto verificado; GO humano por cada fase |
| Excepción de eliminación | Borrado manual de PII | **APROBADA con restricción** | Solo para un menor registrado por error o una solicitud explícita de eliminación. Procedimiento de emergencia en §8. Sin UI de borrado en V1; nunca para corregir errores ordinarios del pipeline |
| Visual QA | Navegador 1440/1024/390/375 | **PASS** | Doc 24 §10 (`07906e2`/`a2579ba`) |

### 1.1 C-A0 preparado (NO ejecutado; espera el GO de C-A0)

> **Vigente:** los valores esperados de producción y los montos son los del §0 (Rules `5df51b09…`, Hosting `ec3d614eb95dc213`, 6 Functions, 7 índices, baseline A10 r2 + A6 0 STOP). La tabla de commits de abajo es histórica.

Commits exactos a verificar al iniciar C-A0 (`git fetch` + `gh pr view`):

| Pieza | Commit esperado |
|---|---|
| Producción antes de C-A1 (post-CASH, post-R0G; verificado sin cambios el 13/10/2026) | `a312c96c95d6b6ad2c336a72729bfb480791e1ff` desplegado (código en GitHub: `feature/preproduccion-mobile-v1` @ `18925d6`, que también contiene el fix de Rules del doc 26): ruleset `2d9939ab-2a9e-491e-b176-1cafd939e568`, Hosting `3d1dc8bc8d1bcc29`, Functions `sumupsyncnow-00007-wut` · `sumupsyncscheduled-00008-nek` · `campaignshare-00002-dij` |
| PR #5 (Etapa B) | head `a8d782de1277ca8c387eccbb216f5c9e0b2cb405` (base `feature/preproduccion-mobile-v1`) |
| PR #7 (Consolidación) | el head registrado en el doc 21 (sección R1/R4); verificar que lo posterior solo cambie `docs/` |
| *Histórico (pre-CASH, NO USAR como objetivo)* | *Etapa A `0d1bb0d`: Hosting `edb77ffc04532a95`, Functions `-00006` · `-00007` · `-00002`; PR #5 `73b9040`; PR #7 `a2579ba`/`92ee592`* |

Checklist de C-A0, en orden (cada ítem deja evidencia en el doc 21, sin PII):
1. **Commits:** los heads de PR #5 y PR #7 coinciden con la tabla; ambos PR en Draft, sin commits nuevos no revisados.
2. **A5:** último reporte de `~/cds-ops/a5-check.mjs` sin STOP (y uno nuevo corrido al iniciar C-A0).
3. **Snapshot de solo lectura** (`~/cds-ops/prod-snap.sh`): ruleset, versión de Hosting, `functions:list`, índices = los valores del §0 (**STOP si difieren**). Se anotan como **objetivos de rollback**.
4. **Montos = baseline A10 r2 aprobado** (`~/cds-ops/baseline-a10-20261014-r2.json`) + deltas explicados por A6 (0 STOP) y ledger = resúmenes 9/9. *Histórico:* baseline A9 post-CASH (ene–sep 34.752.315 / 6.910.000 / diezmos 3.126.397 / 6.387 movs; `~/cds-ops/baseline-a9.json`), resumen de octubre = ledger 9/9 y `~/cds-ops/r0g-fin-snap.mjs snap` como foto previa. Las escrituras `system:sumup` de la ventana se aceptan solo si son creaciones legítimas (rev 1, nunca modificadas, autor `system:sumup`, activas).
5. **Backup** (solo con el GO de C-A0): `gcloud firestore export gs://cds-administracion-backups/pre-consolidacion-$(date +%Y%m%d-%H%M) --project cds-administracion` → SUCCESSFUL.
6. **Decisiones:** D1–D5 y la excepción de eliminación registradas (esta sección).
7. **Gates del §2** en un checkout limpio de los commits exactos.
8. HARD STOP → reporte C-A0 → GO para C-A1.

### 1.2 Baseline técnico del checker A5 (D2)

El checker vive fuera del repo (`~/cds-ops/a5-check.mjs`). Después de **cada** fase que cambie Rules, Functions o Hosting (C-A1, C-A4, C-A5, C-A6 y sus rollbacks):
1. leer el nuevo id desplegado (ruleset, revisiones de Functions, versión de Hosting) con las mismas APIs de solo lectura del snapshot;
2. actualizar **solo** los valores técnicos esperados del checker (sin tocar ninguna otra condición);
3. correr el checker y confirmar "sin STOP";
4. anotar en el doc 21: fase, componente, id anterior → id nuevo.

Se mantienen **intactos** y siguen siendo STOP: montos y summaries vs. baseline, estado de SumUp (created/updated/voided sin causa, errores), scheduler (no-2xx, intervalos), 5xx, permission-denied inesperados, `severity>=ERROR` y cualquier diferencia financiera. Las 6 Functions `members*` nuevas se agregan como esperadas en C-A5 (si faltan o fallan, es STOP de Consolidación, no de Finanzas).

## 2. Gates que deben estar en verde en el commit exacto

En un **checkout limpio** del commit a desplegar (`~/cds-deploy-r2`, §0):

```bash
npm ci && npm --prefix functions ci
```

```bash
npm run lint && npm run typecheck && npx vitest run
```

```bash
npm run test:rules && npm run test:emulator
```

```bash
node scripts/build-shared.mjs --check
```

```bash
rm -rf out && npm run build && npm run check:no-preview
```

`check:no-preview` exige las 6 rutas de Integrantes en `out/` y la ausencia de `/preview`, demo (`demo-cds-suite`, `@cds.test`, `@example.test`, teléfonos ficticios), preview (`suite-preview`, `finance-preview`, WhatsApp simulado) y campos excluidos (`faithConfession`, `baptized`, `birthDate`, …).

## 3. Fases

Reglas comunes: cada fase que despliega (C-A3, C-A4, C-A5, C-A6) empieza en `~/cds-deploy-r2` (§0) con `git rev-parse HEAD` = el commit exacto del merge y `git merge-base --is-ancestor 1951f2b071499c6278f30c0fc282f7054b006fcc HEAD` (0; producción R2.7 + PR #32, §0; ya contiene `638ea1f`, ya contiene `a9eea40`, `35a234c`, `a312c96`, `18925d6` y el fix de Rules del doc 26/32); `--project cds-administracion` explícito; hora de inicio anotada en el doc 21; CLI del repo (`./node_modules/.bin/firebase`, doc 21 A3); consola del navegador abierta en los smokes; nunca escribir datos de prueba en producción.

| Fase | Comando / acción | Verificación | GO | STOP | Rollback |
|---|---|---|---|---|---|
| **C-A0 · Backup, snapshot, A5** | `gcloud firestore export gs://cds-administracion-backups/pre-consolidacion-$(date +%Y%m%d-%H%M) --project cds-administracion` · snapshot de solo lectura (ruleset, versión de Hosting, `functions:list`, índices) · correr `~/cds-ops/a5-check.mjs` | Export SUCCESSFUL; producción = valores del §0 (Rules `5df51b09…`, Hosting `ec3d614eb95dc213`, las 6 Functions del §0, 7 índices READY: **STOP si difieren**; histórico: `a312c96`, `2d9939ab…`, `3d1dc8bc8d1bcc29`, `-00007-wut/-00008-nek/-00002-dij`); A5 sin STOP; **montos = baseline A10 r2 + A6 sin STOP** (histórico: baseline A9) | Todo OK y D1–D5 resueltos | Export falla, A5 con STOP, producción distinta | Nada cambió |
| **C-A1 · Etapa B (PR #5)** · *HECHO (14/10), ver §0; fila histórica* | Fases 0–5 del doc 20 §13 (índice de calendario, reglas RC1, **Functions de calendario por nombre** — `calendarPublicFeed`, `calendarShareLinkManage` —, Hosting RC1, smoke). **Sin** Fases 6–7 (migración) salvo GO aparte | Las del doc 20 (Finanzas idéntico, modal de efectivo R0G y aviso SumUp CASH intactos, calendario OK; `sumupsyncnow-00007-wut`, `sumupsyncscheduled-00008-nek`, `campaignshare-00002-dij` **sin cambio**) | Smoke del doc 20 Fase 5 PASS | Cualquier diferencia en Finanzas | Doc 20 §14 |
| **C-A2 · Smoke Platform + Calendar** · *Admin PASS; Pastor, Pastora y Líder: validación funcional informada por el administrador (§0)* | Admin, Pastor, Pastora y un Líder, cada uno con su sesión propia, solo lectura (protocolo C-A2; el Líder **no** debe ver Finanzas, política R2.7) | Finanzas: montos = baseline A10 r2 (histórico: A9 post-CASH); Calendario visible; **Integrantes NO aparece** (aún no hay Hosting de Consolidación); 0 DENY nuevos | Todo igual | Diferencias | Nada que revertir (solo lectura): STOP y reporte |
| **C-A2.5 · Merge del PR de Consolidación** | Con PR #5 ya mergeado: cambiar la base del PR de Consolidación a `feature/preproduccion-mobile-v1`, verificar que el diff muestre solo Consolidación, mergear (merge commit) | `git diff --stat <merge> <head-de-la-rama>` vacío | Diff vacío | Diff no vacío | `git revert -m 1` |
| **C-A3 · Índices** *(adelantado: ver §4)* | `./node_modules/.bin/firebase deploy --only firestore:indexes --project cds-administracion` | `firebase firestore:indexes` lista los 3 índices `members*`; en la consola pasan a **Habilitado** | 3 índices READY | El CLI propone **borrar** índices → responder **No** y STOP | No hace falta (aditivos, sin datos) |
| **C-A4 · Rules de Consolidación** | `./node_modules/.bin/firebase deploy --only firestore:rules --project cds-administracion` | Ruleset nuevo = `firestore.rules` del commit (byte a byte). Simulación de reglas (API `:test`): admin lee `membersPeople`; pastor legacy, leader y finance **no**; nadie escribe. Finanzas: smoke admin + pastor sin DENY nuevos | Simulación esperada y 0 DENY nuevos | Cualquier DENY en Finanzas o Calendario | R4: restaurar `5df51b09-b460-4515-8fb5-505983c8f1c8` (consola › Reglas › historial; §0) |
| **C-A5 · Functions de Consolidación, POR NOMBRE** | `./node_modules/.bin/firebase deploy --only functions:membersPersonCreate,functions:membersPersonUpdate,functions:membersStatusChange,functions:membersVisitCreate,functions:membersFollowUpCreate,functions:membersOwnerOptions --project cds-administracion` | `functions:list`: 6 nuevas en `southamerica-west1`; **las 6 Functions del §0 (incluidas `calendarpublicfeed-00002-ver` y `sumuppayoutsreconciliation-00001-bog`) con la MISMA revisión**. Sin auth: `curl -s -X POST -H 'Content-Type: application/json' -d '{"data":{}}' https://southamerica-west1-cds-administracion.cloudfunctions.net/membersOwnerOptions` → `UNAUTHENTICATED` (no escribe nada) | 6 ACTIVE, revisiones financieras sin cambio | El CLI intenta tocar otras funciones; error de IAM; revisión de `sumupSync*` cambió | `firebase functions:delete <las 6> --region southamerica-west1 --project cds-administracion` (borra código, **no datos**) |
| **C-A6 · Hosting con Integrantes** | En `~/cds-deploy-r2` @ commit exacto: `git merge-base --is-ancestor 1951f2b071499c6278f30c0fc282f7054b006fcc HEAD` (0; producción R2.7 + PR #32, §0; ya contiene `638ea1f`, ya contiene `a9eea40`, `35a234c`, `a312c96`, `18925d6` y el fix de Rules del doc 26/32) · `rm -rf out .next && npm run build && npm run check:no-preview` · en `out/`: `grep -rlF "Cargar valores vigentes" out` `grep -rlF "no pudimos confirmar los datos con el servidor" out` y `grep -rl "SumUp ya registr" out` (modal R0G y aviso SumUp CASH presentes) · `./node_modules/.bin/firebase deploy --only hosting --project cds-administracion --dry-run` y luego sin `--dry-run` | `curl` 200 en `/integrantes/consolidacion` y demás rutas; `check:no-preview` OK; modal R0G presente | Deploy OK | `check:no-preview` falla | R1: revertir a `ec3d614eb95dc213` (consola › Hosting › historial; §0; segundo nivel `2efde71606a551ae`) |
| **C-A7 · Smoke Admin** | Admin, **solo lectura** | Integrantes visible (5 módulos; barra móvil "Ajustes"); dashboard en **estado vacío**; Atención vacía; Personas vacía; lista de responsables carga (callable `membersOwnerOptions`); Finanzas = baseline; Calendario igual; consola sin errores; 0 DENY nuevos | Todo OK | Error, DENY o diferencia en Finanzas | C-A6 → C-A5 → C-A4 (en ese orden, §5) |
| **C-A8 · Permiso del piloto** | **No aplica (D3):** el piloto es Salvador como Admin (acceso implícito). No se otorga ningún grant. Solo se verifica, con `--summary` (lectura), que el bloque Integrantes siga en `explícitos 0` y que **un pastor NO vea** Integrantes (deep link redirige con aviso) | `consolidation.read/manage explícito 0`; pastor sin acceso | 0 grants | Cualquier grant inesperado | Quitar el permiso desde la UI (inmediato) |
| **C-A9 · Smoke de Consolidación (sin escribir)** | Piloto | Navegación por las 5 pantallas, formularios abiertos y cerrados **sin guardar**; advertencias visibles ("solo adultos", "no registres información médica…"); sin campos de nacimiento/fe/bautismo; WhatsApp no aparece sin personas | Todo OK | Cualquier campo sensible o error | C-A6 |
| **C-A10 · Primera persona real** | Solo en el **uso operacional normal** (p. ej. una persona nueva del culto). **Nunca** personas de prueba en producción | La persona aparece en "Nuevos recientes" y en Personas; `membersPersonChanges` tiene `person_created` con actor y hora | Registro OK | Error de la Function o dato mal guardado | Ver §5 (nunca se borran datos) |
| **C-A11 · Recorrido completo** | Con esa persona, en el uso normal: visita → seguimiento → (sugerencia confirmada) → alerta → timeline | Timeline con creación, visita, seguimiento y cambio de estado; alertas coherentes; auditoría completa | Todo OK | Cualquier inconsistencia | §5 |
| **C-A12 · Uso controlado** | Otorgar el permiso a las personas que Salvador decida (uno por uno) | `--summary` después de cada grant; observación diaria (§6) | Estable 7 días | Errores, DENY o quejas de privacidad | §5 |

## 4. Cambios de orden respecto del brief (y por qué)

- **Índices antes que Rules y Functions** (C-A3): son aditivos, tardan minutos en construirse y la ficha los necesita. Si se despliegan después del Hosting, la primera ficha abierta falla con `FAILED_PRECONDITION`.
- **Merge del PR de Consolidación (C-A2.5) antes de desplegar**, para que lo desplegado sea exactamente lo mergeado (misma práctica que A1/Etapa B).
- Rules → Functions → Hosting se mantiene: con Rules y Functions activas pero sin Hosting, Integrantes no es visible ni alcanzable (no hay UI y nadie tiene grants salvo admin).

## 5. Rollback (independiente de Finanzas y de SumUp CASH)

**Principio:** el rollback **oculta y detiene escrituras**; **nunca** borra datos. Los datos de personas quedan en Firestore, inaccesibles si se revierten las reglas.

Orden **R3 → R1 → R2 → R4** (Atlas A-01): los grants se revocan mientras la UI de Consolidación sigue publicada, porque la UI de C-A1 no tiene el grupo "Integrantes".

| Paso | Acción | Efecto |
|---|---|---|
| R3 · Revocar grants (higiene, primero) | Con el Hosting de Consolidación aún publicado: Configuración › Usuarios → quitar "Ver/Gestionar Consolidación" a quien lo tenga, incluidos los inactivos. Verificar con `node scripts/migrate-access-v1.mjs --project cds-administracion --summary` **desde un checkout del commit de Consolidación** (es el único `--summary` con ese bloque): `explicitRead + explicitManage + inactiveWithGrant == 0` | Deja los perfiles limpios para RC1. **No** es el cierre de acceso (eso es R2/R4): con las reglas RC1 esos permisos guardados no dan acceso a nada, y la UI de C-A1 los descartaría al guardar |
| R1 · Ocultar | Consola › Hosting › historial → **revertir a `ec3d614eb95dc213`** (R2.7 + diezmantes; §0). Segundo nivel: `2efde71606a551ae` | Integrantes desaparece del menú y de las rutas. Finanzas y Calendario quedan como en C-A1 |
| R2 · Detener escrituras | `./node_modules/.bin/firebase functions:delete membersPersonCreate membersPersonUpdate membersStatusChange membersVisitCreate membersFollowUpCreate membersOwnerOptions --region southamerica-west1 --project cds-administracion` | Nadie puede escribir (ni con la consola del navegador). No toca SumUp ni calendario. Los datos no se borran |
| R4 · Cerrar lectura | Consola › Reglas › historial → **restaurar `5df51b09-b460-4515-8fb5-505983c8f1c8`** (R2.7.1; §0) | Las 4 colecciones caen en el catch-all: nadie las lee desde el cliente. Datos intactos |
| R5 · Índices | No se tocan | Aditivos e inofensivos |

Si hay urgencia (exposición de datos), R1 + R2 + R4 pueden ir primero y R3 después: el acceso lo cierran las reglas, no los perfiles.

- Cada paso es independiente: ante un problema de UI basta R1; ante un problema de escrituras, R1 + R2.
- **Nunca** se revierte Financial Core ni se toca SumUp CASH en un rollback de Consolidación.
- **Nunca** `firebase deploy --only functions` sin nombres ni redeploy de Functions desde un checkout anterior: el árbol de PR #5/#7 contiene un `sumupSyncNow` con `requireFinanceUser` refactorizado (doc 20 §19) que **no** está desplegado (`-00007-wut`), y un checkout anterior a `ee33aa9` quitaría SumUp CASH.
- **Vigente (§0):** los objetivos de rollback de Consolidación son Rules `5df51b09-b460-4515-8fb5-505983c8f1c8` (último publicado, R2.7.1) y Hosting `ec3d614eb95dc213` (último publicado: R2.7 + PR #32); `2efde71606a551ae` es aceptable como segundo nivel (misma política, sin panel de diezmantes). **No** usar `80a69cd5`/`0a6ab8858afd6a23` como destino: devolverían el resumen financiero a líderes legacy y el Hosting anterior lo volvería a asignar al crear líderes. *Histórico:* los únicos objetivos de rollback de Hosting y Rules de Consolidación eran los que dejaba **C-A1** (Rules de `18925d6` y Hosting RC1). **`2d9939ab…` NO es objetivo de rollback de Consolidación** (es pre-Platform; ver §5.1); solo lo es de C-A1 mismo (doc 20 §14). Los anteriores a C-A1 en producción eran `3d1dc8bc8d1bcc29` y `2d9939ab…`; `edb77ffc04532a95`, `9e616f79835a96c2`, `f4591416f0474b0f` y `8d0087d6…` son **históricos, NO USAR** (no tienen R0G y/o CASH).
- Re-habilitar: C-A4 → C-A5 → C-A6 desde el mismo commit.

### 5.1 Caveat legacy ampliado (Atlas A-02, doc 20 §14)

Un usuario v1 con **solo** permisos de Integrantes guarda `role = "leader"` (rol derivado). Si alguna vez se volviera a las **reglas legacy de la Etapa A** (`e6b2084`), ese rol leería el **resumen financiero** mensual. El doc 20 lo aceptó con conteo 0; cada grant de C-A8/C-A12 a alguien sin finanzas lo sube.
- El detector existe: `--summary` → "v1 con riesgo de rollback".
- El rollback de Consolidación (R4) vuelve a las Rules R2.7 **`5df51b09`** (§0), no a las reglas legacy: sigue siendo seguro. Volver más atrás, a `80a69cd5`, solo afectaría a documentos de esquema legacy con role leader (hoy 0), que recuperarían el resumen financiero.
- Si algún día se vuelve a las reglas legacy: aplicar antes el procedimiento del doc 20 §14 (desactivar a esos usuarios) **y** R3.

## 6. Observación posterior

Diario durante 7 días (además de A5/Etapa B):
- `functions:list` (revisiones de las 6 `members*` y de SumUp sin cambios);
- logs `severity>=ERROR` de las `members*` (sin PII: el código solo registra método, nombre y código del error);
- evaluaciones de reglas DENY (esperadas: 0 en Finanzas);
- `node scripts/migrate-access-v1.mjs --project cds-administracion --summary` (bloque Integrantes: solo los grants decididos);
- montos financieros = baseline A10 r2 + deltas explicados (A5 y A6 sin STOP; antes: baseline A9 post-CASH) y `r0g-fin-snap.mjs compare` sin escrituras que no sean creaciones legítimas de SumUp.

## 7. Qué NO se hace el miércoles

- Ningún deploy de `sumupSyncNow`, `sumupSyncScheduled` ni `campaignShare`: SumUp CASH ya está en producción; Functions solo por nombre.
- Ninguna migración masiva de usuarios (D4): no `migrate-access-v1 --apply`.
- Ningún grant de `members.consolidation.*` para el primer smoke (D3).
- Ninguna persona ficticia en producción.
- Ningún cambio de Financial Core.

## 8. Eliminación manual de emergencia (excepción aprobada con restricción)

**Solo** cuando (a) se registró por error a un **menor de edad**, o (b) hay una **solicitud explícita de eliminación** de datos personales. **Nunca** para corregir errores ordinarios (duplicados, datos mal escritos, estados): eso se hace con Editar o "Sin continuidad" (doc 23 §7b). V1 no tiene UI de borrado.

**Quién:** un Admin (Salvador), desde la consola de Firebase del proyecto real (no pasa por la app ni por las Functions). Nunca un agente sin GO explícito para ese caso.

**Pasos:**
1. Identificar el `personId` desde la ficha (`/integrantes/consolidacion/persona?id=…`). **No** copiar nombre, teléfono, correo ni notas a ningún chat, ticket, doc ni log.
2. Borrar, en Firestore (consola):
   - todos los `membersVisits` con `personId == <id>`;
   - todos los `membersFollowUps` con `personId == <id>`;
   - todos los `membersPersonChanges` con `personId == <id>` (pueden contener notas de cierre o cambios con valores);
   - el documento `membersPeople/<id>`.
   Verificar con las mismas consultas que quedan **0** documentos.
3. Revisar si **otras** personas tienen en sus notas una referencia a esa persona (p. ej. "hermano de…"): si la hay, editar o anonimizar ese texto con Editar (o, si es una nota de historial, con la consola) dejando "[dato eliminado]".
4. **Tombstone técnico no identificable** (máximo): una fila en el doc 21, sección "Eliminaciones de emergencia", con **solo**: tipo (`menor` | `solicitud`), fecha, actor (rol: "Admin"), motivo general y cantidad de documentos borrados por colección. **Sin** `personId`, nombre, teléfono, correo ni notas.
5. **Backups:** los exports previos de Firestore (p. ej. `pre-consolidacion-*`) conservan los datos hasta su expiración. Para una solicitud de eliminación, anotar en el tombstone la fecha en que vence el último export que los contiene y no restaurar ese export sin repetir este procedimiento.
6. Los logs de las Functions `members*` no contienen PII por diseño (solo método, nombre y código del error): no hay nada que limpiar ahí.

**Efectos:** desaparecen la persona, su historial y sus alertas; las alertas de "Posible duplicado" de otras personas con ese teléfono/correo se resuelven solas. Las reglas y las Functions no cambian.
