# 26 · Firestore Rules: presupuesto de expresiones de las escrituras financieras

**Fecha:** 2026-10-08 · **Rama:** `fix/firestore-rules-expression-budget-v1` (desde `0156740`) · **NO DEPLOY**

## 1. Problema (C-A1.2, Atlas MAJOR-1/2)

Firestore evalúa como máximo **1000 expresiones por documento evaluado**. Lo medimos: el relleno inyectado en un solo documento del commit solo consume el margen de ese documento. Un commit financiero escribe el movimiento, el resumen mensual y, para diezmos, la atribución. El **resumen** es el documento limitante, por `validSummary` + 4×`mapValid`.

- **Producción (`a312c96`, ruleset `2d9939ab`):** ya operaba con unas 13 expresiones libres en el peor caso.
- **Candidata (`0156740`, Platform Core):** sumaba un control de permisos más caro (`gate()` con listas evaluadas aunque no se usen). Así, el peor caso quedaba en ≈0 para legacy y la escritura se **denegaba** para usuarios v1 con `finance.records.manage`.

## 2. Método de medición (reproducible)

`tests/rules/helpers/budget.ts` y `tests/rules-budget/` (solo emulador, datos ficticios).

- **Relleno:** sobre una copia en memoria de las reglas, nunca en `firestore.rules`, se inyectan N términos `request.auth.uid != 'pN'`, evaluados **una sola vez** en el documento elegido. Puntos de inyección: el movimiento (`providerOwnedFinanceTransaction`), el resumen (`validSummary`), la atribución (`validAttribution`) y la configuración de categorías (`validFinanceSettings`).
- **Calibración:** una regla aislada que solo evalúa el relleno. Con 142 términos se agotan las 1000 expresiones, así que cada término cuesta ≈6,99 expresiones.
- **Margen:** el mayor N con el que la operación real sigue permitida.
- **Operaciones:** se hacen con las funciones reales del cliente. Son commits completos: `saveTransaction`, `saveDailyCash`, `voidTransaction`, `addFinanceCategory`.
- **Datos grandes:** 98 categorías de ingreso y 100 de gasto, y resúmenes con todas las categorías y los 31 días en dos meses.
- **Perfiles:**
  - legacy admin, pastor y finance;
  - v1 admin;
  - v1 con `finance.records.manage`.
- **Comandos:**
  - medición: `firebase emulators:exec --only firestore --project demo-cds-suite "RULES_FILE=… OUT_FILE=… PAD_AT=summary npx vitest run --config vitest.rules-budget.config.mts tests/rules-budget/measure.budget.ts"`;
  - perfil por línea (cobertura del emulador, `:ruleCoverage`): `tests/rules-budget/coverage.budget.ts`. Sirve para ubicar el costo, pero no reproduce el conteo exacto del límite, así que el veredicto se apoya en el relleno.

## 3. Cambios (`firestore.rules`): mismo resultado, menos expresiones

| # | Cambio | Equivalencia |
|---|---|---|
| O1/O8/O10 | `financeSummaryRead/DetailsRead/RecordsManage/PastoralManage` especializados: el path del usuario se construye una vez y solo se arma la lista de la rama (v1 o legacy) que aplica. En v1 se evalúa `permissions.hasAny` antes que `baseRole` | Igual que `gateProfile(u, implicants()[p], rolesLegacy)`. El test "tablas de acceso" verifica las listas contra `implicants()`. Las paridades dan 0 diferencias |
| O9 | `settingsManage()` especializado; `appSettings` lo usa directo (sin el alias `admin()`) | `gate([], ['admin'])` ≡ activo ∧ admin, porque `hasAny([])` nunca es verdadero |
| O3 | `configuredIncome/Expense` leen `appSettings/finance` una vez y construyen el fallback solo si se usa | `field in s ? s[field] : fallback` ≡ `data.get(field, fallback)`. Test de equivalencia con 4 estados |
| O7/O5 | `validSummary` lee la configuración una vez y arma su path una vez | `settingsIncomes/Expenses(s)` ≡ `incomes()/expenses()`, con test |
| O2 | Claves diarias: `dayKeysOnly(m)` (regex anclada + `join/split`) | ≡ `m.keys().hasOnly(days())`. Test con 22 casos borde, incluidas claves con coma, con ceros a la izquierda, con espacios y la 32 |
| O4 | `mapValid`: si el movimiento no aporta a ese mapa (`removed == added == 0`) y el mapa no cambió, se omite el cálculo completo | Con diff vacío, `a` y `b` sin cambio, la comprobación original es verdadera. En cualquier otro caso se evalúa completa. Test con 160 casos generados contra la formulación original |

Sin cambios en ningún permiso, validación contable, revisión, `sumup_*`, resúmenes, categorías, auditoría, Calendario, áreas ni `users`.

## 4. Resultado (expresiones libres, peor caso)

| Operación | A producción (a312c96) | B candidata (0156740) | C optimizada | Documento limitante (C) |
|---|---|---|---|---|
| income create (existing month, 100 categories) | ≥13 | DENIED (v1) | **≥118** | summary |
| expense create (existing month, 100 categories) | ≥13 | DENIED (v1) | **≥118** | summary |
| income create (new month, no summary) | ≥13 | DENIED (v1) | **≥132** | summary |
| cash create (saveDailyCash) | ≥13 | DENIED (v1) | **≥118** | summary |
| cash update existing | ≥69 | ≥55 | **≥153** | summary |
| tithe create (+attribution) | ≥13 | DENIED (v1) | **≥118** | summary |
| tithe update amount | ≥76 | ≥55 | **≥160** | summary |
| tithe move to another period | ≥48 | ≥27 | **≥132** | summary |
| edit (same period) | ≥41 | ≥27 | **≥139** | summary |
| move to another period | ≥13 | DENIED (v1) | **≥118** | summary |
| void | ≥69 | ≥48 | **≥153** | summary |
| finance categories update | ≥727 | ≥713 | **≥727** | summary |

Peor caso por perfil (expresiones):
- A: legacy-admin ≥13, legacy-pastor ≥13, legacy-finance ≥13, v1-admin ≥13, v1-records ≥13
- B: legacy-admin ≥0, legacy-pastor ≥0, legacy-finance ≥0, v1-admin ≥0, v1-records DENIED
- C: legacy-admin ≥118, legacy-pastor ≥118, legacy-finance ≥118, v1-admin ≥118, v1-records ≥125

Casos C < A: 6
  - transaction · tithe create (+attribution) · v1-admin: A 76 → C 75 términos
  - transaction · edit (same period) · v1-admin: A 63 → C 62 términos
  - transaction · move to another period · v1-admin: A 63 → C 62 términos
  - transaction · void · v1-admin: A 63 → C 62 términos
  - attribution · tithe update amount · v1-admin: A 105 → C 104 términos
  - attribution · tithe move to another period · v1-admin: A 105 → C 104 términos

**Diferencia residual documentada:** v1 admin tiene 1 término (≈7 expresiones) menos que A en el movimiento y la atribución, documentos no limitantes donde quedan ≥430 expresiones libres. En v1 se comprueba primero el permiso y después `baseRole`. En producción no existen docs v1, y A evalúa ese perfil por su rol legacy, así que no es una operación equivalente. En el documento limitante (resumen), C ≥ A en todos los perfiles.

## 5. Paridad de seguridad

- Probe 34 ops × 7 perfiles, A vs C: **0 diferencias** (238 decisiones).
- Matriz amplia de Atlas, 53 ops × 12 perfiles:
  - **B vs C: 0 diferencias** (636 decisiones). La optimización no cambia ninguna decisión.
  - A vs C: 27 diferencias, las mismas ya clasificadas para B:
    - Calendario y áreas (superficie nueva);
    - un admin promueve a v1;
    - un v1 sin permisos de finanzas deja de leer resúmenes (por diseño).

## 6. Pruebas

- `tests/rules/budget.test.ts`: falla si alguna operación crítica queda con menos de **100 expresiones** libres en el movimiento, el resumen o la atribución, para cualquier perfil escritor (legacy o v1). Incluye la calibración.
- `tests/rules/budget-equivalence.test.ts`: equivalencia de `dayKeysOnly`, `mapValid` y la lectura de categorías.
- `tests/rules/platform-access.test.ts`: "tablas de acceso", adaptada a la forma especializada.

## 7. Compatibilidad

- **Calendario:** `calendarRead/ManageAll/…` siguen usando `gate()` sin cambios. Los tests de Calendario pasan.
- **PR #7 (Consolidación):** agrega `membersRead()` sobre `gate()` y entradas en `implicants()`. Este fix toca helpers distintos, así que la integración debería ser un merge limpio. Hay que repetir la medición de presupuesto y `test:rules` en PR #7, que también corre `budget.test.ts`.
