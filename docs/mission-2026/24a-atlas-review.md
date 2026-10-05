# 24a · Revisión ATLAS (backend): Integrantes › Consolidación V1

> **Revisor:** ATLAS (seguridad / arquitectura), revisión adversarial y basada en evidencia. **Solo lectura**: no se editó código, no se hizo commit, push ni deploy. Se usaron solo emuladores con `demo-cds-suite`.
> **Rama:** `mission/consolidation-v1-fasttrack` @ **`0569f91`** (stacked sobre PR #5 `73b90401708d116a190d0b8d286ca27861a5f3d5`). Diff revisado: `git diff 73b9040..0569f91` (48 archivos, +5246/−46).
> **Fuera de alcance (segunda pasada):** `components/members/`, `lib/members/`, `app/(private)/integrantes/`, `tests/members/` y `tests/platform/members-isolation.test.ts` (carril UI, aún sin commit). Solo se leyeron las consultas de `lib/members/client.ts` para validar los índices (§8).
> **Nota:** durante la revisión entraron 2 commits (`97d2b0d`, `0569f91`: doc 23/24 y `ARRIVAL_SOURCES` + `evangelismo`). Lo revisado y las pruebas finales corresponden a `0569f91`.

## 1. Resumen por área

| # | Área | Veredicto | Hallazgos |
|---|---|---|---|
| 1 | `firestore.rules` (members*, `membersRead()`, catálogo v1 de `users`) | **PASS** | — |
| 2 | Functions (`service.js`, `firestore-store.js`, bloque de `index.js`, `lib/shared/members.ts`) | **PASS** | A-03, A-04, A-05, A-06, A-07 (NIT) |
| 3 | Modelo de acceso (`access.ts`, `types.ts`, `lib/access/*`, `users.ts`, `app-shell`) | **PASS** | A-02 (MINOR) |
| 4 | Migración `migrate-access-v1.mjs` | **PASS** | — |
| 5 | Aislamiento financiero (BLOCKER de la misión) | **PASS** | — |
| 6 | Aislamiento de SumUp CASH | **PASS** | — |
| 7 | Rollback (doc 25 §5) y orden C-A0…C-A12 | **PASS** (con ajuste recomendado al runbook) | A-01 (MINOR), A-02 (MINOR), A-09 (NIT) |
| 8 | Índices (`firestore.indexes.json`) | **PASS** | — |

**No hay hallazgos BLOCKER ni MAJOR.** Recomiendo corregir A-01 y A-02 en el doc 25 antes del miércoles (solo documentación). Los NIT pueden quedar para después del rollout.

## 2. Hallazgos

| ID | Sev. | Archivo:línea | Evidencia | Corrección concreta |
|---|---|---|---|---|
| **A-01** | MINOR | `docs/mission-2026/25-consolidation-v1-rollout.md:75-78` (§5 R1/R3/R4) | (a) **Orden:** R1 revierte Hosting a C-A1 *antes* de R3, pero la UI de C-A1 no tiene el grupo "Integrantes": el paso R3 ("quitar Ver/Gestionar Consolidación") ya no se puede hacer como está escrito. (b) **Justificación imprecisa:** "con un grant guardado, la app no podría editar a ese usuario" no aplica a la UI de C-A1. `normalizeAccess` (73b9040) descarta los permisos fuera de su catálogo y `lib/settings/users-client.ts:256` (73b9040) guarda `[...profile.permissions]`, así que al editar se **eliminan sin aviso** los `members.*` y el guardado pasa las reglas RC1. El bloqueo solo existe al editar desde la UI de esta rama con las reglas RC1. (c) **Cobertura:** el criterio "`--summary` debe dar 0 explícitos" no cuenta `inactiveWithGrant`, que también tiene `members.*` guardado. (d) Ese `--summary` solo existe en el script de **esta** rama, no en el de C-A1. **Seguridad:** no hay riesgo. Con reglas RC1, los `members.*` guardados no tienen efecto: ningún gate los lee y el catch-all deniega. | Reordenar a **R3 → R1 → R2 → R4** (revocar mientras la UI de Integrantes sigue publicada) o documentar las alternativas: re-guardar desde la UI de C-A1 o usar la consola. Criterio: `explicitRead + explicitManage + inactiveWithGrant == 0`, ejecutando `--summary` desde un checkout del commit de Consolidación. Reformular la razón de R3: es higiene operativa, no un cierre de acceso. |
| **A-02** | MINOR | `lib/shared/access.ts:211-217` (`deriveLegacyRole`); doc 25 §5/§6; doc 20 §14 | Un usuario v1 que solo tiene permisos de Integrantes guarda `role = "leader"`. Si alguna vez se vuelve a las **reglas legacy** de la Etapa A (`e6b2084`, doc 20 §14), `leader` puede leer el **resumen financiero**. Esto ya estaba aceptado en el doc 20 porque "hoy el conteo es 0". Con C-A8/C-A12 el conteo pasa a ser > 0 por diseño: los voluntarios de Consolidación son justamente usuarios estándar sin finanzas. **El riesgo aumenta**, pero sigue acotado: hace falta un rollback de reglas *legacy*, no el R4 del doc 25, que vuelve a RC1 y es seguro. El detector existe: verifiqué que `aggregateReport` cuenta a un v1 activo solo con `members.consolidation.manage` en `rollbackRisk` (=1), en `explicitManage` (=1), y a un inactivo con grant en `inactiveWithGrant` (=1). | En el doc 25 (§1 D3/C-A12 y §6), indicar que después de cada grant `rollbackRisk` sube y que todo rollback de la Etapa B a reglas legacy debe seguir el procedimiento del doc 20 §14 (desactivar a esos usuarios **antes**). En el backlog: un `role` que no sea legacy y falle cerrado (ya recomendado en el doc 20 §16). |
| A-03 | NIT | `lib/shared/members.ts:353,358` (`Reader`) | La clave `__proto__` **no** se marca como `unknown_field`: `this.errors["__proto__"] = "unknown_field"` cambia el prototipo, no agrega una clave. Prueba: `parsePersonCreate(JSON.parse('{"__proto__":{"consolidationStatus":"integrado"},…}'))` → `ok:true`. **No es explotable:** `value` se arma solo con claves de la lista blanca y el servicio escribe campos explícitos. Además, `decode()` de firebase-functions 7.3.2 hace `obj[k] = …`, así que en producción `__proto__` se descarta o cambia el prototipo, y entonces `isPlainObject` lo rechaza. | `errors` con `Object.create(null)` (o `Object.defineProperty`) o rechazar explícitamente `__proto__`/`constructor`/`prototype`. Agregar un test. |
| A-04 | NIT | `functions/members/service.js:451-452` | Si `followUpCreate` no recibe `ownerUid`, hereda `person.followUpOwnerUid` sin revalidarlo. Si ese usuario perdió `manage` o está inactivo, el seguimiento y `nextActionOwnerUid` apuntan a alguien sin acceso. No hay fuga, porque las reglas le niegan la lectura, y la alerta "Sin responsable" lo muestra (doc 23 §5.0). **Veredicto: aceptable para V1.** | Opcional: un `tx.get("users", …)` y, si no es válido, `ownerUid = null`, sin error. La próxima acción nunca quedaría asignada a alguien sin acceso. |
| A-05 | NIT | `lib/shared/members.ts:371-389` | `text`/`optText` aceptan caracteres de control y de formato (`U+0000`, `U+202E` RLO): `fullName: "A\u0000‮B"` se guarda. React escapa el contenido (no hay XSS), pero un RLO puede invertir visualmente nombres y notas para otros usuarios. | Rechazar `\p{Cc}` (salvo `\n` en notas) y `\p{Cf}` bidi (`U+202A–202E`, `U+2066–2069`) con `invalid`. |
| A-06 | NIT | `lib/shared/members.ts:344-350` | `payloadTooLarge` cuenta unidades UTF-16, no bytes: 4000 × "é" (≈8 KB en UTF-8) pasa. El tamaño queda acotado por los límites de cada campo. | Ajustar el texto ("≤ 4096 caracteres") o usar `Buffer.byteLength`. |
| A-07 | NIT | `functions/index.js:500-528` | `memory: "256MiB"` en gen2 asigna CPU fraccional, por lo que la concurrencia queda en 1. Con `maxInstances: 5` caben **5 solicitudes simultáneas por callable**. `membersOwnerOptions` se llama desde las pantallas (`lib/members/api.ts:285`). En una iglesia pequeña alcanza; en un pico de domingo podría devolver 429 o arranques en frío lentos. | Observar en C-A12. Si aparecen 429, subir `maxInstances` solo de `membersOwnerOptions` o cachear la lista en el cliente durante la sesión. |
| A-08 | NIT | Transversal (Ley 21.719) | Las lecturas de PII desde el cliente no quedan auditadas: la auditoría cubre solo escrituras. | LATER: evaluar los Data Access audit logs de Firestore (costo) antes de ampliar datos o usuarios. |
| A-09 | NIT | `docs/mission-2026/24-consolidation-v1-security-review.md:32` (T12) | Cita como evidencia `tests/platform/members-isolation.test.ts`, que **no está en ningún commit**: está sin trackear (carril UI). | Commitear ese test antes de cerrar el doc 24, o citar evidencia ya commiteada. |
| A-10 | NIT | `scripts/seed-members-emulator.mjs:280` | `seedMembers` borra documentos y solo exige `FIRESTORE_EMULATOR_HOST`. Es suficiente: con esa variable, el Admin SDK no habla con producción, y el seed de plataforma agrega los interlocks `CDS_SEED_LOCAL` + `demo-*`. | Opcional: exigir también un proyecto `demo-*` en `seedMembers` (defensa en profundidad). |

## 3. Detalle por área

### 3.1 `firestore.rules`
- **Diff exacto:** 2 entradas en `implicants()`, `membersRead()`, el catálogo guardable con los 2 permisos `members.*`, `permissions.size() <= 10` y 4 bloques `match` idénticos (`get, list: if membersRead(); create, update, delete: if false`). Nada más cambia.
- `membersRead() = gate(['members.consolidation.read','members.consolidation.manage'], ['admin'])`:
  - **v1:** activo y (`baseRole == 'admin'` o un permiso explícito de Integrantes);
  - **legacy:** solo `role == 'admin'`;
  - sin documento, inactivo o anónimo: `false` (por `exists()`, `active == true` y `signedIn()`).
- **Pastor, finanzas y líder legacy:** no tienen acceso. **Solo calendario y solo finanzas (v1):** no tienen acceso. `count()` está gobernado por `list` (probado).
- **Escritura del cliente:** denegada en las 4 colecciones. El catch-all (`firestore.rules:323`) deniega cualquier subruta.
- **Paridad con `lib/shared/access.ts`:** `IMPLIES` agrega solo `manage → read`. `LEGACY_ROLE_ACCESS` no contiene `members.*`. El admin legacy obtiene el catálogo completo en ambos lados. `tests/rules/platform-access.test.ts` verifica `membersRead() ≡ can('members.consolidation.read')` contra las tablas canónicas.
- **Presupuesto de expresiones:** `membersRead` usa el mismo `gate` (un `get` cacheado). Ninguna ruta financiera evalúa estos helpers, y los tests financieros históricos pasan sin cambios (§4).

### 3.2 Functions
- **Autorización:** las 6 callables autorizan **antes** de validar el payload (no hay oráculo de validación sin permiso).
  - `authorize()` exige `uid` y luego `can(users/{uid}, permiso)`: sin documento o inactivo = ∅; admin implícito; sin fallback legacy para `members.*`.
  - Las 5 escrituras exigen `manage`; `ownerOptions` exige `read`.
- **Validación del payload:**
  - objeto plano, lista blanca por callable (claves desconocidas → `unknown_field`), tipos estrictos, largos (nombre 120, nota 280, próxima acción 120, motivo 200);
  - fechas en `[hoy−365, hoy]` calculadas en Santiago;
  - `expectedRevision` entero 1…1e6;
  - ids con `^[A-Za-z0-9_-]{1,128}$` (sin `/` ni `.`, así que no hay path traversal); los ids reservados `__*__` se tratan como inexistentes en el store;
  - `requestId` de 8 a 64 caracteres.
  - Excepción menor: A-03.
- **Responsable:**
  - validado **dentro** de la transacción (`users/{uid}` existe, `active` y `can(manage)`) en `personCreate`, `personUpdate` (solo si cambia) y `followUpCreate` (si viene explícito);
  - el responsable por defecto no se revalida (A-04, aceptable).
- **`calendarEventId`:** exige `calendar.read`, que el evento exista y que no esté archivado; solo se guarda el id. Quien tiene `calendar.read` ya puede leer todo `calendarEvents` (`firestore.rules:1032`), así que la verificación de existencia no filtra nada. `personUpdate` no acepta `calendarEventId` (no hay bypass).
- **Transacciones:**
  - todas las lecturas (`tx.get` de la persona, del documento de idempotencia y del responsable) van antes de las escrituras;
  - la persona, el historial, la proyección y la auditoría se escriben en **una** transacción, con `tx.create` para el historial y los cambios (append-only también a nivel de escritura);
  - los `HttpsError` lanzados dentro abortan la transacción sin reintento.
- **Idempotencia:**
  - id = `sha256(uid:kind:requestId)[0..24]`; como el `uid` es parte del id, otro usuario no puede colisionar;
  - el chequeo `createdBy !== uid` / `personId` distinto → `members/request-reused` es defensa en profundidad;
  - el replay no escribe nada.
- **Concurrencia:**
  - `personUpdate` y `statusChange` exigen `expectedRevision`;
  - visitas y seguimientos suben la revisión dentro de la transacción;
  - los ids de cambio `${personId}-r${rev}-${n}` fallan con `create` si chocan.
- **Sugerencias:** `followUpCreate` solo acepta `applyStatus`/`applyDoNotContact` si son **iguales** a la sugerencia recalculada en el servidor. Las únicas sugerencias posibles son `en_seguimiento` (primer contacto desde `por_contactar`) y `sin_continuidad` + No contactar (`no_desea_contacto`). **No se puede forzar `integrado`, `integrandose` ni reabrir.**
- **Pipeline:**
  - `integrado` exige `confirmIntegrated` y cambia la etapa a `integrante` en el **mismo** documento, sin reapertura posible;
  - `sin_continuidad` exige motivo, y nota si el motivo es "otro";
  - desde `sin_continuidad` solo se puede ir a `en_seguimiento`;
  - `personUpdate` no acepta campos de estado.
- **Auditoría:** `actorUid` + `at` (`serverTimestamp`) + `personId` + `action` + `revision` en `person_created`, `owner_changed`, `profile_updated` (**solo nombres de campos**), `do_not_contact_changed`, `status_changed`/`stage_changed` (incluidos los derivados de un seguimiento, con `refId`), `visit_recorded` y `follow_up_recorded`. Los perfiles no copian PII.
- **Errores y logs:**
  - los errores conocidos son `HttpsError` con clave `members/*` y `{fields:{campo:código}}`, sin valores;
  - lo inesperado se registra solo como `{method, name, code}` y se responde `members/internal`;
  - firebase-functions 7.3.2 no registra los `HttpsError`.
- **Duplicados:** devuelven `{personId, fullName, by}` de otras personas con el mismo teléfono o correo (límite 5). Quien llama tiene `manage`, que implica `read`, y ya puede leer toda la colección: **no hay fuga**.
- **`ownerOptions`:** solo `{uid, displayName}` de usuarios **activos con `manage`** (admins incluidos; legacy no admin y solo lectura excluidos). Sin correos: un `displayName` con `@` se muestra como "Usuario sin nombre".
- **Exposición ante abuso:** `timeoutSeconds: 20`, `maxInstances: 5`, payload ≤ 4096 caracteres (A-06), tope por campo y ≤ 5 escrituras por transacción. Un usuario `manage` malicioso puede crear volumen (no hay rate limit), pero está dentro del límite de confianza y solo afecta a `members*`.
- **Fechas:** `entryDate` y "hoy" usan `localToday(clock.now())` en America/Santiago (test 03:30 UTC → día anterior). Los timestamps vienen del servidor.

### 3.3 Modelo de acceso
- **Admin implícito:** `profilePermissions` → `ALL`, que ahora incluye `members.*`, igual que las reglas.
- **Grants solo explícitos:** `MODULE_PERMISSIONS.members = [read]` y `ROUTE_RULES` (`/integrantes` prefijo con read; `/nueva` exacto con manage; gana la regla más específica). `LEGACY_ROLE_ACCESS` no cambia.
- **`MAX_STORED_PERMISSIONS` 8 → 10:** igual en reglas, TS y JS. Sin efecto para la UI de C-A1, que filtra lo desconocido.
- **Rol derivado `leader` para un usuario solo de Integrantes:** correcto según el modelo y sin efecto con las reglas RC1 ni con Storage (`storage.rules` exige `admin/pastor/finance`). El único efecto es el caveat legacy (A-02).
- **`lib/finance/permissions.ts`:** `canSeeDetails`/`canSeePastoral` por rol no se usan.
- **`app-shell`:** cambio solo de presentación (etiqueta corta con 5 módulos).

### 3.4 Migración
- El diff solo agrega el bloque agregado `consolidation` a `aggregateReport`/`formatAggregate`.
- **Interlocks sin cambios:** dry-run por defecto; `--project` explícito; `--apply` exige `--confirm <id>` + `CDS_ALLOW_PRODUCTION_MIGRATION` + TTY.
- **Planner sin cambios:** la migración nunca otorga `members.*`. Es idempotente (salta v1).
- **Conteos verificados** con 4 perfiles (v1 solo manage activo, v1 read inactivo, pastor legacy, admin legacy): `adminImplicit 1`, `explicitManage 1`, `inactiveWithGrant 1`, `legacyWithout 1`, `rollbackRisk 1`. Correctos.

### 3.5 Aislamiento financiero (BLOCKER de la misión): **PASS**
- `git diff --name-only 73b9040..HEAD` **no** contiene ninguna ruta de `functions/sumup/**`, `lib/finance/**`, `components/finance/**`, resúmenes, categorías, diezmos/ofrendas, reportes financieros, motor de sync, `storage.rules`, `firebase.json` ni `functions/package.json`. `git diff --quiet 73b9040..HEAD -- lib/finance components/finance` = sin cambios.
- `functions/index.js`: **0 líneas eliminadas**. Las 37 líneas nuevas se agregan después de `calendarShareLinkManage`. Reutiliza `db`, `FieldValue`, `clock` y `REGION` en solo lectura. Sin secretos ni params nuevos.
- **`functions/shared/access.js` no puede alterar `can(x, "finance.*")`:**
  1. *Razonamiento:* el único cambio en `IMPLIES` es `members.manage → members.read`. El cierre transitivo de cualquier permiso financiero o de calendario no alcanza `members.*` y viceversa. `deriveLegacyRole` solo mira `finance.records/pastoral`. El admin sigue en `ALL`. Antes, `normalizeAccess` descartaba `members.*` por desconocidos; ahora los conserva, pero no implican nada fuera de Integrantes.
  2. *Prueba exhaustiva:* comparé `can()` de `73b9040` contra `HEAD` en **16.403 perfiles**: los 1.024 subconjuntos de los 10 permisos guardables × `baseRole` × `active` × `role`, más los legacy, `null` y roles inválidos. Fueron **147.627 comprobaciones** de todos los permisos no `members.*`, más `deriveLegacyRole`: **0 diferencias**. Ningún perfil legacy no admin obtiene `members.*`.
  3. `sumupSyncNow` autoriza con `can(userDoc, "finance.records.manage")` (`functions/auth/require-finance-user.js`). Además, el deploy por nombre **no** redespliega SumUp: conserva la revisión de C-A1.
- Los tests financieros históricos pasan sin cambios: `tests/rules/finance.test.ts` (17/17) y `tests/rules/integrations.test.ts` (5/5), ambos sin modificar en el diff.

### 3.6 SumUp CASH: **PASS**
- `mission/sumup-cash-intake-v1` (tip `31d826c`) **no** es ancestro de `HEAD` (`git merge-base --is-ancestor` → no). Merge-base común: `e6b2084`.
- **0 de los 7** commits de CASH (`f92f628`…`31d826c`) son ancestros de `HEAD`. `git cherry` los marca todos como ausentes (`+`).
- `git log 73b9040..HEAD` tiene 11 commits, todos de Consolidación o docs, sin merges.
- El diff no agrega `CASH`, `paymentMethod` ni `efectivo`: las únicas menciones están en los docs 24/25, para decir que no se toca.

### 3.7 Rollback y orden del rollout
- **Orden C-A3 (índices) → C-A4 (reglas) → C-A5 (Functions por nombre) → C-A6 (Hosting): correcto.** Con reglas y Functions sin Hosting, nada es alcanzable salvo para admin (sin UI). Los índices van primero para evitar `FAILED_PRECONDITION`.
- **Deploy por nombre** (`--only functions:membersPersonCreate,…`):
  - sube todo `functions/`, pero crea o actualiza **solo** las 6 funciones nombradas;
  - un deploy parcial no borra ni actualiza otras funciones;
  - el predeploy solo verifica `build-shared --check` (pasa);
  - codebase `default` sin cambios; sin dependencias, secretos ni params nuevos.
  - **Nada obliga a un redeploy global.** Las funciones existentes conservan su código. Si algún día se redespliegan, `access.js` es equivalente para ellas (§3.5).
  - La verificación con `curl` sin auth devuelve `UNAUTHENTICATED` sin leer ni escribir.
- **Rollback R1–R5:** solo oculta y detiene escrituras; nunca borra datos.
  - R2 (`functions:delete` de las 6) no toca SumUp ni calendario;
  - R4 vuelve al ruleset RC1 de C-A1: las 4 colecciones caen en el catch-all y los `members.*` guardados quedan sin efecto;
  - es independiente de Financial Core y de SumUp CASH.
- **"Revocar grants antes de R4":** no es necesario para la seguridad, pero sí es útil como higiene. El orden y la razón deben corregirse (A-01).

### 3.8 Índices: **PASS**
- **3 entradas nuevas y 0 existentes modificadas o eliminadas.** Corresponden 1:1 a las consultas reales de `lib/members/client.ts:208-215`, que son las mismas del doc 23 §10 y de `tests/rules/members.test.ts:131-133`:
  - `membersVisits (personId ASC, createdAt DESC)`
  - `membersFollowUps (personId ASC, createdAt DESC)`
  - `membersPersonChanges (personId ASC, at DESC)`
- `membersPeople` usa `orderBy(entryDate desc) + limit(1000)`, y el backend busca duplicados con igualdades de un campo: ambos usan índices automáticos. No hay entradas especulativas.

## 4. Pruebas (en `0569f91`, solo emuladores `demo-cds-suite`)

| Comando | Resultado |
|---|---|
| `node scripts/build-shared.mjs --check` | OK: "functions/shared al día (8 archivos)", exit 0 |
| `npx vitest run tests/functions` | **15 archivos, 197/197 PASS** |
| `npx vitest run` | **1009/1011**: 56 archivos PASS y 1 FAIL, `tests/members/screens.test.tsx` (2 tests: "aviso solo adultos…" y "posible duplicado…"). Es del **carril UI sin commit**, que se escribía durante la revisión. En una corrida anterior, sin las páginas del carril UI, los únicos fallos fueron los 2 de `tests/platform/route-coverage.test.ts` (rutas de Integrantes sin página), como se esperaba |
| `npm run test:rules` | **6 archivos, 150/150 PASS**: `finance.test.ts` **17/17** · `integrations.test.ts` **5/5** · `members.test.ts` 34/34 · `platform-access.test.ts` 48/48 · `platform-calendar.test.ts` 35/35 · `platform-calendar-audit.test.ts` 11/11 |
| `npm run test:emulator` (auth + firestore + functions) | **5 archivos, 27/27 PASS**: `members.e2e` 9 · `calendar-feed.e2e` 8 · `migration.e2e` 4 · `seed-platform.e2e` 4 · `migration-summary.e2e` 2 |
| Comparación exhaustiva de `can()` 73b9040 vs HEAD (ad hoc, sin escribir archivos del repo) | 147.627 comprobaciones, **0 diferencias** fuera de `members.*` |

## 5. Clasificación de archivos (`git diff --name-status 73b9040..0569f91`)

| Archivo | Estado | Clase |
|---|---|---|
| `docs/mission-2026/23-consolidation-v1-production-spec.md` | A | members-only |
| `docs/mission-2026/24-consolidation-v1-security-review.md` | A | members-only |
| `docs/mission-2026/25-consolidation-v1-rollout.md` | A | members-only |
| `functions/members/firestore-store.js` | A | members-only |
| `functions/members/service.js` | A | members-only |
| `functions/shared/members.js` (generado) | A | members-only |
| `lib/shared/members.ts` | A | members-only |
| `scripts/seed-members-emulator.mjs` / `.d.mts` | A | members-only (solo emulador) |
| `scripts/check-no-preview.mjs` | A | members-only (gate de build, solo lectura) |
| `tests/emulator/members.e2e.test.ts` | A | members-only (test) |
| `tests/functions/members-memory-store.ts`, `members-seed.test.ts`, `members-service.test.ts`, `members-wiring.test.ts` | A | members-only (test) |
| `tests/platform/members-access.test.ts`, `shared-members.test.ts` | A | members-only (test) |
| `tests/rules/members.test.ts` | A | members-only (test) |
| `firestore.rules` | M | shared-touched (aditivo: `members*` + catálogo de `users`) |
| `firestore.indexes.json` | M | shared-touched (solo agrega 3 índices) |
| `functions/index.js` | M | shared-touched (**append-only**, 0 líneas eliminadas) |
| `functions/shared/access.js` (generado) | M | shared-touched (equivalencia financiera probada) |
| `functions/shared/types.js` (generado) | M | shared-touched (catálogo + límite 10) |
| `lib/shared/access.ts` | M | shared-touched |
| `lib/shared/types.ts` | M | shared-touched |
| `lib/access/labels.ts`, `modules.ts`, `routes.ts` | M | shared-touched (registro de módulo, rutas y etiquetas) |
| `lib/settings/users.ts` | M | shared-touched (etiquetas y grupo "Integrantes") |
| `components/layout/app-shell.tsx` | M | shared-touched (ícono y etiqueta corta con 5 módulos) |
| `package.json` | M | shared-touched (solo el script `check:no-preview`) |
| `scripts/build-shared.mjs` | M | shared-touched (agrega `members` a `SHARED_FILES`) |
| `scripts/migrate-access-v1.mjs` / `.d.mts` | M | shared-touched (solo el agregado `consolidation`) |
| `scripts/seed-platform-calendar-emulator.mjs` / `.d.mts` | M | shared-touched (seed de emulador: 2 usuarios + `seedMembers`) |
| `tests/emulator/migration-summary.e2e.test.ts`, `migration.e2e.test.ts` | M | shared-touched (test) |
| `tests/platform/access-model.test.ts`, `app-shell.test.tsx`, `migration-summary.test.ts`, `profiles.ts`, `routes.test.ts`, `settings-screens.test.tsx`, `shared-access.test.ts`, `users-access-v1.test.ts` | M | shared-touched (test) |
| `tests/rules/helpers/platform-fixtures.ts`, `tests/rules/platform-access.test.ts` | M | shared-touched (test; `finance.test.ts`/`integrations.test.ts` no los importan) |
| *(ninguno)* | — | **financial: 0 archivos** |

## 6. Veredicto

No encontré ninguna vía explotable para que un usuario sin permiso explícito de Integrantes lea, cuente o escriba datos de `members*`. Tampoco encontré ningún cambio que altere Finanzas o SumUp, ni nada que obligue a un redeploy global. El rollback es seguro y no borra datos. Los dos MINOR son de documentación del runbook (A-01 y A-02) y conviene corregirlos antes del miércoles 7-10-2026.

ATLAS (backend): PASS
