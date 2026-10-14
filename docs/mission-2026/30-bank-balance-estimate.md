# 30 — Saldo bancario estimado (Banco y caja V1)

> Rama: `feature/bank-balance-estimate-v1` (desde `18925d6`), **apilada sobre B2**
> (`feature/finance-summary-calendar-v1`, merge `--no-ff`): se integra después de B2. **NO DESPLEGADO.**
> Validado solo con emuladores (`demo-cds-suite`) y datos ficticios. Sin datos personales.

## 1. Objetivo

Mostrar en Finanzas cuánto dinero **debería** haber en la cuenta bancaria de la iglesia, sin inventar
cifras. Si falta información, la app lo dice ("Saldo pendiente de configurar", "Incompleto: faltan
abonos SumUp") en vez de mostrar un número engañoso.

## 2. Qué datos existen hoy (producción, agregados, octubre 2026)

Libro `financeTransactions` (movimientos activos) por tipo · método · origen:

| Tipo · método · origen | Qué es | ¿Llega al banco? |
|---|---|---|
| ingreso · tarjeta · SumUp | Ventas con tarjeta (desde 2020) | Solo vía **abonos SumUp**: neto de comisión, normalmente al día hábil siguiente, a veces agrupados |
| ingreso · efectivo · manual / SumUp | Caja de ofrendas, cafetería, diezmos en efectivo | No: queda en caja hasta que se deposita |
| ingreso · transferencia · manual | Diezmos y donaciones por transferencia (desde 2026-08) | Sí, directo |
| gasto · transferencia · manual | Pagos desde el banco | Sí (sale) |
| gasto · efectivo · manual | Pagos desde la caja | No (sale de caja) |

Además:

- **No existe** saldo inicial, ni colecciones de banco/caja, ni registros de depósitos o retiros.
- `appSettings/finance` no existe (se usan las categorías de respaldo).
- Los registros manuales empiezan en **2026-08**: antes de eso no hay historia de transferencias ni gastos.
- Los abonos SumUp (montos netos por fecha de abono) vendrán de la callable de solo lectura
  `sumupPayoutsReconciliation`, que se construye en otra rama. Aquí es una **entrada opcional**.

## 3. Por qué no se puede calcular sin un saldo inicial

La suma de ingresos − gastos registrados no es el saldo del banco: falta todo lo que pasó antes de
2026-08, lo que nunca se registró (comisiones bancarias, intereses), y el desfase de los abonos de
SumUp. Cualquier número calculado "desde cero" sería falso. Por eso el cálculo parte de una
**cartola real**: Tesorería informa el saldo que el banco mostraba al **cierre** de una fecha de corte, y
desde el día siguiente se suman y restan los movimientos registrados.

## 4. Definiciones (cuatro cifras que nunca se mezclan)

| Cifra | Qué significa | Qué NO es |
|---|---|---|
| **Saldo bancario estimado** | Saldo de la cartola en la fecha de corte ± lo registrado después que entra o sale del banco | No es la cartola; es una estimación. Si faltan abonos SumUp se marca "Incompleto" |
| **Efectivo registrado en caja** | Ingresos en efectivo − gastos en efectivo − depósitos al banco + retiros del banco desde el corte (+ efectivo inicial contado, si se informó) | No es un arqueo. Sin efectivo inicial muestra solo lo registrado "desde la fecha de corte" |
| **SumUp pendiente de abono** | Ventas con tarjeta que SumUp aún no deposita, informadas por la fuente de abonos | Es **bruto**: todavía no descuenta comisiones. Sin fuente: "Sin dato de SumUp" |
| **Resultado contable del período** | Ingresos − gastos del período (resúmenes mensuales) | No es dinero en el banco. Se muestra aparte y no participa del cálculo |

## 5. Fórmula

Ventana: fechas locales America/Santiago **posteriores** a `openingDate` (el día de corte ya está en la
cartola) y hasta "hoy" (`asOf`) inclusive. La fecha local de un movimiento del libro es `period` + `day`
(los movimientos de SumUp guardan el instante real; `period`/`day` ya están en hora de Chile). Los
movimientos **anulados** nunca cuentan. Los de fecha futura no cuentan todavía (se avisa).

```
banco = saldo inicial (cartola, cierre de openingDate)
      + ingresos con método Transferencia
      + abonos SumUp con estado SUCCESSFUL y fecha de abono > openingDate (netos)
      + abonos que no son ingreso (other_deposit)
      + depósitos de caja (cash_deposit)
      − gastos con método Transferencia o Tarjeta
      − transferencias salientes que no son gasto (outgoing_transfer)
      − retiros a caja (cash_withdrawal)
      ± ajustes manuales conciliados (adjustment, con sentido)

caja  = efectivo inicial (opcional)
      + ingresos en efectivo − gastos en efectivo
      − depósitos al banco + retiros desde el banco
```

- Ventas con tarjeta: **no** suman al banco hasta su abono. Un abono agrupado se cuenta una vez, completo,
  en su fecha de abono.
- Método "Otro": no cuenta ni en banco ni en caja; se avisa cuántos hay.
- **Comisiones SumUp:** los gastos de categoría `Comisiones SumUp` (los que propone el PR C) **no** se
  restan ni del banco ni de la caja: los abonos SumUp ya llegan netos de comisión y restarlos otra vez
  los descontaría dos veces. Se avisa cuántos se omitieron.
- Abonos no exitosos (en proceso, fallidos, desconocidos o sin fecha) nunca suman; se cuentan en avisos.
- La fecha de corte debe ser **anterior a hoy** (el día de hoy aún no cierra en la cartola).
- Estados del resultado: `unconfigured` (sin saldo inicial: **ningún número de banco ni caja**),
  `partial` (faltan abonos SumUp, cobertura de abonos tardía o límite de consulta alcanzado) y
  `complete`.
- Implementación pura y probada: `lib/finance/bank-balance.ts` (`computeBankBalance`), validaciones en
  `lib/finance/bank-model.ts`. Sin Firebase ni reloj.

## 6. Modelo de datos (nuevo, auditado, nada automático)

### `bankAccounts/{accountId}` (V1: `main`)

| Campo | Tipo | Regla |
|---|---|---|
| `name` | string 1–80 | |
| `openingBalance` | int CLP | −1e12 … 1e12. **Puede ser negativo** (sobregiro/línea de crédito): la UI exige marcar una casilla de confirmación |
| `openingDate` | "YYYY-MM-DD" | ≥ 2020-01-01 y anterior a hoy. Saldo al **cierre** de ese día |
| `openingCash` | int ≥ 0 o `null` | Efectivo contado ese día. Opcional |
| `statementReference` | string 0–120 | Ej. "Cartola N° 45" |
| `revision` | int | 1 al crear; +1 en cada cambio |
| `createdBy/At`, `updatedBy/At` | auditoría | Igual que `auditCreate`/`auditUpdate` |

Cada escritura crea **en el mismo lote** `bankAccounts/{id}/history/{revision}` (copia exacta de los
valores, `action` created/updated, `reason` — obligatorio de 3+ caracteres al cambiar —, `actorUid`,
`at`). El historial es inmutable (sin update ni delete).

### `treasuryTransfers/{id}`

`accountId`, `type` ∈ {`cash_deposit`, `cash_withdrawal`, `outgoing_transfer`, `other_deposit`,
`adjustment`}, `direction` (in/out; fijo salvo en ajustes), `amount` > 0 int, `date` "YYYY-MM-DD"
(posterior al corte, no futura), `note`, `reason` (≥ 10 caracteres en ajustes), `status`
active|voided, `revision`, auditoría y `voidedBy/At/voidReason` al anular. **No son ingresos ni gastos:
no tocan `financeMonthlySummaries`.** Solo se anulan con motivo; corregir = anular y registrar de nuevo.

### `bankReconciliations/{id}` (solo creación)

`accountId`, `date`, `reportedBalance` (lo que Tesorería ve en el banco), `expectedBalance` (foto del
estimado mostrado), `difference` = reportado − esperado (verificado por reglas), `estimateComplete`,
`openingRevision`, `note`, `createdBy/At`. **Nunca crea ajustes**: la UI solo ofrece "Preparar ajuste
manual", que rellena el formulario de tesorería; la persona debe escribir el motivo y enviarlo.

## 7. Reglas de Firestore

Agregadas al **final** de `firestore.rules` (después de `calendarShareLinks`), sin tocar los helpers
financieros optimizados (doc 26) ni las secciones de `titheProfiles`/`members`.

| Colección | Leer | Escribir |
|---|---|---|
| `bankAccounts` + `history` | `financeDetailsRead()` | Solo `settingsManage()` (administración; lo mismo que `appSettings/finance`, la opción más estricta). Cuenta e historial deben ir juntos (`!exists` antes + `existsAfter`, y el historial compara con `getAfter` de la cuenta) |
| `treasuryTransfers` | `financeDetailsRead()` | Crear: `financeRecordsManage()`, cuenta existente y fecha > corte. Actualizar: solo anular con motivo. Borrar: nunca |
| `bankReconciliations` | `financeDetailsRead()` | Crear: `financeRecordsManage()`. Actualizar/borrar: nunca |

Fechas "no futuras": `localTodayLatest()` = fecha de `request.time − 3 h` (≥ la fecha local real; como
mucho 1 h adelantada en invierno). Tests: `tests/rules/bank-balance.test.ts` (perfiles legacy admin /
pastor / finance / leader / inactivo, v1 admin / pastor / finance / solo detalle / solo registros /
líder / sin permisos / inactivo, sin perfil y anónimo) y `tests/rules/budget.test.ts` sigue pasando
(`REQUIRED_MARGIN = 100`): las colecciones nuevas no participan en los lotes financieros.

**Decisión:** `settingsManage()` para el saldo inicial implica que una persona con rol Finanzas no puede
fijarlo; la tarjeta le indica que debe hacerlo un administrador. Depósitos, retiros y conciliaciones sí
los registra quien gestiona registros financieros.

## 8. Consultas e índice

`useBankBalance` (en `lib/finance/bank-hooks.ts`, consultas en `lib/finance/bank-queries.ts`) lee solo
desde el corte y solo lo necesario:

1. `financeTransactions` con `type in [income, expense]`, `paymentMethod in [cash, transfer, other]`,
   `date >= mediodía UTC del corte`, `orderBy(date)`, `limit(5000)`.
2. `financeTransactions` con `type == expense`, `paymentMethod == card`, mismo rango, `limit(5000)`.
3. `treasuryTransfers` con `date > corte`, `orderBy(date)`, `limit(1000)` (índice simple automático).

Las ventas con tarjeta (la mayor parte del volumen SumUp) **no se leen**. Si una consulta llega a su
tope, la tarjeta muestra "Límite alcanzado" y el saldo queda `partial`.

**Falla cerrado (revisión Atlas, MAJOR-2):** si **cualquier** fuente falla — cuenta, cualquiera de las
dos consultas del libro o tesorería (permiso denegado, índice faltante, sin conexión) — no se calcula
nada: `resolveBankBalanceState` devuelve `result = null` y la tarjeta muestra el error, **nunca** un
número hecho con datos parciales (sin el índice, "saldo inicial ± tesorería" parecería un saldo). La
conciliación tampoco se puede guardar mientras el estimado tenga error.

> ⚠️ **Índice compuesto nuevo** (`firestore.indexes.json`): `financeTransactions (type ASC,
> paymentMethod ASC, date ASC)`. Sirve a las consultas 1 y 2. Sin este índice desplegado la tarjeta
> muestra el error "La consulta necesita un índice de Firestore". Desplegar índices es aditivo pero
> requiere su **propio GO**.

## 9. UX

- **Montaje en Resumen (B2):** `SummaryPage` pasa
  `fundsBankTile={<BankBalanceCard variant="funds" connectSumupPayouts />}` a la sección "Posición de
  fondos" de B2 (que ya la limita a `finance.details.read` y maneja el período actual). La variante
  `funds` no tiene título propio ("Posición de fondos" lo pone B2) y **no muestra el resultado
  contable** (Design Lock: la posición nunca repite ni suma el resultado, que vive en la banda de
  arriba): tres cifras — saldo bancario estimado, efectivo registrado en caja y SumUp pendiente de
  abono — con sus estados y "¿Cómo se calcula?". Los colores usan los tokens de
  `components/finance/dashboard/tokens.css` (con respaldo).
- `components/finance/bank/bank-balance-card.tsx` (+ `bank-balance.module.css`): `BankBalanceCard`
  (con datos; solo para `finance.details.read`) y `BankBalanceView` (vista pura); variante `card`
  (autónoma, 4 cifras con el resultado contable como prop) o `funds`. Cuatro cifras con
  etiqueta y explicación corta; insignias de texto ("Estimado", "Corte dd-mm-aaaa", "Incompleto: faltan
  abonos SumUp"), nunca solo color; saldo negativo con texto para lectores de pantalla. Estados:
  cargando, error, sin configurar ("Saldo pendiente de configurar" + "Configurar saldo inicial" para
  administración; para el resto, quién debe hacerlo), parcial y completo. Hoja "¿Cómo se calcula?" con
  cada línea (+/− en texto, monto, cantidad de registros) y los avisos. 1 columna < 600 px, 2×2 en iPad
  (600–1199 px), 4 columnas desde 1200 px.
- Configuración › Finanzas › **Banco y caja** (`components/settings/bank-cash-settings-panel.tsx`):
  saldo inicial con paso de revisión y confirmación + historial; movimientos entre caja y banco
  (`components/finance/bank/treasury-panel.tsx`) con anulación con motivo; conciliación
  (`components/finance/bank/reconciliation-panel.tsx`) que muestra estimado, reportado y diferencia y
  nunca ajusta sola.
- **Ajustes y abonos SumUp (revisión Atlas, MAJOR-1):** mientras el estimado no incluya los abonos SumUp
  (o esté incompleto por otro motivo), una conciliación muestra "No ajustes: el estimado no incluye
  abonos SumUp" y **no** ofrece "Preparar ajuste manual": la diferencia sería casi toda abonos y, al
  conectarlos, se contarían dos veces. El formulario de ajuste también lo advierte. Con estimado
  completo, "Preparar ajuste manual" rellena tipo, sentido, monto, nota y **la fecha de la
  conciliación** (nunca envía). Si la conciliación es del día de corte, se indica corregir el saldo
  inicial en vez de ajustar.
- La conciliación guarda `openingRevision`, que las reglas exigen igual a la revisión vigente del saldo
  inicial. Los paneles de tesorería y conciliación son reutilizables en Finanzas (Configuración
  solo la ve administración).

## 10. Plan de despliegue (cada paso con su propio GO)

0. **Orden de PR:** B2 (`feature/finance-summary-calendar-v1`) primero; este PR está apilado sobre él.
1. **Reglas** (`firestore.rules`): solo agrega colecciones nuevas; verificar ruleset en consola.
2. **Índices** (`firestore.indexes.json`): aditivo; esperar estado "Enabled" antes del paso 3.
3. **Hosting**: tarjeta montada en Resumen por el tech lead + panel en Configuración.
4. **Sin migración de datos.** Tesorería toma una cartola, y un administrador ingresa saldo, fecha de corte
   (y opcionalmente el efectivo contado ese día) en Configuración › Finanzas › Banco y caja.
5. **Abonos SumUp** (contrato del PR C, doc 29): `useSumupPayoutsForBank(openingDate, hoy)`
   (`lib/finance/sumup-payouts-client.ts`) llama `httpsCallable("sumupPayoutsReconciliation")` con
   `{account: "both", startDate, endDate}` en ventanas contiguas de ≤ 35 días desde el día siguiente al
   corte hasta hoy (máximo 11 ventanas; más allá, parcial), **2 ventanas en paralelo como máximo**, con
   caché de 10 minutos por sesión de navegador.
   `adaptSumupReconciliationResponse` (`lib/finance/sumup-payouts-adapter.ts`, puro) convierte la
   respuesta:
   - cualquier cuenta `ok: false` → no disponible (con su `errorClass`);
   - solo suman abonos `statusClass === "successful"` con `payoutDate` dentro de la ventana que los
     devolvió, deduplicados por cuenta + id entre ventanas; el resto se cuenta en avisos;
   - `pendingDeposit` = Σ `pendingAmount` de las cuentas; cobertura = primer `period.startDate` y último
     `period.endDate`;
   - parcial si alguna `basis.basis === "indeterminate"` (sus abonos exitosos sí suman), si una cuenta
     trae `rowLimitReached`, si hay abonos con `statusClass "unknown"` (no suman), si un abono exitoso
     `REQUIERE_REVISION` por `currency_issue`/`amount_mismatch` (no suma), si un abono exitoso tiene
     neto negativo — contracargo o devolución — (no suma; nunca oculta los demás), si hay huecos entre
     ventanas, si la cobertura empieza después de hoy o si el `asOfDate` del servidor es anterior a hoy
     (la cobertura termina ahí);
   - `in_progress`, `failed` o sin fecha de abono: no suman y se cuentan en avisos;
   - vocabulario o forma desconocidos (otro `status`, `statusClass` o `basis`, abonos sin id, montos
     inválidos) → no disponible: nunca un 0 silencioso.
   Si la función no existe, no responde o falla, el resultado es "no disponible" y el saldo queda
   "Incompleto: faltan abonos SumUp". **Requiere el deploy de la Function del PR C** (con su propio GO).

   **Carga progresiva:** mientras los abonos cargan, la tarjeta ya muestra banco y caja con la insignia
   "Cargando abonos SumUp…" y el estado es `partial` (nunca `complete` antes de que lleguen); la
   conciliación no se puede guardar hasta entonces.

   **Costo y límites:** cada ventana es una llamada a la Function, que pide los abonos de las 2 cuentas
   a la API de SumUp (1 petición por cuenta, hasta 10 días de margen) y lee de Firestore las ventas de
   ambas cuentas del período más 10 días hacia atrás y hasta 10 días hacia adelante (≈ 55 días de
   `sumupIntegrations/*/transactions` por ventana). Con un corte a fin de septiembre, un Resumen abierto
   en octubre hace 1 llamada; a los 6 meses, 6 llamadas (≈ 6 × 2 peticiones a SumUp). La caché de 10
   minutos evita repetirlas al navegar dentro de la sesión; con 2 llamadas en paralelo no se supera
   `maxInstances: 3` de la Function. Si SumUp limita o falla una ventana, todo el insumo queda "no
   disponible" (falla cerrado) hasta la siguiente consulta. Si el volumen crece, la opción es fijar un
   corte más reciente (nueva cartola).

## 11. Rollback

- Hosting: volver a la versión anterior (la tarjeta desaparece; los datos quedan intactos).
- Reglas: volver al ruleset anterior; las colecciones nuevas quedan inaccesibles para clientes (catch-all
  `false`), sin afectar el libro ni los resúmenes.
- Índice: puede quedarse (no afecta) o borrarse.
- Datos: `bankAccounts`, `treasuryTransfers` y `bankReconciliations` son independientes; no hay que
  revertir nada en `financeTransactions` ni en `financeMonthlySummaries`.

## 12. Decisiones humanas pendientes

1. **Cuenta(s) bancaria(s):** ¿una sola cuenta corriente (`main`) o varias? El modelo admite varias por
   `accountId`, pero la UI V1 maneja solo `main`.
2. **Fecha de corte:** qué cartola usar (recomendado: cierre de mes reciente, p. ej. 2026-09-30) y quién
   la ingresa.
3. **Gastos con tarjeta = banco:** V1 asume tarjeta de débito de la cuenta. Si existe tarjeta de crédito,
   el cargo al banco ocurre al pagar la tarjeta (habría que tratarlo distinto).
4. **Efectivo inicial:** ¿se cuenta la caja el día de corte? Sin él, la caja muestra solo lo registrado
   desde el corte.
5. **Quién fija el saldo inicial:** hoy solo administración (`settingsManage`). ¿Se delega a Finanzas?
6. **Movimientos con método "Otro":** hoy no cuentan; ¿deben reclasificarse?
7. **Dónde registrar depósitos/retiros y conciliar** las personas de Finanzas (no ven Configuración):
   hoy no tienen UI. Seguimiento: montar `TreasuryTransfersPanel` y `ReconciliationPanel` en Finanzas
   (no se agregan rutas en este PR).
8. **Comisiones SumUp:** cuando el PR C registre gastos "Comisiones SumUp", seguirán fuera del saldo
   bancario (los abonos ya son netos). Confirmar que nunca se registren además como gasto pagado por
   transferencia desde el banco.
