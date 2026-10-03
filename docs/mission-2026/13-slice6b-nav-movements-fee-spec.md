# Slice 6b: subnav compacto, Movimientos agrupado y comisión SumUp visible (spec de Designer)

Origen: revisión del preview por Salvador (2026-09-25).
Atlas confirmó que los reembolsos totales de SumUp quedan `status: "voided"`, anulados por `system:sumup`.

## 1. Subnav de Finanzas como barra de pestañas compacta

**Diagnóstico.** `.finance-nav` está definido 4 veces en `app/globals.css` (líneas ~101–125, ~966–971, ~1451–1453 y ~1639–1642), con grids de 4, 2 y 5 columnas que se pisan entre sí. Por eso aparecen 5 pestañas arriba y "Reportes" solo abajo. Hay que **borrar las 4 definiciones y dejar una sola**.

**Diseño.** Pestañas con subrayado, estilo GitHub/Primer UnderlineNav:
- Una sola fila, sin tarjeta y con borde inferior de 1 px `--color-line`.
- Pestaña activa: subrayado de 2 px y texto en `--color-primary`.
- Pestañas inactivas: texto muted, sin fondo.
- Alto: 40 px en desktop y 44 px en móvil.
- En móvil las pestañas no se parten en varias filas: `overflow-x: auto`, sin scrollbar visible y con un fade de 24 px a la derecha.

```css
.finance-nav { position: sticky; top: var(--finance-nav-top, 0px); z-index: 20; display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; border-bottom: 1px solid var(--color-line); background: var(--color-canvas); }
.finance-nav::-webkit-scrollbar { display: none; }
.finance-nav a { flex: 0 0 auto; display: inline-flex; align-items: center; height: 40px; padding: 0 12px; margin-bottom: -1px; border-bottom: 2px solid transparent; color: var(--color-muted); font-size: 14px; font-weight: 500; white-space: nowrap; }
.finance-nav a:hover { color: var(--color-ink); }
.finance-nav a[aria-current="page"] { color: var(--color-primary); border-bottom-color: var(--color-primary); }
.finance-nav a:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; border-radius: 4px; }
@media (max-width: 640px) { .finance-nav { padding-right: 24px; mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent); } .finance-nav a { height: 44px; padding: 0 14px; } }
```

**Comportamiento y ajustes:**
- **Sticky:** es opcional. Si choca con el header del shell o con modales, se usa `position: static`.
- **Contraste:** revisar que el texto muted sobre canvas llegue a ≥ 4,5:1. Si no llega, usar un tono más oscuro.
- **`FinanceNav` (`components/finance/shared.tsx`):** mantiene rutas, labels, orden y `aria-current`. Se agrega `useRef` y un `useEffect([path])` que llama a `activeLink?.scrollIntoView?.({ inline: "nearest", block: "nearest" })`.
- **Rol sin permiso de detalle:** ve la barra solo con "Resumen".

**Jerarquía de títulos:**

| Elemento | Antes | Después |
|---|---|---|
| h1 "Finanzas" (`finanzas/layout.tsx`) | — | `mb-3 text-xl font-semibold` |
| Contenedor de children | `mt-7` | `mt-6` |
| `.finance-page-title h2` | — | 18 px, peso 600, `letter-spacing: -0.01em` |
| `.finance-page-title p` | — | `margin-top: 4px`; oculto en ≤ 640 px |

**Criterios de aceptación:**
1. A 1280 px las 6 pestañas caben en una fila de ~40 px.
2. Queda una sola definición de `.finance-nav` en `globals.css`.
3. La pestaña activa tiene `aria-current`, subrayado y color primary; las inactivas no tienen fondo.
4. Se ve el borde inferior que separa la barra del contenido.
5. A 360 y 390 px la barra se mantiene en una fila, con scroll horizontal, sin scrollbar visible y con pestañas de 44 px.
6. Al entrar directo a `/finanzas/reportes` en móvil, la pestaña activa queda visible y la página no salta verticalmente.
7. Con teclado se ve el anillo de foco; con mouse no.
8. h2 a 18 px, peso 600; h1 a 20 px, peso 600. En móvil el subtítulo está oculto.
9. Los tests de `FinanceNav` siguen pasando. Test nuevo: un rol sin permiso de detalle ve solo "Resumen".
10. A 360 px la página no tiene scroll horizontal.

## 2. Movimientos: SumUp agrupado por día y categoría

**Qué se agrupa y cómo:**
- Solo las transacciones con `isSumUpTransaction(t.id, t.createdBy)`.
- Clave de grupo: `sumup|${status}|${type}|${period}|${day}|${category || "Sin categoría"}`.
- Todo lo que no es SumUp sigue como fila individual.
- Los SumUp `voided` forman un grupo aparte, rotulado **"Anulados o reembolsados en SumUp"**.

**Helper puro nuevo `lib/finance/movement-groups.ts`:**
- `MovementEntry = {kind:"single", key, transaction} | {kind:"sumup-group", key, status, type, period, day, date, category, items, count, amount, label}`.
- `sumUpGroupLabel(t)`:
  - activo: `SumUp · ${category}`
  - anulado: `SumUp · ${category} · Anulados o reembolsados en SumUp`
- `matchesMovementSearch(t, q)`:
  - `q` vacío coincide con todo.
  - Compara en minúsculas (`toLocaleLowerCase("es")`) contra la descripción. Si la transacción es SumUp, también contra `${label} ${dateLabel(t.date)}`.
- `groupMovements(items)`:
  - Ordena por fecha descendente.
  - Dentro del mismo día: primero los grupos activos (Ofrendas, Cafetería, histórico y luego el resto en orden alfabético), después los grupos anulados y al final las filas individuales por `createdAt` descendente.
  - Es determinista. Invariante: Σ montos de las entradas = Σ montos de los ítems.

**Pipeline en `movements-page.tsx`:**
1. Filtrar por transacción con los filtros actuales. `matchesMovementSearch` reemplaza al `description.includes`.
2. `entries = groupMovements(items)`.
3. Paginar sobre `entries`, donde un grupo cuenta como una fila.
4. Pie: `Mostrando {x} de {entries.length} filas · {items.length} registros del período ({sumUpCount} pagos SumUp agrupados)`.
5. Subtítulo: `Entradas y salidas del período. Los pagos SumUp se agrupan por día.`

**Componente `SumUpGroupRow`:**
- Usa el mismo grid `.transaction-row` con el modificador `.is-group`. Contenido por columna:
  1. `TypeIcon` + label; debajo `${fecha} · Entrada`.
  2. `N pagos con tarjeta` (o `1 pago`); debajo `Tarjeta · SumUp`.
  3. Monto con `clp`, tabular y en semibold. Debajo, la pill `Bruto` si el grupo está activo, o `Anulado` si es un grupo anulado (con `.is-voided`).
  4. Pill `🔒 SumUp · solo lectura` (solo en grupos activos) y el botón toggle.
- **Toggle:**
  - Es un `<button type="button">` con `aria-expanded` y `aria-controls` (id generado con `useId`).
  - `ChevronDown` rota 180° en 150 ms.
  - Texto: `Ver N pagos` / `Ocultar N pagos`.
  - Arranca cerrado y mide ≥ 44 px en móvil.
- **Detalle expandido:** `<div className="transaction-group-detail">` con los pagos individuales, todos con "Ver" y su modal de detalle, sin opción de editar ni anular. Estilo: `margin: 0 0 8px 20px; padding-left: 12px; border-left: 2px solid var(--color-line)`.

**Refactor de `transaction-list.tsx`:**
- Extraer `TransactionRow` y `TransactionTable` para que el encabezado se dibuje una sola vez y `MovementsPage` pueda mezclar filas individuales y grupos.
- La API pública `TransactionList({items, onSaved, actions})` no cambia, porque la usan el Resumen y otras pantallas.
- Reemplazar el `isSumUpImported` duplicado por `isSumUpTransaction`.

**Fuera de alcance:** Firestore, queries, `useTransactions`, `voidTransaction`, `TransactionForm`, exportaciones y reportes (que siguen por transacción), y "Últimos movimientos" del Resumen (queda para después).

**Criterios de aceptación:**
1. `tests/movement-groups.test.ts` cubre:
   - 31 pagos de Cafetería del mismo día → 1 grupo, `count` 31, monto exacto;
   - Ofrendas y Cafetería el mismo día → 2 grupos;
   - días distintos → grupos distintos;
   - anulados en un grupo aparte;
   - manuales y diezmos como `single`;
   - orden intra-día correcto;
   - invariante de suma;
   - resultado determinista.
2. Tests de `matchesMovementSearch`.
3. Como máximo 1 fila de SumUp por día × categoría × estado.
4. Con Método = Efectivo no aparecen grupos SumUp. Con Categoría = Cafetería solo aparece Cafetería.
5. Al expandir un grupo se ven todos sus pagos con "Ver"; nada se puede editar.
6. El toggle cumple la accesibilidad pedida y funciona con teclado.
7. Los grupos anulados muestran el texto y la pill.
8. Los estados se comunican con texto e ícono, no solo con color.
9. Las demás pantallas que usan `TransactionList` no cambian.

## 3. Comisión SumUp visible, sin montos inventados

**Cuándo se muestra:** solo si el período tiene SumUp activo (`incomeByMethod(...).sumUp > 0`).

**Resumen, bloque "Gastos y resultado"** (`summary-page.tsx`). Entre "Gastos" y "Resultado" va:

```
Comisión SumUp        ⏱ Pendiente de datos de SumUp
```

- El valor lleva el ícono `Clock` en color `--color-warning` y texto muted de 13 px. **No lleva monto** (ni "$0" ni "—").
- Debajo, como `field-help`: `La comisión se registrará como gasto cuando se conecten los payouts de SumUp. El resultado aún no la descuenta.`
- `expenseTotal` y `result` no cambian.

**Reporte:**
- `FinanceReport.sumUpFee: {status:"none"} | {status:"pending"} | {status:"estimated", ratePercent, estimatedAmount} | {status:"recorded", amount}`. En este slice solo se implementan `pending` y `none`.
- La misma línea se agrega en "Por fuente", tanto en la vista mensual como en la anual.
- En el PDF: `Comisión SumUp: pendiente de datos de SumUp (no descontada del resultado).`
- La alerta A4 se mantiene.

**Preparado, sin implementar:** si Salvador entrega la tarifa, la línea mostraría `≈ $X estimado (tarifa Y %) — no registrado`, sin sumarse a Gastos ni crear movimientos.

**Criterios de aceptación:**
1. Con SumUp en el período, la línea y el texto de ayuda aparecen.
2. Sin SumUp, la línea no aparece.
3. Gastos y Resultado no cambian (con test).
4. El reporte y el PDF muestran la línea, y el test cubre `sumUpFee` en sus estados `pending` y `none`.
5. No se escribe nada en Firestore.
6. Se entiende sin depender del color.
