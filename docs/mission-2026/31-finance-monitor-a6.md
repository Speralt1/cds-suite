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
| Resumen vs ledger | 9 campos, **solo** octubre + meses con escrituras en la ventana | STOP |
| Ene–sep vs baseline | Diferencias contra un baseline JSON | **solo nota no bloqueante** |

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
4. **Falla cerrada.** Un snapshot inválido, la falta de fecha de referencia o un detector que lanza una excepción producen STOP.

### 2.1 Niveles

| Nivel | Significado | Exit |
|---|---|---|
| INFORMATIVO | Legítimo o explicado (por ejemplo, un retroactivo dentro del margen o un delta de mes cerrado que cuadra con sus escrituras) | 0 |
| REVISAR | Posible error que necesita revisión humana | 1 |
| STOP | Inconsistencia contable, problema de seguridad o corrupción | 2 |

**Reconocimientos (`config.acknowledged`):** un humano puede rebajar a INFORMATIVO un REVISAR ya revisado. Indica `code` (opcional), `ids` (completos o los últimos 6 caracteres) y `note`. **Un STOP nunca se rebaja.** El archivo de configuración con ids reales es privado y no vive en el repo.

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
  sumup?: { payoutAmountBasis?, sales: [{ transactionCode, account, date, gross, refunded?, paymentType, status }],
            payouts: [{ id, account, type, transactionCode, amount (NETO), fee, deduction?, reference, date, status }],
            feeExpenses: [{ id, payoutRowId, amount, status }],
            feeProposals: [{ id, payoutRowId, amount }] }
}
```

`createTime`/`updateTime` son los metadatos de Firestore del documento, no campos de la app. `baseline` y `previous` también pueden pasarse como archivos aparte.

## 3. Detectores

| Detector | Código | Nivel | Regla |
|---|---|---|---|
| Diezmos duplicados | `TITHE_DUPLICATE_EXACT` | REVISAR | Mismo perfil + fecha contable + monto + medio, entre diezmos activos atribuidos |
| | `TITHE_REPEAT_MONTH` | INFORMATIVO | Mismo perfil + monto en el mismo mes, con fechas distintas |
| Fecha futura | `FUTURE_DATED` | REVISAR | Fecha contable posterior a hoy en America/Santiago (solo activos) |
| Retroactivos | `BACKDATED_ENTRY` | INFORMATIVO | Mes local de creación posterior al mes contable, con atraso ≤ `backdate.maxLagDays` (31 por defecto) |
| | `BACKDATED_ENTRY_LATE` | REVISAR | Atraso mayor al margen. Si hay snapshot previo, solo se mira lo creado en la ventana |
| Meses vs baseline (a, b, e) | `BASELINE_DELTA_EXPLAINED` | INFORMATIVO | Delta (resumen actual − baseline) = Σ de las escrituras listadas desde `baseline.takenAt` (creaciones, anulaciones, reactivaciones, ediciones) |
| | `BASELINE_DELTA_UNEXPLAINED` | **STOP** | El delta no cuadra con esas escrituras. Las ediciones sin estado previo no se pueden explicar: incluir `baseline.ledger` |
| | `BASELINE_MONTH_MISSING` | REVISAR | Mes cerrado con escrituras desde el baseline que no está en el baseline |
| | `BASELINE_OPEN_MONTH_ABSENT` / `BASELINE_ABSENT` | INFORMATIVO | Falta el mes abierto en el baseline, o falta el baseline completo |
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
| Runner | `INPUT_INVALID` / `DETECTOR_ERROR` | **STOP** | Falla cerrada |

### Notas de diseño

- **Clasificación humano/sistema (f).** Combina `createdBy`, `updatedBy`, el prefijo `sumup_{cuenta}_`, `revision` y si `createTime == updateTime`. Usa la misma definición de "creación SumUp legítima" que el snapshot R0G.
- **Cambio respecto de A5.** Las creaciones POS legítimas pasan a INFORMATIVO: en la auditoría, un veredicto REVISAR causado solo por ventas POS nuevas era ruido. Las **mutaciones** POS de `system:sumup` siguen en REVISAR.
- **Normalización de nombres.**
  - Replica el algoritmo de `lib/shared/names.ts`, que llega en la rama de integridad de diezmos (doc 27): minúsculas, NFKD sin marcas, letras plegadas, puntuación → espacio y espacios colapsados.
  - La clave de identidad se forma con las palabras unidas por `_`. La similitud combina Damerau-Levenshtein, tokens ordenados y contención.
  - Cuando ese módulo llegue a producción, A6 debe importar `functions/shared/names.js` en lugar de su copia.
- **Modelo SumUp de payouts.**
  - Una fila por venta, con `amount` NETO de comisión. Las filas se agrupan en depósitos por `reference`, y un depósito puede cubrir varios días.
  - La conciliación es `neto + comisión + deducciones = bruto`. Esto refleja la ley contable G1: la venta queda en bruto y la comisión es un egreso vinculado.

## 4. Cómo correrlo

```bash
node scripts/ops/finance-monitor/run.mjs --snapshot actual.json \
  [--baseline baseline.json] [--previous previo.json] [--config config.json] \
  [--today YYYY-MM-DD] [--since ISO] [--format text|json]
```

- **Salida:** reporte en español agrupado por STOP → REVISAR → INFORMATIVO, con evidencia agregada.
- **Exit code:** `0` OK, `1` REVISAR, `2` STOP. Una entrada inválida también da `2`.
- **`config.json`:**

```json
{
  "backdate": { "maxLagDays": 31 },
  "payouts": { "pendingBusinessDays": 3, "holidays": ["2026-10-12"] },
  "profileSimilarityThreshold": 0.8,
  "acknowledged": [{ "code": "BACKDATED_ENTRY_LATE", "ids": ["abc123"], "note": "regularización aprobada" }]
}
```

- **Paso privado (fuera del repo)** para generar los snapshots:
  1. Un script read-only en el directorio de operaciones local lee `financeTransactions` (con `createTime`/`updateTime`), `titheAttributions`, `titheProfiles`, `financeMonthlySummaries` y, cuando exista la ingesta, ventas SumUp, payouts y comisiones.
  2. Escribe los JSON con permisos `0600`.
  3. Guarda el snapshot anterior para pasarlo como `--previous`.

  El baseline se refresca **solo con aprobación humana**, después de cada cierre revisado, e incluye el mes abierto y, en lo posible, `ledger` como estado previo.

## 5. Coexistencia y migración

1. **A5 se mantiene** como monitor oficial y sin cambios. Sigue cubriendo componentes desplegados, scheduler, runs, logs, DENY de reglas e invariantes CASH, que A6 no reimplementa.
2. **A6 corre en paralelo en modo observación.** Se ejecuta sobre los mismos snapshots y su veredicto se registra junto al de A5, sin bloquear nada.
3. **Período de comparación** (sugerido: 2 semanas o 1 cierre mensual): se anota cada diferencia de veredicto entre A5 y A6, y cada falso positivo o negativo.
4. **Cambio solo con aprobación humana explícita (GO).** Las opciones son dos: integrar los controles de componentes y CASH de A5 como detectores puros de A6, o mantener A5 para infraestructura y A6 para la contabilidad.
5. **Reversión trivial:** A6 no escribe nada; basta con dejar de ejecutarlo.

## 6. Tests

`tests/ops/finance-monitor.test.ts` (36 tests, entorno node, solo fixtures). Cubren todos los detectores y los patrones reales anonimizados:

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
- **Estado previo inferido.** Sin `baseline.ledger`, una anulación se infiere como "estaba activa con el mismo monto". Una edición de monto queda sin explicar y da STOP. Esto es intencional: falla cerrada.
- **Ventana de retroactivos.** Sin snapshot previo ni `--since`, los retroactivos se evalúan sobre toda la historia, y los históricos legítimos hay que reconocerlos en config.
- **Días hábiles.** Lunes a viernes más los feriados que se configuren. No hay calendario oficial incluido.
- **Diezmos sin atribución.** No participan del detector de duplicados.
- **Fuera de alcance de A6.** No revisa infraestructura (Rules, Hosting, Functions, scheduler, logs). Eso sigue en A5.
