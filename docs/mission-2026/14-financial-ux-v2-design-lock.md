# 14 · Financial UX 2026 / Preview V2: Design Lock

**Autor:** Designer · **Estado:** listo para Builder · **Fecha:** 2026-10-02
**Entradas:** 08 (Design Lock v1), 12 (Slice 6), 13 (Slice 6b), `app/globals.css`, `components/layout/app-shell.tsx`, referencia visual PayFlow (`IMG_6457.PNG`), demo pública de Mercury (vista en vivo) y hallazgos de Navigator y Atlas.

## 0. Estado y alcance

**Este documento reemplaza estas partes del doc 08:**
- §3 Navegación y Home "Hoy";
- §4 Tipografía, Color, Superficies y Modo visual;
- §4 "Qué evitar" (la regla "sin KPI cards" ahora permite **máximo 3 métricas**, y solo en Hoy);
- §4 Base de componentes (no se instala Base UI ni shadcn en esta misión);
- §5 rutas y componentes del preview.

**Del doc 08 se conservan sin cambios** los invariantes financieros, de accesibilidad y de trazabilidad (ver §1.2), la tabla de estados (que aquí se amplía), el modelo de Caja y Conciliación y los criterios de aceptación 1–13 (que aquí se amplían en §15).

**Alcance.** Este documento cubre solo el preview `/preview/finanzas-2026/*`: es estático, usa mock y no importa Firebase. Todo el CSS va bajo `.fx`, con tokens `--fx-*`. Usa recharts 3 y lucide-react. No se agregan dependencias de UI: para sheets y diálogos se usa `<dialog>` nativo, y `<details>` para los expandibles simples.

**Dato de demostración:** "hoy" es el domingo 04-10-2026 a las 13:30 (hay culto). Septiembre está completo y octubre llega al día 4.

## 1. Principios

**Carácter:** "Financial OS para Casa de Salvación". Es un instrumento sereno y exacto:
- sidebar oscura y compacta que da marco;
- lienzo claro donde viven las cifras;
- jerarquía fuerte: una cifra protagonista por bloque;
- denso donde se trabaja (Movimientos, Conciliación, Caja) y espacioso donde se decide (Hoy, Atención, Reportes);
- lenguaje de tesorería de iglesia, no de backend.

### 1.1 Reglas de diseño
1. Toda cifra agregada permite ver su composición: es un link a Movimientos filtrado o abre un popover "Cómo se calcula".
2. Ninguna cifra sin rótulo suma Ofrendas (donaciones) con Cafetería (ventas).
3. Todo monto SumUp se rotula **bruto**. "Líquido" aparece solo con una comisión real o marcada "Ejemplo".
4. Lo que hoy no existe en CDS lleva la pill **Propuesta**.
5. Cada gráfico responde una pregunta escrita en su subtítulo y tiene un equivalente en tabla.
6. Hay un solo botón Primary por vista.

### 1.2 Se conserva del doc 08 (invariantes)
- "No representa el saldo bancario" en todo Resultado.
- Anular siempre exige motivo, y toda diferencia exige motivo.
- El esperado nunca es un input.
- "Conciliado" solo aparece si hay un depósito vinculado.
- Las filas SumUp nunca muestran Editar ni Eliminar: solo "Reclasificar" y "Marcar para revisión".
- Los estados se muestran siempre con ícono + texto + color.
- Montos tabulares, alineados a la derecha, en formato `$ 1.234.567` y con el signo "−" real (U+2212).
- Foco visible, tablas `<table>` semánticas y AA en todo.
- Sin jerga técnica (Firestore, UID, ledgerAmount, system:sumup).
- No hay ranking de donantes ni nombres de diezmantes en reportes.

### 1.3 Se reemplaza
- **Sidebar:** pasa de blanca con ítems de 48 px y radius 12 a **oscura verde-tinta** de 240 px con ítems de 36 px.
- **Home:** pasa de "sin métricas" a **máximo 3 métricas** (Ingresos registrados, Gastos registrados y Resultado del período), con su composición visible.
- **Tipografía:** se descarta Inter. Se usa el stack de sistema con `tabular-nums`.
- **Navegación:** se elimina el subnav de pestañas (`.finance-nav`) dentro del preview; la navegación vive solo en la sidebar o la barra inferior.
- **Navegación móvil:** pasa a ser [Hoy] [Movimientos] [+ Registrar] [Atención] [Más].
- **Base de componentes:** se usan componentes propios mínimos en lugar de Base UI o shadcn.

## 2. Reference matrix

| Referencia | Fuente | Capa | Disponibilidad | Qué aprendemos (evidencia) | Usar | Rechazar |
|---|---|---|---|---|---|---|
| PayFlow (shot en redes) | `IMG_6457.PNG` | A/E visual | FREE PUBLIC (archivo local) | **SCREEN VIEWED** (imagen fija, resolución baja). Sidebar con menú agrupado ("MENU", "TOOLS"); 3 cards de métricas con variación; gráfico de barras con selector de período; tabla con pills de estado; columna derecha | Estructura en 3 filas; métricas en fila de 3; header con selector de período + acción primaria; título de card a la izquierda y control a la derecha; tabla con estado en pill; feed "Actividad reciente" | Violeta; card "My Card" / "Total balance"; "Savings"; barra de "Daily limit"; upsell "Go Pro"; "Ask AI"; sidebar blanca; variación en verde/rojo; avatares de personas |
| Mercury (demo pública) | demo.mercury.com /dashboard y /transactions | A/E | FREE PUBLIC | **SCREEN VIEWED** a 1440×900 (tema oscuro). Sidebar de ~220 px con ítems de ~36 px y grupos con label pequeño; badge con conteo en "Tasks"; barra Saved views · Filters · Date · Keyword · Amount; franja Net change / Money in / Money out sobre la tabla; filas de ~48 px con monto a la derecha; skeleton de filas mientras carga | Medidas de la sidebar; badge en Atención; toolbar de filtros por chips; franja de totales que responde al filtro; skeleton de filas | Gráfico de saldo protagonista; tema oscuro en el lienzo; acciones de mover dinero |
| Parrotfy | Indicación del dueño | A | TEXT DESCRIPTION (no abierto) | Simplicidad de ERP chileno: pocas opciones por pantalla | Menos controles visibles y vocabulario local (CLP, es-CL) | Su marca, colores y componentes |
| Stripe / Brex | doc 08 | A | TEXT DESCRIPTION (doc 08) | El payout como unidad de conciliación; bandeja de tareas con CTA | Conciliación y Atención | Jerga de Connect; tono corporativo |
| Refero MCP | MCP | A | CONNECTED MCP → `NO_SUBSCRIPTION` | Sin resultados | — | No se reintentó |

**Cobertura de la investigación:** SUFFICIENT para la estructura y la navegación. LIMITED para Caja y Conciliación móviles: se apoyan en el doc 08 (Square/Toast en texto).
**Evidencia visual:** STRONG para la sidebar y la tabla (Mercury, vista en vivo); MEDIUM para la composición del dashboard (PayFlow, imagen fija).
**Investigación de componentes:** LIMITED. No se instala ninguna librería; los patrones salen de Mercury y del doc 08.
**Señal de investigación premium:** LOW. Refero sin suscripción no bloqueó nada.

## 3. Arquitectura visual y navegación

### 3.1 Rutas
`/preview/finanzas-2026` (Hoy) · `/atencion` · `/movimientos` · `/caja` · `/conciliacion` · `/ofrendas` · `/diezmos` · `/cafeteria` · `/campanas` · `/reportes` · `/configuracion`. Todas bajo `/preview/finanzas-2026/`.

Query param de demostración: `?estado=cargando|vacio|error` fuerza los estados de §10.

### 3.2 Sidebar desktop (≥1280 px): `FinancialSidebar`

- **Contenedor:** ancho 240 px, `position: sticky; top: 0; height: 100dvh`, fondo `--fx-side-bg #14231d` y padding 12 px.
- **Marca** (alto 56 px, padding 0 8 px):
  - marca cuadrada de 28 px, radius 8, fondo `#7fc79c`, con las iniciales "CS" en 12/700 color `#14231d`;
  - a la derecha "Casa de Salvación" (14/600, `#ffffff`) y debajo "Finanzas" (12/400, `--fx-side-muted`).
- **Ítems:**
  - alto 36 px, padding 0 10 px, gap 10 px, radius 8;
  - ícono lucide de 18 px con `strokeWidth 1.75`;
  - texto 14/500 en `--fx-side-text #c9d6ce`;
  - separación vertical entre ítems: 2 px.
- **Hover:** fondo `#1d3229` y texto `#ffffff`.
- **Activo:**
  - fondo `#244233`, texto e ícono `#ffffff`;
  - barra izquierda de 3×18 px en `#7fc79c`, radius 2, centrada verticalmente (`::before` en `left: 0`);
  - `aria-current="page"`.
- **Labels de grupo:** "FUENTES", "ANÁLISIS", "SISTEMA". Van en 11/600, mayúsculas, `letter-spacing: .06em`, color `--fx-side-muted #8aa197`, con `margin-top: 20px`, alto 24 px y padding 0 10 px. Son `<h2>` visualmente pequeños dentro de un `<nav aria-label="Finanzas">`, con una `<ul>` por grupo. El primer grupo no lleva label.
- **Orden:**
  - Hoy (`LayoutDashboard`), Atención (`Inbox`, con badge), Movimientos (`ArrowLeftRight`), Caja (`Wallet`) y Conciliación (`Scale`);
  - FUENTES: Ofrendas (`HandCoins`), Diezmos (`HandHeart`), Cafetería (`Coffee`) y Campañas (`Target`);
  - ANÁLISIS: Reportes (`ChartColumn`);
  - SISTEMA: Configuración (`Settings`).
- **Badge de Atención:**
  - alineado a la derecha, min-width 20 px, alto 20 px, padding 0 6 px, radius 999;
  - texto 12/600 tabular, fondo `#e8b75a`, texto `#231a05`;
  - el link lleva `aria-label="Atención, 7 pendientes"`;
  - si el conteo es 0, el badge no se muestra.
- **Footer** (`margin-top: auto`):
  - borde superior de 1 px `#23392f` y padding-top 12 px;
  - avatar de 32 px (círculo `#244233` con texto `#c9d6ce` 12/600 "TD");
  - "Tesorería (demo)" en 13/500 `#ffffff` y "Casa de Salvación" en 12 `--fx-side-muted`.
- **Colapsable a futuro:** el ancho sale de `--fx-sidebar-w`. No se renderiza botón de colapsar en esta misión.

### 3.3 Rail tablet (768–1279 px)
- Ancho 72 px con el mismo fondo; solo la marca de 28 px.
- Ítems de 48×48 px centrados, ícono de 20 px y radius 10. El estado activo usa el mismo fondo, con la barra izquierda de 3×20 px.
- Sin labels de grupo: los grupos se separan con una línea de 1×24 px `#23392f` centrada y margin 8 px.
- **Tooltip** a la derecha, en hover y en foco: fondo `#14231d`, borde 1 px `#2c463a`, texto 12/500 `#ffffff`, padding 4 px 8 px, radius 6, aparece a los 300 ms. El link lleva `aria-label` con el nombre.
- **Badge:** 16 px, en la esquina superior derecha del ícono (offset −4 px), 11/700.
- **Footer:** solo el avatar, con tooltip "Tesorería (demo)".

### 3.4 Móvil (<768 px): `MobileNav`
**Top bar:**
- alto 56 px, sticky, fondo `#14231d`, padding 0 16 px;
- marca de 28 px y "Casa de Salvación" (15/600 blanco);
- a la derecha, la pill "Demo" (12/600, fondo `#244233`, texto `#c9d6ce`, alto 24 px);
- el avatar de 32 px dentro de un botón de 44×44 px que abre "Más".

**Bottom bar:**
- `position: fixed; bottom: 0`, alto `64px + env(safe-area-inset-bottom)`, fondo `#ffffff` y borde superior de 1 px `--fx-line`;
- 5 celdas iguales, cada una un link de ≥56 px de alto con ícono de 22 px y label 11/500 en `--fx-muted`;
- ítems: [Hoy `LayoutDashboard`] [Movimientos `ArrowLeftRight`] [Registrar] [Atención `Inbox` + badge de 16 px] [Más `Ellipsis`];
- **activo:** el ícono va dentro de una pastilla de 56×28 px en `--fx-primary-soft`, con ícono y label en `--fx-primary` y `aria-current="page"`;
- **"Registrar":** círculo de 44 px en `--fx-primary` con `Plus` blanco y label "Registrar". Abre un sheet de acciones: Registrar efectivo · Registrar diezmo · Registrar gasto · Otro movimiento (filas de 56 px). En el preview, cada acción muestra un toast de simulación.
- **"Más":** bottom sheet con los mismos grupos de la sidebar (Caja, Conciliación | FUENTES: Ofrendas, Diezmos, Cafetería, Campañas | ANÁLISIS: Reportes | SISTEMA: Configuración). Filas de 52 px con ícono de 20 px; la ruta activa queda marcada.
- El `main` lleva `padding-bottom: calc(64px + env(safe-area-inset-bottom) + 16px)`.

### 3.5 Banner de demostración: `DemoBanner`
- **Desktop y tablet:** franja sticky arriba de la columna principal (no sobre la sidebar).
  - alto 32 px, fondo `--fx-proposal-bg #eef0f4`, borde inferior de 1 px `#d9dde5`;
  - ícono `FlaskConical` de 14 px y texto 12/500 `#46505e`: **"Vista previa · datos de demostración. Nada de lo que hagas aquí se guarda."**
- **Móvil:** 28 px sobre la top bar (no sticky), con el texto "Vista previa · datos de demostración". La pill "Demo" de la top bar cumple el rol permanente.
- No se puede cerrar. Lleva `role="note"`.

### 3.6 Header de página: `FinancialHeader`
- **Desktop:**
  - fila de 64 px con `padding-top: 24px`;
  - a la izquierda, h1 y debajo un subtítulo opcional en 13 `--fx-muted` (máx. 1 línea);
  - a la derecha, `PeriodSelector` + acción Primary ("+ Registrar", botón con menú) y opcionalmente una Secondary ("Exportar").
- **Móvil:**
  - h1 de 20 px y debajo el `PeriodSelector` a ancho completo;
  - la acción Primary se oculta (vive en la bottom bar) y las Secondary pasan a un botón `Ellipsis` de 44 px.

## 4. Grid y espaciado

- **Escala de 4 px:** 4, 8, 12, 16, 20, 24, 32, 40 y 48.
- **Contenedor del main:** `max-width: 1200px; margin: 0 auto`. Padding lateral: 32 px a ≥1280, 24 px entre 768 y 1279, y **16 px** por debajo de 768.
- **Columnas:**
  - ≥1280: 12 columnas, gutter 24;
  - 1024–1279: 12 columnas, gutter 16;
  - 768–1023: 6 columnas, gutter 16;
  - <768: 1 columna, gap 12.
- **Separación entre bloques:** 24 px desktop y 16 px móvil.
- **Panel (card):** fondo `#ffffff`, borde 1 px `--fx-line`, radius 12, sin sombra. Padding 20 px desktop y 16 px móvil. Header del panel: alto 32 px y `margin-bottom: 12px`.
- **Densidad:** Movimientos y Conciliación usan filas de 44 px y padding de celda 0 12 px. Hoy, Atención y Reportes usan paneles con padding 20 px.

## 5. Tipografía

**Stack:** `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. No se descargan fuentes.
**Números:** todo número lleva `font-variant-numeric: tabular-nums`, aplicado con la clase `.fx-num` en `MoneyAmount`, tablas, ejes y badges.

| Rol | Desktop | Móvil | Peso | Notas |
|---|---|---|---|---|
| metric-value | 28/34 | 24/30 | 600 | `letter-spacing: -0.02em`, color `--fx-ink-strong` |
| h1 (página) | 22/28 | 20/26 | 600 | `-0.01em` |
| h2 (panel) | 15/20 | 15/20 | 600 | — |
| money-lg (detalle) | 24/30 | 22/28 | 600 | — |
| body | 14/20 | 15/22 | 400 | — |
| table | 13/18 | — | 400 | montos en 500 |
| list (móvil) | — | 15/20 línea 1 · 13/18 línea 2 | 500 / 400 | — |
| meta / help | 12/16 | 13/18 | 400 | `--fx-muted` |
| group label | 11/16 | 11/16 | 600 | mayúsculas, solo en la sidebar y en los headers de grupo de Atención |
| input | 14 | **16** | 400 | 16 px en móvil evita el zoom de iOS |

**Jerarquía de montos.** Hay una sola cifra protagonista por panel. La composición va en 12–13 px muted. Los negativos llevan "−" y además el color danger solo en diferencias, nunca en gastos (un gasto no es un error). En un gasto, el monto va en ink con el signo "−" en la tabla.

## 6. Tokens de color (contraste calculado según WCAG 2.x)

| Token | Hex | Uso | Contraste |
|---|---|---|---|
| `--fx-canvas` | #f4f5f1 | Fondo del lienzo | — |
| `--fx-surface` | #ffffff | Paneles y tablas | — |
| `--fx-ink-strong` | #14231d | Cifras y h1 | 16,0:1 sobre surface |
| `--fx-ink` | #233c33 | Texto | 11,9:1 sobre surface · 10,8:1 sobre canvas |
| `--fx-muted` | #5f6e65 | Secundario y ejes | 5,38:1 sobre surface · 4,91:1 sobre canvas |
| `--fx-line` | #e3e7e0 | Divisores y grid | decorativo |
| `--fx-control-border` | #7f8c84 | Borde de inputs, chips y stepper | 3,51:1 sobre surface (≥3:1) |
| `--fx-primary` | #285b45 | Primary y links | blanco encima 7,86:1 · sobre canvas 7,18:1 |
| `--fx-primary-hover` | #1e4936 | Hover | — |
| `--fx-primary-soft` | #e6efe7 | Selección y tab activa móvil | primary encima 6,68:1 |
| `--fx-focus` | #285b45 | Anillo de 2 px + offset 2 px en el lienzo | 7,86:1 |
| `--fx-side-bg` | #14231d | Sidebar y top bar móvil | — |
| `--fx-side-text` | #c9d6ce | Ítems inactivos | 10,7:1 |
| `--fx-side-muted` | #8aa197 | Labels de grupo | 5,82:1 |
| `--fx-side-hover` | #1d3229 | Hover | side-text 9,08:1 |
| `--fx-side-active` | #244233 | Ítem activo | blanco 11,0:1 |
| `--fx-side-indicator` | #7fc79c | Barra activa | 5,55:1 sobre side-active |
| `--fx-side-focus` | #8fd1a8 | Foco en la sidebar | 9,04:1 sobre side-bg |
| `--fx-badge-bg` / `-fg` | #e8b75a / #231a05 | Badge de Atención | 9,24:1 |
| `--fx-success` / `-bg` | #1f6b45 / #e3f1e8 | Conciliado, Cerrada cuadrada | 5,55:1 · 6,47:1 sobre surface |
| `--fx-warning` / `-bg` | #8a5a00 / #fbf0d9 | Pendiente, Atrasado, Falta efectivo | 5,24:1 · 5,93:1 |
| `--fx-danger` / `-bg` | #a02e2e / #f8e6e4 | Diferencia, Sin sincronizar | 5,96:1 · 7,18:1 |
| `--fx-info` / `-bg` | #245a86 / #e5eef6 | Abierta, Parcial | 6,21:1 · 7,29:1 |
| `--fx-review` / `-bg` | #9a4a12 / #fbeadc | Reabierta, Requiere revisión | 5,33:1 · 6,25:1 |
| `--fx-neutral` / `-bg` | #4a5750 / #eef0ec | Anulado, Bruto, SumUp, Depositada | 6,61:1 |
| `--fx-proposal` / `-bg` / `-border` | #46505e / #eef0f4 / #8b95a3 (dashed) | Propuesta y banner | 7,16:1 |

**Paleta de gráficos.** Se valida sobre `#ffffff`. Ningún gráfico depende solo del color: siempre hay label directo, leyenda textual y "Ver como tabla".

| Serie | Hex | Contraste (≥3:1 no textual) | Nota de daltonismo |
|---|---|---|---|
| Ingresos (evolución) | #285b45 | 7,86:1 | oscuro |
| Gastos | #b5552b | 4,88:1 | cálido; luminancia distinta de ingresos (L 0,165 vs 0,084) |
| Diezmos | #5d9a78 | 3,30:1 | solo en `SourceBreakdown`, con label en la misma fila |
| Ofrendas | #3f7cac | 4,48:1 | azul: par seguro con Cafetería |
| Cafetería | #b7801a | 3,43:1 | ámbar |
| SumUp histórico sin separar | #7f8c84 + **trama diagonal** | 3,51:1 | se distingue por patrón, no solo por tono |
| Otros | #a3ada6 | 2,2:1 (excepción: siempre con label y monto en la misma fila) | — |
| Mes en curso | la misma serie con `fill-opacity .45` + borde 1 px de la serie | — | va con el label "en curso" |

**Regla:** ningún gráfico combina más de 2 series de color. Ofrendas y Cafetería (azul y ámbar) es el único par por área.

## 7. Componentes

Los nombres van en PascalCase y todos se renderizan dentro de `.fx`.

**`FinancialShell({children})`**
- Grid `[sidebar 240 | main 1fr]` a ≥1280, `[72 | 1fr]` entre 768 y 1279, y apilado por debajo de 768.
- Incluye el skip link "Saltar al contenido", `DemoBanner` y `<main id="fx-main">`.
- Monta un único `ToastRegion`.

**`FinancialSidebar({activeHref, attentionCount, variant: "full"|"rail"})`**: según §3.2 y §3.3.

**`MobileNav({activeHref, attentionCount})`**: top bar, bottom bar, `RegisterSheet` y `MoreSheet`, según §3.4.

**`FinancialHeader({title, subtitle?, period?, primaryAction?, secondaryActions?, proposal?: boolean})`**: si `proposal` es true, pone la pill Propuesta junto al h1.

**`PeriodSelector({mode: "mes"|"año", value, available: string[], onChange})`**
- **Anatomía:** segmented control [Mes | Año] (alto 32 px desktop y 40 px móvil, radius 8, borde `--fx-control-border`; el activo con fondo `--fx-primary-soft` y texto primary) + stepper `‹ Octubre 2026 ›`.
- **Flechas:** botones de 32 px (44 px en móvil), `aria-label="Mes anterior"` / `"Mes siguiente"`. Se deshabilitan en los extremos de `available`.
- **Label central:** botón (14/600, min-width 140 px) que abre un popover listbox con los meses con datos, agrupados por año (en móvil, un bottom sheet).
- **Mes en curso:** sufijo `· en curso` en 12 muted ("Octubre 2026 · en curso · 1–4 oct").
- **Valor por defecto:** mes actual, octubre 2026.
- **`available`:** solo los meses con datos del mock. Nada de rangos 2000–2099.
- El estado vive en la URL: `?periodo=2026-10` o `?periodo=2026`.

**`MetricCard({label, icon, value, composition: Link[], variation?, note, href})`** (solo en Hoy, exactamente 3):

```
┌──────────────────────────────────────┐
│ ↙ Ingresos registrados          (i)  │  13/500 muted · ícono 16 · botón info 32px
│ $ 1.284.500                          │  28/34 600 tabular ink-strong
│ ↗ 8,2 % vs 1–4 sep                   │  12/500 ink + TrendingUp, neutro (nunca verde/rojo)
│ Diezmos $412.000 (32 %) · SumUp      │  12 muted; cada parte es link
│ en bruto $598.300 · Ver desglose →   │
└──────────────────────────────────────┘
```

- Alto mínimo 148 px y padding 20 px. Toda la card **no** es un link; el link es "Ver desglose →", que lleva a Movimientos filtrado.
- El botón (i) abre un popover "Cómo se calcula" con la fórmula en palabras.
- **Variación:**
  - en un mes en curso se compara contra el mismo rango de días del mes anterior, con el texto explícito "vs 1–4 sep";
  - si no hay base comparable: "Sin mes comparable", en muted y sin flecha.
- **Ingresos registrados** (`ArrowDownLeft`). Composición: "Diezmos $X (n %) · SumUp en bruto $Y · Ver desglose →". Popover: "Suma los ingresos activos: diezmos, efectivo, transferencias y SumUp en bruto, menos devoluciones. No incluye anulados ni campañas (fuera del libro)."
- **Gastos registrados** (`ArrowUpRight`). Composición: "n gastos · mayor: {categoría} $X · Ver desglose →". Si es 0: "No se registraron gastos en el período. ¿Faltan egresos?", con `TriangleAlert` en warning.
- **Resultado del período** (`Equal`). Valor = ingresos − gastos; si es negativo, lleva "−" (en ink, no en rojo). Notas fijas en 12 muted, una por línea:
  - "Ingresos − gastos. No representa el saldo bancario."
  - si hay SumUp en el período, además: `Clock` warning + "Aún no descuenta la comisión SumUp."

**`MoneyAmount({value, size: "sm"|"md"|"lg"|"metric", sign?: "auto"|"none", basis?: "bruto"|"liquido", struck?, href?})`**
- Formato `Intl.NumberFormat("es-CL", {style:"currency", currency:"CLP"})` con "−" U+2212 y `.fx-num`.
- `basis` agrega un sufijo 12 muted (" bruto").
- `aria-label`: "menos 4.500 pesos" / "1.284.500 pesos, bruto".
- `struck` aplica `line-through` y agrega "anulado" al `aria-label`.

**`StatusBadge({status, detail?})`**
- Alto 22 px, padding 0 8 px, radius 999, texto 12/500, ícono de 12 px y gap 4.
- Fondo `-bg`, texto e ícono `-fg` del tono.

| Estado | Ícono | Texto | Tono |
|---|---|---|---|
| Propuesta | Compass | Propuesta | proposal (borde dashed; tooltip "Así funcionaría cuando exista; hoy CDS no registra esto.") |
| Ejemplo | FlaskConical | Ejemplo | transparente, borde dashed `--fx-control-border`, texto muted (tooltip "Monto de ejemplo, no es un dato real.") |
| Bruto | Receipt | Bruto | neutral |
| SumUp solo lectura | Lock | SumUp · solo lectura | neutral |
| Anulado | Ban | Anulado | neutral, con el monto tachado |
| Reembolsado | Undo2 | Reembolsado | neutral |
| Conciliado | CircleCheck | Conciliado | success (solo con depósito vinculado) |
| Con diferencia | TriangleAlert | Diferencia −$4.500 | danger |
| Pendiente | Clock | Pendiente | warning |
| Parcial | CircleDashed | Parcial · falta $X | info |
| Atrasado | AlarmClock | Atrasado · 3 d | warning |
| Abierta | LockOpen | Abierta · 09:12 | info |
| Cerrada cuadrada | Lock | Cerrada · cuadrada | success |
| Cerrada con diferencia | LockKeyhole | Cerrada · con diferencia | danger |
| Reabierta v2 | RotateCcw | Reabierta · v2 | review |
| Depositada | Landmark | Depositada | neutral |
| Sin sincronizar | CloudOff | Sin sincronizar · hace 2 h | danger |
| Falta efectivo | TriangleAlert | Falta efectivo · Cafetería | warning |
| Sin registros | CircleDashed | Sin registros | neutral |
| Comisión pendiente | Clock | Comisión pendiente de datos de SumUp | warning |
| Fuera del libro | BookX | Fuera del libro | neutral |
| Requiere revisión | Flag | Requiere revisión | review |

**`AttentionPanel({groups, compact?: boolean, max?: number})` / `AttentionItem`**
- **Orden de grupos:** Integración → Completar registros → Duplicado → Vincular → Explicar diferencia → Devolución → Depositar → Aprobar.
- **Header de grupo:** 11/600 en mayúsculas muted + conteo. Los grupos TO-BE llevan la pill Propuesta en el header (ver §15 y las notas).
- **Ítem** (min-height 56 px, padding 12 px 0, divisor 1 px):
  - ícono de 20 px en un círculo de 32 px `-bg` del tono;
  - **verbo + objeto** en 14/500 ("Registrar efectivo · Cafetería, dom 4 oct");
  - debajo, la meta en 12 muted ("SumUp $186.400 en bruto · hace 2 h");
  - a la derecha, el monto 13/500 + el badge de antigüedad (Atrasado si supera 2 d) + un botón Secondary de 32 px (44 px en móvil) con el verbo ("Registrar", "Reintentar", "Vincular", "Explicar").
- Al usar la CTA en el preview: el ítem colapsa en 200 ms y aparece el toast "Simulación: no se guardó nada." con "Deshacer" durante 6 s.
- **`compact` (Hoy):** máximo 4 ítems, sin headers de grupo, con el grupo como prefijo en la meta, y el pie "Ver los 7 pendientes →".
- **Vacío:** `CircleCheck` success de 24 px + "Todo al día" (15/600) + "No hay nada que necesite tu atención." (13 muted).

**`FinancialChart({kind: "bar"|"line", question, data, series, height, annotations?, tableCaption})`**: recharts 3 `ResponsiveContainer`.
- **Header:** h2 = la pregunta en forma de título; subtítulo 12 muted; a la derecha, un segmented [6 M | 12 M] (si aplica) y un botón ghost `Table2` "Ver como tabla" con `aria-pressed`.
- **Barras:**
  - `barCategoryGap="28%"`, `barGap={4}`, `maxBarSize={18}` (12 en móvil), `radius={[3,3,0,0]}`;
  - `CartesianGrid vertical={false} stroke="#e3e7e0"`;
  - `YAxis` con `axisLine` y `tickLine` en false, ancho 56, ticks 12 `#5f6e65` formateados con `clpShort` ("$3,2 M"), 4 ticks;
  - `XAxis` con mes corto ("sep"), tick 12 y `tickLine` false;
  - el mes en curso lleva el sufijo "*" y el pie "* en curso".
- **Tooltip personalizado:**
  - card blanca, borde 1 px `--fx-line`, radius 8, sombra `0 4px 16px rgba(20,35,29,.12)`, padding 10 px 12 px;
  - título "Septiembre 2026" en 12/600;
  - una fila por serie: swatch de 8 px + label + monto tabular;
  - una fila "Resultado" en el gráfico de evolución;
  - cursor `fill: rgba(40,91,69,.06)`.
- **Leyenda personalizada** sobre el gráfico, a la izquierda: swatch de 10×10 px radius 2 + label 12. No se usa el `Legend` por defecto.
- **Anotaciones:** `ReferenceLine x="sep 2026"` con trazo `#7f8c84` dashed 3 3 y un label arriba en 11 muted: "Diezmos y gastos registrados en CDS desde sep 2026".
- **Alto:** 280 px a ≥1280, 240 px entre 768 y 1279, y 220 px en móvil.
- **Accesibilidad del gráfico:** contenedor `role="img"` con un `aria-label` resumen. "Ver como tabla" reemplaza el gráfico en el mismo lugar por una `<table>` con `<caption>`.

**`SourceBreakdown({rows, total, campaignsOutside})`**: barras horizontales, sin recharts (son divs).
- **Fila** (alto 40 px): label 13/500 (ancho 168 px) · barra (track `#eef0ec` de 8 px, radius 4, relleno del color de la fuente al % del total) · monto 13/500 tabular · % 12 muted (ancho 48 px).
- **Orden:** de mayor a menor. "SumUp histórico sin separar" usa la trama y lleva la meta "antes del 09/09/2026 · no atribuible a Ofrendas ni Cafetería".
- **Diezmos:** es una fila más, con un tooltip en el label: "Parte de Ingresos registrados".
- **Pie:**
  - "Ingresos registrados $X · 100 %" en 13/600, con borde superior;
  - debajo, en 12 muted: "Campañas: $Y fuera del libro · Ver Campañas →".
- Ofrendas y Cafetería van en filas separadas, sin subtotal "Ofrendas + Cafetería".

**`TransactionsTable({entries, onOpen})`**
- `<table>` con `<thead>` sticky (`top: 32px`, debajo del banner), alto de header 36 px, 12/600 muted y fondo `#f9faf8`.
- **Filas:** 44 px, texto 13 px, divisor 1 px, hover `#f6f8f5`. Toda la fila es clicable: `<tr>` con un `<button>` en la celda de Descripción que abre `DetailSheet` (el resto de la fila delega el clic).
- **Columnas:**

| Columna | Ancho | Contenido |
|---|---|---|
| Fecha | 92 px | "dom 4 oct" |
| Descripción | 1fr | 13/500 + categoría 12 muted en la misma celda, 2 líneas, `line-clamp` 1 cada una |
| Fuente | 120 px | — |
| Método | 112 px | — |
| Origen | 120 px | `Lock` "SumUp" / "Manual" |
| Estado | 150 px | `StatusBadge` |
| Monto | 132 px | a la derecha, con "−" en gastos; `aria-sort` en las columnas ordenables (Fecha y Monto) |

- **Grupo SumUp** (doc 13): `SumUp · Cafetería` + "31 pagos con tarjeta" · monto + badge Bruto + "SumUp · solo lectura" · toggle `ChevronDown` "Ver 31 pagos" con `aria-expanded`. Las filas hijas se indentan 20 px y llevan una línea izquierda de 2 px `--fx-line`.
- **Franja de totales** sobre la tabla, dentro del panel: "Entradas $X · Salidas $Y · Resultado del filtro $Z · n registros". Se recalcula con los filtros.
- **Pie:** "Mostrando 1–50 de 212 filas" + paginación ‹ ›.
- **Móvil:** se convierte en `<ul>` con filas de 64 px:
  - línea 1: descripción 15/500 (truncada) y monto 15/600 a la derecha;
  - línea 2: "dom 4 oct · Cafetería · Tarjeta" en 13 muted + el ícono del estado (14 px) con su texto si no es "Activo";
  - un encabezado de día sticky (13/600, 32 px) agrupa las filas por fecha.

**`FilterToolbar({query, filters, onChange})`**
- **Desktop:** fila de 40 px.
  - Search de 280 px (alto 36 px, ícono `Search`, placeholder "Buscar descripción o monto").
  - Chips Tipo · Fuente · Método · Estado: alto 32 px, radius 999, borde `--fx-control-border`, `ChevronDown`. Cada uno abre un popover con checkboxes de 20 px.
  - Chip activo: fondo `--fx-primary-soft` con "Fuente: Ofrendas" + botón `X` de 24 px (`aria-label="Quitar filtro Fuente"`).
  - "Limpiar filtros" como link.
  - A la derecha, "Exportar" Secondary (simulación).
- **Móvil:** search a ancho completo (44 px) + botón "Filtros (2)" de 44 px que abre un bottom sheet con las secciones en radios y checkboxes. El footer sticky lleva "Limpiar" y el Primary "Ver 124 resultados".
- El estado vive en la URL.

**`DetailSheet({open, onClose, entry})`**
- `<dialog>` con `showModal()`. Scrim `rgba(20,35,29,.32)`.
- **Desktop:** panel derecho de 440 px a alto completo, fondo blanco, borde izquierdo de 1 px y sombra `-8px 0 24px rgba(20,35,29,.12)`.
- **Móvil:** bottom sheet de `max-height: 92dvh`, radius 16 px 16 px 0 0, con un handle de 36×4 px `#c9d1c8`.
- El foco inicial va al título; Esc y el botón `X` de 44 px cierran; el foco vuelve a la fila de origen.
- **Secciones**, en orden y separadas por un h3 de 13/600:
  1. **Cabecera:** ícono del tipo, descripción (h2), `MoneyAmount` lg y los badges.
  2. **Montos:**
     - Bruto;
     - Devolución;
     - Comisión: "Comisión pendiente de datos de SumUp", sin monto;
     - Líquido: solo si hay comisión real o de Ejemplo.
  3. **Datos:** Fecha · Fuente · Categoría · Método · Origen · Registrado por (nombre humano, por ejemplo "M. Soto" o "Importado de SumUp") · Comprobante.
  4. **Vínculos** (Propuesta): payout y depósito.
  5. **Historial:** "Creado por M. Soto · 04-10 10:41" (existe). El "antes → después" con motivo lleva Propuesta.
  6. **Footer sticky:**
     - movimiento manual: "Editar" Secondary y "Anular $12.000" Destructive (que abre un dialog con motivo obligatorio);
     - SumUp: "Reclasificar" y "Marcar para revisión".
     - Todo es simulación.

**`CashPanel({area, worship, cash, session?})`**
- **Existe:** "Efectivo registrado" de un monto, con su estado (Falta efectivo / registrado) y el botón "Registrar efectivo".
- **Propuesta:** sesión de cierre con doble conteo.
  - **Ofrendas:** Conteo 1 · Conteo 2 (ciego) · "Diferencia entre conteos". **No hay "esperado"**.
  - **Cafetería:** "Esperado" aparece solo como texto Propuesta, con la nota "Requiere registrar el efectivo de cada venta."
- **`DenominationCounter`:**
  - filas de 52 px para $20.000, $10.000, $5.000, $2.000, $1.000, $500, $100, $50 y $10;
  - cada fila: label 15/500 · stepper [− 44 px][input 56 px numérico, `inputmode="numeric"`][+ 44 px] · subtotal tabular a la derecha;
  - total sticky al pie (56 px): "Conteo 1 $210.000".
- Toda diferencia abre "Motivo (obligatorio)" con un select y una nota.

**`ReconciliationTable({payouts})`** (toda la página es Propuesta):
- **Columnas:** Payout (fecha + chevron) · Cuenta SumUp · Bruto · Devoluciones · Comisión · Líquido · Depósito · Estado.
- Las comisiones y los líquidos del mock llevan el badge "Ejemplo" en la celda.
- El payout sin comisión muestra "Pendiente de datos de SumUp" en las celdas Comisión y Líquido, sin monto.
- **Fila expandida:**
  - "Ventas (31) $86.400 · Ver movimientos →";
  - "Depósito 06-10 $80.000 · vinculado por M. Soto";
  - acciones [Explicar diferencia] [Vincular otro depósito] [Marcar para revisión].
- **Tabs:** "Necesita acción (n)" (por defecto) · "Todos (n)".

**`EmptyState({icon, title, body, action?})`**: centrado, padding 40 px; ícono de 24 px en un círculo de 48 px `#eef0ec`; título 15/600 y cuerpo 13 muted (máx. 360 px).

**`ErrorState({title, body, retry})`**: ícono `CloudOff` o `TriangleAlert` en danger, título en lenguaje humano y el botón "Reintentar". Nunca muestra el error crudo.

**`Skeleton`**: bloques `#eceee9` con radius 6. Animación de opacidad 1 → .55 en 1,2 s alternado; con reduced motion, estática. Las tablas muestran 8 filas skeleton de 44 px.

**`Toast({message, action?})`**
- Región `role="status" aria-live="polite"`, con un solo toast visible.
- **Desktop:** abajo a la derecha, a 24 px. **Móvil:** centrado, a `bottom: calc(64px + safe-area + 12px)`.
- Fondo `#14231d`, texto 14 blanco, ícono `Info` `#8fd1a8`, radius 10, padding 12 px 16 px, máx. 420 px. Duración 5 s (6 s con "Deshacer").
- Texto de simulación: **"Simulación: no se guardó nada."**

**Botones:**
- alto 36 px desktop y 44 px móvil, radius 8, texto 14/600, padding 0 14 px;
- Primary: `--fx-primary` con texto blanco;
- Secondary: blanco con borde `--fx-control-border` y texto ink;
- Ghost: sin borde, texto primary;
- Destructive: fondo `--fx-danger` con texto blanco y el verbo exacto.

## 8. Layouts por pantalla

Los valores son ilustrativos; los números exactos los define el mock.

### 8.1 Hoy (`/preview/finanzas-2026`), desktop 1440

```
┌sidebar 240┬─ Vista previa · datos de demostración. Nada de lo que hagas aquí se guarda. ──────┐
│           │ Hoy                                   [Mes|Año] ‹ Octubre 2026 · en curso › [+ Registrar ▾] │
│           │ Domingo 4 de octubre · culto hoy                                                     │
│           │ ┌Ingresos registrados─┐┌Gastos registrados──┐┌Resultado del período─┐   (4 col c/u)  │
│           │ │$ 1.284.500          ││$ 312.000           ││$ 972.500             │                │
│           │ │↗ 8,2 % vs 1–4 sep   ││↘ 3,1 % vs 1–4 sep  ││Ingresos − gastos. No │                │
│           │ │Diezmos $412.000 ·…  ││6 gastos · mayor: … ││representa el saldo…  │                │
│           │ └─────────────────────┘└────────────────────┘└──────────────────────┘                │
│           │ ┌¿Cómo evolucionan ingresos y gastos? (8 col)──┐┌Atención (7) (4 col)──────────┐     │
│           │ │ [6 M|12 M]                 [Ver como tabla] ││⚠ Registrar efectivo · Cafet. │     │
│           │ │ ▇▁ ▇▁ ▇▁ ▇▁ ▇▁ ▇▁ ┆▇▆ ▇▅ *               ││⟳ Reintentar SumUp Cafetería  │     │
│           │ │ nov … ago        ┆sep  oct               ││◌ Sin registros · mié 30 sep  │     │
│           │ └─────────────────────────────────────────────┘│Ver los 7 pendientes →        │     │
│           │ ┌Ingresos por fuente─┐┌Estado operativo──────┐┌Actividad reciente───┐   (4/4/4)   │
│           │ │Diezmos  ████ 32 %  ││Efectivo de hoy       ││13:05 M. Soto regis… │             │
│           │ │Cafetería ███ 28 %  ││ Ofrendas  ✓ $210.000 ││12:40 SumUp Ofrendas │             │
│           │ │Ofrendas  ██  15 %  ││ Cafetería ⚠ Falta ef.││ 14 pagos sincroniz. │             │
│           │ │Otros     ▏   2 %   ││Integraciones         ││…           Ver todo │             │
│           │ │Campañas: fuera del ││ SumUp Ofr. ✓ hace 12m││                     │             │
│           │ │libro →             ││ SumUp Caf. ⨯ Sin sinc││                     │             │
│           │ │                    ││Cajas [Propuesta]     ││                     │             │
│           │ └────────────────────┘└──────────────────────┘└─────────────────────┘             │
```

- **Subtítulo del h1:** "Domingo 4 de octubre · culto hoy".
- **Estado operativo:** subsección "Cajas" con la pill Propuesta: "Ofrendas · Cerrada con diferencia" y "Cafetería · Abierta 09:12".
- **Actividad reciente:** 5 eventos, cada uno con hora 12 muted + "Nombre + verbo + objeto + monto". Sin avatares de foto.

### 8.2 Hoy, móvil 390

```
[Vista previa · datos de demostración]
[■ Casa de Salvación        Demo (TD)]  56 dark
Hoy
Domingo 4 oct · culto hoy
[Mes|Año]  ‹ Octubre 2026 · en curso ›   (ancho completo)
┌Ingresos registrados ─ $1.284.500 ┐  card compacta 24px
│↗ 8,2 % vs 1–4 sep · Diezmos …    │
└──────────────────────────────────┘
┌Gastos registrados ─────────────── ┐
┌Resultado del período ──────────── ┐ (+ nota saldo/comisión)
Atención (7) → 3 ítems + "Ver los 7"
Ingresos y gastos (6 M por defecto, 220 px)
Ingresos por fuente
Estado operativo
Actividad reciente (3 eventos)
[Hoy][Movimientos][ (+) ][Atención•7][Más]
```

### 8.3 Atención
- **Desktop:** h1 "Atención", subtítulo "Lo que necesita una acción, ordenado por prioridad." Arriba, un segmented [Todas | Mis tareas]. Debajo, `AttentionPanel` completo con los grupos, en una columna de máx. 880 px. Sin métricas.
- **Móvil:** igual, con CTAs de 44 px a ancho completo bajo cada ítem.

### 8.4 Movimientos
- **Desktop:**
  - h1 "Movimientos", subtítulo "Entradas y salidas del período. Los pagos SumUp se agrupan por día.";
  - `PeriodSelector` + "+ Registrar";
  - un panel con `FilterToolbar` → franja de totales → `TransactionsTable` (a 1440×900 se ven ≥15 filas).
- **Móvil:** search + "Filtros", luego la franja de totales en 2 líneas (Entradas / Salidas; Resultado del filtro) y después la lista agrupada por día.

### 8.5 Caja
- **Desktop:** h1 "Caja", subtítulo "Efectivo por culto y por área." Dos columnas: Ofrendas | Cafetería.
  - Cada `CashPanel` muestra el último culto (dom 4 oct) y debajo los cultos anteriores en una lista: Fecha · Efectivo · Estado.
  - Sección "Cierre con doble conteo" con la pill Propuesta.
- **Móvil** (pantalla clave):

```
Caja · Ofrendas  dom 4 oct
[Efectivo registrado  $210.000 ✓]  (existe)
── Cierre con doble conteo [Propuesta] ──
① Conteo 1 · M. Soto   ✓ $210.000
② Conteo 2 · (ciego)   [Contar]
$20.000  [−][ 6][+]  $120.000
$10.000  [−][ 7][+]   $70.000  …
───────────────────────────────
Conteo 2   $205.500        sticky
Diferencia entre conteos  −$4.500  ⚠
Motivo (obligatorio) [▾]
[ Guardar conteo ]  44px · simulación
```

### 8.6 Conciliación
- h1 "Conciliación" con la pill Propuesta. Subtítulo: "Así se vincularían los payouts de SumUp y el efectivo con los depósitos del banco."
- Tabs "Necesita acción" / "Todos", y debajo `ReconciliationTable`.
- Debajo, la sección "Efectivo → depósito": la misma tabla con la caja como unidad.
- **Móvil:** cada payout se muestra como una fila de 2 líneas ("19 sep · SumUp Ofrendas" con el estado; "Bruto $102.000 · Líquido $94.654 [Ejemplo]") que abre `DetailSheet`.

### 8.7 Ofrendas
- h1 "Ofrendas", subtítulo "Donaciones de los cultos: efectivo y SumUp en bruto."
- **Fila 1 (sin MetricCard):** franja de texto "Octubre: SumUp $X bruto · Efectivo $Y · n cultos".
- **Gráfico:** "¿Cuánto se ofrendó en los últimos 8 cultos?", barras agrupadas SumUp bruto (#3f7cac) vs efectivo (#285b45).
- **Tabla "Cultos":** Fecha · SumUp (bruto) · Efectivo · Estado. Si el rango cruza el 09/09: nota "Áreas separadas desde 09/09/2026", y los cultos previos aparecen como "No comparable".
- **Fila explícita:** "SumUp histórico sin separar (hasta 08/09/2026) — no se atribuye a Ofrendas".
- **Línea de integración:** "SumUp Ofrendas: ✓ Sincronizado hace 12 min".

### 8.8 Diezmos
- h1 "Diezmos". Buscador "Buscar persona o familia" a ancho completo.
- **Filas de 48 px:** Nombre · Tipo · Último registro · Estado · [Registrar]. Las fichas son internas y no salen en reportes.
- **Bloque "Por mes":** tabla Mes · Monto · Registros, con la nota "Diezmos registrados en CDS desde sep 2026". Con menos de 3 meses **no hay gráfico**: se muestra "El gráfico aparece con 3 meses de datos."

### 8.9 Cafetería
- h1 "Cafetería", subtítulo "Ventas: SumUp en bruto y efectivo."
- Mismo esquema que Ofrendas, con el gráfico "Ventas de los últimos 8 cultos".
- Sección "Payouts" con la pill Propuesta.
- **Nunca** se muestra un total conjunto con Ofrendas.

### 8.10 Campañas
- h1 "Campañas" con el badge "Fuera del libro". Nota: "Las campañas se llevan aparte y no suman a Ingresos registrados."
- Lista: Campaña · Meta · Recaudado · Envíos por aprobar (esto existe, sin pill).

### 8.11 Reportes
- h1 "Reportes", `PeriodSelector` y "Exportar PDF" (simulación).
- **Orden:**
  1. resumen ejecutivo (párrafo del doc 12);
  2. alertas;
  3. `FinancialChart` "Ingresos vs gastos (12 meses)";
  4. "Ingresos por fuente" (`SourceBreakdown`);
  5. "Últimos 8 cultos por área" (Ofrendas vs Cafetería, barras agrupadas sin sumar);
  6. las tablas por tipo de dinero y por fuente, con "No comparable" antes del 09/09.

### 8.12 Configuración
- Lista de ajustes en filas de 56 px: Integraciones (SumUp Ofrendas / Cafetería con su estado), Categorías, Usuarios y Días de culto (mié y dom, solo lectura).
- Las acciones son simulación.

## 9. Gráficos: pregunta que responde cada uno

| Gráfico | Pregunta | Tipo | Notas obligatorias |
|---|---|---|---|
| Ingresos y gastos (Hoy, Reportes) | ¿Cómo evolucionan los ingresos y los gastos mes a mes? | Barras agrupadas, 6 M o 12 M | ReferenceLine en sep 2026: "Diezmos y gastos registrados en CDS desde sep 2026". Los meses previos llevan la nota "Ingresos de ese período: mayormente SumUp histórico". |
| Ingresos por fuente | ¿De dónde vino el dinero del período? | Barras horizontales + % | Histórico con trama; campañas fuera del libro |
| Últimos 8 cultos (Ofrendas, Cafetería) | ¿Cómo viene cada culto, en SumUp y en efectivo? | Barras agrupadas | Antes del 09/09: "No comparable" en lugar de la barra |
| Últimos 8 cultos por área (Reportes) | ¿Cómo se comparan Ofrendas y Cafetería por culto? | Barras agrupadas | Dos series, sin total combinado |

No hay donuts, ni líneas de saldo, ni sparklines decorativos.

## 10. Estados (se fuerzan con `?estado=`)

| Pantalla | Cargando | Vacío | Error |
|---|---|---|---|
| Hoy | 3 skeletons de métrica de 148 px, gráfico skeleton de 280 px y 4 filas | "Sin movimientos en octubre 2026" · "Cuando se registren ingresos o gastos aparecerán aquí." [Registrar] | "No pudimos cargar los datos" · "Revisa tu conexión e inténtalo de nuevo." [Reintentar] |
| Atención | 4 ítems skeleton | "Todo al día" | ídem |
| Movimientos | 8 filas de 44 px | Con filtros: "Ningún movimiento coincide con los filtros." [Limpiar filtros]. Sin datos: "Aún no hay movimientos en este período." | ídem |
| Caja | 2 paneles skeleton | "No hubo culto en este período." | ídem |
| Conciliación | 6 filas | "No hay payouts por revisar." | ídem |
| Ofrendas / Cafetería | Gráfico + 6 filas | "Sin ingresos de Ofrendas en este período." | ídem |
| Diezmos | 6 filas | "No hay personas que coincidan con «…»." | ídem |
| Reportes | Párrafo + gráfico | "No hay datos para este período." | ídem |
| Integración caída | — | — | Badge "Sin sincronizar · hace 2 h" + "No se pudo conectar con SumUp. Los pagos nuevos aparecerán al reintentar." [Reintentar] |

## 11. Reglas responsive

| Viewport | Navegación | Hoy | Movimientos | Otros |
|---|---|---|---|---|
| 1440×900 | Sidebar 240 | Fila 3 + (8\|4) + (4\|4\|4) | 7 columnas, ≥15 filas visibles | Sheet de 440 px |
| 1280×800 | Sidebar 240 | Igual que 1440, con padding 32 | Igual | — |
| 1024×768 | Rail 72 | Métricas en 3; luego Atención compacta (12 col), gráfico (12), Fuentes \| Estado (6\|6) y Actividad (12) | Se oculta Origen (el badge SumUp va en Estado) | Conciliación oculta Devoluciones (pasa al expandible) |
| 768 | Rail 72 | Métricas en 3 (valor de 24 px); lo demás a 6 columnas, apilado | Se ocultan Fuente y Origen | Filtros en el popover |
| 390×844 / 375×812 | Top bar + bottom bar | Todo apilado (§8.2); gráfico de 6 M | Lista de 2 líneas; filtros en bottom sheet | Sheets inferiores; CTAs de 44 px; inputs de 16 px |

**Siempre:**
- `overflow-x: clip` en `.fx`;
- las tablas desktop viven en un contenedor con `overflow-x: auto` solo a ≥768;
- en móvil no hay tablas de más de 3 columnas;
- los textos largos se truncan con `text-overflow: ellipsis` y `title`.

## 12. Accesibilidad (checklist)

1. Contraste: todos los pares de §6 cumplen AA; los gráficos ≥3:1, salvo "Otros", que va siempre con label.
2. Foco: 2 px `--fx-focus` con offset 2 px (`--fx-side-focus` en la sidebar), solo con `:focus-visible`.
3. Targets: ≥44×44 px en móvil y ≥32 px en desktop.
4. Estados: ícono + texto. Las pantallas se revisan en escala de grises.
5. Tablas `<table>` con `<caption>` (visualmente oculto), `scope="col"` y `aria-sort`.
6. Navegación con landmarks (`nav`, `main`, `aria-current="page"`) y skip link.
7. Sheets y diálogos con `<dialog>` + `showModal()`, foco inicial y devolución del foco al cerrar.
8. Montos con `aria-label` que lee el signo y la base (bruto).
9. Gráficos con `role="img"` + resumen, y "Ver como tabla".
10. Toasts con live region `polite`; los errores de formulario con `role="alert"` inline.
11. Reduced motion respetado (§13).
12. Idioma `lang="es-CL"` y fechas legibles ("domingo 4 de octubre").

## 13. Motion

| Qué | Duración | Easing | Por qué | Con reduced motion |
|---|---|---|---|---|
| Sheet lateral o inferior | 200 ms | `cubic-bezier(.2,.8,.2,1)` | continuidad con el origen | aparece sin desplazamiento (solo fade de 100 ms) |
| Expandir fila o grupo | 150 ms (rotación del chevron) | ease-out | estado | instantáneo |
| Ítem de Atención resuelto | 200 ms (colapso de alto) | ease-in-out | feedback | se quita sin animación |
| Toast | 150 ms de entrada (translateY 8 px) | ease-out | feedback | sin translate |
| Barras de recharts | 300 ms, una sola vez | ease-out | orientación | `isAnimationActive={false}` |
| Hover de ítems y botones | 120 ms `background-color` | linear | feedback | igual |

Las duraciones son **HIPÓTESIS** heredadas del doc 08: no hay evidencia medida. No se usan `transition-all`, count-up ni parallax.

## 14. Qué evitar

- La palabra "Saldo" como label, métrica o título. Solo se permite dentro de la frase fija "No representa el saldo bancario".
- Una cuarta métrica, "Diezmos" como métrica paralela, o Campañas dentro de Ingresos.
- Un total sin rótulo que sume Ofrendas y Cafetería.
- "Líquido" sin comisión real o sin el badge Ejemplo; "Conciliado" sin depósito.
- Variaciones en verde o rojo; violeta; gradientes; glassmorphism; sombras en los paneles.
- Card de tarjeta bancaria, "Daily limit" o upsell (todo eso es de PayFlow).
- Un esperado editable; Editar o Eliminar en filas SumUp.
- Jerga: Firestore, UID, backend, ledgerAmount, sync payload, `system:sumup`.
- Donuts, gráficos de 3 o más series de color, ejes de 100 años.
- Tablas transformadas en cards en desktop; scroll horizontal accidental en móvil.
- Importar Firebase en el preview; CSS fuera de `.fx`.

## 15. Criterios de aceptación de diseño (revisión visual)

1. A 1440×900, Hoy muestra sin scroll: banner, header, las 3 métricas y la parte superior del gráfico y de Atención.
2. Las métricas son exactamente 3, con esos nombres. Resultado lleva "No representa el saldo bancario" y, con SumUp en el período, "Aún no descuenta la comisión SumUp".
3. Toda métrica y toda fila de `SourceBreakdown` lleva a su composición en ≤2 clics.
4. Diezmos aparece solo como desglose; Campañas aparece como "fuera del libro".
5. Ningún total combina Ofrendas y Cafetería sin rótulo. "SumUp histórico sin separar" lleva trama y nota.
6. Todo monto SumUp dice "bruto". No aparece "Líquido" sin badge Ejemplo o comisión real.
7. Todo lo TO-BE (cajas con conteos, payouts, depósitos, conciliación, historial antes → después, duplicados) lleva la pill Propuesta con su tooltip; los montos de ejemplo llevan "Ejemplo".
8. La sidebar cumple §3.2: 240 px, ítems de 36 px, activo con fondo `#244233` + barra `#7fc79c` + `aria-current`, y el badge de Atención con el conteo.
9. Entre 768 y 1279 se ve el rail de 72 px con tooltips; por debajo de 768, la top bar y la bottom bar [Hoy][Movimientos][+ Registrar][Atención][Más], y "Más" lista el resto.
10. A 390 y 375 px: sin scroll horizontal, targets ≥44 px, inputs de 16 px y tablas convertidas en listas de 2 líneas.
11. A 1440×900, Movimientos muestra ≥15 filas, header sticky, montos tabulares a la derecha y grupos SumUp expandibles con `aria-expanded`.
12. Las filas SumUp ofrecen solo "Reclasificar" y "Marcar para revisión". Toda acción del preview muestra el toast "Simulación: no se guardó nada."
13. En Caja (Ofrendas) se ven Conteo 1 / Conteo 2 (ciego) / Diferencia entre conteos, sin "esperado". La diferencia exige motivo y el stepper funciona con una mano a 375 px.
14. Todo gráfico tiene la pregunta como título, la anotación del 09/09 o de sep 2026 cuando corresponde, y "Ver como tabla" con una `<table>` equivalente.
15. Los estados se entienden en escala de grises: ícono + texto en todos los badges de §7.
16. Los contrastes de §6 se verifican con una herramienta en el build real, y el foco es visible en la sidebar y en el lienzo.
17. Con `prefers-reduced-motion`, sheets y barras aparecen sin desplazamiento.
18. `?estado=cargando|vacio|error` muestra los estados de §10 con su copy.
19. No aparecen "Saldo" (fuera de la frase fija), "Firestore", "UID" ni "ledgerAmount".
20. **Capturas obligatorias** para la revisión:
    - (a) Hoy desktop a 1440×900;
    - (b) Hoy móvil a 390×844;
    - (c) Movimientos desktop a 1440×900 con un grupo SumUp expandido;
    - (d) Movimientos móvil a 390×844 con el sheet de filtros abierto;
    - (e) Caja móvil a 375×812 durante el Conteo 2;
    - (f) Conciliación desktop a 1440×900 con una fila expandida;
    - (g) Ofrendas desktop a 1440×900;
    - (h) Diezmos desktop a 1440×900;
    - (i) Reportes desktop a 1440×900;
    - además: Hoy a 1024×768 (rail) y Hoy a 1280×800.

## 16. Notas de Designer y resoluciones del Conductor

| # | Nota de Designer | Resolución |
|---|---|---|
| 1 | Atlas prohíbe "Saldo" y Navigator exige "No representa el saldo bancario" | **Resuelto:** la palabra solo aparece dentro de esa frase fija. Ninguna métrica, label ni título dice "Saldo". Un test de texto lo verifica |
| 2 | Variación en el mes en curso | **Aceptado:** se compara contra el mismo rango de días del mes anterior ("vs 1–4 sep"), siempre con el rango escrito. Si la base no es homogénea (diezmos no registrados antes de sep 2026), se agrega la nota "No homogénea" |
| 3 | Clasificación de los grupos de Atención | **Aceptado:** Integración, Completar registros y Aprobar existen hoy. Duplicado, Vincular, Explicar diferencia, Devolución y Depositar son **Propuesta**. Devolución es Propuesta porque depende de la caja (TO-BE) |
| 4 | Esperado de Cafetería | **Aceptado como Propuesta**, con la dependencia explícita ("Requiere registrar el efectivo de cada venta"). En Ofrendas no hay esperado |
| 5 | Motion y medidas | Se mantienen como HIPÓTESIS; se validan en la revisión visual |
| 6 | Investigación | La carpeta `docs/design-references/` **no existe** en ninguna rama ni en el disco. La única referencia encontrada es la captura `~/Downloads/IMG_6457.PNG` (dashboard "PayFlow"), que no se versiona en el repo por ser una captura de terceros |
| 7 | Color "Otros" bajo 3:1 | **Resuelto:** se usa `#6f7d75` (≥3:1 sobre blanco), además del label |
| 8 | Learning: variación en tono neutro | Queda como candidato; no se guarda en el Brain hasta que Salvador lo valide |

**Fuente de datos del preview.** Fixtures sintéticos y deterministas en `lib/finance-preview/fixtures.ts`. Las magnitudes son plausibles pero **no son datos reales** (Atlas §2.5). Todas las cifras visibles salen de `lib/finance-preview/selectors.ts`.
