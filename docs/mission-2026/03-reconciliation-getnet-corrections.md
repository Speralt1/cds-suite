# Phases 3, 4 y 6: modelo de conciliación, decisión Getnet y correcciones

Consolidado por el coordinador a partir de Atlas (02) y Navigator (01).

## 1. Modelo de conciliación de payouts (Phase 3)

```
TRANSACCIÓN SumUp (raw)  ──►  PAYOUT SumUp  ──►  DEPÓSITO bancario
bruto, reembolso               amount, fee,        monto, fecha,
(fee: desconocido hoy)         date, reference,    comprobante/cartola
                               transaction_code
```

**Fórmula por payout:** `Σ bruto − Σ reembolsos − Σ contracargos − Σ comisión = LÍQUIDO ESPERADO`. Ese líquido se compara contra `payout.amount` y luego contra el depósito.

**Datos que SumUp entrega de verdad** (según docs; ver 02 §2):

| Dato | Endpoint | ¿Se usa hoy? |
|---|---|---|
| Bruto y reembolso por transacción | `/v2.1/.../transactions/history` | Sí |
| Comisión por transacción | Detalle `/transactions?id=` o **payouts `fee`** | **No** |
| Payout (id, monto, comisión, fecha, estado, referencia, transaction_code, tipo PAYOUT / REFUND_DEDUCTION / CHARGE_BACK_DEDUCTION…) | `/v1.0/merchants/{mc}/payouts?start_date&end_date` | **No** |
| Depósito bancario | Ninguno (no sale de SumUp) | Requiere cartola o registro manual |

Validaciones **NO CONFIRMADAS** que exigen una llamada real de solo lectura (gate G9):
- si `payout.amount` es neto;
- si hay una fila por transacción;
- qué agrupa `reference`;
- si la API key tiene el scope de payouts.

**Entidad Payout propuesta (Slice 3):**
- Colección: `sumupPayouts/{account}_{payoutId}`, con idempotencia por `id`.
- Ingesta diaria por cuenta, ventana `[hoy−35, hoy]`.
- Se vincula con transacciones vía `transaction_code`.
- Estado de conciliación según 01 §8.

**Estados:** Pendiente (+ marca Atrasado) · Parcial · Conciliado · Con diferencia · Conciliado con ajuste · Requiere revisión. Definición exacta en 01 §8. Tolerancia: 0 CLP para payouts y depósitos (a confirmar, Q7).

**Unidad de conciliación en la UI:**
- tarjeta: el **payout**;
- efectivo: la **sesión de caja**.

## 2. Decisión de integración Getnet (Phase 4)

| Aspecto | Hallazgo |
|---|---|
| Estado actual | **No integrado.** No hay ninguna referencia en código, rules, functions, docs ni tests. `paymentMethod: card` no distingue proveedor. |
| ¿Solo POS físico? | Probable (HYP). Hay que confirmar si existe un POS Getnet en uso, para qué área y con qué contrato. |
| API | Getnet Chile (Santander) ofrece APIs de e-commerce y portal de comercio con reportes de ventas, abonos y cartola. **No se verificó** que exista una API pública de consulta de transacciones POS para comercios pequeños. La vía realista es la **exportación desde el portal de comercio** (CSV/Excel). |
| Credenciales | Ninguna en el proyecto. |
| Cierres, comisiones, depósitos | Normalmente aparecen en el portal: liquidaciones y abonos con comisión e IVA. **NO CONFIRMADO** para esta cuenta. |

| Opción | Esfuerzo | Beneficio | Riesgos |
|---|---|---|---|
| **A. Registro manual como método `card` + `provider:getnet`** (tras el Slice 2 `origin/provider`) | Bajo | Separa Getnet de SumUp de inmediato | Depende de la digitación y no hay comisión |
| **B. Importación de CSV del portal** (liquidaciones + transacciones), idempotente por id de operación | Medio | Conciliación real de abonos y comisiones sin API | El formato del archivo puede cambiar; requiere un paso humano periódico |
| C. Integración por API | Alto / desconocido | Automático | Puede no existir para POS; contrato y credenciales; costo |

**Decisión recomendada:** A ahora (en cuanto exista `provider`), B como Slice 7 cuando se tenga un archivo real de ejemplo, y C solo si Getnet confirma una API.

**Qué necesita un humano para desbloquear:**
1. ¿Se usa Getnet? ¿En qué área?
2. Un export de ejemplo de un mes: ventas y abonos.
3. La cuenta bancaria de destino.

**No se construye nada de Getnet ahora.**

## 3. Modelo de auditoría y correcciones (Phase 6)

Detalle en 01 §7. Resumen de invariantes:

1. **Nada se borra.** El borrado físico ya está prohibido por las reglas y así se mantiene.
2. Lo que viene de un **proveedor es de solo lectura** para humanos. Una corrección se hace con un movimiento vinculado (reversa, reemplazo o reclasificación), nunca editando el original. Esto requiere cambiar las reglas: **gate G3**.
3. Un movimiento manual no congelado se puede editar, pero con **motivo obligatorio** y un evento `auditEvents/{id}` que guarda antes → después.
4. Lo congelado (caja cerrada, conciliado, período cerrado) solo cambia con una reversa aprobada por admin, y **nadie aprueba su propia corrección**.
5. Todo evento guarda: `actor, action, entityType, entityId, before, after, reason, evidenceRef, relatedIds, timestamp, source`. Los escribe una Function o una regla con `getAfter`, y los clientes no los pueden modificar.
6. Los datos bancarios públicos (/ofrendar) pasan a ser solo de admin y auditados (F8).

**Ya implementado en el Slice 1 (subconjunto seguro):**
- el sync no sobrescribe ediciones ni anulaciones humanas (queda en `review`);
- versiones de cada cambio del proveedor en `sumupIntegrations/{a}/transactions/{id}/versions`;
- contracargos en `adjustments/` con `reviewRequired`.
