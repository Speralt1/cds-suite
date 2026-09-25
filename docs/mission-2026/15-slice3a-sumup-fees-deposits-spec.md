# Slice 3a: comisión y depósito SumUp por día (spec Atlas)

## Evidencia G9 (sonda de solo lectura, septiembre 2026, 2026-09-25)

**Qué entrega SumUp**
- `GET /v1.0/merchants/{mc}/payouts` devuelve **una fila por transacción**: 580 filas, todas `type: PAYOUT` y `status: SUCCESSFUL`. En septiembre no hubo deducciones.
- **`amount` ya viene neto de la comisión.** Los 580 votos coinciden (207 de Ofrendas, 373 de Cafetería, 0 en contra).
- El `id` no se repite (207/207 y 373/373).
- `transaction_code` enlaza el 100 % de las filas con `sumupIntegrations/{a}/transactions`: ningún código quedó sin encontrar ni apareció en la cuenta equivocada.
- SumUp paga al día siguiente de cada día de venta. Cada venta genera una transferencia con `reference` propia (`M2M PID…` en Ofrendas, `MFA PID…` en Cafetería).

**Totales de septiembre**

| Cuenta | Bruto | Comisión | Depositado | % comisión |
|---|---|---|---|---|
| Ofrendas | $1.022.600 | $34.083 | $988.517 | 3,33 % |
| Cafetería | $2.011.700 | $69.560 | $1.942.140 | 3,46 % |

**Consulta aparte:** `feeAmount > 0` dio 0 documentos en las dos cuentas. Queda confirmado que la app nunca tuvo la comisión real.

**Pendiente:** Salvador tiene que comparar 1 o 2 depósitos contra la cartola del banco.

## Decisiones

- **G1 (cerrada):** el ingreso se registra en bruto y la comisión como egreso vinculado. Hoy se puede ejecutar.
- **Granularidad:** la comisión se agrupa por **día de venta × cuenta**, porque así se ve en el resumen de cada día. El depósito se identifica por su `reference` y su `date`.
- **Nunca** se edita el ingreso bruto.
- Si la comisión aún no se conoce, se muestra "pendiente", **nunca $0**.

## Modelo de datos

### `sumupPayouts/{docId}` (solo backend)

- **Reglas:** lectura para `details()`, escritura `if false`.
- **`docId`:** `safeId(`${account}_${type}_${id}_${transaction_code||'none'}`)`.
- **Campos:** `account`, `merchantCode`, `rowId`, `type`, `status`, `date`, `reference`, `transactionCode`, `currency`, `amountRaw`, `feeRaw`, `amount`, `fee` (enteros CLP), `netPaid` (con la base `net` es igual a `amount`), `basis`, `raw`, `rawHash`, `firstSeenAt`, `lastSeenAt`, `runId`, `linkStatus`, `review`, `reviewReason`.
- **Cambios:** `raw` y `firstSeenAt` se escriben una sola vez. Si cambia `rawHash`, se agrega una entrada en `versions/`. Nada se borra.

### `sumupIntegrations/{a}/transactions/{txId}.settlement`

- Es un mapa **nuevo** que solo escribe la ingesta de payouts. El sync horario **no debe tocarlo**; hay que agregar un test de regresión.
- **Campos:** `feeAmount`, `feeStatus` (`provider` | `mismatch`), `feeSource: 'payouts'`, `payoutRowIds[]`, `payoutDate`, `payoutReference`, `payoutStatus`, `netPaid`, `deductions`, `updatedAt`, `runId`.
- **Bug a corregir:** `buildRawDoc` (en `functions/sumup/engine.js`) escribe `feeAmount:null` y `feeStatus:'unknown'` en el nivel superior del documento. Se mantiene por compatibilidad, pero la UI y la ingesta tienen que usar solo `settlement.*`.

### Deducciones

- Las filas `REFUND_DEDUCTION`, `CHARGE_BACK_DEDUCTION`, `DD_RETURN_DEDUCTION` y `BALANCE_DEDUCTION`, y las filas sin código, se guardan con `review: true`.
- No crean movimientos contables.
- Restan en la conciliación del depósito.

## Ingesta

### Funciones

- **`sumupPayoutsScheduled`:** una vez al día a las 06:10 hora de Chile, en `southamerica-east1`, con los secrets de las dos cuentas.
- **`sumupPayoutsNow`:** HTTP, solo admin (`requireFinanceUser` con role `admin`). Recibe `{account?, startDate?, endDate?, dryRun}` con una ventana de 35 días como máximo.

### Por cuenta y aislada

- Usa el mismo lease del sync (`acquireLease`/`releaseLease`) pero con su propio lock `payouts`.
- Registra cada ejecución en `sumupSyncRuns` con `kind: 'payouts'` y `dryRun`.
- Ventana: [hoy − 35 días, hoy]. Parámetros `limit=9999` y `order=asc`, con timeout.
- Si falla, clasifica el error con `classifyHttpError`. Un 401 o 403 se registra como `scope_missing`.
- Reutiliza la lógica pura de `scripts/lib/payouts-probe-core.mjs`: detección de base, vinculación y agregados. Para usarla en `functions/` hay que moverla a `functions/sumup/payouts-core.js` en CommonJS, y la sonda la importa desde ahí.

### Regla de base (ya probada)

- Una fila vota **net** si `|amount + fee − G| ≤ 1` (o `G'`), y **gross** si `|amount − G| ≤ 1`.
- La base se acepta solo si todos los votos coinciden y hay al menos 3. Si no, la ejecución queda en `needs_review`: se escriben las filas crudas pero **no** `settlement` ni el libro.

## Libro contable (G1)

### Movimiento de comisión

- **Id:** `financeTransactions/sumup_fee_{account}_{YYYY-MM-DD}`. El prefijo `sumup_` lo deja protegido por G3.
- **Monto:** Σ de `settlement.feeAmount` de las transacciones de esa cuenta en ese día de venta que tengan `feeStatus: 'provider'`.
- **Campos:**
  - `type: 'expense'`, `paymentMethod: 'card'`, `date` a las 12:00 hora de Chile, `period`, `day`.
  - `category`: `Comisión SumUp · Ofrendas`, `Comisión SumUp · Cafetería` o `Comisión SumUp · histórico sin separar` (antes del 2026-09-09). Estas categorías se agregan a `expenseCategoriesAll` con un `ensure`.
  - `origin: 'sumup_fee'`, `area`, `feeCoverage: {txCount, txWithFee}`, `createdBy`/`updatedBy: 'system:sumup'`, `revision`.
- **Recálculo:** se hace dentro de una transacción de Firestore.
  - Si el monto cambia, sube la revisión y se agrega una entrada en `versions/`.
  - Si el monto baja a 0, el movimiento queda `voided` con su motivo.
- **Resumen mensual:** hay que agregar `expenseSummaryDelta` a `core.js`, con cambios en `expenseTotal`, `expenseByCategory`, `dailyExpense` y `result`. El documento se escribe **completo**, sin merge, siguiendo el patrón B1.

### Interruptor

- La variable `SUMUP_FEES_LEDGER_ENABLED` (param) **empieza en false**.
- Mientras esté apagado, la ingesta solo escribe `sumupPayouts` y `settlement`, y la UI ya muestra comisión y depósito.
- Encenderla para crear los movimientos de gasto y hacer el **backfill de septiembre** es una migración: requiere OK humano.

## UI

### Resumen del día (panel y calendario) y tarjetas de Ofrendas y Cafetería, por área

```
Tarjeta SumUp (bruto)      $580.000
Comisión SumUp            −$20.068
Líquido                    $559.932
Depositado 21-09           $559.932   ✓ Conciliado
```

- **Sin payout todavía:** `Comisión: pendiente` y `Por depositar`. En ese caso "Líquido" se muestra como `—`.
- **Cobertura parcial:** `Comisión parcial (k de n pagos)`.
- **Estados** (01 §8), siempre con ícono y texto:
  - **Pendiente:** todavía no hay payout.
  - **Conciliado:** la diferencia entre lo depositado y el líquido esperado es 0.
  - **Con diferencia:** la diferencia es mayor que 0 y ya pasaron 5 días hábiles.
  - **Requiere revisión:** hay filas en review, mismatch o base indeterminada.

### Otras pantallas

- **Resumen del mes:** la línea "Comisión SumUp · Pendiente" se cambia por el monto real cuando haya datos (estado `recorded`, si el ledger está apagado sale de `settlement`). "Ingresos por tipo de dinero" suma una fila "Depositado por SumUp".
- **Reporte:** agrega la comisión real y lo depositado por cuenta. Cambia `sumUpFee.status` a `recorded`.
- **Etiquetas:** se retiran por completo las que dicen "líquido" sobre montos que en realidad son bruto.

### Lectura desde el cliente

- Nueva query `sumupPayouts` where `account` y `date` en el rango del mes. El detalle de cada transacción se obtiene leyendo `settlement` de `sumupIntegrations/{a}/transactions`.
- Si la lectura resulta cara, se puede agregar un resumen diario `sumupDailySettlement/{a}_{date}` con bruto, comisión, pagado, referencias y estado, que escribe la ingesta. **Recomendado:** reduce lecturas y es lo que muestra la UI.

## Tests

### Unit (mocks)

- Base neta y base bruta; votos mezclados → review; menos de 3 votos.
- Reembolso antes y después del payout; contracargo; deducción con comisión.
- Filas de `BALANCE_DEDUCTION` sin código; filas de otra cuenta.
- Ejecutar dos veces no escribe nada; si cambia una fila, se crea una versión.
- El sync horario no pisa `settlement` (regresión).
- Recálculo de la comisión: revisión, anulación en 0 y delta de gastos en el resumen.
- Lease y aislamiento por cuenta.

### Otros

- **Reglas:** el cliente no puede escribir `sumupPayouts`, `sumupDailySettlement` ni `sumup_fee_*`.
- **UI:** el panel del día y las tarjetas muestran bruto, comisión, líquido y depositado, y "pendiente" cuando falta.
- **Aceptación con datos de septiembre** (fixture armado con los totales de G9): Ofrendas da $1.022.600 − $34.083 = $988.517 y Cafetería da $2.011.700 − $69.560 = $1.942.140.

## Gates

- Deploy de functions y rules.
- Primera ejecución real con `dryRun`.
- Encender `SUMUP_FEES_LEDGER_ENABLED` y hacer el backfill de septiembre (migración).
- Validación contra la cartola.
