# 32 · Consolidación V1 integrada con producción `18925d6` (PR #5 + fix de presupuesto de Rules)

**Fecha:** 2026-10-13 · **Rama:** `integration/consolidation-v1-on-18925d6` (local, sin push) · **NO DEPLOY**

## 1. Qué se integró

| Lado | Commit | Contenido |
|---|---|---|
| Consolidación V1 (PR #7) | `602e93b` (`mission/consolidation-v1-fasttrack`, **sin modificar**) | Módulo Integrantes › Consolidación V1 (docs 23–25), apilado sobre PR #5 `a8d782d` |
| Producción | `18925d67f17de2e42f5061024486d579ed29ce66` (`origin/feature/preproduccion-mobile-v1`) | PR #5 Platform Core + Calendar (`0156740`, árbol = `a8d782d`) + PR #12 fix del presupuesto de expresiones de Firestore Rules (`53c528d`, `ebf7ec8`; doc 26) |

- Merge real con `git merge --no-ff` (sin rebase, sin force, sin push). La rama original de PR #7 no se tocó.
- Como `0156740` tiene el mismo árbol que `a8d782d` (base de PR #7), lo único nuevo para PR #7 es PR #12: 9 archivos (`firestore.rules`, `tests/rules/platform-access.test.ts`, doc 26, `tests/rules/budget*.test.ts`, `tests/rules/helpers/budget.ts`, `tests/rules-budget/*`, `vitest.rules-budget.config.mts`).
- Sin cambios entre `18925d6` y esta rama en `firebase.json`, `package-lock.json`, `functions/package*.json`, `functions/sumup/**`, `lib/finance/**` ni `components/finance/**`. `package.json` solo agrega el script `check:no-preview` de PR #7. `lib/shared/*` y `functions/shared/*` están sincronizados (`build-shared --check` OK).

## 2. Conflictos y resolución semántica

Hubo 2 conflictos, los previstos en el doc 26 §7. Se resolvieron a mano, sin "ours/theirs" en bloque.

### 2.1 `firestore.rules`, bloque de helpers

- **Lado del fix (se conserva completo):** helpers financieros especializados (`financeSummaryRead/DetailsRead/RecordsManage/PastoralManage` con sus variantes `*OfAt`/`*Of`) y `settingsManage`/`settingsManageAt`/`settingsManageOf`. **No** se reintroduce el alias `admin()`; `appSettings` sigue usando `settingsManage()` directo.
- **Lado de PR #7 (se agrega):** `membersRead()`, que sigue implementado sobre `gate()` y solo se evalúa en las 4 colecciones `members*`.
- **Sin conflicto (merge automático, verificado):**
  - las entradas `members.consolidation.*` de `implicants()`;
  - el catálogo `permissionCatalogNoSettings()` con los 2 permisos nuevos y `permissions.size() <= 10`;
  - las reglas `membersPeople`, `membersVisits`, `membersFollowUps` y `membersPersonChanges`, de solo lectura para el cliente.

Bloque final, tal como queda:

```
    // settings.manage solo existe vía admin (baseRole v1 o role legacy): nunca por `permissions`.
    // ≡ gate([], ['admin']): hasAny([]) nunca es verdadero, así que queda activo ∧ admin (v1 o legacy).
    function settingsManage() { return signedIn() && settingsManageAt(userPath()); }
    function settingsManageAt(up) { return exists(up) && settingsManageOf(get(up).data); }
    function settingsManageOf(u) { return u.active == true && adminProfile(u); }
    // Finanzas: … mismo resultado que gate(implicants()[p], roles legacy) …
    function financeSummaryRead() { return signedIn() && financeSummaryOfAt(userPath()); }
    function financeDetailsRead() { return signedIn() && financeDetailsOfAt(userPath()); }
    function financeRecordsManage() { return signedIn() && financeRecordsOfAt(userPath()); }
    function financePastoralManage() { return signedIn() && financePastoralOfAt(userPath()); }
    function financeSummaryOfAt(up) { … } · financeDetailsOfAt · financeRecordsOfAt · financePastoralOfAt
    function financeSummaryOf(u) { … } · financeDetailsOf · financeRecordsOf · financePastoralOf   (idénticos a 18925d6)
    // Integrantes › Consolidación V1 (doc 23): SOLO permiso explícito v1 o admin. Ningún rol legacy
    // distinto de admin lo obtiene (legacyPermissions() no incluye members.*).
    function membersRead() { return gate(['members.consolidation.read','members.consolidation.manage'], ['admin']); }
```

`git diff 18925d6 -- firestore.rules` queda en exactamente 4 bloques, todos de PR #7:
- 2 entradas en `implicants()`;
- `membersRead()`;
- el catálogo y el tamaño máximo de permisos en `validUserV1`;
- las 4 colecciones `members*`.

### 2.2 `tests/rules/platform-access.test.ts` ("tablas de acceso")

- Se conserva el test especializado de `settingsManage()` del fix. Se quita la fila genérica `["settingsManage", "settings.manage"]` de la tabla `gate()`, porque `settingsManage` ya no usa `gate()` y esa fila fallaría.
- Se conserva la fila `["membersRead", P.memRead]` de PR #7. Verifica que la lista de `membersRead()` = `implicants()['members.consolidation.read']` y que los roles legacy = solo `admin`.

## 3. Presupuesto de expresiones (doc 26)

Medición con relleno sobre el resumen (`PAD_AT=summary`, `MAX_TERMS=200`, `STEP=1`), solo en el emulador y con datos ficticios. Calibración: 142 términos, ≈6,99 expresiones por término. Se corrió lo mismo sobre `firestore.rules` de `18925d6` como referencia.

Valores en **expresiones libres** del documento limitante (el resumen mensual), peor caso por perfil: 17 términos de relleno × 6,99 ≈ 118 y 18 × 6,99 ≈ 125. Para 100 expresiones hacen falta 15 términos, así que la holgura sobre `REQUIRED_MARGIN` es de unos 2 términos.

| Perfil (expresiones libres) | `18925d6` (fix) | Integración | Mínimo exigido |
|---|---|---|---|
| legacy-admin | ≥118 | **≥118** | 100 |
| legacy-pastor | ≥118 | **≥118** | 100 |
| legacy-finance | ≥118 | **≥118** | 100 |
| v1-admin | ≥118 | **≥118** | 100 |
| v1-records | ≥125 | **≥125** | 100 |

- Los márgenes por operación y perfil (12 operaciones, incluidas income, expense, cash, tithe, edit, move, void y categorías) son **idénticos byte a byte** entre `18925d6` y la integración.
- Las reglas de Consolidación **no consumen** presupuesto financiero:
  - `membersRead()` solo se invoca en `match /members*`;
  - las 2 entradas nuevas de `implicants()` no están en ningún camino financiero, porque los helpers financieros usan listas literales;
  - `validUserV1` solo corre en escrituras de `users`.
- `tests/rules/budget.test.ts` pasa con `REQUIRED_MARGIN = 100` sin tocar.

## 4. Gates (2026-10-13, en la rama de integración)

| Gate | Resultado |
|---|---|
| `npm run lint` | OK (0 warnings) |
| `npm run typecheck` (con `.next` limpio) | OK |
| `npm run test` | **66 archivos / 1136 tests PASS** |
| `npm run test:rules` | **8 archivos / 158 tests PASS**, incluidos `budget.test.ts`, `budget-equivalence.test.ts`, `members.test.ts` y `platform-access.test.ts` |
| `npm run test:emulator` | **5 archivos / 27 tests PASS** (incluye `members.e2e`, con las 6 callables `members*` cargadas en el emulador) |
| `node scripts/build-shared.mjs --check` | OK (`functions/shared` al día, 8 archivos) |

- No hizo falta ningún arreglo de integración aparte de los dos conflictos.
- `package-lock.json` es idéntico al de producción, así que no se re-ejecutó `npm install`.
- No se corrió `npm run build` ni `check:no-preview` en esta pasada. Quedan para el checkout limpio de deploy (doc 25 §2).

## 5. Funcionalidad de Consolidación: verificación estática y por tests

El fix (PR #12) no tocó código de app, Functions ni `lib/`. Los archivos de Consolidación quedan idénticos a `602e93b`. Los tests de Consolidación se corrieron por separado: **10 archivos / 239 tests PASS** (`tests/members/*`, `tests/functions/members-*`, `tests/platform/members-*` y `shared-members`).

| Área | Dónde vive | Cubierto por |
|---|---|---|
| Dashboard de Integrantes, Atención, Personas, ficha, alta | `app/(private)/integrantes/**`, `components/members/*` | `tests/members/screens.test.tsx`, `write-flows.test.tsx` |
| Visitas, seguimientos, estados (transiciones y sugerencias) | `lib/shared/members.ts` (`checkTransition`, `suggestAfterFollowUp`, `projectVisit/FollowUp`), `functions/members/service.js` | `tests/functions/members-service.test.ts`, `tests/platform/shared-members.test.ts` |
| Responsables | callable `membersOwnerOptions` | e2e del emulador y `members-service` |
| Enlaces de WhatsApp | `whatsappLink()` (respeta "No contactar") | `shared-members`, `screens` |
| Duplicados por teléfono y correo | `findDuplicates` (cliente) y `service.findDuplicates` (servidor; advierte, nunca bloquea) | `consolidation.test.ts`, `members-service` |
| Auditoría | `membersPersonChanges`, escrita solo por Functions | `members-service`, `members.e2e` |
| Permisos | `members.consolidation.read/manage`, `membersRead()`, rutas `/integrantes*`, módulo Integrantes | `tests/rules/members.test.ts`, `platform-access`, `tests/platform/members-access.test.ts` |
| Protección de datos personales | el cliente nunca escribe `members*`; sin datos religiosos, nacimiento ni menores; aislamiento respecto de Finanzas | `members.test.ts` (rules), `members-isolation.test.ts`, `check:no-preview` |

**Piloto solo para admin (sin cambios):**
- `legacyPermissions()` no incluye `members.*`;
- `membersRead()` solo acepta el rol legacy `admin`;
- no se agregó ningún permiso masivo ni ningún grant.

## 6. Riesgos residuales

1. **Holgura del umbral:** `REQUIRED_MARGIN = 100` sigue con unos 2 términos de holgura (doc 26 §7). Consolidación no la reduce, pero cualquier validación nueva del resumen financiero puede hacer fallar `budget.test.ts`. En ese caso hay que optimizar, nunca bajar el umbral.
2. **Doc 25 desactualizado:** su referencia de ancestro es `git merge-base --is-ancestor a312c96 HEAD`. Para desplegar desde esta integración, el commit exacto también debe contener `18925d6`: `git merge-base --is-ancestor 18925d67f17d HEAD` → 0.
3. **Caveat legacy (doc 25 §5.1):** un v1 que solo tiene permisos de Integrantes guarda `role = "leader"`. Volver a las reglas legacy de la Etapa A le daría lectura del resumen financiero. Con las reglas de `18925d6` o de esta integración no pasa, porque v1 se evalúa por `permissions`/`baseRole`.
4. **Rama local sin publicar:** para revisión, hay que hacer push o abrir un PR con GO humano. La rama original de PR #7 (`602e93b`) sigue sin el fix. Mergear PR #7 tal cual en `feature/preproduccion-mobile-v1` reproduciría el conflicto; hay que usar esta resolución.
5. **Ruido del emulador:** en la máquina compartida, los puertos del hub y del logging pueden estar ocupados por otros proyectos (el CLI cambia de puerto solo). Las corridas se serializaron con el lock `/tmp/claude-501/cds-emu.lock`.

## 7. Prerrequisitos de deploy (ninguno ejecutado)

> **Actualizado el 15/10/2026:** C-A1 ya está hecho y producción es R2.5 (`35a234c`). Los valores y el estado vigentes están en el doc 25 §0; lo de abajo es histórico.

1. **Primero, C-A1 completo** (doc 25 C-A1 = doc 20 §13 Fases 0–5): Rules de `18925d6` (fase "C-A1.2" del registro operativo de Salvador: el reintento con el fix del doc 26, detenido el 08/10 por la reconciliación financiera A10), Functions de Calendario por nombre (`calendarPublicFeed`, `calendarShareLinkManage`) y Hosting RC1; después **C-A2** (smoke PASS) y **C-A2.5** (merge del PR de Consolidación). Mientras producción siga en el ruleset `2d9939ab…` y el Hosting `3d1dc8bc8d1bcc29`, **no** se despliega nada de Consolidación. Anotar el ruleset y la versión de Hosting resultantes de C-A1 como objetivos de rollback.
2. **Después, las Rules de Consolidación (C-A4 del doc 25):**
   - desde `~/cds-deploy`, en el **commit de merge de C-A2.5** (PR de Consolidación mergeado en `feature/preproduccion-mobile-v1`), nunca en la rama de integración; antes: `git merge-base --is-ancestor 18925d67f17de2e42f5061024486d579ed29ce66 HEAD` y `git merge-base --is-ancestor <head revisado de esta rama> HEAD` deben dar 0, y el diff del merge debe mostrar solo Consolidación;
   - con los gates del §4 en verde en un checkout limpio (`npm ci && npm --prefix functions ci`);
   - el rollback de C-A4 pasa a ser el ruleset de C-A1 (Rules de `18925d6`), **no** `2d9939ab…` (ruleset pre-Platform: con él, un v1 solo de Integrantes guardado como `role = "leader"` leería el resumen financiero, doc 25 §5.1).
3. **Índices `members*` (C-A3):** aditivos, con GO aparte.
4. **Functions:** las 6 `members*` (`membersPersonCreate`, `membersPersonUpdate`, `membersStatusChange`, `membersVisitCreate`, `membersFollowUpCreate`, `membersOwnerOptions`) se despliegan **solo por nombre** y **solo con un GO futuro** (C-A5). **Nunca** se redespliegan las Functions de SumUp (`sumupSyncNow`, `sumupSyncScheduled`) ni `campaignShare` como parte de Consolidación. Su revisión debe quedar igual antes y después.
5. **Hosting con Integrantes (C-A6):** solo después de C-A4 y C-A5, con `check:no-preview` y el modal R0G verificados en `out/`.
6. **Piloto:** Salvador como Admin (D3), sin grants ni migración masiva (D4).

## 8. Nota: normalización de nombres

Una rama paralela (`feature/tithes-integrity-v1`) está agregando un normalizador compartido, `lib/shared/names.ts`.

- Hoy Consolidación detecta duplicados solo por teléfono (E.164) y correo normalizados. No compara nombres.
- **Recomendación:** si más adelante Consolidación suma similitud de nombres (p. ej. advertir "posible duplicado por nombre"), debe **adoptar `lib/shared/names.ts`** (y su copia generada en `functions/shared/`) en vez de crear un segundo normalizador.
- **No se implementa ahora.**

## 9. Actualización sobre producción R2.5 (`35a234c`, 15/10/2026)

- Merge de `feature/preproduccion-mobile-v1` @ `35a234cb33d5311e8d2f957db203aa4eed2f567f` en esta rama: **sin conflictos** (solo auto-merge de `app/globals.css`). Se conservan R2 (Finanzas, banco, conciliación SumUp, caché de Hosting, CI) y R2.5 (resumen diario agregado, efectivo pendiente, Depósitos, creación de actividades).
- Diff respecto de producción: solo Consolidación (84 archivos; `firestore.rules`, `firestore.indexes.json`, `functions/members/*`, `functions/shared/{members,access,types}.js`, `functions/index.js`, rutas `/integrantes/*`, tests y docs). Sin cambios en `storage.rules` ni `firebase.json`.
- Gates en checkout limpio (`npm ci` raíz + functions): lint, typecheck, unit **1651/1651**, `build-shared --check`, Rules **288/288**, emulador **33/33**, build y `check:no-preview` OK.
- Presupuesto de Rules (arnés `tests/rules-budget/measure.budget.ts`, relleno en el resumen): mínimo **118** (perfiles legacy y v1-admin) / **125** (v1-records), **igual** que las Rules de producción `cbe11685`. Margen requerido 100: OK.
- Prerrequisitos de deploy actualizados en el doc 25 §0 (valores vigentes, rollback, Functions a vigilar y smoke pendiente de Pastor, Pastora y Líder).
