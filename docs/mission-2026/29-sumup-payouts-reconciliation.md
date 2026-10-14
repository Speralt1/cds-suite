# 29 — Conciliación de abonos SumUp (solo lectura)

> Rama `feature/sumup-payouts-reconciliation-v1` (desde producción `18925d6`).
> **NO DESPLEGADO.** No escribe en el libro, no hace backfill y no toca el motor de ventas SumUp.
> Validado solo con tests unitarios (fetch simulado) y con el emulador (`demo-cds-suite`).

## 1. Objetivo

Responder, por cada depósito que SumUp hace al banco, tres preguntas:

1. Qué ventas paga ese depósito.
2. Cuánto se descontó y por qué: comisión, devoluciones u otros ajustes.
3. Si cuadra.

Además, mostrar cuánto de lo vendido con tarjeta **todavía no se abona** ("SumUp pendiente de abono").

Todo esto es lectura. Las comisiones se calculan como **propuestas** de gasto. Registrarlas en el libro es una decisión aparte (§8).

## 2. Evidencia de la API (sonda de solo lectura, octubre 2026)

Solo se registran agregados. Este documento no incluye merchant codes, claves, referencias reales ni datos personales.

- `GET https://api.sumup.com/v1.0/merchants/{merchant_code}/payouts?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&limit=9999&order=asc`, con la apiKey de la cuenta, responde **HTTP 200**. El scope está disponible.
- Cada fila trae los campos `amount`, `currency`, `date`, `fee`, `id`, `reference`, `status`, `transaction_code` y `type`.
- Hay **una fila por cada venta**. Todas las filas observadas son `type: PAYOUT` y `status: SUCCESSFUL`, y los `id` no se repiten.
- **`amount` viene neto de la comisión.** Se cumple `amount + fee == bruto de la venta` en el 100 % de las filas.
- `transaction_code` enlaza el 100 % de las filas con `sumupIntegrations/{cuenta}/transactions.transactionCode`.
- **Un depósito no equivale a un día de venta.** El abono de Ofrendas del 13-10-2026 agrupó dos días de venta:

  | Día de venta | Ventas |
  |---|---|
  | 10-10 | 10 |
  | 11-10 | 13 |

  En total: bruto $100.522, comisión $3.352 y abono neto $97.170.

- Según la documentación de SumUp y la Slice 3A, también pueden aparecer:
  - otros tipos de fila: `REFUND_DEDUCTION`, `CHARGE_BACK_DEDUCTION`, `DD_RETURN_DEDUCTION` y `BALANCE_DEDUCTION`;
  - estados fallidos o en proceso;
  - filas sin `transaction_code`.

### Caso conciliado: Cafetería

- **Ventas:** 88 ventas con tarjeta el domingo 11-10-2026, por un bruto de **$462.500**.
- **Abono:** un solo depósito el martes 13-10-2026, con una sola referencia. El lunes 12-10 fue feriado.
- **Comisión SumUp** (Σ `fee`): **$15.968**.
- **Abono neto** (Σ `amount`): **$446.532**.
- **Resultado:** $462.500 − $15.968 = $446.532. La diferencia es exactamente la comisión real, sin devoluciones ni deducciones. Estado: **CONCILIADO**.

El caso está reproducido con datos ficticios, con los mismos agregados, en `tests/functions/sumup-payouts-fixtures.ts` (`cafeteriaCase`).

## 3. Componentes

| Pieza | Archivo | Qué hace |
|---|---|---|
| Lógica pura | `lib/shared/sumup-payouts.ts` → `functions/shared/sumup-payouts.js` (build-shared) | Valida filas, detecta la base, arma los abonos, asigna estados y calcula propuestas y pendientes. Sin I/O. |
| Callable | `functions/sumup-payouts/read.js`, exportado como `sumupPayoutsReconciliation` | Autoriza, valida la ventana, llama solo a `GET /payouts` y lee las ventas. No escribe. |
| Cableado | `functions/index.js` | Agrega **una línea** de export. El resto del archivo no cambia. |
| Cliente | `lib/offerings/payouts-client.ts` | Usa `httpsCallable` y traduce los errores a mensajes en español. |
| UI | `components/finance/offerings/sumup-reconciliation-panel.tsx` | Panel "Conciliación SumUp" en Ofrendas y Cafetería, que se consulta a pedido. |

**No se tocaron:**
- `functions/sumup/core.js`, `engine.js` ni `firestore-store.js`;
- `sumupSyncNow`, `sumupSyncScheduled` ni `campaignShare`;
- las reglas de Firestore;
- la lógica del libro ni la de los resúmenes.

## 4. Contrato del callable

```
sumupPayoutsReconciliation (onCall, southamerica-west1, timeout 60 s, 256 MiB, maxInstances 3,
                            secrets SUMUP_OFFERINGS_CONFIG + SUMUP_CAFETERIA_CONFIG)
entrada: { account?: "offerings" | "cafeteria" | "both" (default "both"), startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD" }
salida:  { readOnly: true, period, payoutFetch, salesRead, asOfDate, policy, differenceBusinessDays,
           accounts: [ {ok:true, account, basis, settlements[], pendingDays[], pendingAmount, pendingSales,
                        proposals[], totals, rowStats} | {ok:false, account, errorClass} ],
           totals }
```

**Autorización.** Exige `can(users/{uid}, "finance.details.read")`, el mismo permiso que pide la página. Entran admin, pastor, finanzas y cualquier perfil v1 con ese permiso. Líder, solo resumen, inactivo o sin documento reciben `permission-denied`.

**Errores** (`HttpsError` con clave):

| Código | Clave | Cuándo |
|---|---|---|
| `unauthenticated` | `sumup-payouts/unauthenticated` | Sin sesión |
| `permission-denied` | `sumup-payouts/forbidden` | Sin el permiso |
| `invalid-argument` | `sumup-payouts/invalid-input` | Entrada inválida |
| `invalid-argument` | `sumup-payouts/window-too-long` | Más de 35 días |
| `internal` | `sumup-payouts/internal` | Error inesperado (respuesta genérica, sin detalles) |

**Ventana.** `startDate`/`endDate` son días de venta, como máximo 35, ambos inclusive.
- **Abonos que se piden a SumUp:** `[startDate, min(endDate + 10 días, hoy)]`. Así se capturan los abonos de las últimas ventas de la ventana.
- **Ventas que se leen** (de ambas cuentas, para detectar filas de la otra): `[startDate − 10 días, max(endDate, fin de abonos pedidos)]`.
  - El lookback vincula abonos de inicio de mes que pagan ventas del mes anterior.
  - Leer hasta el fin de los abonos pedidos vincula **todas** las filas de un abono de borde de mes. Por ejemplo, un abono del 03-11 que paga 31-10 + 01-11 (Ofrendas agrupa sábado y domingo, y el 31-10-2026 es sábado) queda CONCILIADO tanto en la vista de octubre como en la de noviembre, con la misma propuesta.
  - Pendientes y totales siguen limitados a `[startDate, endDate]`.

**Errores por cuenta.** Cada cuenta se procesa aislada: si una falla, la otra responde igual. Las clases de error son:
- `config_error`
- `auth_error` (401)
- `scope_missing` (403)
- `rate_limited`
- `provider_unavailable`
- `timeout` (15 s, cubre la petición y la lectura del cuerpo)
- `provider_bad_response`
- `emulator_offline`

**Tope de ventas leídas.** Se leen como máximo 20.000 ventas por cuenta. Si alguna cuenta llega al tope, la respuesta trae `salesLimitReached: true` y el panel avisa que algunos abonos podrían aparecer como no vinculados.

**Límite de filas.** Se piden `limit=9999` filas. Si SumUp devuelve 9999 o más, la cuenta trae `rowLimitReached: true` y el panel avisa que puede haber abonos que no se muestran.

**Solo lectura:**
- El único llamado HTTP es `GET` a `/payouts`, con timeout de 15 s.
- Firestore se envuelve en `readOnlyFirestore`, un Proxy **profundo**.
  - **Qué vuelve envuelto:** todo lo que sale de él. Esto incluye retornos de métodos (también dentro de promesas), propiedades como `ref.firestore` y `ref.parent`, snapshots y su `ref`, `snap.docs[i].ref`, los datos leídos y los descriptores de propiedad.
  - **Callbacks:** los que se le pasan reciben sus argumentos envueltos. Por ejemplo, en `qs.forEach(d => …)`, `d.ref` está protegido.
  - **Prototipo y constructor:** `Object.getPrototypeOf(x)` devuelve el prototipo envuelto, así que `Object.getPrototypeOf(ref).set` también lanza. `x.constructor` (salvo Object/Array) lanza al llamarse.
  - **Qué lanza `ReadOnlyViolation`:** pedir `set`, `update`, `delete`, `create`, `add`, `batch`, `runTransaction`, `bulkWriter` o `recursiveDelete`, y también asignar, definir o borrar propiedades o cambiar el prototipo.
  - **Pruebas:** está probado con un db simulado (refs con métodos en el prototipo) y con el Admin SDK real sobre el emulador.
  - **Límite:** solo protege lo que se obtiene a través de la guardia. Este módulo no usa Firestore por ningún otro camino.
- El store solo expone `getUser`, `listSales` y `getFinanceAmounts`, y está congelado.
- Lee `financeTransactions/{idPropuesta}` con `getAll`, solo para saber si una comisión ya existe en el libro.

**Secretos:**
- Reutiliza los `defineJsonSecret` ya declarados.
- La apiKey y el merchantCode **nunca** se loguean ni se devuelven. Los logs solo llevan `{account, errorClass}`.
- Los errores del proveedor no se reenvían.
- En el emulador no se declaran secrets (no hay ninguna llamada a Secret Manager) y `fetch` nunca sale a la red.

### 4.1 Contrato de respuesta (campos exactos, para adaptadores)

Este contrato sirve, por ejemplo, al adaptador de `feature/bank-balance-estimate-v1`. La forma **no** se cambia para ese adaptador: es el adaptador el que mapea estos campos.

**Raíz:**

| Campo | Tipo |
|---|---|
| `readOnly` | `true` |
| `salesLimitReached` | `boolean`: se alcanzó el tope de 20.000 ventas leídas por cuenta |
| `period` | `{ startDate, endDate }`: días de venta pedidos, YYYY-MM-DD |
| `payoutFetch` | `{ startDate, endDate }` o `null` (ventana futura): fechas de abono pedidas a SumUp |
| `salesRead` | `{ startDate, endDate }` |
| `asOfDate` | YYYY-MM-DD, hoy en Chile |
| `policy` | `"payout_date"` o `"sale_date"` |
| `differenceBusinessDays` | número |
| `accounts` | `AccountResult[]`, en el orden pedido (`offerings`, `cafeteria`) |
| `totals` | `Totals`: suma de las cuentas con `ok: true` |

**`AccountResult`** puede tener dos formas:

- **Error:** `{ ok: false, account: "offerings"|"cafeteria", errorClass: string }`. Las clases están en §4.
- **Éxito:**

  | Campo | Tipo |
  |---|---|
  | `ok` | `true` |
  | `errorClass` | `null` |
  | `rowLimitReached` | `boolean` |
  | `account` | cuenta |
  | `basis` | `{ basis: "net"\|"gross"\|"indeterminate", reason, tally }` |
  | `settlements` | `Settlement[]` |
  | `pendingDays` | `PendingDay[]` |
  | `pendingAmount` | número: **SumUp pendiente de abono** de la cuenta, en CLP |
  | `pendingSales` | número |
  | `proposals` | `FeeProposal[]` |
  | `totals` | `Totals` |
  | `rowStats` | `{ fetched, used, duplicatesIgnored, duplicateConflicts, rounded }` |

**`Settlement`** (un depósito de SumUp), con montos enteros en CLP:

| Campo | Tipo / significado |
|---|---|
| `id` | `"stl_{cuenta}_{payoutDate}_{hash12}"`, estable |
| `account` | cuenta |
| `payoutDate` | YYYY-MM-DD o `null`: fecha del abono |
| `reference` | string o `null` |
| `referenceShort` | string |
| `anchorRowId` | string o `null` |
| `statusClass` | `"successful"`, `"in_progress"`, `"failed"` o `"unknown"`. Solo `successful` es dinero que llegó al banco. |
| `status` | `"PENDIENTE"`, `"CONCILIADO"`, `"CON_DIFERENCIA"` o `"REQUIERE_REVISION"` |
| `reasons` | `string[]`. Las claves están en `SettlementReason` de `lib/shared/sumup-payouts.ts`. |
| `grossSales` | número |
| `fee` | número o `null`: comisión SumUp del proveedor; `null` = desconocida |
| `feeConfirmed` | `boolean` |
| `refundsBeforePayout` | número ≥ 0 |
| `deductions` | número ≤ 0 |
| `adjustments` | número ≤ 0 |
| `netPaid` | número: **abono neto depositado** |
| `difference` | número: bruto − neto. No es la comisión. |
| `residual` | número |
| `rawResidual` | número: el mismo residual con los montos sin redondear, a 2 decimales |
| `saleDays` | YYYY-MM-DD[] |
| `byDay` | `[{ saleDate, gross, fee, sales }]` |
| `inWindow` | `boolean`: fecha de abono dentro de `period` |
| `afterWindow` | `boolean` |
| `businessDaysSincePayout` | número o `null` |
| `rowCount`, `payoutRowCount`, `deductionRowCount`, `unlinkedRowCount`, `linkedSalesCount` | números |

**`PendingDay`:** `{ account, saleDate, salesCount, amount, status: "PENDIENTE", inProgressCount, failedCount }`.

**`FeeProposal`:** `{ id, account, type: "expense", category: "Comisiones SumUp", description, amount, accountingDate, policy, payoutDate, saleDate, saleDates, settlementId, referenceShort, state: "propuesta"|"ya_registrada"|"revision"|"sin_confirmar"|"excluida", reasons, previousAmount, writesLedger: false }`.

**`Totals`:** `{ settlements, notCountedSettlements, grossSales, fee, feeComplete, adjustments, netPaid, difference, pendingAmount, pendingSales, byStatus: { PENDIENTE, CONCILIADO, CON_DIFERENCIA, REQUIERE_REVISION } }`. Los montos son solo de abonos exitosos con `inWindow`.

**Mapeo sugerido al formato que espera `parseSumupPayoutsResponse`:**

| Destino | Origen |
|---|---|
| `settlements[]` | `accounts[ok].settlements` filtrados por `statusClass === "successful"` (y, si se quiere solo el período, por `inWindow`) |
| `id` | `id` |
| `payoutDate` | `payoutDate` |
| `netPaid` | `netPaid` |
| `fee` | `fee` (puede ser `null`) |
| `status` | `status` |
| `pendingDeposit` | Σ `accounts[ok].pendingAmount` (= `totals.pendingAmount`) |
| `coverageFrom` | `payoutFetch.startDate` |

Una cuenta con `ok: false` significa cobertura desconocida para esa cuenta: no equivale a 0.

## 5. Modelo

### Filas

- **Montos:** se convierten a enteros CLP. **Regla de redondeo:** al entero más cercano, con las mitades alejándose de cero (100,5 → 101; −2,5 → −3). La fila queda marcada `rounded`.
- **Moneda:** si no es `CLP`, o si falta, la fila pasa a revisión. Nunca se convierte.
- **Deducciones:** su monto se fuerza a ≤ 0, porque siempre restan del abono, sea cual sea el signo que entregue SumUp.
- **Duplicados:**
  - si el mismo `id` llega con el mismo contenido, se ignora (`duplicatesIgnored`);
  - si llega con contenido distinto, se marca `duplicate_conflict`, se conserva la primera fila y **nunca se suman ambas**.

### Base (regla G9/Atlas, la misma de la Slice 3A)

Cada fila `PAYOUT` exitosa y vinculada vota:

| Voto | Condición |
|---|---|
| `net` | `amount + fee ≈ G` o `≈ G'` |
| `gross` | `amount ≈ G` o `≈ G'` |
| `ambiguous` | `fee = 0` |
| `mismatch` | No cuadra con nada |

`G` es el bruto y `G'` es el bruto menos los reembolsos. La tolerancia es ±1.

La base se acepta con **≥ 3 votos contables**, sin `mismatch` y sin desacuerdo entre `net` y `gross`. Se calcula **por cuenta**.

### Abono (settlement)

La clave de agrupación es **cuenta + fecha de abono + referencia + clase de estado**: `successful`, `in_progress`, `failed` o `unknown`.

| Campo | Significado |
|---|---|
| `grossSales` | Σ `grossAmount` de las ventas vinculadas por filas `PAYOUT` (el bruto del libro) |
| `fee` | Σ `fee` del proveedor. `null` si alguna fila no lo trae. **Nunca** se deduce de una diferencia. |
| `feeConfirmed` | Abono exitoso, base `net`, todas las filas con `fee`, todas vinculadas y sin motivos de revisión |
| `refundsBeforePayout` | Devolución previa al abono: la fila pagó `G'` en lugar de `G` |
| `deductions` | Filas de deducción (≤ 0) |
| `adjustments` | `deductions − refundsBeforePayout`. Es la columna **AJUSTES / DEVOLUCIONES**. |
| `netPaid` | Σ de lo transferido. Es la columna **ABONO NETO**. |
| `difference` | `grossSales − netPaid`. Se expone aparte y **no es la comisión**. |
| `residual` | `netPaid − (grossSales − refundsBeforePayout − fee + deductions)`. Si es 0, cuadra. |
| `saleDays`, `byDay` | Días de venta que cubre el abono (pueden ser varios) |
| `inWindow`, `afterWindow` | Si el abono cae en la ventana, o si es posterior pero paga ventas de la ventana |

### Estados

Siempre se muestran con ícono y texto.

| Estado | Cuándo |
|---|---|
| **REQUIERE REVISIÓN** | Hay deducciones, filas sin vincular (sin código, no encontradas o de otra cuenta), base indeterminada o `gross`, abono fallido o con estado desconocido, problema de moneda, duplicados en conflicto, una venta pagada dos veces, comisión ausente o un monto que no cuadra. Un abono fallido cuyas ventas tienen otro abono exitoso lleva además el motivo informativo `payout_retried` ("reintentado"). |
| **PENDIENTE** | El abono está en proceso. O el `residual` no es 0 y aún no pasaron **N días hábiles** (parámetro `differenceBusinessDays`, 5 por defecto, con feriados como parámetro). Las ventas sin ninguna fila de abono exitosa se muestran como filas "Por abonar". |
| **CONCILIADO** | `residual = 0`, todo vinculado y base `net`. También por la **regla de redondeo** (ver más abajo), con el motivo informativo `rounding`. |
| **CON DIFERENCIA** | `residual ≠ 0` después de N días hábiles. El panel muestra "diferencia $X", que es el `residual`. |

**Regla de redondeo.** Un abono con `residual ≠ 0` queda CONCILIADO, con el motivo `rounding`, solo si se cumplen las tres condiciones:
1. tiene filas con decimales;
2. `|residual|` ≤ número de esas filas, porque monto y comisión se redondean por separado y cada fila puede desviar a lo más $1;
3. con los montos **originales, sin redondear**, `|rawResidual| < $0,5`.

Si no se cumplen, es una diferencia real y queda PENDIENTE o CON DIFERENCIA. Ejemplo: 20 filas con comisión 345,4 que en total pagan $5 de menos tienen `residual = rawResidual = 5`, así que quedan CON DIFERENCIA y no como redondeo. Las filas guardan `rawAmount`/`rawFee` solo para esta regla.

**Abono reintentado.** Un abono fallido cuyas ventas pagó otro abono exitoso conserva el estado `REQUIERE_REVISION` en los datos, pero el panel lo muestra como **"Reintentado"**, con un ícono y el motivo `payout_retried`. El panel muestra hasta dos motivos por abono, y los informativos (`rounding`, `refunds_before_payout`) también se ven en los conciliados.

Una devolución previa al abono que cuadra exacto queda CONCILIADO, con el motivo informativo `refunds_before_payout` y el ajuste visible.

### SumUp pendiente de abono

Es la Σ de `amountAfterRefunds` de las ventas que cumplen todo esto:
- son de **tarjeta** (`POS`) y en CLP;
- tienen estado `SUCCESSFUL` o `REFUNDED` con saldo > 0;
- están **dentro de la ventana**;
- no tienen ninguna fila `PAYOUT` exitosa.

El efectivo registrado en SumUp **nunca** cuenta, porque SumUp no lo abona. Si un abono falla, la venta vuelve a quedar pendiente. Para estas ventas la comisión se muestra como "pendiente", **nunca $0**.

### Totales

Los montos de los totales suman solo los abonos **exitosos** (`statusClass = successful`) con fecha dentro de la ventana (`inWindow`).
- Los abonos posteriores que pagan ventas del período se muestran, pero no se suman. Así un mes no cuenta dos veces lo que también verá el mes siguiente.
- Los abonos fallidos, en proceso o con estado desconocido **no suman**: no llegaron al banco y sus ventas siguen en "pendiente de abono". Sumarlos contaría la misma venta dos veces. Se cuentan en `totals.notCountedSettlements` y en `totals.byStatus`.
- Con un abono fallido y luego reintentado, el "Abono neto" total coincide con el banco.

## 6. Propuestas de comisión e idempotencia

- **Categoría y tipo:** `Comisiones SumUp`, `type: "expense"`, `writesLedger: false`.
- **Id determinista:** `sumup_fee_{cuenta}_{fechaAbono}_{hash12(referencia)}`, con un hash estable cyrb53 que es igual en el cliente y en Functions.
  - Si la fila no es exitosa, el hash incluye la clase de estado. Así un abono fallido nunca comparte id con uno exitoso.
  - Si el abono no tiene referencia, cada fila es su propio abono y el hash incluye el `id` de la fila. Los ids de abono y de propuesta nunca chocan.
  - Con la política `sale_date`, al id se le agrega `_sYYYYMMDD` por cada día de venta.
- **Sin doble conteo:** el mismo abono visto dos veces, en ventanas solapadas, en otro orden o con filas repetidas, da **el mismo id y el mismo monto**. Hay tests para cada caso.
- **Estados de una propuesta:**

  | Estado | Cuándo |
  |---|---|
  | `propuesta` | El abono está CONCILIADO, la comisión está confirmada y no existe en el libro |
  | `ya_registrada` | Existe en el libro con el mismo monto |
  | `revision` | Existe con **otro** monto (comisión corregida por SumUp). Muestra `previousAmount` y `amount`. |
  | `sin_confirmar` | Cualquier otro caso (revisión, en proceso, diferencia) |
  | `excluida` | El abono falló. Monto 0, nunca se propone. |

- **Invariantes** (cubiertos por tests):
  - el ingreso bruto del libro **nunca se modifica**;
  - el abono neto **nunca es un ingreso**;
  - Σ de las propuestas = Σ de las comisiones del proveedor;
  - la respuesta no contiene ningún `income`.

## 7. UI

En **Ofrendas y Cafetería**, debajo de "Días del mes", hay una sección **"Conciliación SumUp · SOLO LECTURA"**.

**Consulta:**
- No consulta nada hasta que se pulsa **"Consultar abonos"**. Así no se llama a SumUp en cada visita.
- Desde ese momento, consulta el mes visible y lo vuelve a consultar al cambiar de mes. "Actualizar" repite la consulta.

**Contenido por cuenta:**
- Totales: ventas brutas abonadas, comisión SumUp ("sin confirmar" si corresponde), ajustes, abono neto y **SumUp pendiente de abono**.
- Una tabla con estas columnas:

  | Columna | Contenido |
  |---|---|
  | ABONO | Fecha del depósito |
  | VENTAS DEL | Días de venta que cubre |
  | VENTAS BRUTAS | Bruto de las ventas |
  | COMISIÓN SUMUP | Monto, "pendiente" o "· sin confirmar" |
  | AJUSTES / DEVOLUCIONES | Ajustes del abono |
  | ABONO NETO | Lo depositado |
  | ESTADO | Ícono, texto y motivo |
  | REF. | Últimos 6 caracteres de la referencia |

- Las ventas pendientes aparecen como filas "Por abonar".

**Errores.** Si la Function no está desplegada o falla, se muestra un texto sereno: "Conciliación SumUp aún no disponible. Los montos de arriba no cambian." La página nunca se rompe. Un permiso denegado tiene su propio mensaje, y si una cuenta falla, la otra se muestra igual.

**Responsive.** Reutiliza las clases existentes (`panel`, `section-heading`, `offering-area-*`, `offering-days-table`, `status-inline`). En teléfono (< 640 px) cada celda lleva su etiqueta. Se verificó a 1024 px y a 375 px, sin scroll horizontal. No se cambiaron estilos globales.

## 8. Decisiones humanas pendientes

1. **Política de fecha contable de la comisión.** Es un parámetro y la decide una persona:
   - **`payout_date`** (por defecto): una comisión por depósito, fechada el día del abono. Coincide con la cartola del banco.
   - **`sale_date`**: la comisión se reparte por día de venta, fechada el día de la venta. Coincide con el resumen diario de ventas.

   Cambiar de política después genera otros ids. Hay que decidirla **una vez**, antes de habilitar escrituras.
2. **Habilitar escrituras al libro** (crear los gastos `Comisiones SumUp`). Es un **GO separado**, con su propia rama y revisión, y exige:
   - un snapshot o backup previo;
   - categoría en `expenseCategoriesAll`;
   - delta de gastos en el resumen escrito completo (patrón B1);
   - reglas que nieguen al cliente la escritura de `sumup_fee_*`;
   - versiones cuando cambie el monto;
   - anular cuando el monto llegue a 0.

   Esta rama **no** lo hace ni lo prepara de forma implícita.

   Al escribir en el futuro, hay que **filtrar las propuestas por `accountingDate` dentro del período** que se registra. Una vista de octubre incluye abonos posteriores (por ejemplo, del 03-11) que pagan ventas de octubre, y sus propuestas tienen fecha contable de noviembre con la política `payout_date`. Además, solo se registran propuestas en estado `propuesta`. El id determinista evita duplicados, pero no reemplaza este filtro.
3. **Backfill** de meses anteriores: no está incluido. Sería una migración aparte.
4. **N días hábiles** para "Con diferencia" (5 por defecto) y la lista de feriados chilenos que se pasará como parámetro.
5. Confirmar contra la cartola 1 o 2 depósitos más, por ejemplo uno con devolución, cuando ocurra.

## 9. Plan de deploy (futuro, requiere GO explícito)

1. Pasar los gates de §10 en el commit exacto. Revisar `node scripts/verify-functions-package.mjs`: el archivo nuevo `sumup-payouts/read.js` tiene que estar incluido.
2. Desplegar **solo** esta Function, por nombre:
   `firebase deploy --only functions:sumupPayoutsReconciliation --project <prod>`
   **Nunca** `--only functions` a secas, y **nunca** volver a desplegar `sumupSyncNow` ni `sumupSyncScheduled` como efecto colateral.
3. Verificar en la consola:
   - región `southamerica-west1`;
   - acceso a los dos secrets;
   - una llamada como finanzas para la ventana de octubre, que debe reproducir el caso Cafetería.
4. Desplegar Hosting con el panel, en un paso separado. Hasta entonces el panel muestra "aún no disponible".
5. No hacen falta cambios de reglas ni de índices, porque la consulta usa `timestamp` (índice de campo único).

## 10. Rollback

- **Function:** `firebase functions:delete sumupPayoutsReconciliation --region southamerica-west1 --project <prod>`. Como no escribe nada, no queda ningún estado que revertir.
- **UI:** volver a desplegar el Hosting anterior. Con la Function borrada, el panel muestra "Conciliación SumUp aún no disponible".

## 11. Qué NO hace esta rama

- No escribe nada: ni en el libro, ni en `sumupPayouts`, ni `settlement`, ni en los resúmenes.
- No hace backfill.
- No despliega nada.
- No modifica el motor de ventas SumUp, las reglas ni las Functions existentes.
- No llama a la API real de SumUp. Los tests usan fetch simulado y el emulador no sale a la red.
- No persiste el historial de comisiones corregidas. "revisión" se detecta contra lo que ya existe en el libro (`financeTransactions/{id}`), que hoy está vacío.
