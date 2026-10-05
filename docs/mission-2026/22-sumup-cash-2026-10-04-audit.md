# 22 — SumUp CASH Intake V1 + auditoría financiera del domingo 04/10/2026

> **Estado: NO DEPLOY · NO BACKFILL APPLY · NO MERGE.** Rama `mission/sumup-cash-intake-v1`, base `feature/preproduccion-mobile-v1` @ `0d1bb0d` (árbol `55b29f6`, idéntico al de `e6b2084`). Producción no fue modificada: toda la auditoría fue de solo lectura.

## 0. Resumen ejecutivo

- El domingo 04/10 SumUp entregó **1 transacción CASH** (Cafetería, **$163.500**, SUCCESSFUL, 16:34 hora Santiago). El motor en producción la vio en cada corrida desde las 17:21 y la **ignoró deliberadamente como `nonPOS`**: no hay raw, no hay ledger, no hay summary para ella. Ofrendas no registró CASH.
- Todo el POS del día entró correcto: Ofrendas 14 pagos / $65.000; Cafetería 89 pagos / $740.360 (+7 FAILED por $28.400 correctamente excluidos). Proveedor → raw → ledger → summary cuadra 1:1.
- No hubo **ningún** movimiento manual en octubre → **0 duplicados** (confirmados, probables o en revisión).
- `financeMonthlySummaries/2026-10` cuadra **9/9 campos** con el ledger activo (PASS). El ledger está **incompleto respecto del proveedor** en exactamente $163.500 (el CASH).
- Scheduler 24/24 ejecuciones HTTP 200 en la ventana; 0 errores, 0 5xx, 0 permission-denied en Functions.
- **Riesgo BLOCKER confirmado en datos reales:** SumUp tiene CASH histórico que NO debe entrar: Cafetería 49 CASH ($125.201, 27/09 y 30/09 — dentro de la ventana del sweep de 45 días) y Ofrendas 4 CASH en junio 2025 ($9.002.023, uno de ≈$9.000.000). Habilitar CASH sin fecha de corte los habría importado en el siguiente sweep.
- Implementado: CASH ≥ 2026-10-04 → ingreso `paymentMethod: "cash"`; CASH anterior → `preCashStart` en todos los modos; POS idéntico (hash byte-idéntico, 0 rawRefresh en 641 POS reales). Sub-slice UI separado para que Movimientos no rotule el efectivo como tarjeta y para avisar antes de registrar dos veces el mismo efectivo.
- Dry-run sobre producción con el engine real: **1 CASH a crear, +$163.500**, 0 cambios POS, 0 manuales en conflicto.

**Auditoría general: PASS WITH FINDINGS.**

---

## 1. Método y alcance

| Item | Valor |
|---|---|
| Ventana local | `2026-10-04 00:00:00.000` → `23:59:59.999` America/Santiago |
| Ventana UTC (calculada con `Intl`, no a mano) | `2026-10-04T03:00:00.000Z` → `2026-10-05T02:59:59.999Z` (offset −180 min en ambos extremos; horario de verano vigente desde el 06/09) |
| Proveedor | `GET /v2.1/merchants/{mc}/transactions/history` con `oldest_time/newest_time` ±1 día y filtro posterior por fecha local con `core.datePartsChile` (la misma función que usa el motor). Historial completo de ambas cuentas desde 2025-01-01 para clasificar CASH histórico. |
| Firestore | Solo REST `GET` y `:runQuery` (lectura). Colecciones: `financeTransactions` (period 2026-10 y 2026-09), `financeMonthlySummaries/2026-10`, `sumupSyncRuns` (desde 03/10 15:00 UTC), `sumupIntegrations/{cuenta}` y `…/transactions` (raw del día). |
| Logs | `gcloud logging read` severidad ≥ WARNING y total de la ventana. |
| Secretos | Leídos a memoria; nunca impresos. IDs abreviados a los últimos 6 caracteres. |

Limitaciones: Cloud Logging no registra denegaciones de Firestore Rules del cliente web (ocurren en el navegador); el conteo de permission-denied cubre Functions/Cloud Run/Scheduler.

---

## C0.1 — SumUp (proveedor, autoridad)

### Ofrendas

| payment_type | n | bruto | SUCCESSFUL | REFUNDED | PENDING | FAILED/CANCELLED |
|---|---:|---:|---|---|---|---|
| POS | 14 | $65.000 | 14 · $65.000 | 0 | 0 | 0 |
| CASH | 0 | $0 | — | — | — | — |

POS: type PAYMENT 14, CLP 14, entry_mode `contactless` 14, `product_summary` 0, sin `fee_amount` 14, 12:27–12:34 hora local.

### Cafetería

| payment_type | n | bruto | SUCCESSFUL | REFUNDED | PENDING | FAILED/CANCELLED |
|---|---:|---:|---|---|---|---|
| POS | 96 | $768.760 | 89 · $740.360 | 0 | 0 | 7 FAILED · $28.400 |
| CASH | 1 | $163.500 | 1 · $163.500 | 0 | 0 | 0 |

- POS: PAYMENT 96, CLP 96, entry_mode contactless 93 / none 2 / chip 1, `product_summary` 49, sin `fee_amount` 96, 10:31–16:15 local.
- CASH (`…edce28`): type PAYMENT, CLP, status SUCCESSFUL, `entry_mode: "none"`, **sin `fee_amount`**, **sin `card_type`**, sin `product_summary`, sin `simple_payment_type` en la respuesta de history, `refunded_amount` 0, timestamp `2026-10-04T19:34:36Z` = 16:34:36 local (19 min después del último POS: patrón de cierre de caja consolidado). `transaction_id` disponible.

Campos que entrega history para CASH: los mismos que POS salvo `card_type`. `fee_amount` tampoco viene para POS en history (conocido desde Slice 3a; `feeStatus: unknown`).

---

## C0.2 — Qué hizo CDS Suite

Lectura del código antes de interpretar (`functions/sumup/core.js` / `engine.js` @ `0d1bb0d`): `classifyItem` devuelve `ignored/nonPOS` para todo `payment_type !== "POS"` y `applyLedgerDecision` solo incrementa el contador en ese caso: **no persiste raw**. La ausencia de raw para el CASH no prueba que SumUp no lo entregara; los contadores de `sumupSyncRuns` y la API sí lo prueban.

| Grupo | Proveedor | Raw | Ledger | Summary | Resultado |
|---|---|---|---|---|---|
| Ofrendas POS SUCCESSFUL | 14 · $65.000 | 14 · $65.000 (POS/SUCCESSFUL, feeStatus unknown, sin review) | 14 · $65.000 (`card`, montos 14/14 iguales) | Ofrendas $65.000 | ✅ cuadra |
| Cafetería POS SUCCESSFUL | 89 · $740.360 | 89 · $740.360 | 89 · $740.360 (`card`, 89/89 iguales) | Cafetería $740.360 | ✅ cuadra |
| Cafetería POS FAILED | 7 · $28.400 | — (ignored `other`, por diseño) | — | — | ✅ correcto |
| Cafetería CASH | 1 · $163.500 | — | — | — | ⚠️ ignored `nonPOS` (deliberado, código actual) |

Evidencia del ignore: desde la corrida programada de las 20:21 UTC (17:21 local) cada corrida de Cafetería reporta `fetched 1 · ignored.nonPOS 1` (7 corridas el domingo + todas las del lunes) y el sweep de 02:21 UTC reporta `nonPOS 50` (49 CASH históricos + el del domingo). No hay ledger docs sin raw, ni raw sin ledger.

---

## C0.3 — Movimientos manuales del 04/10

`financeTransactions` con `period = 2026-10`: **103 docs, todos `active`, todos `system:sumup`, todos día 4, todos `card`**. No existe ningún movimiento manual en octubre (tampoco `cash_offerings_2026-10-04`, `cash_cafeteria_2026-10-04` ni revisiones `_r2`), ni docs de otros períodos actualizados desde el inicio del domingo.

| Agrupación | n | monto |
|---|---:|---:|
| ingreso · Cafetería · card · general · system:sumup | 89 | $740.360 |
| ingreso · Ofrendas · card · general · system:sumup | 14 | $65.000 |
| manual (cualquier categoría/método) | 0 | $0 |

Ofrendas efectivo: 0 · Cafetería efectivo: 0 · Transferencias: 0 · Egresos: 0.

**Candidatos a doble registro: ninguno.** DUPLICADO CONFIRMADO 0 · DUPLICADO PROBABLE 0 · NO DUPLICADO n/a · REQUIERE REVISIÓN 0.

> **Confirmación humana requerida (no es un duplicado):** Ofrendas no tiene efectivo del domingo en ningún lado (ni SumUp ni manual). El CASH de $163.500 está en la cuenta **Cafetería**, 19 minutos después del último pago POS. Si ese monto consolida también efectivo de Ofrendas, al importarse quedará 100% como Cafetería. Antes del deploy, confirmar con quien operó la caja si $163.500 es solo Cafetería; si incluye Ofrendas, la corrección correcta es en SumUp (o un ajuste manual trazable), nunca editando el doc importado.

---

## C0.4 — Octubre: ledger vs summary

### Estado actual (PASS)

| Campo | Summary | Ledger activo | OK |
|---|---:|---:|---|
| incomeTotal | 805.360 | 805.360 | ✅ |
| expenseTotal | 0 | 0 | ✅ |
| result | 805.360 | 805.360 | ✅ |
| titheTotal | 0 | 0 | ✅ |
| transactionCount | 103 | 103 | ✅ |
| incomeByCategory | Cafetería 740.360 · Ofrendas 65.000 | idem | ✅ |
| expenseByCategory | {} | {} | ✅ |
| dailyIncome | {4: 805.360} | idem | ✅ |
| dailyExpense | {} | {} | ✅ |

### Delta CASH faltante y estado esperado post-backfill (NO escrito)

| Campo | Actual | Delta CASH | Esperado |
|---|---:|---:|---:|
| incomeTotal | 805.360 | +163.500 | 968.860 |
| result | 805.360 | +163.500 | 968.860 |
| transactionCount | 103 | +1 | 104 |
| incomeByCategory.Cafetería | 740.360 | +163.500 | 903.860 |
| incomeByCategory.Ofrendas | 65.000 | 0 | 65.000 |
| dailyIncome.4 | 805.360 | +163.500 | 968.860 |
| expenseTotal / titheTotal / expenseByCategory / dailyExpense | 0 / 0 / {} / {} | 0 | sin cambio |

El dry-run con el engine productivo (C4) produce exactamente este delta.

---

## C0.5 — Reconstrucción operacional del domingo

| Hora local | Evento |
|---|---|
| 03/10 21:31–21:32 | 3 sync manuales: 2 `partial` legítimos (presupuesto de 25 s) y 1 `completed`; solo `rawRefresh` (92/184/70), sin efecto contable. Fuera de la ventana; coincide con el despliegue de Etapa A. |
| 03/10 22:21 | Programada + sweep: rawRefresh 235 en Cafetería, `nonPOS 49` (CASH históricos). Sin efecto contable. |
| 04/10 10:31 | Primer POS Cafetería. 11:21 → primera importación (8). |
| 04/10 12:27–12:34 | 14 POS Ofrendas → importados en la corrida de 13:21. |
| 04/10 11:21–16:21 | Corridas horarias crean 8+11+31+10+19+10 = 89 POS Cafetería. |
| 04/10 16:34 | **CASH $163.500** registrado en SumUp (Cafetería). |
| 04/10 17:21 → 05/10 02:21 | Cada corrida de Cafetería lo trae y lo ignora `nonPOS`. |
| 04/10 23:21 | Sweep diario de ambas cuentas: `completed`, sin cambios contables. |

| Pregunta | Respuesta |
|---|---|
| Qué entró correctamente | Todo el POS SUCCESSFUL (103 pagos, $805.360). |
| Qué fue ignorado deliberadamente | 7 POS FAILED ($28.400, correcto) y 1 CASH ($163.500, por la regla POS-only). |
| Qué faltó | El CASH de Cafetería ($163.500). Efectivo de Ofrendas: no registrado en ninguna parte (confirmar si existió). |
| Registros manuales | Ninguno. |
| Duplicados | Ninguno. |
| Summary vs ledger | Matemáticamente correcto (9/9). |
| Ledger vs proveedor | Incompleto en $163.500 por CASH. |
| Errores / 5xx / permission-denied | 0 / 0 / 0 (logs ≥ WARNING en la ventana: 0 entradas). |
| Scheduler | PASS: 24/24 intentos HTTP 200; 2 runs/hora (una por cuenta) durante 29 h, todos `completed`. 2 sweeps por cuenta. |
| Runs parciales | Solo los 2 manuales del 03/10 21:31 (legítimos, fuera de ventana). |

### Hallazgos

| ID | Sev. | Hallazgo | Acción |
|---|---|---|---|
| F1 | MAJOR | CASH del 04/10 ($163.500) ausente del ledger por la regla POS-only. | Este slice + deploy de Functions (el propio engine lo importa; ver C4). |
| F2 | BLOCKER (mitigado en código) | CASH histórico en el proveedor: Cafetería 49 / $125.201 (27/09: 48 · $122.701; 30/09: 1 · $2.500) y Ofrendas 4 / $9.002.023 (04/06 y 08/06/2025, uno ≈ $9.000.000). Sin guard, el sweep habría importado los 49 de septiembre. | `SUMUP_CASH_START_DATE` + `preCashStart` en todos los modos; probado con el engine real sobre el historial real. |
| F3 | Decisión humana | El efectivo de Cafetería del 27/09 y 30/09 ($125.201) no está en el ledger por ninguna vía (no hay caja manual de Cafetería esos días). Puede ser una omisión real de septiembre. | Fuera de V1 por diseño (corte 04/10). Si corresponde, registrar manualmente vía "Caja del día" con nota. |
| F4 | Confirmación | ¿$163.500 es solo Cafetería o consolida Ofrendas? (C0.3). | Confirmar antes del deploy. |
| F5 | INFO | El watermark de Cafetería quedó anclado al timestamp del CASH: cada corrida horaria re-trae 1 ítem. Benigno; tras el deploy ese ítem pasa a `unchanged`. | Ninguna. |
| F6 | INFO | `fee_amount` no viene en history ni para POS ni para CASH (`feeStatus: unknown`). No es regresión. | Ninguna. |
| F7 | MINOR (preexistente) | Un mismo ítem repetido dentro de UNA página reentra por `create`: un solo doc y delta 0, pero `revision` sube 1. Afecta igual a POS desde Slice 1. | Fuera de alcance; documentado en test. |
| F9 | INFO (preexistente) | Si el legacy de Ofrendas volviera a correr, crearía 1 POS histórico (< 09/09) que hoy no está en el ledger. No ocurre: el legacy está en cortocircuito (`historyBackfilledAt` + schema v2). | Investigar aparte si se reabre el legacy. |
| F8 | Observación fuera de ventana | Septiembre tiene un egreso en efectivo de $6.480.000 en "Servicios básicos" (29/09). No auditado aquí. | Solo para conocimiento. |

---

## C1 — Diseño

### C1.1 Payment types

| provider `payment_type` | Antes | Después |
|---|---|---|
| POS | `card` | `card` (idéntico; hash idéntico) |
| CASH ≥ 2026-10-04 (fecha local) | ignored `nonPOS` | ingreso `paymentMethod: "cash"` |
| CASH < 2026-10-04 | ignored `nonPOS` | ignored **`preCashStart`** (todos los modos) |
| ECOM, RECURRING, BALANCE, MOTO, otros | ignored `nonPOS` | ignored `nonPOS` |

`core.LEDGER_PAYMENT_METHOD = { POS: "card", CASH: "cash" }` es la única tabla; el engine escribe `normalized.paymentMethod` (ya no `"card"` fijo). El contador conserva la clave `nonPOS` por compatibilidad (runs, UI), ahora con el significado "payment type no soportado".

### C1.2 Descripciones

| Cuenta | POS | CASH |
|---|---|---|
| Ofrendas | `Ofrenda tarjeta física · SumUp` | `Ofrenda efectivo · SumUp` |
| Cafetería | `Venta Cafetería · SumUp` | `Venta Cafetería efectivo · SumUp` |

La categoría no cambia (`Ofrendas` / `Cafetería`): Reportes, Insights y la página de Ofrendas ya suman efectivo por `category + paymentMethod === "cash"`, así que el CASH SumUp aparece como Efectivo sin tocar esos módulos.

### C1.3 Raw / provider snapshot

Se agregan `providerSnapshot.simplePaymentType` y, en el raw, `simplePaymentType` y `paymentMethod` (lo que el ledger reserva). Se preservan `paymentType`, bruto, reembolsado, status, id, timestamp, `entryMode`, `feeAmount`/`feeStatus` tal como los entrega el proveedor: CASH sin `fee_amount` queda `feeAmount: null, feeStatus: "unknown"`. El ledger nunca descuenta comisión.

### C1.4 Hash / idempotencia

- `snapshotHash` incluye `paymentType` (y `simplePaymentType`) **solo cuando no es POS**. Así un cambio POS ↔ CASH siempre cambia el hash, y todos los hashes POS ya guardados quedan byte-idénticos (sin rawRefresh masivo al desplegar). Verificado: test 15 y simulación real (641 POS, 0 rawRefresh).
- `classifyItem` compara `amount`, `category`, `day` **y `paymentMethod`** (docs previos sin el campo se leen como `card`). Un cambio solo de método es `update` con razón `payment_method_changed`, versionado (`before` completo + `afterPaymentMethod`).
- El summary no separa por método, así que ese update tiene delta monetario 0; además el engine ya no reescribe el summary cuando todas las entradas del delta son 0.
- CASH anterior al corte con un doc activo existente (solo podría ser `card`) → `review/payment_method_changed`, nunca conversión automática.
- `rawRefresh` sigue reservado a metadata que no toca el ledger (p. ej. `fee_amount`, test 18).

### C1.5 Refunds / estados

Sin cambios en los guards: el chequeo de CASH va después de chargeback/nonCLP/nonPayment/pending y antes del resto. CASH hereda: reembolso parcial → `update/refund_partial`; total → `void`; CANCELLED/FAILED sin doc → ignored, con doc activo → `review/status_downgraded`; PENDING → ignored; CHARGE_BACK → `review/chargeback` sin efecto contable; edición/anulación humana → `review`.

### C1.6 Legacy / sweep / cursor / watermark

El guard vive en `classifyItem`, que usan los tres modos; no depende de cursor ni watermark. Comparación por **fecha local de Santiago** (`localDate`), igual que `preSplit`.

| Modo | Riesgo real | Resultado |
|---|---|---|
| Incremental (watermark −15 min) | Bajo | CASH ≥ 04/10 entra; anterior `preCashStart`. |
| Sweep 45 días | **49 CASH de septiembre en ventana** | Simulación real: 1 creado (04/10), 49 `preCashStart`, 0 cambios POS. |
| Legacy (Ofrendas < 09/09) | 4 CASH de 2025 (≈$9 M) si el legacy volviera a correr | Siempre `preCashStart` (test 14 con $9.000.000). Hoy además está en cortocircuito (`historyBackfilledAt` + schema v2). |

### C1.7 Respaldo manual y doble registro

Regla: SumUp CASH es la vía primaria; la "Caja del día" manual sigue disponible como contingencia; nunca se suman los dos para el mismo efectivo.

Arquitectura actual que ya ayuda:
- Origen explícito e inequívoco: SumUp = id `sumup_{cuenta}_{tx}` + `createdBy: system:sumup` + `paymentMethod: cash` + descripción "… efectivo · SumUp". Manual = id determinístico `cash_{área}_{fecha}` (`_rN` tras anulaciones), uno por área/día.
- `findActiveDailyCash` solo mira ids `cash_*`, así que el modal nunca confunde un CASH SumUp con la caja manual (no hay edición humana accidental del doc importado).
- La tarjeta del día en Ofrendas suma todo el efectivo (`cashDay`), por lo que el CASH SumUp ya se ve y el aviso "falta efectivo" desaparece.

Defensa elegida (menor blast radius, sin deduplicación por monto):
1. **Functions (V1):** importar con origen trazable; nunca tocar docs manuales.
2. **Sub-slice UI (Hosting, commits separados):**
   - SumUp primero → manual después: el modal "Caja del día" muestra un aviso no bloqueante cuando SumUp ya registró efectivo para esa área/día (vinculado al campo con `aria-describedby`).
   - Manual primero → SumUp después (o cualquier orden): la tarjeta del área muestra "Incluye $X registrado en SumUp" y, si además hay una Caja del día activa ese día, un aviso "Hay efectivo en SumUp y en Caja del día. Revisa que no sea el mismo dinero."
   - Nada se bloquea ni se fusiona: dos montos legítimos pueden coincidir.
3. **Dry-run (C4):** antes de aplicar, por cada día con CASH a crear lista el efectivo manual activo de la misma área/día → "REQUIERE REVISIÓN". **Debe re-ejecutarse inmediatamente antes del deploy de Functions** (la foto del 05/10 caduca).

Riesgo residual aceptado para V1 (→ V1.1):
- El formulario genérico de movimientos (`TransactionForm`) también permite crear ingresos Ofrendas/Cafetería en efectivo y no muestra el aviso.
- El engine no marca `review` cuando importa un CASH en un día/área con Caja del día manual activa (V1.1: flag por origen en el raw, no por monto).

Reglas operativas (cajero SumUp + tesorería):
- **Una cuenta por área:** el efectivo de Ofrendas se registra solo en la cuenta SumUp de Ofrendas y el de Cafetería solo en la de Cafetería. Nunca consolidar ambas áreas en un mismo CASH (la categoría la decide la cuenta).
- **Mismo día:** el ledger usa la fecha/hora en que se registra el CASH en SumUp. Registrarlo el mismo día del servicio (antes de las 23:59 hora Santiago); si se pasó el día, usar "Caja del día" con la fecha correcta.
- **Sin fondo de caja:** el CASH consolidado excluye el sencillo inicial.
- **Error de cuenta o monto:** reembolsar en SumUp y volver a registrar correctamente (o vía Caja del día). Pendiente confirmar que SumUp permite reembolsar un CASH (condición previa al deploy).

Procedimiento manual seguro (para tesorería):
1. Si el efectivo se registró en SumUp como CASH: **no** usar "Caja del día" para ese mismo efectivo.
2. Solo si NO se registró en SumUp (máquina sin batería, olvido): registrar en "Caja del día" con nota "No registrado en SumUp".
3. Si se registró en ambos por error: anular el **manual** con motivo "Duplicado de SumUp CASH" (el doc SumUp es solo lectura y se corrige en SumUp).
4. Si el CASH en SumUp tiene un monto errado: corregir/reembolsar en SumUp; el sistema actualiza o anula solo.

---

## C2 — Implementación

| Commit | Alcance | Archivos |
|---|---|---|
| `f92f628` | **Functions** | `functions/sumup/core.js`, `functions/sumup/engine.js`, `tests/functions/sumup-cash.test.ts` |
| `fd5b000` | **Hosting** (sub-slice UI) | `lib/finance/movement-groups.ts`, `components/finance/transactions/transaction-list.tsx`, `lib/offerings/cash.ts`, `components/finance/offerings/cash-modal.tsx`, `tests/sumup-cash-ui.test.tsx` |
| `f7afeae` | Script (no se despliega) | `scripts/sumup-cash-backfill.mjs`, `scripts/lib/sumup-dry-run-store.mjs` |
| `f52ee09` | Hosting (review Designer) | `transaction-list.tsx` ("Ver 1 registro/pago"), `cash-modal.tsx` (icono + `aria-describedby`), columnas "Ofrendas/Cafetería tarjeta" en `offerings-page.tsx`, `reports-page.tsx`, `lib/finance/report-pdf.ts` |
| `accbed9` | Hosting (review Navigator) | `offerings-page.tsx`: origen SumUp del efectivo del día + aviso cuando hay SumUp y Caja del día el mismo día |

No se tocó `functions/index.js`, Firestore Rules, índices, scheduler, secretos ni A5.

**Por qué no se necesitan Rules:** las Functions escriben con Admin SDK (no evalúa Rules) y la validación de `financeTransactions` ya admite `paymentMethod in ['cash','transfer','card','other']`.

**Por qué el sub-slice UI sí es necesario (demostrado):** `SumUpGroupRow` rotulaba todo grupo SumUp como "N pagos con tarjeta · Tarjeta · SumUp" y `groupMovements` agrupaba por día × categoría × estado sin método. Con solo Functions, el 04/10 de Cafetería se vería como "90 pagos con tarjeta · $903.860". Los totales serían correctos, el rótulo no. El fix separa el grupo de efectivo y deja la clave/rótulo de tarjeta idénticos. Todo lo demás (Reportes, Insights, Ofrendas, Resumen) ya clasificaba por `paymentMethod` y no necesita cambios.

---

## C3 — Matriz de pruebas

`tests/functions/sumup-cash.test.ts` (25 casos) y `tests/sumup-cash-ui.test.tsx` (9 casos).

| # | Caso | Test |
|---|---|---|
| 1 | POS successful CLP sigue creando card | "1/15. POS successful…" |
| 2 | CASH ≥ 04/10 crea cash | "2/6/16…" |
| 3 | CASH < 04/10 ignorado (incl. borde 23:30 del sábado local vs 00:30 del domingo) | "3/12…", "3. el corte usa la fecha LOCAL…" |
| 4 | CASH repetido idempotente | "4/5/17…", "4b…" |
| 5 | Sin dos finance docs | "4/5/17…" |
| 6 | Summary suma una vez | "2/6/16…", "4/5/17…" |
| 7 | Reembolso parcial | "7…" |
| 8 | Reembolso total | "8…" |
| 9 | PENDING no entra | "9…" |
| 10 | FAILED/CANCELLED guards | "10…" |
| 11 | Cambio de método del proveedor | "11. … POS -> CASH", "11. … snapshotHash", "11b…", "CASH anterior… revisión humana" |
| 12 | Otros payment types ignorados | "3/12…" |
| 13 | Sweep encuentra CASH ≥ 04/10 | "13…" + simulación real |
| 14 | Legacy no importa CASH histórico | "14…" + simulación real |
| 15 | POS existente no cambia | "15. snapshotHash byte-idéntico" + simulación real (0 rawRefresh) |
| 16 | Summary mantiene 9 campos | "2/6/16…" |
| 17 | Relectura no cambia montos | "4/5/17…" |
| 18 | Fee no modifica ledger | "18…" |
| 19 | Ambas cuentas | "19…" |
| 20 | Tests históricos Financial Core | suite completa |

Gates: `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ **208/208** (174 previos + 34 nuevos) · `npm run build` ✅ · `node --check` Functions ✅. Rules tests: no aplica (Rules intactas).

---

## C4 — Backfill controlado del 04/10

**Mecanismo:** el backfill **es el engine productivo**. Tras desplegar Functions, la siguiente corrida horaria de Cafetería (su watermark está anclado justo en el CASH, F5), el sweep diario (ventana 45 días) o "Sincronizar ahora" importan el CASH del 04/10 con lease, run record y transacciones reales. No hay un segundo camino de escritura.

**Dry-run:** `scripts/sumup-cash-backfill.mjs` corre `engine.runAccountSync` sobre un store de dry-run (lecturas a producción, escrituras en memoria). Solo lectura por construcción, rechaza `--since` anterior al 04/10 y no tiene `--apply`.

```
node scripts/sumup-cash-backfill.mjs [--account offerings|cafeteria|both] [--since 2026-10-04] [--until YYYY-MM-DD]
```

Resultado (05/10, ventana 04/10–05/10):

| | Ofrendas | Cafetería | Total |
|---|---:|---:|---:|
| CASH encontrados | 0 | 1 · $163.500 | 1 · $163.500 |
| CASH ya presentes | 0 | 0 | 0 |
| CASH a crear | 0 | 1 · $163.500 | 1 · $163.500 |
| CASH en revisión | 0 | 0 | 0 |
| POS: ya presentes / cambios | 14 / 0 | 89 / 0 (+7 FAILED ignorados) | 103 / 0 |
| Efectivo manual en conflicto | — | 0 | 0 |
| Delta summary 2026-10 | — | incomeTotal +163.500 · result +163.500 · transactionCount +1 · Cafetería +163.500 · día 4 +163.500 | |

Simulaciones adicionales del guard con el engine real sobre el historial real del proveedor (scratch, no versionadas, store de dry-run):

- Sweep de 45 días de Cafetería (691 ítems) → `created 1` (el CASH del 04/10), `preCashStart 49`, `rawRefreshed 0`, `updated 0`.
- Legacy de Ofrendas forzado a re-correr sobre todo el historial (13.749 ítems) → `preCashStart 4`, **0 escrituras `cash`**. (También reporta 1 POS histórico anterior al 09/09 sin doc en el ledger: preexistente e independiente de CASH; ver F9.)

**Plazo:** el sweep cubre 45 días; si el deploy ocurre después del **2026-11-17**, el 04/10 sale de la ventana y el CASH solo entraría vía incremental si el watermark sigue anclado. En ese caso, preparar un apply explícito antes de desplegar.

---

## Rollback conceptual

- **Datos primero, Functions después.** Los docs `sumup_*` son de propiedad del proveedor: `firestore.rules` (`providerOwnedFinanceTransaction`) bloquea su edición/anulación desde el cliente y la UI los muestra en solo lectura. Para revertir un CASH importado: **reembolsarlo en SumUp mientras las Functions nuevas siguen activas** (el engine lo anula y ajusta el summary, trazable), o un script Admin revisado. Nunca borrar.
- **Functions:** redeploy de `0d1bb0d` (Etapa A). CASH vuelve a `nonPOS`. Los docs CASH ya creados quedan en el ledger y el engine viejo **deja de seguirlos**: un reembolso posterior en SumUp ya no llegaría al ledger. Por eso el orden anterior.
- **Hosting:** redeploy del build anterior. Efecto visual (el efectivo SumUp vuelve al grupo "pagos con tarjeta") **y** se pierden los avisos de doble registro: sube el riesgo de duplicado, no solo la estética.
- **Orden recomendado del deploy:** Hosting primero (sin docs CASH se ve igual que hoy), luego Functions. Así nunca se muestra "90 pagos con tarjeta".
- **Alcance del deploy:** `firebase deploy --only hosting` y `--only functions:sumupSyncScheduled,functions:sumupSyncNow` (nunca `--only functions` a secas). Antes, verificar que el Hosting vivo corresponde a `0d1bb0d`; si no, el deploy de Hosting arrastraría cambios intermedios.

---

## Impacto productivo propuesto

| | |
|---|---|
| Rules | NO |
| Functions | SÍ (`sumupSyncScheduled`, `sumupSyncNow`: cambia `functions/sumup/*`) |
| Hosting | SÍ, recomendado (sub-slice UI, independiente) |
| Backfill requerido | SÍ, implícito en el deploy de Functions (sin script de escritura) |
| CASH 04/10 a crear | 1 |
| Delta financiero esperado | +CLP 163.500 (Cafetería, 04/10) |
| Manuales a revisar antes del apply | 0 |
| Confirmación humana previa | 1 (F4: composición de los $163.500) |
| Gates operativos previos | Avisar a tesorería que **no** registre a mano el efectivo de Cafetería del 04/10 (la UI hoy muestra "Falta efectivo" y lo invita); re-ejecutar el dry-run justo antes del deploy y exigir 0 días manuales en conflicto; confirmar que SumUp permite reembolsar CASH; comunicar reglas operativas a cajeros |
| Contadores | `ignored.preCashStart` nuevo; `nonPOS` deja de contar CASH. Ninguna UI muestra estos contadores |
