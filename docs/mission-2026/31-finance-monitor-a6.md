# 31 · Monitor financiero A6 (propuesta + implementación probada)

Estado: **propuesta en observación**. A6 **no reemplaza** a A5. Rama `feature/finance-monitor-a6-v1`, sin deploy, sin acceso a producción.

Código: `scripts/ops/finance-monitor/` · Tests: `tests/ops/finance-monitor.test.ts` (los corre `npm run test`).

---

## 1. Qué hace A5 hoy y por qué no alcanzó

A5 es el monitor del rollout SumUp CASH (doc 22, CASH-A9). Corre a mano, lee producción en modo solo lectura e imprime cifras agregadas e ids abreviados. Cubre:

| Área | Qué verifica | Resultado |
|---|---|---|
| Componentes | Rules, Hosting y revisiones de Functions contra valores esperados | REVISAR si cambian |
| Scheduler y runs | Estado y frecuencia del job, invocaciones no-2xx, huecos > 2 h, runs fallidos, `review`, leases vencidos, sweeps atrasados | REVISAR |
| Logs y reglas | Errores, 5xx, permission denied, errores de proveedor, DENY de reglas | REVISAR / nota |
| Escrituras financieras | Ventana (24 h por defecto) separada en `system:sumup` y humanas solo por `updatedBy`. Las humanas **no son fallo A5** | REVISAR si `system:sumup` toca POS o docs ajenos |
| Invariantes CASH | CASH SumUp anterior al inicio, duplicado con efectivo manual, coherencia raw ↔ ledger | REVISAR / BLOCKER |
| Resumen vs ledger | 9 campos, **solo** octubre + meses con escrituras en la ventana | línea de texto "STOP:" dentro de un veredicto REVISAR |
| Ene–sep vs baseline | Diferencias contra un baseline JSON | **solo nota no bloqueante** |

A5 solo produce dos veredictos: **OK** o **REVISAR**. Las condiciones graves aparecen como líneas de texto que empiezan con "STOP:" (o "BLOCKER:") dentro de un veredicto REVISAR; no tiene un nivel ni un exit code STOP propios.

En la auditoría C-A1.2F (incidente de diezmos retroactivos), A5 **sí vio** el cambio de septiembre, pero solo como nota. El veredicto quedó en REVISAR por otra causa (ventas POS). Brechas detectadas:

- **(a)** El delta contra el baseline no se compara con Σ de las escrituras que lo explicarían.
- **(b)** Un cambio en un mes cerrado que nadie explica individualmente no levanta REVISAR.
- **(c)** No detecta movimientos con fecha futura ni retroactivos.
- **(d)** No detecta diezmos duplicados (mismo perfil, fecha, monto y medio) ni perfiles duplicados por nombre normalizado.
- **(e)** Octubre (mes abierto) no se compara con un baseline.
- **(f)** Lo humano y lo del sistema se distinguen solo por `updatedBy`.
- Además, faltan controles SumUp nuevos:
  - bruto vs neto;
  - payouts pendientes;
  - payouts duplicados;
  - propuestas de comisión registradas dos veces.

A5 también limita su ventana a 24 h. Pasado ese plazo, un mes cambiado queda solo como nota, sin las escrituras que lo explican y sin conciliación.

## 2. Diseño de A6

Principios:

1. **Detectores puros.**
   - Son funciones sin I/O. Reciben snapshots como objetos JS planos y devuelven hallazgos `{code, level, message, evidence}`.
   - No hacen red ni llaman a `Date.now()`. "Hoy" se deriva de `takenAt` (o de `--today`) en America/Santiago.
2. **Recolección fuera del repo.**
   - Leer producción es un paso **privado y separado**. Usa las herramientas read-only existentes de snapshot (REST de Firestore y la API de SumUp en modo lectura) y produce JSON locales.
   - El repo no contiene credenciales, cuentas, ids de deploy ni datos personales.
3. **Sin PII en la salida.**
   - Los mensajes no incluyen nombres. Usan ids abreviados (`…xxxxxx`) y tokens de grupo (`P1`, `P2`).
   - Los ids completos viajan solo en `refs`, internos, para cruzar reconocimientos. Nunca se imprimen, tampoco en `--format json`.
   - El actor se informa como `humano` o `system:sumup`, nunca como uid.
4. **Falla cerrada.** Todo lo siguiente produce STOP con exit 2, nunca un OK:
   - un snapshot u opciones inválidas (`INPUT_INVALID`);
   - la falta de fecha de referencia;
   - un detector que lanza una excepción (`DETECTOR_ERROR`);
   - cualquier otro error inesperado (`INTERNAL_ERROR`, y la CLI siempre sale con 2).
5. **Validación estricta, sin coerción.**
   - Ledger:
     - `type`, `status` y `source` deben estar dentro de su dominio;
     - `amount` debe ser entero ≥ 0 (un texto no vale);
     - `period` debe ser `YYYY-MM` válido y `day` un día real de ese mes;
     - `revision`, si viene, debe ser entero ≥ 1;
     - los timestamps deben ser ISO con zona;
     - no puede haber ids repetidos.
   - Resúmenes: los 5 escalares son obligatorios y numéricos, y los mapas solo pueden tener valores numéricos.
   - También se validan baseline, snapshot previo, perfiles, atribuciones y SumUp.
   - Un ledger o un `summaries` vacío es STOP salvo con `--allow-empty` explícito.
   - Las opciones desconocidas o con tipo erróneo también son STOP.
6. **Cobertura visible: OK nunca significa "nada revisado".**
   - El reporte imprime una línea `Cobertura:` con lo que se revisó: ledger, resúmenes, baseline (y su fuente de estado previo), snapshot previo y SumUp.
   - Si falta el baseline o el snapshot previo → `COVERAGE_PARTIAL` (REVISAR).
   - Si faltan los datos SumUp → `COVERAGE_SUMUP_ABSENT` (INFORMATIVO).

### 2.1 Niveles

| Nivel | Significado | Exit |
|---|---|---|
| INFORMATIVO | Legítimo o explicado (por ejemplo, un retroactivo dentro del margen o un delta de mes cerrado que cuadra con sus escrituras) | 0 |
| REVISAR | Posible error que necesita revisión humana | 1 |
| STOP | Inconsistencia contable, problema de seguridad o corrupción | 2 |

**Reconocimientos (`config.acknowledged`):** un humano puede rebajar a INFORMATIVO un REVISAR ya revisado.

- Cada reconocimiento lleva:
  - `code`: **obligatorio**; debe ser igual al del hallazgo;
  - `ids`: **ids completos**, no sufijos; deben estar todos los del hallazgo;
  - `note`;
  - `until`: opcional, `YYYY-MM-DD`.
- Un reconocimiento vencido (`until` < hoy) deja de aplicarse y se avisa con `ACK_EXPIRED` (INFORMATIVO).
- Un reconocimiento mal formado es STOP.
- **Un STOP nunca se rebaja.**
- El archivo de configuración con ids reales es privado y no vive en el repo.

### 2.2 Entradas (snapshot JSON)

```text
{
  takenAt: ISO,
  ledger: [{ id, type, amount, category, paymentMethod, period, day, source, status,
             revision, createdBy, updatedBy, createTime, updateTime, voidedAt? }],
  attributions: [{ id, transactionId, profileId, amount, status }],
  profiles: [{ id, displayName, active, createTime }],
  summaries: { "YYYY-MM": { 9 campos } },
  baseline?: { takenAt, months: { "YYYY-MM": {...} }, year?, ledger?: [estado previo] },
  previous?: { takenAt, ledger: [...] },
  sumup?: { payoutAmountBasis?,
            sales: [{ transactionCode, account, date (YYYY-MM-DD local America/Santiago), gross, refunded?,
                      paymentType (POS|CASH), status }],
            payouts: [{ id, account, type, transactionCode, amount (NETO), fee, deduction?, reference, date, status }],
            feeExpenses: [{ id, payoutRowId, amount, status }],
            feeProposals: [{ id, payoutRowId, amount }] }
}
```

- `createTime`/`updateTime` son los metadatos de Firestore del documento, no campos de la app.
- `baseline` y `previous` también pueden pasarse como archivos aparte.
- Cuando hay `sumup`, sus 4 arreglos son obligatorios (pueden venir vacíos).
- `sales[].date` es la **fecha local de America/Santiago** en formato `YYYY-MM-DD`. Un timestamp o una fecha imposible es STOP.

## 3. Detectores

| Detector | Código | Nivel | Regla |
|---|---|---|---|
| Diezmos duplicados | `TITHE_DUPLICATE_EXACT` | REVISAR | Mismo perfil + fecha contable + monto + medio, entre diezmos activos atribuidos |
| | `TITHE_REPEAT_MONTH` | INFORMATIVO | Mismo perfil + monto en el mismo mes, con fechas distintas |
| | (perfiles gemelos) | — | Las dos claves anteriores agrupan por **clave de identidad del nombre del perfil**: un duplicado repartido entre dos fichas gemelas también se detecta (`twinProfiles`) |
| | `TITHE_ATTRIBUTION_INTEGRITY` | REVISAR | Diezmo activo con 0 o con 2 o más atribuciones activas |
| Fecha futura | `FUTURE_DATED` | REVISAR | Fecha contable posterior a hoy en America/Santiago (solo activos) |
| Retroactivos | `BACKDATED_ENTRY` | INFORMATIVO | Mes local de creación posterior al mes contable, con atraso ≤ `backdate.maxLagDays` (31 por defecto) |
| | `BACKDATED_ENTRY_LATE` | REVISAR | Atraso mayor al margen. Si hay snapshot previo, solo se mira lo creado en la ventana |
| Meses vs baseline (a, b, e) | `BASELINE_DELTA_EXPLAINED` | INFORMATIVO | Delta (resumen actual − baseline) = Σ de las escrituras listadas desde `baseline.takenAt` (creaciones, anulaciones, reactivaciones, ediciones) |
| | `BASELINE_DELTA_UNEXPLAINED` | **STOP** | El delta no cuadra con esas escrituras |
| | `BASELINE_EDIT_UNVERIFIABLE` | REVISAR | El delta cuadra, pero hay ediciones posteriores al baseline sin estado previo. Una edición sin estado previo nunca es INFORMATIVO: si el delta no cuadra es STOP, y si cuadra es REVISAR. Para verificarla, incluir `baseline.ledger` |
| | `BASELINE_ROW_DELETED` | **STOP** | Un doc de `baseline.ledger` ya no existe. Es STOP **sin importar el delta**, aunque el resumen se haya ajustado: el ledger solo anula, nunca borra |
| | `BASELINE_MONTH_MISSING` | REVISAR | Mes cerrado con escrituras desde el baseline que no está en el baseline |
| | `BASELINE_OPEN_MONTH_ABSENT` | INFORMATIVO | Falta el mes abierto en el baseline |
| Resumen vs ledger | `SUMMARY_LEDGER_MISMATCH` | **STOP** | Cualquiera de los 9 campos difiere, en **todos** los meses |
| | `SUMMARY_MISSING` | **STOP** | Mes con movimientos activos y sin resumen |
| | `SUMMARY_ZERO_KEYS` | INFORMATIVO | Claves en 0 (estructurales) |
| Escrituras (semántica A5 + f) | `SUMUP_POS_MUTATION` | REVISAR | `system:sumup` modificó un doc POS existente |
| | `SYSTEM_WRITE_FOREIGN_DOC` | REVISAR | `system:sumup` escribió sobre un doc que no es `sumup_*` |
| | `HUMAN_WRITE_ON_SUMUP_DOC` | REVISAR | Un humano editó un doc `sumup_*` |
| | `SUMUP_CREATIONS`, `SUMUP_CASH_MUTATION`, `HUMAN_WRITES` | INFORMATIVO | Conteos de la ventana |
| Contra snapshot previo | `PREEXISTING_MODIFIED` | REVISAR | Cambió un campo contable de un doc preexistente |
| | `UNEXPECTED_VOID` / `REACTIVATED` | REVISAR | Anulación o reactivación no reconocida |
| | `ROW_MISSING` | **STOP** | Desapareció un doc (el ledger solo anula, nunca borra) |
| | `REVISION_REGRESSION` | **STOP** | `revision` o `updateTime` retrocedieron |
| Perfiles | `PROFILE_DUPLICATE_NAME` | REVISAR | Misma clave de identidad (nombre normalizado) |
| | `PROFILE_SIMILAR_NAME` | INFORMATIVO | Similitud ≥ 0,8 |
| SumUp | `PAYOUT_ROW_DUPLICATE` | **STOP** | La misma fila de payout (cuenta + id) aparece dos veces |
| | `PAYOUT_SALE_MULTIPLE` | REVISAR | Una venta con más de una fila PAYOUT distinta |
| | `PAYOUT_BASIS_NOT_NET` | REVISAR | Base declarada distinta de neta, o monto = bruto con comisión > 0 |
| | `SETTLEMENT_MISMATCH` | REVISAR | Por depósito (`reference`): Σ(neto + comisión + deducciones) ≠ Σ bruto de las ventas ligadas |
| | `PAYOUT_UNLINKED` / `PAYOUT_DEDUCTION_MISMATCH` | REVISAR | Fila sin venta en el snapshot, o deducción ≠ reembolso |
| | `PAYOUT_PENDING` | REVISAR | Venta POS sin payout después de N días hábiles (3 por defecto; feriados configurables) |
| | `PAYOUT_PENDING_WITHIN_TERM` | INFORMATIVO | Venta POS todavía dentro del plazo |
| | `FEE_EXPENSE_DUPLICATE` / `FEE_DOUBLE_BOOKED` / `FEE_PROPOSAL_ALREADY_BOOKED` | **STOP** | Doble registro de la comisión |
| | `FEE_AMOUNT_MISMATCH` / `FEE_WITHOUT_PAYOUT` | REVISAR | Comisión registrada o propuesta ≠ comisión del proveedor, o sin fila |
| Cobertura | `COVERAGE_PARTIAL` | REVISAR | Falta el baseline o el snapshot previo |
| | `COVERAGE_SUMUP_ABSENT` | INFORMATIVO | Faltan los datos SumUp |
| Config | `ACK_EXPIRED` | INFORMATIVO | Hay reconocimientos vencidos |
| Runner | `INPUT_INVALID` / `DETECTOR_ERROR` / `INTERNAL_ERROR` | **STOP** | Falla cerrada |

### Notas de diseño

- **Clasificación humano/sistema (f).** Combina `createdBy`, `updatedBy`, el prefijo `sumup_{cuenta}_`, `revision` y si `createTime == updateTime`.
- **Creación SumUp legítima (estricta).** Espeja lo que escribe `functions/sumup/engine.js` y el `classify()` del snapshot R0G. Deben cumplirse todas estas condiciones:
  - `revision === 1` exacto: una `revision` ausente no cuenta como 1;
  - `createTime == updateTime`;
  - `createdBy == updatedBy == "system:sumup"`;
  - `status: active`, `type: income` y `source: general`;
  - `paymentMethod` igual a `card` o `cash`;
  - `amount` entero > 0;
  - categoría de la cuenta.
  Cualquier otra escritura de `system:sumup` es una mutación.
- **Cambio deliberado respecto de A5.** Las creaciones POS legítimas, con la definición estricta anterior, pasan a INFORMATIVO: en la auditoría, un veredicto REVISAR causado solo por ventas POS nuevas era ruido. Las **mutaciones** POS de `system:sumup` siguen en REVISAR.
- **Normalización de nombres.**
  - Replica el algoritmo de `lib/shared/names.ts`, que llega en la rama de integridad de diezmos (doc 27): minúsculas, NFKD sin marcas, letras plegadas, puntuación → espacio y espacios colapsados.
  - La clave de identidad se forma con las palabras unidas por `_`. La similitud combina Damerau-Levenshtein, tokens ordenados y contención.
  - Un test de paridad fija las salidas esperadas, generadas con `lib/shared/names.ts`.
  - Cuando ese módulo llegue a producción (PR A), A6 importará `functions/shared/names.js` en lugar de su copia, y el test de paridad debe seguir pasando sin cambios.
- **Modelo SumUp de payouts.**
  - Una fila por venta, con `amount` NETO de comisión. Las filas se agrupan en depósitos por `reference`, y un depósito puede cubrir varios días.
  - La conciliación es `neto + comisión + deducciones = bruto`. Esto refleja la ley contable G1: la venta queda en bruto y la comisión es un egreso vinculado.

## 4. Cómo correrlo

```bash
node scripts/ops/finance-monitor/run.mjs --snapshot actual.json \
  [--baseline baseline.json] [--previous previo.json] [--config config.json] \
  [--today YYYY-MM-DD] [--since ISO] [--format text|json] [--allow-empty]
```

- **Salida:** reporte en español agrupado por STOP → REVISAR → INFORMATIVO, con evidencia agregada.
- **Exit code:** `0` OK, `1` REVISAR, `2` STOP.
  - Una entrada inválida, un argumento inválido o cualquier error inesperado también da `2`.
  - Los errores de lectura o de JSON son genéricos: nunca repiten el contenido del archivo.
- **Flags que solo fija la CLI.** `--today` debe ser una fecha real (`2026-02-30` es STOP) y `--since` un instante ISO con zona. La fecha de referencia, la ventana y el modo vacío (`--today`, `--since`, `--allow-empty`) **solo** se fijan por CLI. Una config que intente fijar `today`, `since`, `now` o `allowEmpty` se rechaza con exit 2.
- **`config.json`:**

```json
{
  "backdate": { "maxLagDays": 31 },
  "payouts": { "pendingBusinessDays": 3, "holidays": ["2026-10-12"] },
  "profileSimilarityThreshold": 0.8,
  "acknowledged": [{ "code": "BACKDATED_ENTRY_LATE", "ids": ["<id completo del movimiento>"], "note": "regularización aprobada", "until": "2026-11-30" }]
}
```

- **Paso privado (fuera del repo)** para generar los snapshots:
  1. Un script read-only en el directorio de operaciones local lee `financeTransactions` (con `createTime`/`updateTime`), `titheAttributions`, `titheProfiles`, `financeMonthlySummaries` y, cuando exista la ingesta, ventas SumUp, payouts y comisiones.
  2. Escribe los JSON con permisos `0600`.
  3. Guarda el snapshot anterior para pasarlo como `--previous`.

- **Adaptador de baselines A9/A10.**
  - `takenAt` cae a `createdAt` cuando falta.
  - De cada mes solo se leen los 9 campos del resumen; otros campos, como `updatedAt`, se ignoran.
  - `baseline.ledger` solo se usa como estado previo si es un **arreglo de filas**. En A10 es un objeto agregado: se ignora y el estado previo queda "inferido", como se ve en la línea de cobertura y en la evidencia `priorState`.

  El baseline se refresca **solo con aprobación humana**, después de cada cierre revisado, e incluye el mes abierto y, en lo posible, `ledger` como estado previo.

## 5. Coexistencia y migración

1. **A5 se mantiene** como monitor oficial y sin cambios. Sigue cubriendo componentes desplegados, scheduler, runs, logs, DENY de reglas e invariantes CASH, que A6 no reimplementa.
2. **A6 corre en paralelo en modo observación.** Se ejecuta sobre los mismos snapshots y su veredicto se registra junto al de A5, sin bloquear nada.
3. **Período de comparación** (sugerido: 2 semanas o 1 cierre mensual): se anota cada diferencia de veredicto entre A5 y A6, y cada falso positivo o negativo.
4. **Cambio solo con aprobación humana explícita (GO).** Las opciones son dos: integrar los controles de componentes y CASH de A5 como detectores puros de A6, o mantener A5 para infraestructura y A6 para la contabilidad.
5. **Reversión trivial:** A6 no escribe nada; basta con dejar de ejecutarlo.

## 6. Tests

Tests en entorno node, solo con fixtures (`tests/ops/finance-monitor-fixtures.ts`, que construye snapshots con cobertura completa por defecto). Son 99 en total:

- `tests/ops/finance-monitor.test.ts`: 36 tests, uno o más por detector.
- `tests/ops/finance-monitor-hardening.test.ts`: 63 tests con los arreglos de la revisión Atlas:
  - M1: borrados y ediciones sin estado previo;
  - M2: exit 2 ante cualquier fallo;
  - M3: validación estricta;
  - creación SumUp estricta, reconocimientos con `code`/ids completos/`until`, perfiles gemelos e integridad de atribuciones;
  - corrupción de tipos, cobertura y baselines A9/A10;
  - `--today` y la config;
  - error JSON genérico;
  - DST de America/Santiago (2026-04-05 y 2026-09-06);
  - regresión de privacidad con 10+ códigos (sin ids completos, nombres, correos, teléfonos ni uids en texto ni JSON);
  - paridad de normalización con `lib/shared/names.ts`.

El archivo principal cubre: Cubren todos los detectores y los patrones reales anonimizados:

| Caso | Resultado esperado |
|---|---|
| 3 diezmos de septiembre ingresados 18 días tarde, explicados | INFORMATIVO (retroactivo y delta de baseline), veredicto OK |
| Diezmo con fecha +1 día | REVISAR |
| Dos diezmos idénticos de $145.000 a 24 s, mismo perfil | REVISAR |
| Perfil de familia duplicado con nombre idéntico | REVISAR; además se verifica que el reporte no contenga nombres ni ids completos |
| SumUp bruto 462.500 / comisión 15.968 / neto 446.532 | Conciliado, sin hallazgos |
| Payout agrupado que cubre dos días de venta | Sin hallazgos |
| Fila de payout vista dos veces | STOP |
| Cambio ene–sep sin explicar | STOP |
| Resumen descuadrado | STOP |

Hay además casos de:

- anulación explicada;
- edición con y sin estado previo;
- mes abierto;
- mes fuera del baseline;
- escrituras POS, foráneas y humanas sobre `sumup_*`;
- borrado y regresión;
- reconocimientos (nunca rebajan un STOP);
- pendientes por días hábiles;
- comisiones doble registradas o con monto distinto;
- deducciones;
- CLI (exit codes reales, archivos, JSON sin ids completos, argumentos inválidos).

## 7. Limitaciones conocidas

- **Modelo de payouts no confirmado.** El modelo (neto, una fila por venta, agrupado por `reference`, deducciones como filas con monto negativo) sigue el hallazgo G9 descrito en la tarea, pero no está validado contra la ingesta real, que todavía no existe en producción. El mapeo a `sales/payouts/feeExpenses/feeProposals` es responsabilidad del paso privado de recolección.
- **Estado previo inferido.** Sin `baseline.ledger` (o con el agregado de A10), una anulación se infiere como "estaba activa con el mismo monto". Una edición sin estado previo nunca es INFORMATIVO: si el delta no cuadra es STOP (`BASELINE_DELTA_UNEXPLAINED`), y si cuadra es REVISAR (`BASELINE_EDIT_UNVERIFIABLE`). Los borrados solo se detectan si hay `baseline.ledger` o snapshot previo.
- **Ventana de retroactivos.** Sin snapshot previo ni `--since`, los retroactivos se evalúan sobre toda la historia, y los históricos legítimos hay que reconocerlos en config.
- **Días hábiles.** Lunes a viernes más los feriados que se configuren. No hay calendario oficial incluido.
- **Diezmos sin atribución.** No participan del detector de duplicados; se reportan aparte con `TITHE_ATTRIBUTION_INTEGRITY`.
- **Fuera de alcance de A6.** No revisa infraestructura (Rules, Hosting, Functions, scheduler, logs). Eso sigue en A5.
