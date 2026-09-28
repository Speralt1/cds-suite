# Phase 7: Financial Truth Check (reconciliation report)

Fecha: 2026-09-22. Solo lectura. No se modificó ningún dato de producción.
Fuentes:
- App en producción con sesión admin (Resumen, Ofrendas, Reportes).
- Consola de Cloud Run y Logging.
- Documentación de SumUp.

El dashboard de SumUp **no está disponible**: requiere iniciar sesión en las dos cuentas (es un gate humano).

## 1. Consistencia interna: libro ↔ resúmenes

`buildReport` (`lib/finance/reports.ts:62-81`) reconstruye los totales a partir de Σ movimientos activos y **lanza un error si no coinciden** con `financeMonthlySummaries` (ingresos, egresos, resultado, diezmos y conteo). Ambos reportes se generaron sin error.

| Período | Ingresos | Egresos | Diezmos | Movimientos activos | Anulados | ¿Σ mov = resumen? |
|---|---|---|---|---|---|---|
| Septiembre 2026 | $6.717.397 | $0 | $2.926.397 | 588 | 0 | **Sí** |
| Año 2026 | $33.645.065 | $50.000 | $3.126.397 | 6.185 | 0 | **Sí** |

**Composición de septiembre 2026:**

| Categoría | Monto |
|---|---|
| Diezmos | $2.926.397 |
| Cafetería | $2.362.700 |
| SumUp histórico sin separar | $802.800 |
| Ofrendas | $625.500 |
| **Total** | **$6.717.397** ✓ |

La suma de la composición cuadra con el total.

**Cruce con la pantalla de Ofrendas (septiembre):**

| Área | Tarjeta | Efectivo | Total | Coincide con |
|---|---|---|---|---|
| Ofrendas | $165.500 | $460.000 | $625.500 | Resumen ✓ |
| Cafetería | $1.922.700 | $440.000 | $2.362.700 | Resumen ✓ |

**Tarjeta "Recaudación SumUp" de septiembre ($2.891.000, 544 movimientos):**
$1.922.700 + $165.500 + $802.800 = $2.891.000 ✓

**Conclusión:** a nivel de totales, la app es **internamente consistente**. No hay deriva entre el libro y los resúmenes en 2026.

**No verificado:** los mapas `dailyIncome` e `incomeByCategory` a nivel de día. Con 0 anulados en 2026, el bug de merge anidado (M1) no debería haberse activado. Aun así, conviene correr la verificación de solo lectura propuesta por Atlas.

## 2. ¿El "líquido" SumUp es líquido?

Las 34 transacciones de Ofrendas en septiembre suman exactamente **$165.500**, que es la cifra que la app llama "Tarjeta líquida".

| Día | Montos | Subtotal |
|---|---|---|
| 09-09 | 5.500 + 20.000 + 2.000 + 1.000 + 5.000 + 3.000 + 2.000 | 38.500 |
| 13-09 | 15 transacciones | 78.000 |
| 16-09 | 5 transacciones | 19.000 |
| 20-09 | 7 transacciones | 30.000 |

Todos los montos son **redondos** ($1.000, $5.000, $10.000…). Una comisión real produciría montos como $9.7xx. **La app registra el BRUTO, no el líquido.**

- **R1 CONFIRMADO con datos:** la comisión de SumUp no se descuenta ni se registra en ningún lado.
- **Efecto:** Ofrendas y Cafetería por tarjeta están **sobrestimadas respecto de lo que llega al banco**, en el monto de la comisión SumUp de Chile. Esa comisión no se conoce hoy; se obtiene del endpoint de payouts (gate G9).
- Es correcto registrar el bruto como ingreso. Lo que es incorrecto es la etiqueta "líquido" y que no exista una línea de comisión.

## 3. Proveedor ↔ app (pendiente de acceso)

| Chequeo | Estado |
|---|---|
| Total de SumUp Ofrendas en septiembre (dashboard) vs $165.500 en la app | **PENDIENTE**: requiere login en SumUp Ofrendas |
| Total de SumUp Cafetería en septiembre vs $1.922.700 | **PENDIENTE**: requiere login en SumUp Cafetería |
| Reembolsos de septiembre en SumUp vs 0 anulados en la app | **PENDIENTE** |
| Payouts de septiembre (monto y comisión) vs líquido esperado | **PENDIENTE**: gate G9 (API de payouts) o el reporte "Payouts" del dashboard |
| Depósitos en el banco vs payouts | **PENDIENTE**: cartola bancaria (gate) |
| Día 1–8 de septiembre ($802.800 histórico) vs SumUp Ofrendas | **PENDIENTE** |

**Procedimiento cuando haya acceso** (solo lectura, unos 10 minutos por cuenta):

1. En me.sumup.com, ir a Informes y exportar Transacciones del 01/09 al 30/09 en CSV.
2. Sumar las transacciones SUCCESSFUL, sumar los reembolsos y contar las transacciones, separando antes y después del 09/09.
3. En Informes → Payouts del mismo período, anotar el monto neto y la comisión de cada payout.
4. Comparar con la app: Ofrendas de 09/09 a 30/09 contra $165.500; Cafetería contra $1.922.700; anterior al 09/09 contra $802.800.
5. Cualquier diferencia se registra aquí, con su causa. **No se corrige nada en la app.**

## 4. Discrepancias y causas conocidas

| # | Discrepancia | Causa | Impacto |
|---|---|---|---|
| D1 | "Líquido" = bruto | La comisión no viene en `/transactions/history` (R1) | La tarjeta se sobrestima en ~la comisión SumUp respecto del banco |
| D2 | Posibles reembolsos tardíos no aplicados | Sync de 1 página y 45 días (R2) | Desconocido. Se verifica en el paso 3.3. Lo corrige el Slice 1 (barrido diario) |
| D3 | Sync programado caído ~21 h (10 al 11 de septiembre) | Bug `net is not defined` | Se recuperó por ventana deslizante. Posibles pérdidas si hubo más de 100 transacciones en la ventana. Hay que verificar el 13/09 (15 transacciones de Ofrendas) contra SumUp |
| D4 | La ejecución del 16/09 01:04 se abortó entera | SumUp 500 y ausencia de aislamiento (R7) | Se recuperó la hora siguiente |
| D5 | Efectivo sin esperado | El modelo de caja no lo tiene | No se puede detectar ninguna diferencia de efectivo |
| D6 | Campañas fuera del libro | Diseño actual (F7) | "¿Cuánto entró?" no incluye campañas |

**Checkpoint FINANCIAL TRUTH VERIFIED:** **PARCIAL**. La consistencia interna está verificada. Proveedor, payouts y banco quedan pendientes del acceso humano.
