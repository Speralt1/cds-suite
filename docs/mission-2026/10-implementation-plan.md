# Phase 11–12: arquitectura final y plan de implementación

## 1. Arquitectura objetivo (Atlas, Phase 11)

Firebase sigue siendo válido. No se agrega infraestructura nueva.

```
Adaptador por proveedor/cuenta ─► Raw store (evidencia + versions + adjustments)
      (watermark, cursor, lease,          │
       presupuesto, clasificación de      ▼
       errores)                         Proyector de libro (puro, idempotente)
                                          │   financeTransactions + summary (documento completo)
Ingesta de payouts (diaria) ─► sumupPayouts
                                          ▼
                                   Conciliador (estados de 01 §8) ◄── Depósitos (manual o cartola)
                                          │
Observabilidad: sumupSyncRuns + alertas ·  Verificador diario de solo lectura (Σ mov vs summaries)
Auditoría: auditEvents (append-only) · Roles mínimos (cashier/finance/admin)
```

**Invariantes:**

1. `SALDO = Σ MOVIMIENTOS`.
2. Todo sync puede repetirse sin efecto adicional (idempotencia por id del proveedor).
3. Las cuentas nunca se mezclan.
4. Lo que viene del proveedor es de solo lectura para las personas.
5. Nada se borra.
6. El monto esperado nunca es editable.
7. Toda corrección deja evidencia.

## 2. Vertical slices (ordenados según el baseline, no según la lista original)

| # | Slice | Estado | Depende de |
|---|---|---|---|
| **1** | **SumUp reliability**: engine con watermark, paginación, lease, runs, aislamiento, presupuesto, versions, guardas | **HECHO en la branch** `mission/slice1-sumup-reliability`. Atlas: APROBADO PARA PR. 110 tests | Deploy (gate) |
| **1b** | **Etiquetas veraces + F1**: "bruto" en vez de "líquido", fuera "Conciliado" falso, SumUp solo lectura en la UI, selector de años, caja anulada re-registrable | **HECHO en la branch** `mission/slice1b-truthful-labels`. 123 tests | Deploy (gate) |
| 2 | **Ledger**: `origin/area/provider/providerRef` en movimientos, `auditEvents` antes→después, datos bancarios públicos solo admin (F8), verificador diario Σ | Siguiente; **G3 ya cerrado en reglas** | Migración de backfill de `origin` (gate) |
| 3 | **Payouts + comisión real**: ingesta `/v1.0/payouts`, `sumupPayouts`, vínculo por `transaction_code`, bruto/comisión/líquido reales | Bloqueado | **G9** (primera llamada real). **G1 cerrado:** bruto menos reembolsos + comisión como egreso vinculado |
| 4 | **Caja diaria**: `cashSessions` con apertura, esperado, conteo (doble en Ofrendas), cierre con diferencia, reapertura v+1, depósito | Bloqueado parcialmente | Q2, Q3, Q7, Q10 (Navigator) |
| 5 | **UX foundation + Preview 2026**: tokens, StatusBadge, MoneyAmount, DataTable, Sheet; `/preview/finanzas-2026` con mocks | Puede empezar ya: no toca datos | Revisión del Design Lock |
| 6 | **Ofrendas / Cafetería** como dominios propios; Conciliation Center; Attention Queue | Después de 3 y 4 | 3, 4, 5 |
| 7 | **Getnet**: registro manual con `provider:getnet`, luego import de CSV | Bloqueado | Info de Getnet (03 §2) |
| 8 | Reportes (bruto/comisión/líquido, por origen), exportes, pulido | Final | 2–6 |

## 3. Test matrix (estado)

| Caso | Cobertura |
|---|---|
| SYNC DUPLICATE: dos syncs → una transacción | ✅ `sumup-engine.test.ts` "duplicado" |
| UNKNOWN RESULT: un timeout no duplica | ✅ "unknown result/timeout" + M5 |
| REFUND: total y parcial | ✅ `sumup-core`/`engine` |
| COMMISSION: neto correcto | ⚠️ Solo "desconocida → no se resta". El neto real llega en el Slice 3 |
| TWO SUMUP ACCOUNTS nunca se mezclan; mismo merchant → config_error | ✅ |
| PAYOUT: transacciones asociadas | ⏳ Slice 3 |
| CASH CLOSE: esperado vs contado | ⏳ Slice 4. F1 ✅ `cash.test.ts` |
| CORRECTION: historia preservada | ✅ parcial: el sync no pisa ediciones humanas y hay versions. Auditoría completa en el Slice 2 |
| PERMISSIONS: sin permiso no corrige | ✅ UI + Firestore Rules: `sumup_*` es solo lectura para clientes (G3 cerrado) |
| SCHEDULER + MANUAL simultáneos | ✅ lease |
| Cambio de mes | ✅ |
| Resumen con documento completo (9 campos) en mes vacío | ✅ B1 |

## 4. Checklist de deploy del Slice 1 + 1b (gate humano)

1. `npm run test:rules` en la Mac (el emulador no descarga en el sandbox).
2. `npm ci && npm run lint && npm run typecheck && npx vitest run`.
3. `npm run build`.
4. **Consulta de solo lectura previa:** ¿algún `sumupIntegrations/*/transactions/*` tiene `feeAmount > 0`? Se espera 0. Si hay alguno, detenerse.
5. Crear una **alerta de Cloud Monitoring** sobre errores de `sumupsyncscheduled`. El 10/09 falló 21 h sin que nadie se enterara.
6. Deploy: `firebase deploy --only functions,firestore:rules,hosting --project cds-administracion` (requiere autorización).
7. **Validación post-deploy:**
   - Sync manual desde la app: respuesta en menos de 30 s, en JSON y con estado por cuenta.
   - Primer run: muchos `rawRefreshed` y **0 `updated` sin causa**.
   - Segundo run: `unchanged == fetched` (menos los ignorados).
   - Totales de septiembre sin cambio: Ingresos $6.717.397, Ofrendas $625.500, Cafetería $2.362.700.
   - Reporte anual 2026 sin error de "sincronizando".
8. **1 de octubre:** el resumen `2026-10` tiene 9 campos y un gasto manual en octubre funciona.
9. **Rollback:** redeploy del commit `648afd1`. Los datos nuevos (`sumupSyncRuns`, `versions`, `adjustments`, campos extra en raw e integración) son aditivos y el código anterior los ignora.

## 5. Checkpoints

| Checkpoint | Estado |
|---|---|
| BASELINE VERIFIED | ✅ |
| FINANCIAL MODEL COMPLETE | ✅ (AS-IS + TO-BE; decisiones humanas pendientes) |
| SUMUP AUDIT COMPLETE | ✅ |
| SUMUP RELIABILITY IMPLEMENTED | ✅ en branch; sin deploy |
| RECONCILIATION MODEL COMPLETE | ✅ modelo; datos reales bloqueados por G9 |
| FINANCIAL TRUTH VERIFIED | ◐ parcial: interno ✅, proveedor pendiente de login en SumUp |
| UX AUDIT COMPLETE | ✅ |
| DESIGN RESEARCH COMPLETE | ✅ (evidencia visual limitada) |
| DESIGN LOCK COMPLETE | ◐ borrador, pendiente de revisión |
| FINANCIAL PREVIEW READY | ⏳ Slice 5 |
| GETNET DECISION READY | ✅ (recomendación; faltan datos del negocio) |
| PRODUCTION READY | ⛔ gate humano |
