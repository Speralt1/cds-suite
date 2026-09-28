# NAVIGATOR: modelo financiero, Caja, Correcciones y Conciliación (Phases 1, 5, 6)

Branch base: `feature/preproduccion-mobile-v1` · 2026-09-22 · moneda CLP.

**Leyenda:** FACT = verificado en código, con referencia `archivo:línea` · HYP = hipótesis · REC = recomendación.

## Síntesis

Hoy CDS es un **libro de ingresos y egresos con totales mensuales desnormalizados**. Alrededor de ese libro hay módulos satélite: Diezmos, Caja/Ofrendas, Campañas y SumUp.

- **Qué registra:** dinero que entró y dinero que salió.
- **Qué no modela:** dinero esperado, depositado, pendiente o con diferencia.
- La palabra "Conciliado" aparece en la UI, pero no hay lógica de conciliación detrás.
- La "Caja del día" es un solo monto editable.

## 1. AS-IS: módulos

| Módulo | Qué hace realmente | Colecciones | Estado |
|---|---|---|---|
| Resumen | Totales de mes, año o día desde `financeMonthlySummaries`. SumUp aparece agrupado en una tarjeta aparte, identificado por el prefijo `sumup_` o por `createdBy` (`summary-page.tsx:131-151`). | summaries, transactions | Funciona. No muestra pendientes ni diferencias. |
| Movimientos | Crear, editar y anular (con motivo) **cualquier** movimiento, incluidos SumUp y caja (`transaction-list.tsx:67-79`). | financeTransactions | Funciona, pero la edición sobrescribe el registro sin guardar el valor anterior (`transactions.ts:73-97`). |
| Diezmos | Fichas de diezmantes. Cada diezmo es un movimiento con `source:'tithe'` más una atribución privada; admite comprobante (`transactions.ts:115-156`). | titheProfiles, titheAttributions, pastoralFollowups | Funciona. |
| Ofrendas / Caja | Muestra la tarjeta SumUp del día y un efectivo que se ingresa a mano. Incluye sync manual, estado de las integraciones y configuración pública. | `cash_{area}_{fecha}`, sumupIntegrations, publicGivingSettings | **Parcial** (ver §6). |
| SumUp | Scheduler cada hora más botón manual. Importa solo transacciones POS/PAYMENT en CLP con estado SUCCESSFUL o REFUNDED, y registra el ingreso por "líquido". | ídem | Funciona, con los riesgos que documenta Atlas. |
| Campañas | Meta, cuotas, aportes manuales y públicos con comprobante y revisión. | fundraisingCampaigns, campaignContributions, campaignSubmissions, campaignPublicViews | Funciona como **libro paralelo: no genera financeTransactions** (`client.ts:260-335`). |
| Reportes | PDF por período, construido desde Σ movimientos y validado contra los resúmenes. | transactions, summaries | Funciona. No distingue origen ni comisión. |
| Configuración | Categorías (`*All` / `*Active`) y usuarios. | appSettings/finance, users | Solo admin. |
| /ofrendar | Muestra datos de transferencia y un link online opcional. | publicGivingSettings | Informativa. Las transferencias que llegan no se capturan. |
| Getnet | **Sin referencias en el código.** | — | No existe. |

### Hallazgos críticos AS-IS

| ID | Hallazgo | Evidencia |
|---|---|---|
| **F1** (bug) | **Un efectivo de caja anulado no se puede volver a registrar.** El id es determinístico (`cash_{area}_{fecha}`) y las reglas prohíben actualizar un documento anulado. | `cash.ts:11-16`, `transactions.ts:59-62`, `offerings-page.tsx:392-402`, `rules:113` |
| **F2** | Un movimiento SumUp que un usuario editó o anuló se revierte o "resucita" en el siguiente sync; queda con restos de `void*` y deja de ser editable. | `functions/index.js:234-240, 312-336` |
| **F3** | Un reembolso reescribe el día y el mes de la venta original, aunque ya estén informados o cerrados. | `functions/index.js:223-310` |
| **F4** | Si la comisión es mayor que el monto neto, se trunca a 0 y la pérdida desaparece. | `:198` |
| **F5** | "Conciliado" y "Histórico SumUp conciliado" son etiquetas falsas. | `offerings-page.tsx:633, 491` |
| **F6** | "Total del día" suma la tarjeta (supuestamente líquida) con el efectivo bruto. | `offerings-page.tsx:341-343` |
| **F7** | El dinero de campañas no está en el libro. `verifiedAmount` lo puede editar cualquier rol con acceso de detalle. | `rules:289-292, 446-453` |
| **F8** | Pastor y Finance pueden cambiar los **datos bancarios públicos** de /ofrendar sin auditoría (riesgo de fraude). | `rules:224-227` |
| **F9** | `source` solo admite `general\|tithe`. El origen SumUp solo se infiere por id o por `createdBy`. | `types.ts:26` |
| **F10** | `paymentMethod: card` no distingue SumUp de Getnet. "Cafetería" existe a la vez como categoría de ingreso y de egreso. | `types.ts:11` |

## 2. Actores y permisos

- **Roles reales:** `admin`, `pastor`, `finance`, `leader`, más `system:sumup`, el donante público y el scheduler.
- **Actores operativos que no existen en el sistema (HYP):** contador/a de ofrendas, cajero/a de Cafetería, tesorero/a que deposita.

**Matriz de permisos actual:**

| Acción | admin | pastor | finance | leader |
|---|---|---|---|---|
| Ver agregados | ✓ | ✓ | ✓ | ✓ |
| Ver, crear, **editar** y **anular** movimientos (incluidos SumUp y caja) | ✓ | ✓ | ✓ | – |
| Borrar movimientos | ✗ | ✗ | ✗ | ✗ |
| Registrar o editar el efectivo de caja | ✓ | ✓ | ✓ | – |
| Sync SumUp | ✓ | ✓ | ✓ | – |
| Categorías y usuarios | ✓ | – | – | – |
| Datos bancarios públicos | ✓ | ✓ | ✓ | – |
| Campañas y aprobaciones | ✓ | ✓ | ✓ | – |
| Cerrar caja / conciliar | no existe | | | |

**Permisos TO-BE (REC):**

- **cashier** (rol nuevo): abre y cierra **su** sesión de caja y registra movimientos de caja. No ve el libro general ni los diezmos.
- **finance:** movimientos manuales, confirmación de cierres (segundo firmante), depósitos, conciliación, cola de atención y propuesta de correcciones.
- **admin:** reabrir cajas, aprobar correcciones congeladas, categorías, usuarios, **datos bancarios públicos** y configuración de proveedores.
- **pastor:** lectura completa más pastoral. Si puede escribir, lo decide un humano (Q9).
- **leader:** solo agregados.
- **system:** es el único que escribe transacciones de proveedor. En la UI son de solo lectura.
- **Regla:** nadie confirma la diferencia de su propia caja.

## 3. Flujos de dinero

| Flujo | Hoy | Falta |
|---|---|---|
| MONEY IN | Ingresos manuales, diezmos, efectivo de caja, SumUp y aportes de campaña (estos últimos **fuera del libro**). | Transferencias con match, Getnet, pagos online. |
| MONEY OUT | Egresos manuales. | Comisiones como costo, egresos de caja, reembolsos como evento propio. |
| MONEY EXPECTED | **No existe.** | Payout esperado, efectivo esperado, depósito esperado. |
| MONEY DEPOSITED | **No existe.** | Payouts, depósitos de efectivo, abonos Getnet. |
| MONEY PENDING | Solo los envíos de campaña pendientes. | Payouts por recibir, efectivo en custodia, transacciones sin match. |
| MONEY WITH DIFFERENCE | **No existe.** | Diferencias de caja, de payout y de depósito. |

## 4. Entidades TO-BE mínimas

| Entidad | ¿Existe? | Decisión |
|---|---|---|
| Movimiento | `financeTransactions` | Se agregan `origin` (manual, cash_session, sumup, getnet, campaign, tithe), `area`, `provider`, `providerAccount`, `providerRef`, `cashSessionId`, `reversalOf`/`correctionOf`. **Invariantes:** nunca se borra; lo originado en proveedor no se edita desde la UI; los totales se derivan de los movimientos. |
| Transacción de proveedor | `sumupIntegrations/{acct}/transactions` | 1:1 con su Movimiento vía `providerRef`. Historial de estados (lo implementa el Slice 1 con `versions/`). |
| Área / Fuente | implícita en `category` | **Enum `area`**, no colección. |
| Método / canal | `paymentMethod` | Se agrega `provider`. |
| Cuenta de proveedor | `sumupIntegrations/{acct}` | Se agregan `area` fija y `bankAccountId`. |
| Cuenta bancaria | no | Configuración mínima: alias, banco, últimos 4 dígitos. Solo admin. |
| Caja | implícita | Enum fijo de 2 valores. |
| **Sesión de caja / Cierre** | no | **CREAR:** apertura, fondo inicial, esperado calculado, contado, diferencia, motivo, responsables, estado y versión. |
| **Payout** | no | **CREAR** en el slice de conciliación. |
| **Depósito** | no | **CREAR:** registro manual con evidencia. |
| Comisión | solo `feeAmount` en raw | Depende de la decisión G1. **No es una entidad.** |
| Reembolso | solo `refundedAmount` | TO-BE: evento o reversa fechada. |
| Conciliación | no | **No es tabla:** es un estado más vínculos. |
| Diferencia | no | Valor calculado y congelado. |
| Ajuste / Reversa | solo void | Movimiento con `reversalOf`/`correctionOf`. |
| **Evento de auditoría** | no | **CREAR:** append-only. |

**No crear todavía:** plan de cuentas y partida doble, entidades Caja, Conciliación y Comisión, presupuestos, fondos restringidos, multimoneda, Getnet (hasta Q5), pasarela online, cierre contable formal.

## 5. Decisión humana G1: ¿tarjeta en bruto o en líquido?

**FACT:** hoy la intención es registrar el LÍQUIDO (schema v2), pero la comisión nunca llega, así que **de hecho se registra el bruto menos los reembolsos**.

| Opción | Pros | Contras |
|---|---|---|
| A. Líquido | Simple. | Oculta cuánto dio la gente. La comisión no se ve. No cuadra con los reportes de SumUp. |
| **B. Bruto por transacción + comisión como egreso vinculado + reembolso como reversa en su propia fecha** | Máxima trazabilidad: se reconstruye bruto − reembolsos − comisiones = líquido. Cuadra con SumUp. | Más filas. Requiere migración (gate). La comisión puede conocerse tarde (payouts). |
| C. Bruto + comisión agregada por payout o por día | Menos filas. | La comisión queda desacoplada de la transacción. Depende de los payouts. |

**REC: B.** La comisión real viene del endpoint de payouts (Atlas).

## 6. Caja diaria (Phase 5)

**AS-IS:**

- No hay apertura, fondo, movimientos de caja, esperado, conteo separado, estado "cerrada" ni confirmador.
- El monto ingresado es a la vez conteo e ingreso, así que **la diferencia es indetectable**.
- Se puede editar en cualquier momento y sobrescribe lo anterior.
- Si se anula, bloquea el día (F1).
- El mínimo de fecha es 2026-09-09.

**TO-BE:**

```
ABIERTA → EN CIERRE → CERRADA·CUADRADA | CERRADA·CON DIFERENCIA → [REABIERTA v+1] → ENTREGADA/DEPOSITADA → CONCILIADA
```

**Reglas:**

1. Una sesión por caja × fecha × servicio.
2. Apertura con responsable, hora y fondo inicial. En Cafetería el fondo es obligatorio (puede ser 0).
3. Durante la operación se registran egresos de caja con motivo. La tarjeta SumUp se vincula por cuenta y rango horario, como dato informativo.
4. **Esperado calculado, nunca editable.** Cafetería: fondo + ventas en efectivo − egresos. Ofrendas: **doble conteo** independiente.
5. Cierre: contado (con desglose opcional por denominación), diferencia = contado − esperado, motivo obligatorio si está fuera de tolerancia, y registro de quién cerró, quién confirmó y cuándo.
6. Al cerrar se generan los movimientos de efectivo (`origin: cash_session`). La diferencia queda como un movimiento aparte ("Diferencia de caja"). **El esperado no se ajusta.**
7. Una caja cerrada es inmutable. Solo admin puede reabrir, con motivo. Eso crea una versión nueva y las correcciones se hacen como reversas.
8. La custodia (entregado a tesorería, depositado) se registra en pasos separados.

**Criterios de aceptación:**

- No se puede cerrar sin monto contado, ni sin motivo si hay diferencia fuera de tolerancia.
- El esperado no se puede editar ni desde la UI ni desde las reglas.
- Una caja cerrada solo cambia si admin la reabre, y la reapertura queda en auditoría.
- La vista de caja responde las 7 preguntas del cierre diario.
- Anular o reabrir nunca bloquea un nuevo registro (corrige F1).
- Tarjeta y efectivo aparecen en columnas separadas, cada una con su base explícita.

## 7. Correcciones (Phase 6)

**AS-IS:**

- Anular pide motivo y es irreversible.
- Editar usa `revision`, pero no guarda el valor anterior ni un motivo.
- No hay log de auditoría. El borrado está prohibido.
- En Campañas se edita sin motivo.
- En SumUp, las ediciones se sobrescriben en el siguiente sync.

**TO-BE: ORIGINAL → AJUSTE / REVERSA → ESTADO CORREGIDO**

- Un movimiento queda **congelado** si pertenece a una sesión cerrada, a un payout o depósito conciliado, a un período cerrado (más adelante) o si es de proveedor.
- Un movimiento congelado se corrige con:
  - reversa (`reversalOf`),
  - reemplazo (`correctionOf`),
  - o reclasificación (reversa + reemplazo), que es el único camino para mover SumUp de área.
- Un movimiento manual no congelado se puede editar, con motivo y evento de auditoría antes→después.
- El motivo es obligatorio siempre. La evidencia es obligatoria por sobre un umbral (Q8).
- **Fecha de la reversa:** si el período original está cerrado, la reversa lleva la fecha de la corrección; si está abierto, la fecha original (Q8).
- **Quién corrige:** finance, lo no congelado; admin, lo congelado y las reaperturas. **Nadie aprueba su propia corrección.**
- **Nunca se borran:** movimientos, transacciones de proveedor, sesiones y sus versiones, eventos de auditoría ni comprobantes.
- **Evento de auditoría:** `actor, action, entityType, entityId, before, after, reason, evidenceRef, relatedIds, timestamp, source`.

## 8. Estados de conciliación

Se aplican a tres cruces: transacción de proveedor ↔ payout, payout ↔ depósito, y sesión de caja ↔ depósito.

| Estado | Entra cuando | Sale cuando |
|---|---|---|
| **Pendiente** | Existe un esperado y todavía no hay contraparte. | Se vincula una contraparte, o hay una anomalía. Si se vence la ventana, se agrega la marca **Atrasado** (no es un estado aparte) y entra a la cola de atención. |
| **Parcial** | Las contrapartes suman menos que el esperado y la ventana sigue abierta. | Se completa (→ Conciliado) o se cierra la ventana (→ Con diferencia). |
| **Conciliado** | Hay contraparte completa y la diferencia \|dif\| ≤ tolerancia. Queda registrado quién conciló y cuándo. | Solo si cambia un insumo (reembolso o contracargo posterior) → Requiere revisión. |
| **Con diferencia** | Completo o vencido, con \|dif\| > tolerancia y sin explicación. | Se explica con un ajuste (→ Conciliado con ajuste) o hay un error de datos (→ Requiere revisión). |
| **Conciliado con ajuste** (nuevo) | La diferencia se aceptó con un ajuste vinculado, motivo y aprobador. | Igual que Conciliado. |
| **Requiere revisión** | Hay una anomalía: duplicado, error de sync, cambio del proveedor después de conciliar, o datos faltantes. | Una persona la resuelve y el estado se recalcula. |

**Tolerancia (Q7):** 0 CLP en payouts y depósitos (HYP); configurable para efectivo.

## 9. Attention Queue (agrupada por la acción que requiere)

| Acción | Tipos | Responsable |
|---|---|---|
| Reintentar o arreglar la integración | Error de sync, cuenta sin configurar, sync atrasado, proveedor caído o credencial vencida | admin |
| Decidir si es duplicado | Manual vs proveedor; campaña vs manual | finance |
| Vincular | Transacción sin payout; depósito sin origen; transferencia de /ofrendar | finance |
| Explicar diferencia | Diferencia de payout, de caja o depósito parcial | finance (admin sobre el umbral) |
| Registrar devolución | Reembolso o contracargo, sobre todo después de un cierre | finance |
| Depositar | Efectivo cerrado que no se ha depositado | tesorería |
| Cerrar | Sesión de caja abierta fuera de plazo | cashier / finance |
| Aprobar | Aportes de campaña; correcciones de movimientos congelados | finance / admin |

## 10. Criterios de aceptación por slice

- **S1 SumUp reliability:**
  - Sin duplicados.
  - Suma del día = suma de los raw del día.
  - Las transacciones de proveedor no se pueden editar.
  - Los reembolsos no alteran cierres anteriores.
  - Una comisión mayor que el neto va a la cola de atención.
  - Los ignorados quedan registrados con su motivo.
  - Desaparecen las etiquetas "Conciliado" falsas.
- **S2 Ledger:**
  - `origin` y `area` en todos los movimientos.
  - Resumen = Σ movimientos (test de reconstrucción).
  - Auditoría antes→después.
  - Se aplica la decisión G1.
  - Se decide qué hacer con Campañas.
- **S3 Payout reconciliation:**
  - Cada payout lista sus transacciones.
  - Líquido esperado = Σ(bruto − reembolsos − comisiones).
  - Estados según §8.
  - Drill-down payout → transacción → movimiento.
- **S4 Caja:** todo lo de §6, incluido el fix de F1.
- **S5 Correcciones:**
  - Todo lo de §7.
  - Las reglas impiden sobrescribir registros congelados.
  - Historial visible.
  - Datos bancarios públicos: solo admin, con auditoría (F8).

## 11. Preguntas abiertas (prioridad)

1. **G1:** ¿bruto con comisión separada (REC: B) o líquido? ¿Por qué se migró a líquido (schema v2)?
2. ¿Quién cuenta la ofrenda y cuántas personas? ¿Hay doble firma? ¿El conteo es por servicio o por día?
3. **Efectivo:** ¿se deposita? ¿En qué cuenta, cada cuánto y quién lo hace? ¿Hay custodia intermedia?
4. ¿A qué cuenta bancaria llega cada SumUp? ¿Con qué cadencia paga SumUp?
5. **Getnet:** ¿se usa? ¿Para qué área? ¿Hay contrato o API? ¿A qué cuenta abona?
6. **Campañas:** ¿entran al libro general o son un fondo separado?
7. **Tolerancias** de diferencia.
8. **Correcciones:** umbral para exigir evidencia o segundo aprobador. ¿Existe "mes cerrado"?
9. **Pastor:** ¿escribe o solo lee? ¿Se crea el rol "cajero"?
10. **Cafetería:** ¿paga insumos con efectivo de caja? ¿Tiene fondo inicial (sencillo)?

**Seguro de implementar sin decisión humana:** el fix de F1 y el retiro de las etiquetas "Conciliado" falsas.
