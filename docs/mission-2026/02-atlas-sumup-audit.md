# ATLAS — SumUp Audit (Phases 2, 3, 11) + Slice 1 spec

Base: `feature/preproduccion-mobile-v1` @ 648afd1 · 2026-09-22 · solo lectura de código + documentación oficial SumUp.
Sin logs de producción, sin datos Firestore y sin llamadas reales a SumUp: todo lo que depende de eso va marcado **NO CONFIRMADO / HYPOTHESIS**.

## 0. Resumen ejecutivo

1. **FACT (docs):** `GET /v2.1/merchants/{mc}/transactions/history` **no incluye `fee_amount`**. Ese campo solo existe en el detalle de la transacción (`/transactions?id=`) y en payouts (`fee`). El código calcula `liquid = gross − refunded − fee_amount` (`functions/index.js:197-198`), así que **fee = 0** siempre y el "líquido" guardado es en realidad **bruto − reembolsos**. La UI lo muestra como "Tarjeta SumUp · líquido" (`offerings-page.tsx:332,586`). Falta validarlo con datos: `feeAmount == 0` en todos los docs `sumupIntegrations/*/transactions/*`.
2. **FACT (código):** el sync incremental lee **una sola página** (25 manual / 100 programado) con `changes_since = ahora − 45 d`, orden descendente y sin cursor (`index.js:140-148`). Consecuencias:
   - Con más de N transacciones en 45 días, un reembolso tardío sobre una transacción que quedó fuera del top-N no se aplica.
   - Si hay downtime y se acumulan más de 100 transacciones nuevas por cuenta, las que no entran en la página **nunca se importan**.
   - En ambos casos no queda ningún rastro.
3. **FACT:** el filtro se aplica **antes** de comparar contra el libro (`index.js:187-189`). Por eso:
   - Una transacción importada que luego pasa a CANCELLED/FAILED queda **activa** en el libro.
   - Los CHARGE_BACK se ignoran, lo que produce sobre-registro silencioso.
4. **FACT:** las cuentas se sincronizan en serie y un `throw` corta la ejecución (`index.js:617-630, 610`). Si Ofrendas falla, Cafetería no se sincroniza, y en la ejecución programada tampoco corre el backfill legacy (`:688-691`).
5. **FACT:** `firestore.rules:113-121` permite a admin/pastor/finance **editar** docs `sumup_*`, y la UI ofrece "Editar" (`transaction-list.tsx:67-78`). El siguiente sync **sobrescribe** esas ediciones sin dejar rastro (`index.js:312-336`).
6. **502 — HYPOTHESIS principal:** el tiempo de ejecución crece con el tamaño de la ventana y no con los cambios. Una ejecución manual hace hasta 50 `runTransaction` en serie, lo que choca con `timeoutSeconds: 55` y con el tope de 60 s de Hosting. La contención con el sync programado lo empeora. Hay que confirmarlo con logs (§4).

## 1. Inventario

**Secrets:**
- `SUMUP_OFFERINGS_CONFIG` y `SUMUP_CAFETERIA_CONFIG` (JSON `{apiKey, merchantCode}`), en `:18-19` y `:136`.
- Autenticación: Bearer API key. Según la documentación, la API key trae el conjunto completo de permisos; **NO CONFIRMADO** que incluya `payouts.read`.
- No hay ninguna guarda que impida que ambos secrets tengan el mismo `merchantCode`. Si pasa, hay **doble conteo**.

**Functions:**

| Function | Tipo | Región | Timeout | Qué hace |
|---|---|---|---|---|
| `sumupSyncNow` | HTTP | southamerica-west1 | 55 s | `requireFinanceUser` (admin/pastor/finance) → `syncAllSumUp(false, 25)` |
| `sumupSyncScheduled` | cada 60 min, America/Santiago | southamerica-east1 | 540 s | `syncAllSumUp(false,100)` + `syncLegacyPage(offerings)` |
| `campaignShare` | HTTP | southamerica-west1 | 20 s | sin relación con SumUp |

- Hosting reescribe `/api/sumup-sync` hacia `sumupSyncNow` (`firebase.json:36-42`).
- El cliente hace POST con el ID token (`lib/offerings/client.ts:155-190`). Si la respuesta no es JSON, muestra el texto crudo.
- Memoria por defecto: no está declarada. El scheduler no tiene retry.

**Llamadas a SumUp:**

| Uso | Parámetros | Páginas |
|---|---|---|
| Manual | `order=descending&limit=25&changes_since=now−45d` | 1 |
| Programado | `limit=100`, resto igual | 1 |
| `fullHistory` | sin `changes_since`, `limit=100`, hasta 100 páginas | **código muerto**: `allowBackfill` siempre es false |
| Legacy | sin `changes_since`, `limit=100`, persiste `links.next` como cursor | 1 página por hora |

Los errores se convierten en `Error("SumUp <status>: …")`. No hay timeout en el fetch ni clasificación del error.

**Filtros:** `payment_type==='POS'`, `type==='PAYMENT'`, `status ∈ {SUCCESSFUL, REFUNDED}`, `currency==='CLP'`. Las ejecuciones manual y programada descartan lo anterior a 2026-09-09; el legacy procesa solo eso.

**Cálculo:** `liquid = max(0, round(amount) − round(refunded_amount) − round(fee_amount||0))`.

**Identidad:**
- Raw: `sumupIntegrations/{account}/transactions/{safeId(tx_id)}`.
- Libro: `financeTransactions/sumup_{account}_{safeId(tx_id)}`.
- Resumen: `financeMonthlySummaries/{period}`, con el período según la hora local de Chile.
- La identidad es estable y las cuentas no colisionan, salvo que se use el mismo merchant en ambas.

**Escritura:**
- Un `runTransaction` por ítem. Si hay cambio (monto activo, estado, categoría o día), se aplica un delta al resumen y se escribe o anula el doc del libro.
- El raw se reescribe **siempre**, aunque no haya cambios.
- El libro guarda solo el "líquido". Bruto, reembolso y comisión quedan solo en el raw, sin historial.

**Estado de integración:**
- `lastSyncAt`, `lastSyncStatus`, `lastError` (se sobrescribe) y `lastImportedCount` (cuenta ítems filtrados, no transacciones creadas).
- `ensureSumUpSystemCategory` hace leer→escribir sin transacción. La carrera que eso permite es benigna.

**Legacy:**
- Solo la cuenta offerings. La historia de cafetería anterior a 2026-09-09 no se importa: **OPEN QUESTION**.
- Una vez completado el backfill, las transacciones legacy quedan **congeladas**: un reembolso posterior no se aplica.

**Reglas y tests:**
- `sumupIntegrations/**` es de solo lectura para el cliente, y tiene test.
- `financeTransactions/sumup_*` es actualizable por el cliente y **no tiene test**.
- No hay tests de `functions/`.

## 2. Qué dice la documentación oficial de SumUp

**`GET /v2.1/merchants/{mc}/transactions/history`** (https://developer.sumup.com/api/transactions/list)
- **CONFIRMADO**, parámetros:
  - `order`: asc (default) o desc.
  - `limit`: default 10, sin máximo documentado.
  - `changes_since`: "modified at or after".
  - Filtros por fecha de creación: `oldest_time`/`newest_time`, `oldest_ref`/`newest_ref`.
  - Filtros de lista: `statuses[]`, `types[]` (PAYMENT, REFUND, CHARGE_BACK), `payment_types[]` (CASH, POS, ECOM, RECURRING, BITCOIN, BALANCE, MOTO, BOLETO, DIRECT_DEBIT, APM, UNKNOWN), `users[]`, `entry_modes[]`, `transaction_code`.
- **CONFIRMADO**, campos de cada ítem: `id`, `transaction_id`, `transaction_code`, `amount`, `currency`, `timestamp`, `status`, `payment_type`, `type`, `installments_count`, `merchant_code`, `product_summary`, `payouts_total`, `payouts_received`, `payout_plan`, `payout_date`, `payout_type`, `user`, `card_type`, `client_transaction_id`, `refunded_amount`.
- **CONFIRMADO: `fee_amount` NO aparece** ni en el schema ni en el ejemplo.
- **NO CONFIRMADO:**
  - Máximo real de `limit`.
  - Si `links.next` conserva `changes_since`.
  - Qué criterio usa `order`.
  - Si un reembolso actualiza la fecha de modificación del pago original.
  - Rate limits y comportamiento ante 429.
  - Cómo aparece Tap-to-Pay en `payment_type`.

**Detalle: `GET /v2.1/merchants/{mc}/transactions?id=`** (https://developer.sumup.com/api/transactions/get)
- **CONFIRMADO:** `fee_amount`, `vat_amount`, `tip_amount`, `simple_status` (…PAID_OUT, CHARGEBACK, REFUNDED, NON_COLLECTION…).
- `events[]`:
  - `type`: PAYOUT, CHARGE_BACK, REFUND, PAYOUT_DEDUCTION.
  - `status`: FAILED, PAID_OUT, PENDING, RECONCILED, REFUNDED, SCHEDULED, SUCCESSFUL.
  - Montos: `amount`, `fee_amount`, `deducted_amount`, `deducted_fee_amount`.
- También `transaction_events[]`.

**Payouts: `GET /v1.0/merchants/{mc}/payouts`** (https://developer.sumup.com/api/payouts/list)
- **CONFIRMADO**, parámetros: `start_date` y `end_date` (obligatorios, inclusivos), `format`, `limit` 1–9999, `order`.
- **CONFIRMADO**, campos:
  - `id`
  - `type`: PAYOUT, CHARGE_BACK_DEDUCTION, REFUND_DEDUCTION, DD_RETURN_DEDUCTION, BALANCE_DEDUCTION.
  - `amount`, `fee`, `date`, `currency`, `status`, `reference`, `transaction_code`.
- **NO CONFIRMADO:**
  - Si `amount` es neto o bruto.
  - Si hay una fila por transacción.
  - Qué agrupa `reference`.
  - Cadencia de pago en Chile.

**Implicancias:**
- Hoy la comisión es **desconocida**, no 0.
- `refunded_amount` existe, así que el reembolso se modela bien siempre que la transacción se vuelva a leer.
- Ignorar los ítems REFUND es correcto, porque evita el doble conteo con `refunded_amount`.
- Ignorar CHARGE_BACK **no** es correcto.

## 3. Riesgos (veredicto)

| # | Riesgo | Veredicto | Evidencia |
|---|---|---|---|
| R1 | Comisión ausente: el "líquido" es bruto − reembolsos | **CONFIRMADO** (docs + código); falta validar con datos | `index.js:197-198`; `offerings-page.tsx:332,586` |
| R2 | Una sola página de 25/100 en 45 días: reembolsos tardíos no aplicados | **CONFIRMADO** | `:140-148` |
| R3 | Caída de más de 1 h con más de 100 transacciones nuevas, o más de 45 días sin sync: transacciones nunca importadas | **CONFIRMADO** | `:147` |
| R4 | CHARGE_BACK ignorado: el pago queda activo | **CONFIRMADO** (código) | `:187` |
| R5 | Transacción importada que pasa a CANCELLED/FAILED: el libro sigue activo | **CONFIRMADO** | `:187-189` |
| R6 | Pagos no-POS (ECOM/online) ignorados sin rastro | CONFIRMADO que se ignoran; que existan es PROBABLE | `:187` |
| R7 | Una cuenta que falla corta la otra y el legacy | **CONFIRMADO** | `:617-630` |
| R8 | Un reembolso modifica el mes original (posiblemente ya cerrado) | **CONFIRMADO**; es una regla financiera | `:216` |
| R9 | El libro guarda solo el líquido; el raw se sobrescribe sin historial | **CONFIRMADO** | `:317, :355-375` |
| R10 | Colisión de escrituras cliente/servidor en summaries | Corrupción **DESCARTADA** (ambos usan transacciones). Contención **PROBABLE** | `transactions.ts:50-184` |
| R11 | Cliente edita `sumup_*` → el sync lo revierte; si cambió el período, corrompe resúmenes | **CONFIRMADO** | rules `113-121`; `index.js:231-232,253-260` |
| R12 | "Anular" un `sumup_*` desde la UI | HYPOTHESIS fuerte: **siempre falla**, porque la regla ve un cambio en `date` (12:00Z vs instante real) | `transactions.ts:193`; rules `118-119` |
| R13 | Resurrección: un doc anulado vuelve a `active` y conserva `void*` | **CONFIRMADO**, probabilidad baja | `:312-336` |
| R14 | Fechas: pagos del día 1 antes de ~08–09 h local caen en la consulta del mes anterior en Ofrendas | **CONFIRMADO**; impacto acotado | `hooks.ts:188-189`; `offerings-page.tsx:72-89` |
| R15 | Sin registro por ejecución; `lastError` sobrescrito; un timeout deja "ok" falso | **CONFIRMADO** | `:574-609` |
| R16 | Scheduler + manual producen doble conteo | **DESCARTADO**. Contención y "último que escribe gana" en `lastSync*`: CONFIRMADO | `:218-240` |
| R17 | `datePartsChile` | OK | `:116-129` |
| R18 | `revision` no guarda motivo ni valor anterior | CONFIRMADO | `:327` |
| R19 | Mismo merchant en ambos secrets: doble conteo | Sin guarda | `:136` |
| R20 | Propinas contadas como venta | NO CONFIRMADO; regla de negocio | docs get |
| R21 | Sin timeout por fetch | CONFIRMADO | `:149, :428` |
| R22 | package-lock desincronizado (`npm ci` falla) | FACT | baseline |

## 4. Causa raíz del 502

Trabajo de una ejecución manual:
1. `verifyIdToken` + lectura del usuario.
2. `ensureSumUpSystemCategory`.
3. Para cada una de las 2 cuentas, en serie: fetch a SumUp sin timeout y luego hasta 25 `runTransaction` secuenciales, cada uno con 2 lecturas + commit + reescritura del raw, **aunque no haya cambios**.

Total: ~50 transacciones Firestore en serie más 2 llamadas HTTP, dentro de 55 s.

| H | Hipótesis | Prob. | Evidencia que la confirmaría |
|---|---|---|---|
| H1 | La función supera 55 s; Cloud Run corta y Hosting responde 502/504. Causa estructural: trabajo O(ventana) | **Alta** | `httpRequest.latency ≈ 55s`; texto "maximum request timeout" |
| H2 | Contención con el scheduler y con escrituras del cliente sobre el mismo summary | Media, agravante | Ejecuciones solapadas; errores ABORTED/contention |
| H3 | Cold start + secrets + latencia entre regiones | Media, agravante | "STARTUP TCP probe" cerca del 502 |
| H4 | OOM o crash | Baja | "Memory limit", "Container called exit" |
| H5 | Error de SumUp 4xx/5xx | **Descartado como 502**: el código devuelve 500 JSON | `console.error('sumupSyncNow')` |
| H6 | Los 502 son anteriores al commit del proxy de Hosting | ? | Comparar fechas |

Queries de Cloud Logging (proyecto `cds-administracion`):
```
resource.type="cloud_run_revision" resource.labels.service_name="sumupsyncnow" httpRequest.status>=500
resource.type="cloud_run_revision" resource.labels.service_name="sumupsyncnow" textPayload:"maximum request timeout"
resource.type="cloud_run_revision" resource.labels.service_name="sumupsyncnow" httpRequest.latency>"30s"
resource.labels.service_name="sumupsyncnow" severity>=ERROR
resource.labels.service_name=("sumupsyncnow" OR "sumupsyncscheduled") (textPayload:"Memory limit" OR textPayload:"Container called exit")
resource.labels.service_name="sumupsyncnow" textPayload:"STARTUP TCP probe succeeded"
resource.labels.service_name="sumupsyncscheduled" severity>=WARNING
resource.labels.service_name=("sumupsyncnow" OR "sumupsyncscheduled") (textPayload:"ABORTED" OR textPayload:"contention")
```

**Corrección en la raíz (sin agregar retries):**
- Trabajo proporcional a los cambios: comparar el snapshot contra el raw con lecturas en lote y omitir lo que no cambió.
- Presupuesto interno de ≤40 s con cursor persistido.
- Lease para evitar ejecuciones solapadas.
- Timeout en cada fetch.
- Aislamiento por cuenta.

## 5. Sync truth table

M = manual (25, 1 página) · S = programado (100, 1 página) · L = legacy (solo offerings, anterior a 2026-09-09). ⚖ = requiere decisión humana o de Navigator.

| Evento | Local | Proveedor | Acción actual | Acción target | ¿Retry? | ¿Idempotente? |
|---|---|---|---|---|---|---|
| Nueva, dentro del top-N | no existe | SUCCESSFUL | Crea el libro con bruto − reembolso (fee 0), el raw y el delta | Igual, + `feeStatus:'unknown'`, snapshot, contador `created` | sí | **sí** |
| Nueva, fuera del top-N | no existe | SUCCESSFUL | **Nunca se importa** | Paginación completa desde un watermark con solapamiento; si se acaba el presupuesto, `partial` + cursor | sí | sí |
| Ya importada, sin cambio | active | igual | `runTransaction` + reescritura (costo inútil) | Omitir por hash; contador `unchanged` | n/a | sí |
| PENDING → SUCCESSFUL | no existe | PENDING→SUCCESSFUL | Se ignora; se crea al pasar a SUCCESSFUL si está en la ventana | Igual; contador `ignored.pending` | sí | sí |
| Reembolso total | active | REFUNDED | Libro `voided`; resta en el **mes original** | Igual + versión + contador. ⚖ mes de reconocimiento | sí | sí |
| Reembolso parcial | active | refunded<amount | Reduce `amount` y hace `revision+1` sin motivo | + versión con motivo y antes/después | sí | sí |
| Reembolso tardío | active | REFUNDED | **No se aplica** | Barrido diario de 45 d; >45 d ⚖ | sí | sí |
| Contracargo | active | ítem CHARGE_BACK | Se ignora | Registrar en `adjustments/` + `reviewRequired`. Efecto en el libro ⚖ | n/a | sí |
| Pasa a CANCELLED/FAILED | active | CANCELLED/FAILED | Se ignora (sigue activa) | `review` sin tocar el libro ⚖ | n/a | sí |
| No-POS / no-CLP | no existe | SUCCESSFUL | Se ignora sin rastro | Contador + ids de muestra; ⚖ tratamiento | n/a | sí |
| Timeout | parcial | n/a | Commits parciales, estado "ok" viejo, HTML 502 | Presupuesto de 40 s → `partial`; lease vencido → `abandoned` | sí | sí |
| 4xx | n/a | error | `throw`: la otra cuenta no corre, respuesta 500 | `provider_client_error`; la otra sigue; el watermark no avanza | no | sí |
| 401/403 | n/a | credencial inválida | idem | `auth_error` visible | **no** | sí |
| 5xx / red | n/a | caído | idem | `provider_unavailable` | siguiente run | sí |
| 429 | n/a | rate limit | idem | `rate_limited`, persistir cursor | siguiente run | sí |
| Scheduler duplicado | cualquiera | cualquiera | Ambos corren; contención | Lease → `skipped_locked` | n/a | sí |
| Manual durante scheduler | cualquiera | cualquiera | Ambos corren; posible timeout | 200 `already_running` + runId | n/a | sí |
| Cruce de fin de mes | n/a | 01/10 UTC | `period`/`day` locales correctos; R14 en Ofrendas | Test que documenta; normalizar la fecha ⚖ (migración) | n/a | sí |
| Mismo merchant ×2 | n/a | n/a | Doble conteo | Guarda → `config_error` | no | sí |
| `sumup_*` editado por humano | active editado | sin cambio | El sync revierte | Reglas/UI de solo lectura ⚖; mientras tanto, si `updatedBy≠system:sumup` → `review` | n/a | sí |
| Anulado que revive | voided | SUCCESSFUL | Se reactiva y conserva `void*` | Si lo anuló un humano: no reactivar, `review`. Si fue el sistema: limpiar `void*` + versión | n/a | sí |
| L: reembolso posterior al backfill | active | REFUNDED | Nunca se relee | Barrido si cae en la ventana; fuera de ella ⚖ | n/a | sí |

## 6. Datos para la conciliación de payouts

| Concepto | Fuente SumUp | Estado |
|---|---|---|
| BRUTO | `amount` (listado; puede incluir propina) | CONFIRMADO |
| REEMBOLSOS | `refunded_amount`; ítems REFUND; `events[REFUND]`; `REFUND_DEDUCTION` | CONFIRMADO |
| CONTRACARGOS | ítems CHARGE_BACK; `events`; `CHARGE_BACK_DEDUCTION` | Campos confirmados; montos NO CONFIRMADOS |
| COMISIÓN | `fee_amount` (detalle), `events[].fee_amount`, `fee` (payouts) | Existe, **no se consume** |
| PAYOUT esperado | `payout_date`, `payout_type`, `payouts_total/received`, `payout_plan` | CONFIRMADO |
| PAYOUT efectivo | `/v1.0/merchants/{mc}/payouts` | CONFIRMADO; neto/bruto NO CONFIRMADO |
| DEPÓSITO bancario | **No viene de SumUp**: requiere cartola | Gate: integración bancaria o importación manual |

**REC:**
- Hacer una ingesta diaria de payouts por cuenta, ventana `[hoy−35, hoy]`, con idempotencia por `payout.id`.
- Usar el detalle solo para investigar excepciones.
- Antes de modelar, validar con una llamada real de solo lectura (gate G9): si `amount` es neto, si hay una fila por transacción, qué agrupa `reference` y si la API key tiene scope de payouts.

## 7. Slice 1 — SumUp reliability

**Principio:** el slice no cambia ninguna regla financiera ni ninguna cifra ya registrada en el libro.
- `amount` del libro = `bruto − reembolsado`, que es exactamente lo que se registra hoy.
- El trabajo es de observabilidad, completitud, aislamiento, concurrencia y enriquecimiento del raw.

### ✅ Seguro para Builder

**S1.1 — Lógica pura** en `functions/sumup/core.js`:
- `normalizeItem`
- `classifyItem(normalized, existing)` → `create | update | void | reactivate | unchanged | ignored(reason) | review(reason)`. Clasifica **antes** de filtrar (corrige R4 y R5).
- `ledgerAmount = max(0, gross − refunded)`
- `summaryDelta` puro, equivalente al actual
- `classifyHttpError` → `auth_error | rate_limited | provider_client_error | provider_unavailable | config_error`
- `snapshotHash`
- `datePartsChile`

**S1.2 — `sumupSyncRuns/{runId}`** (solo Admin; reglas: lectura `details()`, escritura false).
- Identificación: `provider`, `account`, `merchantCode`, `trigger` (manual/scheduled/sweep/legacy), `requestedBy`.
- Estado: `status` (running/completed/partial/failed/skipped_locked/abandoned), `startedAt`, `finishedAt`, `durationMs`.
- Ventana: `window{changesSince, cursorIn, cursorOut}`, `pages`.
- `counts{fetched, created, updated, voided, reactivated, unchanged, review, ignored{nonPOS, nonCLP, nonPayment, pending, preSplit, other}, chargebacks}`.
- Error: `errorClass`, `errorMessage`, `httpStatus`, `sampleIds`.
- El doc de integración guarda `lastRunId`, `lastSuccessfulSyncAt` y `lastErrorClass`.

**S1.3 — Aislamiento por cuenta:** el fallo de una cuenta no corta la otra, y el legacy corre siempre.

**S1.4 — Watermark + paginación completa:**
- `changes_since = watermark − 15 min`, orden ascendente, siguiendo `links.next` hasta agotar la paginación o el presupuesto.
- Si se agota el presupuesto: `partial` con el cursor persistido y **sin** avanzar el watermark.
- Primera ejecución: `now − 45 d`.

**S1.5 — Barrido diario** de 45 días con paginación completa.

**S1.6 — Lease por cuenta** (TTL 60 s manual / 9 min programado): si está tomado → `skipped_locked` o `already_running`; si vence → `abandoned`.

**S1.7 — Manual acotado:**
- Presupuesto de 40 s, `AbortController` de 15 s por fetch, omisión por hash.
- Respuesta **siempre JSON 200** `{ok, results:[…]}`; 401/403 solo para autenticación.
- UI: estado por cuenta y "parcial, continúa automáticamente".

**S1.8 — Raw enriquecido y versionado:**
- `providerSnapshot` (incluye payout_*, merchant_code, type, status), `feeAmount:null`, `feeStatus:'unknown'`, `amountBasis:'gross_minus_refunds'`.
- Subcolección `versions/{n}` con antes/después, motivo y runId.

**S1.9 — Guardas:**
- `merchantCode` distinto entre cuentas, e `item.merchant_code === config`.
- Los CHARGE_BACK van a `adjustments/{id}` con `reviewRequired`, sin efecto en el libro.

**S1.10 — Libro conservador:**
- Al reactivar un doc anulado por el sistema, limpiar `void*`.
- Si lo anuló o editó un humano, no sobrescribir: marcar `review`.

**S1.11 — Tests (vitest):**
- duplicado
- unknown result / timeout
- reembolso total y parcial
- contracargo
- estado degradado
- comisión
- separación de cuentas y mismo merchant
- aislamiento
- scheduler + manual
- cambio de mes
- paginación y watermark
- clasificación de errores

**S1.12 — Test de reglas** que documenta el comportamiento actual (el cliente puede actualizar `sumup_*`).

**S1.13 — Reparar el package-lock** (`npm ci`).

### ⚖ Gates humanos / Navigator

| Gate | Decisión |
|---|---|
| G1 | Neto vs bruto en el libro (regla financiera + migración) |
| G2 | Mes en que se reconocen reembolsos y contracargos |
| G3 | Bloquear la escritura del cliente en `sumup_*` (permisos) — prioridad alta |
| G4 | Pagos ECOM/online |
| G5 | Qué efecto tienen en el libro los contracargos, CANCELLED y FAILED |
| G6 | Normalizar `date` (migración) |
| G7 | Propinas |
| G8 | Historial de cafetería anterior a 2026-09-09 |
| G9 | Primera llamada real a payouts/detalle con la credencial de producción |
| G10 | Deploy, y cambiar el texto de UI "líquido" |

### Acceptance criteria del Slice 1
1. Pasan los tests S1.11 y S1.12, los 60 existentes, lint y typecheck; `npm ci` funciona.
2. Con un mock de 3 páginas y más de 100 ítems se importa el 100 %. Una ejecución manual con presupuesto agotado queda `partial` y la siguiente completa sin duplicados.
3. Un fallo de Ofrendas no impide que Cafetería termine `completed`.
4. Cada ejecución deja un doc de run por cuenta, con conteos que suman `fetched`.
5. Un ítem sin cambios no genera escrituras en el libro ni en el resumen.
6. Ante el mismo input, ningún monto del libro cambia respecto del código actual (no-regresión financiera).
7. La respuesta manual es siempre JSON; con un SumUp lento de 30 s responde en menos de 45 s.
8. Después del deploy (gate): la segunda ejecución consecutiva termina con `unchanged = fetched`; la latencia en los logs baja de 30 s; la suma del mes por cuenta cuadra contra el reporte de SumUp.

## 8. Arquitectura de sync (Phase 11, esbozo)

```
[Adaptador proveedor por cuenta]   sumup:offerings | sumup:cafeteria | getnet (modelo propio)
   fetch paginado, watermark, cursor, lease, clasificación de errores
      ▼
[Raw store]   sumupIntegrations/{a}/transactions/{id} + /versions + /adjustments
      ▼
[Proyector de libro] (puro, idempotente)   financeTransactions/sumup_{a}_{id} + delta en summaries
[Ingesta de payouts] (diaria)   sumupPayouts/{a}_{payoutId}
      ▼
[Conciliador]   tx: bruto−reemb−fee = líquido esperado ↔ payout ↔ depósito (cartola, gate)
[Observabilidad]   sumupSyncRuns + logs estructurados + alertas (auth_error; lastSuccessfulSyncAt > 3 h; review > 0)
[Verificador]   job diario de solo lectura: Σ financeTransactions activos vs financeMonthlySummaries → discrepancias (sin autocorrección)
```

Webhooks para POS: no verificados. El mecanismo base es polling con watermark.
