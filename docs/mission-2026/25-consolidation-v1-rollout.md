# 25 · Consolidación V1: runbook del rollout controlado (miércoles 7-10-2026)

> **NO EJECUTADO.** Este documento solo prepara el rollout. Cada fase exige un **GO explícito de Salvador** y termina en **HARD STOP**.
> **Actualización R1/R4 (2026-10-08).** El baseline productivo cambió: SumUp CASH (05/10), la recuperación del Hosting del 05/10 (R0B–R0D) y la seguridad del modal de efectivo (PR #11, R0E–R0G) ya están en producción. Rama productiva `feature/preproduccion-mobile-v1` @ **`a312c96`**; Hosting **`3d1dc8bc8d1bcc29`**; Rules `2d9939ab-2a9e-491e-b176-1cafd939e568`; Functions `campaignshare-00002-dij`, `sumupsyncnow-00007-wut`, `sumupsyncscheduled-00008-nek`; baseline financiero **A9 post-CASH**. La pila quedó `a312c96` → PR #5 `a8d782d` → PR #7 (este PR). Los valores de la Etapa A (`edb77ffc04532a95`, `-00006/-00007`, montos A0) quedan **solo como evidencia histórica pre-CASH**. El C-A0 del 08/10 terminó en STOP (doc 21) por ese cambio de baseline; el próximo C-A0 parte de estos valores.
> Spec: [doc 23](23-consolidation-v1-production-spec.md) · Seguridad: [doc 24](24-consolidation-v1-security-review.md) · Etapa B (Platform + Calendar): [doc 20](20-platform-calendar-rc1-readiness.md) §13–14 · Bitácora: [doc 21](21-controlled-rollout-log.md).

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

Commits exactos a verificar al iniciar C-A0 (`git fetch` + `gh pr view`):

| Pieza | Commit esperado |
|---|---|
| Producción hoy (post-CASH, post-R0G) | `a312c96c95d6b6ad2c336a72729bfb480791e1ff`: ruleset `2d9939ab-2a9e-491e-b176-1cafd939e568`, Hosting `3d1dc8bc8d1bcc29`, Functions `sumupsyncnow-00007-wut` · `sumupsyncscheduled-00008-nek` · `campaignshare-00002-dij` |
| PR #5 (Etapa B) | head `a8d782de1277ca8c387eccbb216f5c9e0b2cb405` (base `feature/preproduccion-mobile-v1`) |
| PR #7 (Consolidación) | el head registrado en el doc 21 (sección R1/R4); verificar que lo posterior solo cambie `docs/` |
| *Histórico (pre-CASH, NO USAR como objetivo)* | *Etapa A `0d1bb0d`: Hosting `edb77ffc04532a95`, Functions `-00006` · `-00007` · `-00002`; PR #5 `73b9040`; PR #7 `a2579ba`/`92ee592`* |

Checklist de C-A0, en orden (cada ítem deja evidencia en el doc 21, sin PII):
1. **Commits:** los heads de PR #5 y PR #7 coinciden con la tabla; ambos PR en Draft, sin commits nuevos no revisados.
2. **A5:** último reporte de `~/cds-ops/a5-check.mjs` sin STOP (y uno nuevo corrido al iniciar C-A0).
3. **Snapshot de solo lectura** (`~/cds-ops/prod-snap.sh`): ruleset, versión de Hosting, `functions:list`, índices = la fila "Producción hoy". Se anotan como **objetivos de rollback**.
4. **Montos = baseline A9 post-CASH** (ene–sep 34.752.315 / 6.910.000 / diezmos 3.126.397 / 6.387 movs; `~/cds-ops/baseline-a9.json`), resumen de octubre = ledger 9/9 y `~/cds-ops/r0g-fin-snap.mjs snap` como foto previa. Las escrituras `system:sumup` de la ventana se aceptan solo si son creaciones legítimas (rev 1, nunca modificadas, autor `system:sumup`, activas).
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

En un **checkout limpio** del commit a desplegar (`~/cds-deploy`):

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

Reglas comunes: `--project cds-administracion` explícito; hora de inicio anotada en el doc 21; CLI del repo (`./node_modules/.bin/firebase`, doc 21 A3); consola del navegador abierta en los smokes; nunca escribir datos de prueba en producción.

| Fase | Comando / acción | Verificación | GO | STOP | Rollback |
|---|---|---|---|---|---|
| **C-A0 · Backup, snapshot, A5** | `gcloud firestore export gs://cds-administracion-backups/pre-consolidacion-$(date +%Y%m%d-%H%M) --project cds-administracion` · snapshot de solo lectura (ruleset, versión de Hosting, `functions:list`, índices) · correr `~/cds-ops/a5-check.mjs` | Export SUCCESSFUL; producción = `a312c96` (`2d9939ab…`, `3d1dc8bc8d1bcc29`, `-00007-wut/-00008-nek/-00002-dij`); A5 sin STOP; **montos = baseline A9** | Todo OK y D1–D5 resueltos | Export falla, A5 con STOP, producción distinta | Nada cambió |
| **C-A1 · Etapa B (PR #5)** | Fases 0–5 del doc 20 §13 (índice de calendario, reglas RC1, **Functions de calendario por nombre** — `calendarPublicFeed`, `calendarShareLinkManage` —, Hosting RC1, smoke). **Sin** Fases 6–7 (migración) salvo GO aparte | Las del doc 20 (Finanzas idéntico, modal de efectivo R0G y aviso SumUp CASH intactos, calendario OK; `sumupsyncnow-00007-wut`, `sumupsyncscheduled-00008-nek`, `campaignshare-00002-dij` **sin cambio**) | Smoke del doc 20 Fase 5 PASS | Cualquier diferencia en Finanzas | Doc 20 §14 |
| **C-A2 · Smoke Platform + Calendar** | Admin y pastor, solo lectura | Finanzas: montos = baseline A9 post-CASH; Calendario visible; **Integrantes NO aparece** (aún no hay Hosting de Consolidación); 0 DENY nuevos | Todo igual | Diferencias | Doc 20 §14 |
| **C-A2.5 · Merge del PR de Consolidación** | Con PR #5 ya mergeado: cambiar la base del PR de Consolidación a `feature/preproduccion-mobile-v1`, verificar que el diff muestre solo Consolidación, mergear (merge commit) | `git diff --stat <merge> <head-de-la-rama>` vacío | Diff vacío | Diff no vacío | `git revert -m 1` |
| **C-A3 · Índices** *(adelantado: ver §4)* | `./node_modules/.bin/firebase deploy --only firestore:indexes --project cds-administracion` | `firebase firestore:indexes` lista los 3 índices `members*`; en la consola pasan a **Habilitado** | 3 índices READY | El CLI propone **borrar** índices → responder **No** y STOP | No hace falta (aditivos, sin datos) |
| **C-A4 · Rules de Consolidación** | `./node_modules/.bin/firebase deploy --only firestore:rules --project cds-administracion` | Ruleset nuevo = `firestore.rules` del commit (byte a byte). Simulación de reglas (API `:test`): admin lee `membersPeople`; pastor legacy, leader y finance **no**; nadie escribe. Finanzas: smoke admin + pastor sin DENY nuevos | Simulación esperada y 0 DENY nuevos | Cualquier DENY en Finanzas o Calendario | Restaurar el ruleset de C-A1 (consola › Reglas › historial) |
| **C-A5 · Functions de Consolidación, POR NOMBRE** | `./node_modules/.bin/firebase deploy --only functions:membersPersonCreate,functions:membersPersonUpdate,functions:membersStatusChange,functions:membersVisitCreate,functions:membersFollowUpCreate,functions:membersOwnerOptions --project cds-administracion` | `functions:list`: 6 nuevas en `southamerica-west1`; **SumUp, campaignShare y calendario con la MISMA revisión que en C-A1**. Sin auth: `curl -s -X POST -H 'Content-Type: application/json' -d '{"data":{}}' https://southamerica-west1-cds-administracion.cloudfunctions.net/membersOwnerOptions` → `UNAUTHENTICATED` (no escribe nada) | 6 ACTIVE, revisiones financieras sin cambio | El CLI intenta tocar otras funciones; error de IAM; revisión de `sumupSync*` cambió | `firebase functions:delete <las 6> --region southamerica-west1 --project cds-administracion` (borra código, **no datos**) |
| **C-A6 · Hosting con Integrantes** | En `~/cds-deploy` @ commit exacto: `git merge-base --is-ancestor a312c96 HEAD` (0) · `rm -rf out .next && npm run build && npm run check:no-preview` · en `out/`: `grep -rlF "Cargar valores vigentes" out` y `grep -rl "SumUp ya registr" out` (modal R0G y aviso SumUp CASH presentes) · `./node_modules/.bin/firebase deploy --only hosting --project cds-administracion --dry-run` y luego sin `--dry-run` | `curl` 200 en `/integrantes/consolidacion` y demás rutas; `check:no-preview` OK; modal R0G presente | Deploy OK | `check:no-preview` falla | Consola › Hosting › historial → versión de C-A1 |
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
| R1 · Ocultar | Consola › Hosting › historial → **revertir a la versión de C-A1** | Integrantes desaparece del menú y de las rutas. Finanzas y Calendario quedan como en C-A1 |
| R2 · Detener escrituras | `./node_modules/.bin/firebase functions:delete membersPersonCreate membersPersonUpdate membersStatusChange membersVisitCreate membersFollowUpCreate membersOwnerOptions --region southamerica-west1 --project cds-administracion` | Nadie puede escribir (ni con la consola del navegador). No toca SumUp ni calendario. Los datos no se borran |
| R4 · Cerrar lectura | Consola › Reglas › historial → **restaurar el ruleset de C-A1** | Las 4 colecciones caen en el catch-all: nadie las lee desde el cliente. Datos intactos |
| R5 · Índices | No se tocan | Aditivos e inofensivos |

Si hay urgencia (exposición de datos), R1 + R2 + R4 pueden ir primero y R3 después: el acceso lo cierran las reglas, no los perfiles.

- Cada paso es independiente: ante un problema de UI basta R1; ante un problema de escrituras, R1 + R2.
- **Nunca** se revierte Financial Core ni se toca SumUp CASH en un rollback de Consolidación.
- **Nunca** `firebase deploy --only functions` sin nombres ni redeploy de Functions desde un checkout anterior: el árbol de PR #5/#7 contiene un `sumupSyncNow` con `requireFinanceUser` refactorizado (doc 20 §19) que **no** está desplegado (`-00007-wut`), y un checkout anterior a `ee33aa9` quitaría SumUp CASH.
- Los únicos objetivos de rollback de Hosting y Rules son los anotados en C-A0/C-A1 (hoy `3d1dc8bc8d1bcc29` y `2d9939ab…`); `edb77ffc04532a95`, `9e616f79835a96c2`, `f4591416f0474b0f` y `8d0087d6…` son **históricos, NO USAR** (no tienen R0G y/o CASH).
- Re-habilitar: C-A4 → C-A5 → C-A6 desde el mismo commit.

### 5.1 Caveat legacy ampliado (Atlas A-02, doc 20 §14)

Un usuario v1 con **solo** permisos de Integrantes guarda `role = "leader"` (rol derivado). Si alguna vez se volviera a las **reglas legacy de la Etapa A** (`e6b2084`), ese rol leería el **resumen financiero** mensual. El doc 20 lo aceptó con conteo 0; cada grant de C-A8/C-A12 a alguien sin finanzas lo sube.
- El detector existe: `--summary` → "v1 con riesgo de rollback".
- El rollback de Consolidación (R4) vuelve a **RC1**, no a las reglas legacy: sigue siendo seguro.
- Si algún día se vuelve a las reglas legacy: aplicar antes el procedimiento del doc 20 §14 (desactivar a esos usuarios) **y** R3.

## 6. Observación posterior

Diario durante 7 días (además de A5/Etapa B):
- `functions:list` (revisiones de las 6 `members*` y de SumUp sin cambios);
- logs `severity>=ERROR` de las `members*` (sin PII: el código solo registra método, nombre y código del error);
- evaluaciones de reglas DENY (esperadas: 0 en Finanzas);
- `node scripts/migrate-access-v1.mjs --project cds-administracion --summary` (bloque Integrantes: solo los grants decididos);
- montos financieros = baseline A9 post-CASH (A5) y `r0g-fin-snap.mjs compare` sin escrituras que no sean creaciones legítimas de SumUp.

## 7. Qué NO se hace el miércoles

- Ningún deploy de SumUp CASH (otro carril, otro PR, otro deploy).
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
