# Slice 6: Usabilidad financiera (spec de Designer para Builder)

Base: `mission/slice1b-truthful-labels`. Reutiliza el Design Lock (08): tokens, estados con ícono + texto, sin grillas de KPI y la palabra "bruto" siempre explícita.
**Principio:** menos clics y totales a la vista. No es un rediseño visual; se reorganiza lo que ya funciona.

## A. Diagnóstico

1. El login lleva a `/dashboard` (`app/login/page.tsx:20`, `app/page.tsx:13`), que es una portada sin uso operativo (`app/(private)/dashboard/page.tsx:36-127`). Además, la barra lateral muestra "Dashboard" y la tarjeta "Un mismo propósito" (`app-shell.tsx:20, 89-98`).
2. La cabecera de Finanzas (eyebrow, H1 4xl y tagline) empuja el contenido unos 120 px hacia abajo (`finanzas/layout.tsx:10-16`).
3. El Resumen no dice cuánto entró por tipo de dinero. Los KPIs genéricos están en `kpis.tsx:13-20`; SumUp aparece al final (`summary-page.tsx:363-398`) y el efectivo no aparece en ninguna parte.
4. "Registrar diezmo" cambia de página. No existen "Registrar efectivo" ni "Registrar gasto". `TransactionForm` siempre abre como "Entrada" (`transaction-form.tsx:47`).
5. Ofrendas lista cada pago SumUp (`offerings-page.tsx:626-651`) y dispara 2 queries de 1.000 documentos (`:391-392`).
6. En las tarjetas de área, el total del mes queda como un `<small>`. "Sincronizar" es el CTA primario y el aviso del 09/09 ocupa un bloque grande.
7. Diezmos se muestra como grilla de tarjetas, sin opción de registrar desde la fila. El método por defecto es Efectivo, aunque los diezmos llegan por transferencia.
8. La ficha no muestra método, comprobante ni totales por mes, y el selector ofrece 100 años (`profile-page.tsx:198-237`).
9. El reporte es KPIs + gráficos + lista. No incluye análisis ni alertas.
10. No se detecta el caso "SumUp sin efectivo". `saveDailyCash` rechaza montos ≤ 0 (ver G1).

## B. Navegación

- **Login:** después de iniciar sesión, todos los roles van a `/finanzas`. Hay que cambiar `app/login/page.tsx:20` y `app/page.tsx:13`.
- **`/dashboard`:** pasa a ser solo `router.replace("/finanzas")`.
- **Otras rutas:** `settings-guard.tsx:15` debe apuntar a `/finanzas`. Actualizar `tests/auth.test.tsx`.
- **Barra lateral:** Finanzas · Configuración (esta última solo para admin). Se eliminan el ítem Dashboard, la tarjeta "Un mismo propósito" y el tagline del footer; el footer queda como "Casa de Salvación".
- **Cabecera de Finanzas:** solo `<h1>Finanzas</h1>` en `text-2xl`, seguido de `FinanceNav`.
- **FinanceNav:** Resumen · Movimientos · **Ofrendas y Cafetería** · Diezmos · Campañas · Reportes. La ruta `/finanzas/ofrendas` no cambia.

## C1. Resumen (`summary-page.tsx`), roles con detalle

Orden de los bloques:

**0. Controles.** Se mantienen: Diario/Mensual/Anual y PeriodPicker.

**1. Acciones.**

| Botón | Tipo | Comportamiento |
|---|---|---|
| `Registrar efectivo` | primario | Abre `CashModal` aquí mismo. Se extrae a `components/finance/offerings/cash-modal.tsx` y se le agrega un selector de área (Ofrendas \| Cafetería). Área por defecto: la primera con SumUp y sin efectivo ese día; si no hay, Ofrendas. Fecha por defecto: hoy. |
| `Registrar diezmo` | secundario | Abre `TitheRegister` como modal aquí mismo. |
| `Registrar gasto` | secundario | Abre `TransactionForm` con la prop nueva `initialType="expense"`. |
| `Otro movimiento` | ghost | Igual que hoy. |
| `Reporte del mes` | ghost | Link a `/finanzas/reportes` con el período (si no persiste solo, pasarlo como `?periodo=YYYY-MM`). |

**2. "Ingresos por tipo de dinero".** Tabla compacta con columnas Tipo · Monto · % · Movimientos. Toma `latest.data` activos de tipo `income`. Filas:
- `Efectivo`: `paymentMethod === "cash"`.
- `Tarjeta SumUp · bruto`: `card` e `isSumUp` (`id.startsWith("sumup_") || createdBy === "system:sumup"`).
- `Tarjeta · otra`: `card` que no es SumUp. Solo si es > 0.
- `Transferencia`.
- `Otro`: solo si es > 0.
- `Total ingresos`: en semibold.

Debajo de la fila SumUp, en 12 px y color muted: `Ofrendas $X · Cafetería $Y · Histórico sin separar $Z` (agrupado por categoría). Esto reemplaza la `summary-sumup-card`.
Nota al pie: `SumUp en bruto: la comisión aún no está disponible.`
Si el total ≠ `incomeTotal` de los resúmenes, mostrar: `Los datos se están sincronizando; los totales pueden cambiar en segundos.`
Porcentajes con 1 decimal en formato es-CL. Montos tabulares, alineados a la derecha. La lógica va en un helper puro testeable `incomeByMethod` en `lib/finance/`.

**3. "Por fuente".** Dos columnas.
- Izquierda, "Ingresos por fuente": `total.incomeByCategory` ordenado de mayor a menor.
- Derecha: Gastos, Resultado y la nota "no representa el saldo bancario".
- Si `expenseTotal === 0 && incomeTotal > 0`, mostrar `No se registraron gastos en el período. ¿Faltan egresos?` con `TriangleAlert` en tono warning.

Este bloque reemplaza `<Kpis>` **solo** para los roles con detalle.

**4. "Días por revisar (n)"** (solo en vista mensual). Lista de alertas del calendario; cada ítem es un botón que selecciona ese día. Si no hay alertas: `CircleCheck` + `Todo registrado en los días de culto de este mes.`

**5. Calendario** (solo en vista mensual) con el panel del día.
- Desktop (≥1024 px): calendario al 60 % y panel al 40 %.
- Móvil: el panel va abajo y se hace `scrollIntoView`.
- Vista Anual: `Selecciona Mensual para ver el calendario.`
- Vista Diaria: no hay calendario; el panel del día reemplaza a `summary-day-balance`.

**6. Gráficos.** `FinanceCharts` sin cambios.

**7. Últimos movimientos.** Se mantiene igual.

**Rol leader:** sin cambios.
**Orden en móvil:** acciones → por tipo de dinero → días por revisar → calendario + panel → por fuente → gráficos → últimos movimientos. `Registrar efectivo` va a ancho completo (44 px); Diezmo, Gasto y Reporte van en una fila de 3.

```
Finanzas
Resumen · Movimientos · Ofrendas y Cafetería · Diezmos · Campañas · Reportes
[Diario|Mensual|Anual] Mes [Septiembre▾] Año [2026▾]
[+ Registrar efectivo] [+ Diezmo] [+ Gasto] [Otro movimiento] [Reporte del mes →]

INGRESOS POR TIPO DE DINERO                          Monto        %     Mov.
 Efectivo                                         $ 900.000    13,4 %     n
 Tarjeta SumUp · bruto                          $ 2.891.000    43,0 %     n
   Ofrendas $165.500 · Cafetería $1.922.700 · Histórico sin separar $802.800
 Transferencia                                  $ X            …
 Total ingresos                                 $ 6.717.397   100 %     588
 SumUp en bruto: la comisión aún no está disponible.

INGRESOS POR FUENTE                    │ GASTOS Y RESULTADO
 Diezmos                  $2.926.397   │ Gastos          $0
 Cafetería                $2.362.700   │ Resultado       $6.717.397
 SumUp histórico s/separar  $802.800   │ ⚠ No se registraron gastos en el período. ¿Faltan egresos?
 Ofrendas                   $625.500   │

DÍAS POR REVISAR (n)
 ⚠ Falta efectivo · Cafetería — dom 20 sep                          [Ver día]
 ○ Sin registros — mié 2 sep (culto)                                [Ver día]
```

## C2. Ofrendas y Cafetería (`offerings-page.tsx`)

1. **Header.** Título `Ofrendas y Cafetería`. Subtítulo `Tarjeta SumUp (bruto) y efectivo, por día y por mes.` Sin botones en el header.
2. **Barra de fecha.** `‹` · input Fecha · `›` · `Hoy`. Si el mes incluye días anteriores al 09/09/2026, agregar una línea informativa de 12 px: `Hasta el 08/09/2026 SumUp no separaba áreas: {clp(legacyCardMonth)} quedó como "SumUp histórico sin separar".` Esta línea reemplaza el bloque `sumup-cutoff-notice`.
3. **Tarjetas Ofrendas y Cafetería.** En desktop van lado a lado; en móvil, apiladas con Ofrendas primero. Usan `sumFinanceDay`/`sumFinanceMonth`, que ya existen, sin queries nuevas. El efectivo del día sale de `findActiveDailyCash(...)?.amount`. Cada tarjeta muestra:
   - Título del área en h3, sin eyebrow.
   - Bloque **Día · {mié 16 sep}**: `Tarjeta SumUp (bruto)`, `Efectivo`, `Total del día`. Si SumUp > 0 y no hay efectivo, el valor del efectivo se reemplaza por `⚠ Falta efectivo` en tono warning.
   - Bloque **Mes · {septiembre 2026}**: `Tarjeta SumUp (bruto)`, `Efectivo`, `Total del mes`. Si el mes incluye el 09/09/2026, agregar el sufijo `(desde 09/09)`.
   - Botón: `Registrar efectivo` (primario) si no hay efectivo, o `Editar efectivo · {clp}` (secundario) si ya existe.

   Una sola nota debajo de las dos tarjetas: `Montos SumUp en bruto: la comisión aún no está disponible.` Para fechas anteriores al 09/09 se mantiene la tarjeta "Histórico SumUp" actual.
4. **"Días del mes".** Tabla densa: Fecha · Ofrendas SumUp · Ofrendas efectivo · Cafetería SumUp · Cafetería efectivo · Estado (reglas de D).
   - Incluye los días con ingresos de esas categorías y los días de culto ya pasados, ordenados de más reciente a más antiguo.
   - Al hacer clic en una fila cambia `selectedDate`.
   - En móvil, cada día ocupa 2 líneas.
   - Si no hay datos: `Sin ingresos de Ofrendas ni Cafetería en este mes.`
5. **Integración SumUp.** Una sola línea discreta de 12 px: `SumUp Ofrendas: ✓ Conectado · 22-09 10:02 · SumUp Cafetería: ✓ Conectado · … [Sincronizar ahora]` (botón ghost). Si hay error o no está configurada: `CloudOff` + texto + `lastError`. Se eliminan las `offering-integration-card`.
6. **Página pública.** `Página pública de ofrendas · /ofrendar  [Ver página] [Configurar]` (abre `GivingSettingsModal`).
7. **Se ELIMINA** la sección "Últimas ofrendas por tarjeta física" (`:626-651`), junto con `useSumUpTransactions(..., 1000)` (`:391-392`) y sus errores.

```
Ofrendas y Cafetería
[‹] Fecha [16-09-2026] [›] [Hoy]
ⓘ Hasta el 08/09/2026 SumUp no separaba áreas: $802.800 quedó como "SumUp histórico sin separar".
┌ Ofrendas ───────────────────────┐ ┌ Cafetería ──────────────────────┐
│ Día · mié 16 sep                │ │ Día · mié 16 sep                │
│  Tarjeta SumUp (bruto)  $45.000 │ │  Tarjeta SumUp (bruto) $210.000 │
│  Efectivo              $120.000 │ │  Efectivo      ⚠ Falta efectivo │
│  Total del día         $165.000 │ │  Total del día         $210.000 │
│ Mes · septiembre (desde 09/09)  │ │ Mes · septiembre (desde 09/09)  │
│  Tarjeta SumUp (bruto) $165.500 │ │  Tarjeta SumUp (bruto)$1.922.700│
│  Efectivo              $460.000 │ │  Efectivo               $440.000│
│  Total del mes         $625.500 │ │  Total del mes        $2.362.700│
│ [Editar efectivo · $120.000]    │ │ [ Registrar efectivo ]          │
└─────────────────────────────────┘ └─────────────────────────────────┘
Montos SumUp en bruto: la comisión aún no está disponible.
DÍAS DEL MES  (tabla)
SumUp Ofrendas: ✓ Conectado · … [Sincronizar ahora]
Página pública de ofrendas · /ofrendar [Ver página] [Configurar]
```

## C3. Diezmos y ficha

**Lista (`tithes-page.tsx`):**
- Orden: header con `+ Registrar diezmo`, luego el **buscador** a ancho completo (label `Buscar persona o familia`, placeholder `Escribe el inicio del nombre…`, con `autoFocus` en desktop), luego los resultados y, al final, los KPIs actuales.
- Los resultados pasan de grilla de tarjetas a **filas** de 48 px: Nombre · Persona/Familia · Último registro · Estado · botón `Registrar` (abre `TitheRegister initialProfile`).
- Al hacer clic en el nombre se abre la ficha. En móvil, cada fila ocupa 2 líneas y el botón mide 44 px. Las fichas inactivas no muestran botón.

**Ficha (`profile-page.tsx`):**
1. Encabezado: se mantiene.
2. **NUEVO, franja "Aportes":** `Este mes $X · Este año $Y (n) · Últimos 12 meses $Z · Último registro dd-mm-aaaa`. Los datos salen de `recent`/`history` activos, sin queries nuevas.
3. Contacto: se mantiene.
4. Gráfico de 12 meses: se mantiene.
5. **"Historial {año}":**
   - Muestra `Total {año}: $X · n registros`.
   - El selector de año va de 2024 al año actual.
   - La tabla se **agrupa por mes** (fila de grupo `Septiembre 2026 · 2 registros · $120.000`, mes más reciente primero), con columnas Fecha · Método · Monto · Comprobante · Estado · Nota.
   - **Método:** es una query nueva. Se leen los `financeTransactions` de las filas visibles por `transactionId`, en lotes `where(documentId(), "in", ids)` de hasta 30, y se muestra `PAYMENT_METHODS[...]` (o `…` mientras carga).
   - **Comprobante:** botón `Ver comprobante` que, al hacer clic, llama `getDownloadURL(ref(storage, "tithe-receipts/{transactionId}/receipt"))` y abre el archivo en una pestaña nueva. Si no existe, se reemplaza por `Sin comprobante`. Sin prefetch.
   - **Estado:** Activo, o Anulado (tachado, con `Ban`). Lo anulado no suma.
   - Se elimina el link genérico "Consultar movimiento…".
6. Pastoral: sin cambios.

**Registro rápido:** en `TransactionForm`, cuando se usa para diezmo, el método por defecto es `transfer` y la fecha es hoy. Después de guardar, el usuario queda en la ficha con un mensaje de éxito.

**Futuro (NO implementar):** un portal del diezmante con historial y certificado. Requiere autenticación de miembros y va a Navigator + Atlas.

## C4. Reportes

Extender `FinanceReport` con `byMethod`, `bySource`, `worshipDays`, `topIncome`, `topExpense`, `alerts`, `narrative` y `comparison`, calculados en `buildReport` a partir de `selected`.
- Se mantienen el chequeo de consistencia y la allowlist `safeRow` (sin nombres de diezmantes).
- Query nueva, solo en vista mensual: `useTransactions(previousPeriod(period))`. Las fuentes usan `useSummaries(previousPeriod)`.

Orden, igual en pantalla y en PDF:
1. Encabezado (se mantiene).
2. **Resumen ejecutivo:** plantilla determinista, sin IA:
   > En septiembre 2026 ingresaron **$6.717.397** en 588 movimientos. La mayor fuente fue Diezmos ($2.926.397 · 43,6 %), seguida de Cafetería ($2.362.700 · 35,2 %), SumUp histórico sin separar ($802.800 · 12,0 %) y Ofrendas ($625.500 · 9,3 %). Por tipo de dinero: tarjeta SumUp $2.891.000 (bruto), efectivo $900.000 y transferencia $X. {"Frente a agosto, los ingresos {subieron/bajaron} un N %." | "No hay datos del mes anterior para comparar."} No se registraron gastos. Hay {n} alertas para revisar.

   Las fuentes se ordenan de mayor a menor. Se omiten las oraciones cuyo dato sea 0 o no exista.
3. **Alertas** (ver D2): ícono + texto en pantalla; en el PDF, prefijo `[Revisar]` o `[Info]`.
4. **Por tipo de dinero:** Tipo · Monto · % · Mov. · Mes anterior · Variación.
5. **Por fuente:** Fuente · SumUp (bruto) · Efectivo · Transferencia · Otro · Total · Mes anterior. Para Ofrendas y Cafetería, si el mes anterior es anterior al 09/09/2026, mostrar `No comparable (antes del 09/09 SumUp no separaba áreas)`.
6. **Días de culto:** Fecha · Ofrendas (SumUp / efectivo) · Cafetería (SumUp / efectivo) · Diezmos · Total del día · Estado. Incluye cada día de culto hasta hoy y los días fuera de culto que tengan ingresos de Ofrendas o Cafetería.
7. **Principales categorías:** top 5 de ingresos y top 5 de gastos, con %. Si no hay gastos: `Sin gastos registrados`.
8. Gráficos: se mantienen.
9. Detalle: se mantiene.

**Vista anual:** en las secciones 4 y 5 se muestra `—` con la nota `Comparación disponible en vista mensual`. La sección 6 se reemplaza por una tabla de 12 meses: Mes · Ingresos · Efectivo · SumUp · Transferencia · Gastos · Alertas (n).
**PDF:** agregar las secciones 2 a 7 antes de las actuales, reutilizando los helpers de `report-pdf.ts`.

```
SEPTIEMBRE 2026          Días de culto: miércoles y domingo
 lun      mar      mié·culto  jue      vie      sáb      dom·culto
          1        2          3        4        5        6
                   ○ Sin reg.
 7        8        9          10       11       12       13
                   $xx mil                               $xx mil
                   ⚠ Falta ef.
 ...
┌ Miércoles 16 sep · Culto ────────────────────┐
│ ⚠ Falta efectivo · Cafetería (SumUp $210.000) │
│            SumUp bruto  Efectivo  Otros  Total│
│ Ofrendas      $45.000  $120.000     —  $165.000│
│ Cafetería    $210.000        —      —  $210.000│
│ Diezmos            —         —  $60.000 $60.000│
│ Gastos                                     $0 │
│ Total ingresos del día              $435.000  │
│ [Registrar efectivo · Cafetería] [Ver movimientos del día] │
└───────────────────────────────────────────────┘
```

## D. Reglas del calendario y de las alertas

**Datos:**
- Se usan las transacciones activas del mes. Cada fecha se arma con `period` + `day`. "Hoy" es `today()`. `SPLIT = "2026-09-09"`.
- Las áreas se identifican por categoría: `Ofrendas` y `Cafetería`.
- SumUp = `isSumUp && paymentMethod === "card"`.
- Efectivo del área = `paymentMethod === "cash"` con la categoría del área.
- Días de culto: `WORSHIP_WEEKDAYS = [3, 0]` (miércoles y domingo), en `lib/finance/constants.ts`.

**Estado de un día D.** Se evalúan todos los estados; la celda muestra el de mayor prioridad y el panel muestra todos.
1. **`Falta efectivo · {área}`:** cuando `D ≥ SPLIT`, `D ≤ hoy`, SumUp del área en D > 0 y no hay efectivo del área en D. Si faltan las dos áreas: `Falta efectivo · 2 áreas`. Ícono `TriangleAlert`, tono warning.
2. **`Sin registros`:** día de culto, `D < hoy` y sin ninguna transacción activa. Ícono `CircleDashed`.
3. **Con ingresos:** monto corto, con un nuevo formateador `clpShort` (`$165 mil`, `$1,2 M`). Sin ícono de cuadre: el calendario no declara conciliación.
4. **Futuro:** muted.
5. **Hoy:** borde primary de 2 px y `aria-current="date"`.

**Interacción:**
- La celda es un `<button>` dentro de una `<table>` semántica. La semana empieza el lunes.
- `aria-label` completo, por ejemplo: `Miércoles 16 de septiembre, culto, ingresos $435.000, falta efectivo Cafetería`. El día seleccionado lleva `aria-pressed`.
- El panel del día se muestra en la misma pantalla y su título lleva `aria-live="polite"`.
- Alto de celda: ≥ 44 px en móvil, 84 px en desktop.
- Selección por defecto: el primer día de "por revisar"; si no hay, hoy (si pertenece al mes); si tampoco, el último día con ingresos.

**Panel del día:**
- Filas: Ofrendas, Cafetería, Diezmos (`source === "tithe"`), SumUp histórico sin separar, Otros ingresos y Gastos.
- Columnas: SumUp bruto · Efectivo · Otros (transferencia + otro + tarjeta no SumUp) · Total. No se muestran las filas en cero.
- Acciones: `Registrar efectivo · {área}` por cada área que falte (con área y fecha precargadas) y `Ver movimientos del día` (cambia a la vista Diaria con esa fecha).

**Alertas del reporte:**

| # | Condición | Texto | Tono |
|---|---|---|---|
| A1 | Estado 1 (por día y área) | `Falta efectivo · {Área} — {dd mmm}: SumUp {clp} en bruto, sin efectivo registrado.` | Revisar |
| A2 | Estado 2 | `Sin registros — {dd mmm} (día de culto).` | Revisar |
| A3 | Mensual con `expenseTotal === 0 && incomeTotal > 0` | `No se registraron gastos en el mes — verificar si faltan egresos.` En la vista anual: `Meses sin gastos registrados: {lista}.` | Revisar |
| A4 | SumUp > 0 | `Los montos SumUp están en bruto: la comisión aún no está disponible, por lo que lo depositado será menor.` | Info |
| A5 | Histórico > 0 | `SumUp histórico sin separar ({rango}): {clp}. No se atribuye a Ofrendas ni Cafetería.` | Info |

Orden: primero las de Revisar, en orden cronológico; después las Info. Si no hay alertas de Revisar: `Sin alertas de revisión en este período.`

## E. Qué NO tocar

- `saveDailyCash`, los ids y revisiones de efectivo, y las validaciones.
- El corte del 09/09 y la categoría "histórico sin separar".
- La lógica de guardado de `TransactionForm`, la subida de comprobantes y la allowlist de categorías. Solo se agregan `initialType` y el método por defecto para diezmo.
- En `buildReport`: el chequeo de consistencia, el límite de 10.000 y `safeRow`.
- Movimientos, Campañas, las Functions, `/ofrendar` y `GivingSettingsModal`.
- Permisos, las rules de Firestore y `PastoralPanel`.
- `FinanceDataCacheProvider` y `useTransactions` (se reutilizan las mismas cache keys).
- `Kpis` (lo usa leader) y `FinanceCharts`.
- No se agregan colecciones ni escrituras nuevas.

## F. Criterios de aceptación

1. Después del login se llega a `/finanzas`. `/dashboard` redirige ahí y los tests de auth están actualizados.
2. Ya no existen la bienvenida, "Lo que viene", "Un mismo propósito", el tagline de Finanzas ni el ítem Dashboard.
3. La pestaña y el título dicen "Ofrendas y Cafetería"; la ruta sigue siendo `/finanzas/ofrendas`.
4. En el Resumen de septiembre 2026, sin hacer scroll a 1440×900, se ve la tabla por tipo de dinero: Efectivo = efectivo de Ofrendas ($460.000) + Cafetería ($440.000) + diezmos y otros ingresos en efectivo; Tarjeta SumUp · bruto $2.891.000 con el desglose $165.500 / $1.922.700 / $802.800; Total $6.717.397, igual a `incomeTotal`.
5. La suma por método es igual al total de ingresos (test unitario de `incomeByMethod`).
6. Cada tarjeta de área muestra SumUp bruto, efectivo y total, del día y del mes. En septiembre: Ofrendas $165.500 + $460.000 = $625.500; Cafetería $1.922.700 + $440.000 = $2.362.700.
7. Ofrendas y Cafetería ya no lista pagos SumUp individuales ni usa `useSumUpTransactions`.
8. Registrar o editar efectivo funciona desde Ofrendas y Cafetería, desde el Resumen y desde el panel del día.
9. `Falta efectivo · {área}` aparece solo en días ≥ 09/09/2026 y ≤ hoy que tengan SumUp del área y no tengan efectivo del área. Hay tests para los días 9, 13, 16 y 20 de septiembre.
10. `Sin registros` aparece solo en miércoles y domingos anteriores a hoy sin transacciones activas.
11. Cada estado se muestra con ícono + texto (visible o en `aria-label`) y también como texto en "Días por revisar".
12. Hacer clic en un día abre el panel sin cambiar de ruta. Se puede usar con teclado y el foco es visible.
13. Los 5 flujos requieren como máximo 2 clics desde el Resumen: efectivo (1), diezmo (1 + elegir persona), revisar el mes (0), reporte (2) y gasto (1, y el formulario abre en "Salida").
14. La ficha muestra: la franja Aportes, el historial agrupado por mes con subtotales, el método, `Ver comprobante` o `Sin comprobante`, y el selector de años desde 2024.
15. Registrar un diezmo abre con Transferencia por defecto. La lista de Diezmos tiene el botón `Registrar` en cada fila activa.
16. El reporte, en pantalla y en PDF, sigue el orden: resumen ejecutivo, alertas, por tipo de dinero, por fuente, días de culto, principales categorías, detalle. Septiembre incluye A3, A4 y A5.
17. El PDF no contiene nombres de diezmantes.
18. A 375 px no hay scroll horizontal y todos los botones miden ≥ 44 px.

## G. Supuestos y riesgos

1. `saveDailyCash` rechaza $0, así que un día que realmente no tuvo efectivo seguirá marcado como "Falta efectivo". Se acepta: la alerta dice "revisar". Se entrega a Navigator la acción "Declarar sin efectivo" (con motivo y actor).
2. Los días de culto son una constante (`[miércoles, domingo]`). Hacerlos configurables en Configuración queda para un slice posterior (Atlas).
3. Un pago con tarjeta que no sea SumUp (por ejemplo Getnet) aparece como "Tarjeta · otra", separado de SumUp.
4. Queries nuevas: solo las transacciones del mes anterior (Reportes) y el método de cada diezmo en la ficha (lotes `in` de 30). Se eliminan 2 queries de 1.000 documentos. Si hay más de 10.000 transacciones, se muestra el mensaje de límite existente.
