# 28 · Design Lock: Finanzas iPad-first (Resumen, calendario de caja, navegación y tamaño de texto)

**Fecha:** 2026-10-13. **Autor:** Designer (revisión del Tech Lead). **Base:** `18925d6`.

**Evidencia:** solo interna (código y capturas en `docs/mission-2026/screens-platform-core-calendar/`: 07, 13, 22, 23, 40, 41, 60). No hay capturas de iPad, así que lo primero del QA es tomar una baseline nueva.

**Implementación en dos PR:**
- **B1** · `feature/finance-ux-ipad-v1`: base de tokens y rem, shell (sidebar/rail/cajón/barra superior) y control "Aa".
- **B2** · `feature/finance-summary-calendar-v1`: Resumen (`BalanceBand` y slot `FundsPosition`) y calendario de caja.

## Decisiones del Tech Lead sobre las preguntas abiertas

1. **Posición de fondos:** la ve quien tiene `finance.details.read`. El líder no.
2. **"Efectivo en caja":** efectivo registrado y aún no depositado (definición del PR D).
3. **"SumUp pendiente de abono":** el bruto vendido que todavía no tiene payout (PR C).
4. **No existe un "total de fondos".** La posición nunca se suma al resultado.
5. **Los diezmos son un subconjunto de los ingresos.** Corresponde la sublínea "Incluye diezmos $X".
6. **En móvil se conserva la barra inferior** además del cajón.
7. **La variación del resultado se muestra en monto**, nunca en % sobre una base negativa.
8. **No se crea el estado "advertencia revisada"** en esta misión. El único estado es "Pendiente", y desaparece cuando se registra el efectivo.
9. **"Revisar movimientos":** usar filtros por URL si Movimientos ya los admite. Si no, usar `onViewDay` (vista Diario de esa fecha).
10. **Fase 1 de "Posición de fondos":** la sección solo aparece cuando se le entrega un tile de saldo (el PR D lo monta). Sin ese tile, no se muestran placeholders vacíos. El conteo de movimientos pasa al encabezado de "Últimos movimientos".
11. **"Aa" se expone en B1.** El QA visual del Tech Lead valida 110 % y 125 %, y si falla se corrige antes de publicar.

## A. Diagnóstico (resumen)

**Resumen**
- Hay 5 KPIs de igual peso, con ingresos y gastos indistinguibles.
- El resultado negativo solo se reconoce por el color y aparece como "$-20.400".
- Diezmos figura como KPI hermano de Ingresos, cuando es un subconjunto.
- "Movimientos" mezcla un conteo con montos.
- El disclaimer de saldo aparece 3 veces.
- `source-block-expense` repite el resultado.
- En los gráficos, el color de gastos `#ad9373` no tiene contraste semántico. La leyenda pone Gastos antes que Ingresos y el eje dice "Período".

**Calendario de caja** (`globals.css` ≈3126–3266)
- Las celdas tienen 44px de alto mínimo, el número 13px, el estado 9px y el icono 12px.
- En 1024 de ancho cada celda queda en unos 70×44.
- Hoy y seleccionado se confunden.
- No hay leyenda.
- El `aria-live` cubre el panel completo.
- Hay hasta 31 paradas de Tab.
- "Días por revisar" está separado del calendario y no se puede recorrer.

**Contraste:** `.notice-warning` (`#9a6a1f` sobre `#fbf1de`) da 3,74:1 y **falla AA**.

**Navegación**
- Entre 768 y 1279 el rail mide 72px y sus tooltips solo aparecen con hover o foco, así que no sirven en táctil.
- Desde 768 no hay barra superior: no hay lugar para "Aa" ni para la hamburguesa.

**Tamaño:**
- Hay 142 `font-size` en px y 26 `text-[Npx]` en el TSX.
- `.kpi p` usa `vw`.
- `zoom` rompería los `fixed`, los `<dialog>` y recharts.

**Identidad que se conserva** (`globals.css:3–29`):

| Elemento | Valor |
|---|---|
| Primary | `#285b45` |
| Ink | `#233c33` |
| Canvas | `#f8f9f6` |
| Sand | `#f0ece2` |
| Side | `#14231d` / accent `#7fc79c` |
| Tipografía | Pila de sistema (SF Pro en iPad) |
| Radios | Panel 16 · KPI 14 · botón 9–10 · píldora 999 |
| Foco | `3px #7b9d56` con offset 4 |

## B. Tokens (modo claro; la app no tiene modo oscuro)

Van en un nuevo bloque `@theme inline`. Los tokens existentes no cambian de valor.

| Token | Valor | Uso | Contraste |
|---|---|---|---|
| `--color-income` | `#256b47` | Texto y cifras de ingreso, "+" | 6,41:1 sobre blanco |
| `--color-income-soft` | `#e8f2ec` | Fondo ingreso | — |
| `--color-expense` | `#a4482f` (terracota) | Gasto, "−", déficit | 5,92:1 |
| `--color-expense-soft` | `#f8ece6` | Fondo gasto | — |
| `--color-chart-income` | `#285b45` | Barras y líneas | 7,85:1 |
| `--color-chart-expense` | `#c0694c` | Reemplaza `#ad9373` | 3,91:1 (no textual) |
| `--color-chart-result` | `#60746b`, discontinua | Línea de resultado | — |
| `--color-result-ink` | `#233c33` | Cifra del resultado | 8,2:1 |
| `--color-result-surface` | `#f0ece2` | Bloque del resultado | — |
| `--color-result-line` | `#ddd5c3` | Borde del bloque | — |
| `--color-warning` | `#9a6a1f` | **Solo** iconos y bordes | 4,71:1 |
| `--color-warning-ink` | `#7a5216` | **Todo** texto de advertencia | 5,47:1 sobre `warning-soft` |
| `--color-warning-soft` | `#fbf1de` | Fondo de advertencia | — |
| `--color-info` / `-soft` | `#245a86` / `#e5eef6` | Posición de fondos | 7,3:1 |
| `--color-muted-strong` | `#5f6d65` | Texto secundario pequeño | ≥4,5:1 |

- **Hoy:** círculo primary lleno con el número en blanco.
- **Seleccionado:** marco de 2px primary + fondo `primary-soft`. En una celda seleccionada, el foco es primary con offset 2.

**Tipografía (rem; 1rem = 16px al 100 %)**

| Uso | Tamaño |
|---|---|
| Cuerpo | 0,875 |
| Secundario | 0,8125 |
| Mínimo informativo | 0,75 |
| Encabezados de tabla en mayúsculas (único caso) | 0,6875 |
| Inputs | ≥1rem |
| Resultado | 2rem/700 → 1,75 → 1,5 |
| Ingresos y gastos | 1,5rem/600 → 1,375 → 1,25 |
| Posición | 1,25rem/600 |

- Las cifras usan `tabular-nums`.
- Los signos usan U+2212 "−" y espacio fino. Un negativo se escribe "− $20.400" en terracota, con la etiqueta "Déficit".

**Shell**

| Token | Valor |
|---|---|
| `--topbar-h` | 3,5rem |
| `--rail-w` | 4,5rem |
| `--sidebar-w` | 15rem |
| `--drawer-w` | min(20rem, 86vw) |
| `--tap-min` | 2,75rem (44px) |
| `--tap-touch` | 3rem (48px) |

**Celdas del calendario** (container query sobre el ancho del calendario)

| Modo | Ancho | Alto mín. | Número | Contenido |
|---|---|---|---|---|
| Completo | ≥42rem | 5,5rem | 1rem/600 | Etiqueta "Culto" + chip con texto + monto |
| Medio | 28–42rem | 4,5rem | 0,9375rem | Chip con icono + "Falta" / "Sin reg." y monto 0,75rem |
| Compacto | <28rem | 3,25rem | 0,9375rem | Icono de 16px + barra de 3px; sin montos |

Gap de 0,25rem, radio de celda 10, chip 6.

## C1. Resumen financiero

**Orden de la página**
1. Encabezado y acciones (sin cambios).
2. **Resultado del período** (`BalanceBand`). Lo ven todos los que hoy ven KPIs, incluido el líder.
3. **Posición de fondos** (`FundsPosition`). Requiere details y un tile de saldo provisto.
4. Calendario de caja con su panel (details, vista Mensual).
5. Tablas de ingresos "por tipo de dinero" y "por fuente", lado a lado desde un contenedor de 52rem.
6. Gráficos.
7. "Últimos movimientos · N en el período".

**`BalanceBand`**

Es un `<section aria-labelledby>` blanco con borde. El h3 dice "Resultado de octubre 2026" (en vista Diario: "Resultado del sáb 3 oct").

- **Contenedor ≥52rem:** `[Ingresos] [−] [Gastos] [=] [Resultado]` con columnas `1fr 2rem 1fr 2rem 1.15fr`. Los operadores van con `aria-hidden`.
  - **Ingresos:**
    - icono `TypeIcon` income;
    - "+ $4.641.132" en `--color-income`;
    - sublínea "Incluye diezmos $X";
    - variación neutra "↑ 12,4 % vs. septiembre".
  - **Gastos:**
    - icono expense;
    - "− $532.000";
    - si gastos = 0 e ingresos > 0, chip "Sin gastos registrados. ¿Faltan egresos?";
    - si hay SumUp, sublínea "Comisión SumUp: pendiente de datos".
  - **Resultado:**
    - bloque `result-surface` con borde `result-line` y radio 12;
    - etiqueta "Resultado del período";
    - cifra 2rem/700;
    - debajo: "Ingresos menos gastos. No es dinero disponible.";
    - si es negativo: terracota + "Déficit";
    - variación en monto ("$1.240.000 más que septiembre"); nunca un % sobre base negativa.
- **Contenedor <52rem:** libro contable vertical, filas de 3rem.

  ```
  Ingresos      + $4.641.132
    Incluye diezmos $X
  Gastos        −   $532.000
  ─────────────────────────
  Resultado del período  $4.109.132   (bloque resaltado)
  ```

- **Semántica:** `<dl>` más un resumen para lector de pantalla: "Ingresos 4.641.132 pesos menos gastos 532.000 pesos, resultado 4.109.132 pesos".
- **Estados:**
  - Cargando: skeleton con la altura final y `aria-busy`.
  - Error: `Notice` sin ceros falsos.
  - Vacío: $0 neutro y "Aún no hay movimientos en octubre 2026".
  - 125 %: las cifras nunca llevan elipsis.

**`FundsPosition`**

- Título: h3 "Posición de fondos", con el subtítulo "Dinero en un momento dado. No se suma al resultado."
- Reglas:
  - nunca en la misma fila que el resultado;
  - nunca se suma;
  - cada cifra con fecha y naturaleza ("estimado" o "pendiente");
  - no depende del período seleccionado; si se mira un mes pasado: "Posición de fondos · hoy, 13 oct" y "No depende del período seleccionado."
- Tiles: grid `repeat(auto-fit, minmax(15rem, 1fr))`, icono `info` y tinta neutra.
  - Saldo bancario estimado (`Landmark`).
  - Efectivo en caja (`Banknote`).
  - SumUp pendiente de abono (`CreditCard` + `Clock`).
- Estados del saldo (los implementa el PR D):

| Estado | Contenido |
|---|---|
| Configurado | Cifra + "Estimado al …" + "¿Cómo se calcula?" |
| Sin configurar | **"Saldo pendiente de configurar"** + "Configurar saldo" o "Pide a Tesorería que lo configure." |
| Cargando | Skeleton |
| Error | "No pudimos calcular el saldo." + "Reintentar". Nunca $0 |

**Tablas**
- Columnas de ancho fijo en rem: Monto 9rem, % 4,5rem, Mov. 4rem, alineadas a la derecha; `max-width` 44rem.
- Se elimina "Gastos y resultado". Su nota y su advertencia pasan a la banda.

**Gráficos**
- Colores desde los tokens.
- Leyenda en orden Ingresos, Gastos, Resultado.
- Etiquetas de valor `clpShort` en "Ingresos vs gastos".
- El eje X muestra el nombre del período.
- `.chart-box` mide 17rem (`.short` 11,25rem).
- Tamaños de texto desde CSS, sin `fontSize` numérico.
- `YAxis width` de 3,5rem.

## C2. Calendario de caja

**Layout** (`.fin-cal-section` con `container-type: inline-size`)
- **≥52rem:** `minmax(0,1fr) clamp(18rem, 32%, 22rem)` con gap 1,25rem. El panel es sticky (`top: calc(var(--subnav-h) + 1rem)`), con `max-height: calc(100dvh - 8rem)` y scroll interno.
- **<52rem:** calendario a ancho completo. Al tocar un día se abre un `<dialog>`:
  - lateral de 440px en ≥768 (medidas y animación de `CalDialog`);
  - hoja de máximo 92dvh en <768.

  El foco vuelve a la celda. Debajo queda "Días por revisar".

**Encabezado**
- h3 "Calendario de caja · Octubre 2026".
- Ayuda: "Montos: efectivo de Ofrendas y Cafetería. Toca un día para ver el detalle y los diezmos."
- Chip de estado:
  - con advertencias: "⚠ 3 advertencias en 2 días · Revisar" (`warning-soft` / `warning-ink`); selecciona la primera y mueve el foco al panel;
  - sin advertencias: "✓ Todo registrado en los días de culto de este mes."

**Leyenda** (siempre visible en ≥768; en <768 con "Ver leyenda" / "Ocultar leyenda", abierta por defecto)

| Muestra | Texto |
|---|---|
| ⚠ ámbar | "Falta efectivo: SumUp registró cobros y no hay efectivo del área" |
| ◌ punteado | "Sin registros: día de culto sin Ofrendas ni Cafetería" |
| "$165 mil" verde | "Efectivo registrado" |
| Círculo | "Hoy" |
| Marco | "Día seleccionado" |
| "Culto" | "Día de culto" |

**Celda** (un botón dentro de cada `td`, número arriba a la izquierda)

| Estado | Señales |
|---|---|
| Falta efectivo | Fondo `warning-soft`, borde `warning`, barra superior de 3px y chip `TriangleAlert` 16px "Falta efectivo" ("· Ofrendas" o "· 2 áreas" en modo completo), texto `warning-ink` |
| Sin registros | Fondo canvas, borde punteado, `CircleDashed` 16px, "Sin registros" |
| Con efectivo | `clpShort` 0,8125rem/600 en `income` |
| Futuro | Número en `muted-strong` |
| Hoy | Círculo de 1,75rem + `aria-current="date"` |
| Seleccionado | Marco de 2px + `primary-soft` + `aria-pressed` |

`aria-label` de la celda, por ejemplo: "sábado 3 de octubre, hoy, día de culto, falta efectivo de Ofrendas, 1 advertencia".

**Teclado**
- Roving tabindex: una sola parada de Tab en la grilla (el día seleccionado, si no hoy, si no el día 1).
- ←/→ mueven ±1 día y ↑/↓ ±7.
- Inicio/Fin van al inicio o fin de la semana.
- Enter o Espacio selecciona; en modo apilado además abre el diálogo.
- Se mantienen `<table>`, `aria-pressed` y `aria-current`, para no romper los tests existentes.

**Panel del día** (`CashDayPanel`, mismo contenido en línea o en diálogo)
1. **Encabezado:** "Sábado 3 de octubre · Culto" + chip "Hoy". Un `role="status"` solo para lector de pantalla anuncia "Sábado 3 de octubre: 2 advertencias". Ya no hay `aria-live` sobre el panel.
2. **"Advertencias (n)":** una tarjeta por advertencia, con borde izquierdo `warning`.
   - **Tipo:** "Falta efectivo · Ofrendas".
   - **Causa:**
     - "SumUp registró $85.000 en Ofrendas este día, pero no hay efectivo de Ofrendas registrado."
     - "Es día de culto y no hay ingresos de Ofrendas ni de Cafetería registrados."
   - **Movimientos asociados:** hasta 3 y "Ver los N movimientos".
   - **Estado:** píldora "Pendiente".
   - **Acciones:**
     - "Registrar efectivo · Ofrendas" (solo con `manage`; abre `CashModal`);
     - "Revisar movimientos";
     - sin `manage`: "Puedes revisar este día, pero no registrar movimientos."
3. **"Ingresos del día":** tabla `dayBreakdown`. Con un panel de menos de 24rem pasa a filas.
4. **Pie:** "‹ Advertencia anterior" · "2 de 7" · "Siguiente advertencia ›" (44px). Recorre `reviewDays` del mes.

**Estados**
- Cargando: skeleton de 5×7.
- Error: `Notice` + "Reintentar".
- "Sin movimientos activos este día." / "Día futuro: aún no hay registros."
- Más de 5 en la lista: "Ver las N advertencias".

**Permisos:** sin cambios. El líder no ve el calendario; `details` sin `manage` ve todo en lectura.

## C3. Shell de navegación (B1)

| Viewport | Patrón |
|---|---|
| ≥1280 | Sidebar persistente de 15rem, contraíble a rail de 4,5rem. La hamburguesa alterna el estado y se persiste en `localStorage` `cds.ui.sidebar`. **Sin animar el ancho.** |
| 1024–1279 (1194×834, 1024×768) | Rail fijo de 4,5rem con icono de 22px y **etiqueta corta visible** (0,6875rem: "Finanzas", "Calendario", "Reportes", "Ajustes"). La hamburguesa abre un cajón modal con nombres completos. |
| 768–1023 | Sin rail. Barra superior oscura sticky con hamburguesa → cajón. Sin barra inferior. |
| <768 | Barra superior oscura (existente) + barra inferior existente. La hamburguesa abre el cajón. |

**Barra superior** (3,5rem)
- **<1024:** fondo `side`, sticky. Contenido: hamburguesa (44px) · "CS" · título del módulo · **Aa** · avatar (hoja "Cuenta").
- **≥1024:** fila en la columna de contenido, sobre canvas, no sticky, con hamburguesa a la izquierda y **Aa** a la derecha. El padding superior de `main` baja de 3rem a 1,5rem.

**Cajón**
- `<dialog>` modal (patrón `Sheet`, variante izquierda), ancho `--drawer-w`, 100dvh, fondo `side`.
- Contiene: marca, "Módulos" (filas de 3rem), cuenta y "Cerrar sesión".
- Se cierra con Esc, con el fondo, con el botón "Cerrar menú" y al navegar. El foco vuelve a la hamburguesa.
- **No se monta mientras está cerrado** (tests de "un único `role=alert`" y "Cerrar sesión" único).

**Hamburguesa:** `Menu` de lucide, 44×44.
- <1280: "Abrir menú de navegación" + `aria-haspopup="dialog"` + `aria-expanded`.
- ≥1280: "Contraer barra lateral" / "Expandir barra lateral" + `aria-expanded` + `aria-controls="app-sidebar"`.

**Orden de foco:** skip link "Saltar al contenido" → hamburguesa → rail/sidebar → Aa → avatar → `main`.

**Sin parpadeo:** un script previo al pintado fija `data-sidebar` y `data-text-size` en `<html>`.

## C4. "Aa": tamaño del texto (B1)

**Control**
- Botón de 44×44 con "Aa" y `aria-label="Tamaño del texto (actual: Normal)"`.
- **≥768:** popover `role="dialog"` "Tamaño del texto" con un `fieldset` de 3 radios en filas de 3rem: "Normal · 100 %", "Grande · 110 %", "Muy grande · 125 %". Cada fila trae una muestra y la ayuda "Se guarda en este dispositivo."
- **<768:** la misma lista dentro de `Sheet`.
- Se aplica al instante y se anuncia con `role="status"`. Esc cierra y devuelve el foco.

**Técnica**
1. `html[data-text-size="normal|large|xlarge"] { font-size: 100% | 110% | 125% }`. **Nunca** `zoom` ni `transform`.
2. `html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }`.
3. Script inline bloqueante en `<head>` de `app/layout.tsx`: lee `cds.ui.textSize` y `cds.ui.sidebar` dentro de try/catch, con `<html suppressHydrationWarning>`. **No** debe tocar las rutas ni módulos públicos (tests de pureza: `tests/platform/shared-purity.test.ts:29`, `tests/platform/public-calendar-page.test.tsx:157`).
4. En `globals.css`:
   - todos los `font-size` px → rem (÷16);
   - paddings y min-heights de controles, celdas y filas → rem;
   - bordes, radios, sombras y `@media` se quedan en px;
   - `.kpi p` sin `vw`.
5. Los `text-[Npx]` del TSX → rem.
6. Los componentes nuevos usan container queries en rem (verificar en iPad Safari; alternativa: `ResizeObserver`).
7. Recharts: tamaños por CSS (`.recharts-cartesian-axis-tick text`, `.recharts-legend-item-text`).
8. `components/calendar/calendar.css` → rem.

**Riesgos a 110–125 %:**
- `.kpi-grid` (`.tithe-kpis`);
- `.summary-period-left` (selects de 160 y 110px → min-width en rem);
- `.period-view-toggle`;
- `.summary-actions`;
- `.income-method-table`, `.day-panel-table`;
- `.transaction-row`, `.profile-row`;
- `.tithe-history-table` (scroll interno aceptable);
- `.offering-days-table`;
- `.campaign-metrics`, `.campaign-row-actions` (34px → 44px);
- `.finance-modal`;
- `.settings-general-grid`, `.user-settings-fields`;
- la barra inferior (64px → rem + safe-area);
- los chips del calendario mensual;
- `YAxis width`.

## Design Lock

- **Carácter:** herramienta pastoral sobria, confiable y serena. Densidad media en tablet. El color comunica significado, nunca decora.
- **Dirección:** el lenguaje interno de CDS (el módulo Calendario como referencia de paneles, el shell oscuro como referencia de navegación) más un libro contable que separa **flujo** de **posición**.
- **Color:**
  - el verde de ingreso no es el primary (primary queda para acciones);
  - la terracota es solo para gasto y déficit (`danger` sigue para errores);
  - ámbar: icono `#9a6a1f` y texto `#7a5216`;
  - azul `info` para la posición de fondos.
- **Espaciado:**
  - escala de 4px en rem;
  - panel de 1,5rem (1,125rem en <640);
  - `main` con 2rem laterales en 768–1279, 3rem en ≥1280 y 1,5rem en móvil.
- **Radios:** panel 16 · resultado 12 · tile 12 · celda 10 · botón 10 · chip 6 · píldora 999.
- **Fundación:** CSS propio + Tailwind 4 + `<dialog>` nativo + lucide. Sin bibliotecas nuevas.
- **Movimiento:**
  - cajón: 200ms ease-out al entrar y 160ms al salir;
  - fondo: 150ms;
  - selección: 120ms solo en `background-color` y `border-color`;
  - **sin** `transition-all`;
  - sin animar el ancho del sidebar ni el cambio de tamaño;
  - se respeta `prefers-reduced-motion` (regla global en `globals.css:170`).
- **Accesibilidad:**
  - AA en todo el texto;
  - objetivos ≥44px a cualquier escala;
  - signos y etiquetas además del color;
  - `<dl>` y tablas semánticas;
  - una sola parada de Tab en la grilla;
  - foco atrapado en los diálogos y devuelto al cerrarlos.
- **Evitar:**
  - KPIs de igual peso;
  - sumar la posición con el resultado;
  - placeholders vacíos;
  - rojo de error para gastos;
  - tooltips como única etiqueta;
  - `zoom`;
  - animar el ancho del sidebar;
  - gradientes y glassmorphism;
  - % sobre una base negativa.

## E. Checklist de QA visual

**Resoluciones:** 1440×900, 1280×800, 1194×834, 1024×768, 768×1024, 390×844 y 375×667.
- Todas en Normal y Muy grande; Grande solo en 1024 y 390.
- 1194, 1024 y 768 se prueban en iPad (Safari o simulador).

**Estados a capturar**
- Resumen con ≥3 advertencias y un día seleccionado distinto de hoy.
- Hoy seleccionado.
- Resultado negativo.
- Mes vacío.
- Cargando.
- Error.
- Saldo en sus 4 estados.
- Líder.
- `details` sin `manage`.
- Vista Diario.
- Panel de advertencia, en línea y en diálogo.
- Mes con 12 advertencias.
- Rail, cajón y sidebar contraída.
- "Aa" abierto.
- `CashModal` al 125 % en 768 y en 375.
- Movimientos, Ofrendas y Cafetería, Diezmos, Campañas, Reportes, Calendario y Configuración al 125 % en 1024 y en 375.

**Criterios de aprobación**
- Sin scroll horizontal de página (`scrollWidth <= innerWidth`).
- Ninguna cifra truncada.
- Controles de ≥44px.
- Modales dentro del viewport.
- Celdas de ≥44px.
- Hoy y seleccionado se distinguen en escala de grises.
- Contraste medido.
- Teclado y Esc funcionan, y el foco vuelve a su origen.
- VoiceOver anuncia correctamente.
- Reduced motion respetado.
- La preferencia persiste sin parpadeo.
- Una ventana privada sin `localStorage` no falla.
- Al 100 %, las pantallas que no se tocaron quedan iguales a la baseline.
