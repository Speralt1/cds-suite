# 28b · Implementación B2: Resumen y calendario de caja

**Rama:** `feature/finance-summary-calendar-v1` (desde `18925d6`). **Base de diseño:** Design Lock 28 (§B tokens, §C1 Resumen, §C2 calendario) y las decisiones del Tech Lead.

Solo presentación: ninguna cifra nueva. Todo sale de `useSummaries`, `useTransactions` y de los selectores existentes de `lib/finance/insights.ts`. Los permisos no cambian.

## Qué cambió

**Resumen (`components/finance/dashboard/summary-page.tsx`)**
- El orden de la página es: encabezado, acciones, `BalanceBand`, `FundsPosition` (slot), calendario de caja con su panel, tablas de ingresos, gráficos y "Últimos movimientos · N en el período".
- Los 5 KPIs (`Kpis`) dejan de usarse en el Resumen. `kpis.tsx` se conserva porque Reportes lo sigue usando.
- Se elimina el bloque "Gastos y resultado". Su nota y la advertencia de gastos en cero pasan a la banda.
- El disclaimer de saldo aparece una sola vez, dentro de la banda: "Ingresos menos gastos. No es dinero disponible."
- El conteo de movimientos pasa al encabezado de "Últimos movimientos" (o "Movimientos del día · N" en la vista Diario).
- En la vista Diario, la banda reemplaza a `DailyKpis` y al bloque `summary-day-balance` (que repetía las mismas cifras).
- Si el día seleccionado pertenece a otro mes, el panel ya no lo muestra. El respaldo es el día 1 del mes en vez de "hoy".
- En Diario no aparece el chip "Sin gastos registrados": un día sin gastos es normal (todos los domingos). El panel del día y el conteo "Movimientos del día · N" solo se muestran cuando los movimientos del mes cargaron sin error. Se usa la misma regla que en la vista mensual, y así no aparecen "Sin registros" ni ceros falsos.
- `FundsPosition` se renderiza una sola vez, en una posición fija después de la banda y fuera de las ramas de carga y error. El tile del PR D no se remonta al cambiar de vista o de período, y sigue visible si fallan los resúmenes.
- Hay un solo `role="status"` de carga a la vez. El skeleton del calendario y el "Consultando…" de la lista de movimientos no lo repiten.

**`BalanceBand` (`balance-band.tsx`)**
- Usa `<section aria-labelledby>` con un `<dl>` y un resumen para lector de pantalla ("Ingresos … pesos menos gastos … pesos, resultado … pesos").
- Los signos son reales: "+ $X" y "− $X", con U+2212 y espacio fino, mediante el nuevo `clpSigned` de `lib/finance/formatters.ts`. `clp` no cambia.
- Un resultado negativo se muestra en terracota, con "−" y la etiqueta "Déficit".
- Los ingresos muestran la sublínea "Incluye diezmos $X". Los diezmos son un subconjunto, no un KPI hermano.
- Variaciones:
  - Ingresos: % neutro solo con una base positiva (la misma `variation()` de siempre).
  - Resultado: siempre en monto ("$X más/menos que septiembre"). Nunca se usa %.
- El chip "Sin gastos registrados. ¿Faltan egresos?" y "Comisión SumUp: pendiente de datos" se muestran solo con `finance.details.read`, igual que antes.
- Estados: el skeleton de carga tiene la altura final y `aria-busy`. El estado vacío muestra $0 neutro y "Aún no hay movimientos en …". El error usa el `Notice` existente, sin ceros falsos.

**Calendario de caja (`cash-calendar.tsx`, `cash-day-panel.tsx`)**
- **Encabezado:** "Calendario de caja · Octubre 2026", con la ayuda y un chip de estado: "N advertencias en M días · Revisar", o el mensaje de todo registrado.
- **Leyenda:** 6 señales. En pantallas de menos de 768px se puede contraer y arranca abierta.
- **Celdas:** un `<button>` dentro de cada `td`, con 3 modos según container query (completo ≥42rem, medio 28–42rem, compacto <28rem).
  - "Falta efectivo" se marca con fondo, borde, barra superior, icono y texto.
  - "Sin registros" se marca con borde punteado e icono.
  - El efectivo registrado se muestra con `clpShort` en verde.
  - Hoy es un círculo primary. El día seleccionado lleva un marco de 2px y `primary-soft`.
  - Cada celda tiene un `aria-label` completo.
  - Se mantienen `<table>`, `aria-pressed` y `aria-current="date"`.
- **Teclado:** roving tabindex con una sola parada de Tab. ←/→ mueven ±1 día, ↑/↓ ±7, e Inicio/Fin van al inicio o fin de la semana dentro del mes. Mover el foco no selecciona. Enter o Espacio seleccionan.
- **Panel del día (`CashDayPanel`):**
  - Encabezado "Sábado 3 de octubre · Culto" con el chip "Hoy".
  - Un `role="status"` solo para lector de pantalla anuncia el día. Ya no hay `aria-live` sobre todo el panel.
  - Tarjetas de advertencia con tipo, causa, hasta 3 movimientos asociados con "Ver los N movimientos", estado "Pendiente" y acciones.
  - Acciones según permisos:
    - con `manage`: "Registrar efectivo · área", que abre el `CashModal` existente con área y fecha;
    - siempre: "Revisar movimientos";
    - sin `manage`: la nota de solo lectura.
  - "Ingresos del día" con la tabla `dayBreakdown` (se movió desde `summary-page.tsx` sin cambios de cálculo). Si el panel mide menos de 24rem, la tabla pasa a filas.
  - Pie con "Advertencia anterior", la posición "2 de 7" y "Siguiente advertencia". Recorre los días con advertencias del mes.
- **Layout:**
  - **≥52rem:** calendario y panel lado a lado. El panel es sticky y tiene scroll interno.
  - **<52rem (modo apilado):** al tocar un día se abre un `<dialog>` (lateral de 27,5rem en ≥768px; hoja de 92dvh en <768px) con las medidas y la animación de `CalDialog`, duplicadas en `cash-calendar.css`. El foco vuelve a la celda del día seleccionado. Debajo de la grilla queda "Días por revisar", con "Ver las N advertencias" cuando hay más de 5.
  - JavaScript necesita saber si está en modo apilado. Lo mide con `ResizeObserver` sobre la sección (mismo umbral que la container query) y vuelve a medir cuando cambia `data-text-size` en `<html>` (el "Aa" de B1). Sin `ResizeObserver`, se queda en el modo en línea.
- **Foco:**
  - "Revisar movimientos" y "Ver los N movimientos" pasan a Diario y llevan el foco al título de la banda de Diario (cuando termina de cargar).
  - "Advertencia anterior" y "Siguiente advertencia" usan `aria-disabled` en los extremos, así que el botón conserva el foco y no hace nada.
  - El diálogo también se cierra con el evento nativo `close`.
- **"Revisar movimientos":** Movimientos no acepta filtros por URL, así que se usa `onViewDay`, que lleva a la vista Diario de esa fecha (decisión 9). En la vista Diario, el mismo botón enlaza a `#fin-movements`.
- **Selector nuevo:** `dayWarnings(day, transactions)` en `lib/finance/insights.ts`. Es aditivo y se deriva de `dayStatus`, sin reglas nuevas.

**Tablas:** "Ingresos por tipo de dinero" y "por fuente" quedan lado a lado desde un contenedor de 52rem. Las columnas son de ancho fijo en rem (Monto 9, % 4,5, Mov. 4) con `max-width` de 44rem. Las tablas se ocultan en un período sin movimientos.

Los anchos fijos solo se aplican cuando el panel mide más de 30rem (container query `fin-table`). En un panel más angosto (teléfono, 125 % o dos columnas en tablet), la tabla vuelve a `table-layout: auto`, con un mínimo de 7rem para la columna de texto.

**Banda angosta (<24rem):** queda en una sola columna. La cifra va en su propia fila, la etiqueta puede pasar de línea y "Déficit" va debajo de "Resultado del período", así que nada se superpone a 375 px ni al 125 %.

**Gráficos (`finance-charts.tsx`):** los cambios se limitan a colores, leyenda y etiquetas.
- Colores desde los tokens: ingresos `#285b45`, gastos `#c0694c` (reemplaza `#ad9373`) y resultado `#60746b` discontinuo.
- Leyenda en orden Ingresos, Gastos, Resultado. Recharts 3 ordenaba alfabéticamente; ahora usa `itemSorter`.
- Etiquetas `clpShort` sobre las barras de "Ingresos vs gastos". Son texto, así que usan los tokens de texto AA (`#256b47` ingresos, `#a4482f` gastos) y no el color de la barra (`#c0694c` da 3,91:1). Su tamaño sale de CSS (B1: `.chart-box .recharts-label-list text`), sin `fontSize` en línea.
- El eje X muestra el nombre del período.

## Archivos CSS

Todos son nuevos, están en rem (incluidas las container queries) y los importa cada componente, siguiendo el patrón de `area-badges.tsx`. B2 **no toca** `app/globals.css`.

| Archivo | Contenido |
|---|---|
| `components/finance/dashboard/tokens.css` | Tokens de §B con alcance local (`.fin-summary`, `.fin-balance`, `.fin-funds`, `.fin-cal-section`, `.fin-day-dialog`, …) y el skeleton |
| `components/finance/dashboard/summary.css` | `BalanceBand`, `FundsPosition`, tablas y conteo de movimientos |
| `components/finance/dashboard/cash-calendar.css` | Calendario, leyenda, celdas, "Días por revisar", panel, diálogo y skeleton 5×7 |

Las reglas `.calendar-*`, `.day-panel-*`, `.review-days*`, `.source-block*` e `.income-method-*` de `globals.css` quedan sin uso en el Resumen y se limpian después. `.kpi*` sigue en uso en Diezmos y Reportes.

## Cómo monta el PR D el tile de saldo en `FundsPosition`

`FundsPosition` es solo un slot (decisión 10). Sin `bankTile` devuelve `null`: no se muestran placeholders.

```ts
// components/finance/dashboard/funds-position.tsx
export interface FundsPositionProps {
  bankTile?: ReactNode;      // obligatorio para que la sección aparezca
  tiles?: ReactNode[];       // opcionales, después del saldo: "Efectivo en caja", "SumUp pendiente de abono" (con key)
  isCurrentPeriod: boolean;  // false → "Posición de fondos · hoy, 13 oct" + "No depende del período seleccionado."
  todayLabel: string;        // "13 oct"
}

// components/finance/dashboard/summary-page.tsx
export interface SummaryDashboardProps {
  fundsBankTile?: ReactNode; // se pasa a FundsPosition.bankTile
  fundsTiles?: ReactNode[];  // se pasa a FundsPosition.tiles
}
export function SummaryPage() { return <SummaryDashboard />; } // ruta /finanzas
```

El PR D solo cambia el cuerpo de `SummaryPage`:

```tsx
export function SummaryPage() {
  return <SummaryDashboard fundsBankTile={<BankBalanceCard />} />;
}
```

`SummaryDashboard` ya se encarga de lo demás:
- muestra la sección solo con `finance.details.read` (el líder nunca la ve, decisión 1);
- la ubica en una fila propia después de la banda, nunca junto al resultado ni sumada a él;
- calcula `isCurrentPeriod` y `todayLabel`.

El tile es responsable de sus 4 estados (configurado, sin configurar, cargando y error, sin mostrar nunca $0) y de mostrar la fecha y la naturaleza ("estimado") de cada cifra. Los tiles se ubican en una grilla `repeat(auto-fit, minmax(15rem, 1fr))`. La ruta `app/(private)/finanzas/page.tsx` no cambia.

## Desviación aceptada: ancho de las celdas en modo compacto

A 375 px el calendario tiene 7 columnas, el gap de 0,25rem del Design Lock y el padding del panel. Con eso, cada celda queda en unos 38 px de ancho al 100 % y unos 34 px al 125 %. **Los 44 px de ancho no son posibles en 375 px con 7 columnas**.

- Se acepta un ancho de ≥24 px, el mínimo de WCAG 2.2 AA (2.5.8). El alto sigue en ≥3,25rem (52 px o más).
- En modo compacto, el padding de la celda baja a 0,125rem.
- El número (y el círculo de "Hoy") mide `min(1.5rem, 100%)`, así que nunca se recorta. En los modos medio y completo vuelve a 1,75rem.

## Dependencias con B1

- **Tokens:** B1 agrega los mismos tokens de §B globalmente (`@theme inline`). Cuando ambos estén integrados, hay que eliminar el bloque duplicado de `tokens.css` (deduplicación pendiente; los valores son idénticos).
- **`--subnav-h`:** el panel sticky usa `top: calc(var(--finance-nav-top, 0px) + var(--subnav-h, 2.75rem) + 1rem)`. Si B1 define `--subnav-h`, se toma; si no, se usa el respaldo de 2,75rem.
- **"Aa":** el modo apilado se recalcula cuando cambia `data-text-size` en `<html>`. Todo B2 está en rem y escala con "Aa".
- **`globals.css` (B1):** B2 no cambia `.chart-box` (17rem / 11,25rem), los `fontSize` numéricos de Recharts ni `YAxis width` (3,5rem). Quedan para B1 o para una limpieza posterior.
- **Botones:** `.button-secondary` y `.notice` siguen saliendo de `globals.css`, que B1 migra a rem.
