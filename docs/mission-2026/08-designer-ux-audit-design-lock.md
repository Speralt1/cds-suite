# DESIGNER: auditoría UX, Reference Matrix, Experiencia 2026 y Design Lock (borrador)

**Checkpoints:**
- UX AUDIT COMPLETE: basado en código, con verificación en vivo parcial por el coordinador.
- DESIGN RESEARCH COMPLETE: evidencia visual limitada.
- DESIGN LOCK: **borrador pendiente de revisión humana**.

## 1. Auditoría UX (Phase 8)

Severidad:
- **C**: puede inducir a un error financiero.
- **A**: alta.
- **M**: media.

| # | Superficie | Problema | Evidencia | Sev |
|---|---|---|---|---|
| O1 | Ofrendas | Dice "Tarjeta SumUp · líquido", pero la cifra es el **bruto** (confirmado con datos) | `offerings-page.tsx:332,350,586` | **C** |
| O2 | Ofrendas | "Total del día" suma dos bases distintas | `:341-344` | **C** |
| O3 | Ofrendas | Se llama "Cierre diario / Caja del día", pero no hay cierre: no existen esperado, contado ni diferencia | `:528-532,356-363` | **C** |
| O4 | Ofrendas | La etiqueta "Conciliado" se aplica a todo pago no reembolsado | `:633` | **C** |
| H1 | Resumen | "Recaudación SumUp" suma Ofrendas, Cafetería e histórico en un solo número | `summary-page.tsx:355-381` | **C** |
| M1 | Movimientos | Los importados de SumUp se pueden editar | `transaction-list.tsx:67-79` | **C** |
| O5 | Sync | Muestra "Histórico SumUp conciliado" al sincronizar; confunde sincronizar con conciliar | `:491` | A |
| O6 | Estados | "Reembolsado" y "Conciliado" usan el mismo pill, sin ícono | `globals.css:636-644` | A |
| O7 | IA | La página "Ofrendas" contiene también Caja e integración de Cafetería | `:504,559-567` | A |
| H2 | Resumen | El texto "Información confirmada en Firestore." es jerga técnica y además afirma algo falso | `:164` | A |
| H3 | Resumen | 5 KPI cards del mismo peso; Diezmos es subconjunto de Ingresos, pero parece un dato paralelo | `kpis.tsx:13-20` | A |
| H5 | Resumen | "Últimos movimientos" excluye SumUp | `:146-151` | A |
| H6 | Resumen | No responde HOY / ATENCIÓN / POR RECIBIR / CAJA | — | A |
| M2 | Movimientos | Es una pseudo-tabla: filas de 18px de padding, sin orden, sin columnas de origen ni estado | `transaction-list.tsx:26-83` | A |
| M3 | Movimientos | El detalle muestra el uid crudo o "system:sumup"; no hay historial | `:93-126` | A |
| N1/N3 | Navegación | Solo 3 ítems genéricos; en móvil el aside empuja el contenido; no hay acceso rápido a Caja ni a Registrar | `app-shell.tsx` | A |
| S1 | Sync | `lastError` se muestra crudo (posible HTML). **Resuelto en el Slice 1** | `:104` | A |
| V1 | Resumen y Reportes (en vivo) | El selector de año ofrece de 2000 a 2099, 100 opciones | pantalla | M |
| O9 | Ofrendas | El aviso de corte al 09/09 usa estilo "success" (verde) cuando es una advertencia | `:516` | M |
| O10 | Ofrendas | La CTA principal es "Sincronizar SumUp", que es una acción técnica | `:509` | M |

**Mantener:**
- la aclaración "no representa el saldo bancario";
- la anulación con motivo obligatorio;
- la tarjeta histórica que explica por qué ese período no está separado.

**Respuestas a las preguntas de la misión:**

| Pregunta | Respuesta |
|---|---|
| ¿Se entiende de dónde sale cada cifra? | No. Ninguna cifra tiene drill-down. |
| ¿Hay demasiadas cards? | Sí. |
| ¿Se mezclan Ofrendas y ventas? | Sí, en H1 y O7. |
| ¿Se distingue bruto de líquido? | Está rotulado de forma falsa. |
| ¿Se distingue depositado de pendiente? | No existe. |
| ¿Se ven las diferencias? | No. |
| ¿Las acciones visibles resuelven algo? | Solo hay CRUD. |
| ¿Hay estados técnicos sin traducir? | Sí. |
| ¿La pantalla ayuda a resolver? | Solo muestra, y a veces falsea el estado. |

## 2. Reference Matrix (Phase 9)

| # | Producto | Patrón | Aplicación en CDS | No copiar | Fuente |
|---|---|---|---|---|---|
| 1 | Stripe | Conciliación de payout: cada payout agrupa sus transacciones (bruto / comisión / neto / cantidad) | La unidad de conciliación de tarjeta es el **payout SumUp** | Jerga de Connect | docs.stripe.com/reports/payout-reconciliation |
| 2 | Stripe | Conciliación de saldo final (lo no liquidado) | Bloque "Por recibir" | Tratar el saldo como si fuera una cuenta bancaria | ídem |
| 3 | Stripe | Montos clicables que llevan a sus transacciones | **Regla: toda cifra agregada es un link** | — | docs.stripe.com/reports/activity-breakdown |
| 4 | Stripe | Secciones que solo aparecen si hay algo que mostrar; export resumido o detallado | Bloques de atención condicionales; exportar Resumen / Detalle | Conciliar exportando CSV | ídem |
| 5 | Square | Caja: efectivo inicial → entradas y salidas → conteo → esperado | Flujo Abrir → Entradas/Salidas → Contar → Cerrar | Cierre automático | squareup.com/help/…/8344 |
| 6 | Toast | Esperado, sobrante/faltante; depósito esperado = contado − fondo | Esperado · Contado · Diferencia (±) · A depositar | Jerga de restaurante | support.toasttab.com/…/Cash-Drawer-Reports-Overview |
| 7 | Toast | Permiso específico para editar datos históricos | Reabrir crea v+1 con motivo, solo admin | Editar en el mismo lugar | ídem |
| 8 | QuickBooks | "For review": Match o Categorize, con sugerencia y deshacer | Vincular depósito con un payout sugerido (±3 días) | Lenguaje de contabilidad general | quickbooks.intuit.com (match bank transactions) |
| 9 | QuickBooks | Cuando las comisiones rompen el match 1:1 | Conciliar payout ↔ depósito, no venta ↔ depósito | — | ídem |
| 10 | Xero | "Revisa solo lo que necesita tu atención" | La conciliación abre en "Necesita acción" | Automatización opaca | xero.com reconcile |
| 11 | Mercury | Barra de herramientas: Vistas · Filtros · Fecha · Monto · Exportar; franja de entradas / salidas / neto | Barra de Movimientos y franja de totales que **responde al filtro** | Violeta; gráfico dominante | mercury.com/blog/updated-transactions-page (captura vista) |
| 12 | Mercury | Vistas guardadas por defecto | Hoy · Este mes · Ofrendas · Cafetería · Sin vincular · Anulados | Edición masiva de datos del proveedor | ídem |
| 13 | Brex | Página de tareas priorizadas con CTA | Attention Queue agrupada por acción | Tono corporativo | brex.com/product-announcements/new-task-overview-page |
| 14 | SumUp | Reportes separados: Ventas, Payouts, Facturas de comisiones | Usar el vocabulario del proveedor; "Ver en SumUp" | Mezclar cuentas | sumup.com business-guide reporting |

**Dirección dominante:** "Libro con trazabilidad por excepción".
- Movimientos al estilo Mercury: tabla densa, filtros y vistas guardadas.
- Conciliación al estilo Stripe: el payout como unidad.
- Caja al estilo Square / Toast.
- Vincular al estilo QuickBooks.
- Bandeja de tareas al estilo Brex.

## 3. Experiencia 2026 (Phase 10)

**Navegación:**
- **Desktop:** sidebar con Hoy · Atención (•n) · Movimientos · Caja · Conciliación, luego el grupo FUENTES (Ofrendas · Diezmos · Cafetería · Campañas) y al final Reportes y Configuración (Integraciones · Categorías · Usuarios).
- **Móvil:** barra inferior con [Hoy] [Caja] [+] [Atención] [Más].
- El estado de SumUp se mueve a Configuración › Integraciones y solo aparece como alerta en Atención y en Hoy.

**Home "Hoy":**

```
┌ Hoy · lunes 22 sep ─────────────────────────── [+ Registrar] ┐
│ NECESITA ATENCIÓN (3)                               Ver todo → │
│ ⚠ Diferencia de caja  Ofrendas dom 21   −$4.500   [Explicar]  │
│ ⟳ SumUp Cafetería sin sincronizar hace 2 d        [Reintentar]│
│ ⛓ Depósito $182.340 sin vincular                  [Vincular]  │
├──────────────────────────────┬────────────────────────────────┤
│ INGRESOS DE HOY               │ CAJA                           │
│ Ofrendas   $312.000           │ Ofrendas   🔒 Cerrada·con dif. │
│   Efectivo $210.000 contado   │ Cafetería  🔓 Abierta 09:12    │
│   Tarjeta  $102.000 bruto     │            [Ir a caja]         │
│ Cafetería  $ 86.400 bruto     │                                │
│ Diezmos    $450.000           │                                │
├──────────────────────────────┼────────────────────────────────┤
│ POR RECIBIR                   │ ACTIVIDAD RECIENTE             │
│ SumUp Ofrendas  —  (comisión  │ 10:41 M.Soto cerró caja Ofr.   │
│   no disponible)              │ 10:02 Sync SumUp Ofr. ✓ 14 pagos│
│ Efectivo a depositar $205.500 │ 09:12 J.Pérez abrió caja Caf.  │
└──────────────────────────────┴────────────────────────────────┘
```

Reglas de la Home:
- sin KPI cards;
- cada monto es un link;
- Ofrendas y Cafetería nunca se suman;
- la tarjeta lleva siempre su base (bruto o líquido) y "líquido" solo aparece con la comisión real;
- el análisis mensual va en Reportes.

**Movimientos:**
- **Barra de herramientas:** Vistas · Período · Buscar · Filtros (Tipo, Fuente, Cuenta, Método, Categoría, Estado, Monto, Creado por) · chips · Limpiar | Columnas · Exportar.
- **Franja:** Entradas · Salidas · Neto · n, **según el filtro activo**.
- **Columnas:** Fecha · Descripción (+ categoría) · Fuente · Método · Origen (🔒 SumUp / Manual) · Estado · Monto (a la derecha, con signo).
- **Panel de detalle** (Sheet de 440px): montos bruto / reembolso / comisión / líquido, procedencia, vínculos, estado de conciliación e **historial** (actor con nombre, antes → después, motivo).
- Los importados no tienen "Editar": tienen "Reclasificar" (con motivo) y "Marcar para revisión".

**Caja (pensada primero para móvil):** Lista → Abrir (fondo) → Abierta (esperado en vivo + Entrada / Salida con motivo) → Conteo (denominaciones; en Ofrendas, 2º conteo ciego) → Resultado (diferencia con motivo) → Cerrada (A depositar = contado − fondo; Registrar depósito; Reabrir con permiso).

```
┌ Cerrar caja · Ofrendas ─ dom 21 ┐
│ ① Conteo 1  M. Soto   ✓          │
│ ② Conteo 2  J. Pérez  ✓ (ciego)  │
├──────────────────────────────────┤
│ Esperado            $214.500     │
│  Fondo $20.000 + Efectivo culto  │
│  $194.500 (12 mov.)  Ver ›       │
│ Contado             $210.000     │
│ ⚠ Diferencia        −$4.500      │
│   Faltante                       │
│ Motivo (obligatorio) [▾] [nota]  │
│ Evidencia  [📎 Adjuntar foto]    │
├──────────────────────────────────┤
│ A depositar         $190.000     │
│ [ Cerrar con diferencia ]  44px  │
└──────────────────────────────────┘
```

El esperado es texto calculado y **nunca un input**.

**Centro de Conciliación:**

```
Conciliación  [Cuenta ▾] [Estado ▾] [Período]      ⟳ Sincronizado hace 12 min
Necesita acción (4)   Todos (27)
│ Payout   │ Cuenta    │ Bruto   │ Reemb. │ Comisión│ Líquido │ Depósito │ Estado        │
│ 19 sep ▸ │ Ofrendas  │ 102.000 │ −5.000 │  −2.346 │  94.654 │  94.654  │ ✓ Conciliado  │
│ 20 sep ▾ │ Cafetería │  86.400 │      0 │  −1.987 │  84.413 │  80.000  │ ⚠ Dif. −4.413 │
│   ├ Ventas (31) 86.400  [Ver movimientos]                                              │
│   ├ Depósito 22-09 80.000 ⛓ vinculado por M.Soto                                       │
│   └ [Explicar diferencia] [Vincular otro depósito] [Marcar requiere revisión]          │
│ 22 sep ▸ │ Ofrendas  │  96.940 │      0 │      —  │     —   │    —     │ ◷ Pendiente   │
Efectivo: cajas cerradas → depósito (misma tabla; la unidad es la caja)
```

**Attention Queue:**
- Grupos por acción: Integración → Duplicado → Vincular → Explicar diferencia → Devolución → Depositar → Cerrar caja → Aprobar.
- Cada ítem: ícono + verbo + objeto + monto + antigüedad (Atrasado) + CTA.
- Filtro: Mis tareas / Todas.
- Estado vacío: "Todo al día".

**Ofrendas:**
- Solo **donaciones**, separadas por método.
- Cabecera: recibido · por recibir · con diferencia.
- Lista de cultos con su caja y el doble conteo.
- El histórico sin separar aparece como una fila explícita.

**Cafetería:**
- Son **ventas**, con tabs Hoy · Payouts · Caja.
- El desglose es permanente: Bruto − Reembolsos − Comisión = Líquido → Payout / Depósito.

## 4. Design Lock (borrador, para revisión)

**Carácter:** un cuaderno de tesorería sereno y preciso. Denso donde se trabaja y amplio donde se decide. Lenguaje humano ("Faltan $4.500"). Verde institucional sobrio.

**Tipografía:**
- Se mantiene el stack de sistema; en el preview se evaluará Inter con tnum.
- Escala: 12 / 13 (tabla) / 14 (cuerpo) / 16 (móvil e inputs) / 20 / 24 / 28 (monto protagonista).
- Pesos: 400, 500 y 600 (montos).
- Se elimina el eyebrow de 10px.
- Números **tabulares**, alineados a la derecha, en formato `$ 1.234.567`, con el signo "−" real **además** del color.

**Color (tokens):**

| Token | Hex | Nota |
|---|---|---|
| canvas | #f8f9f6 | Se mantiene |
| surface | #ffffff | Nuevo |
| ink | #233c33 | Se mantiene |
| muted | #5f6e65 | Antes #68776e; se cambia por contraste AA |
| line / line-strong | #e2e7df / #cbd4ca | Se mantienen |
| primary / hover | #285b45 / #1e4936 | Se mantienen |
| primary-soft | #eaf1e9 | Solo para selección, nunca para estados |
| success | #1f6b45 / #e3f1e8 | Nuevo |
| warning | #8a5a00 / #fbf0d9 | Nuevo |
| danger | #a02e2e / #f8e6e4 | Nuevo |
| info | #245a86 / #e5eef6 | Nuevo |
| review | #9a4a12 / #fbeadc | Nuevo |

**Estados:** siempre ícono + texto + color. Íconos de lucide.

| Estado | Ícono | Texto | Color |
|---|---|---|---|
| Pendiente | Clock | Pendiente | warning |
| Atrasado | AlarmClock | "Atrasado · 3 d" | warning |
| Parcial | CircleDashed | "Parcial · falta $X" | info |
| Conciliado | CircleCheck | Conciliado | success |
| Con diferencia | TriangleAlert | "Diferencia −$4.500" | danger |
| Conciliado con ajuste | CircleCheck + PenLine | Conciliado con ajuste | success |
| Requiere revisión | Flag | Requiere revisión | review |
| Anulado | Ban | Anulado (tachado) | neutral |
| Reembolsado | Undo2 | Reembolsado | neutral |
| Sin sincronizar | CloudOff | "Sin sincronizar · hace 2 d" | danger |
| Importado | Lock | SumUp | neutral |

Estados de caja:

| Estado | Ícono | Color |
|---|---|---|
| Abierta | LockOpen | info |
| En cierre | Timer | warning |
| Cerrada · cuadrada | Lock + Check | success |
| Cerrada · con diferencia | Lock + Alert | danger |
| Reabierta v2 | RotateCcw | review |
| Depositada | Landmark | neutral |
| Conciliada | CircleCheck | success |

**Superficies:**
- Radius: controles 6, botones 8, paneles 12, badges 999.
- Sin sombras, salvo en Sheet y Dialog.
- Espaciado en escala de 4; gutter de 16 en móvil.

**Tablas:**
- Filas de 40px (36px en modo compacto), texto de 13px, header sticky.
- Montos a la derecha y tabulares; fila de totales con el operador escrito.
- Sin zebra.
- En móvil se convierten en una lista de 2 líneas, sin cards.

**Botones:**
- Un Primary por vista; además Secondary, Ghost y Destructive (el verbo exacto, por ejemplo "Anular $12.000").
- Alto: 36px en desktop y 44px en móvil.

**Formularios:**
- Label arriba y error inline con ícono.
- Montos con "$" y separador de miles en vivo; `inputmode=numeric`.
- Motivo obligatorio en toda corrección.
- Dialog para decisiones y Sheet para detalle.

**Filtros:** chips y Popover; el estado vive en la URL; en móvil se abren en un bottom sheet.

**Motion:**
- Sheet: ~200ms. Expandir fila: ~150ms. Ítem resuelto: colapso + toast "Deshacer" de 6s.
- Sin count-up y sin `transition-all`.
- Se respeta reduced motion.

**Accesibilidad:**
- AA en todo.
- Estados legibles sin color.
- Foco visible de 3px.
- `<table>` semántico con `aria-sort`.
- Montos con un aria-label que lee el signo.
- Live region para sync y cierre.

**Modo oscuro:** no en v1. Los tokens ya están nombrados para agregarlo después.

**Qué evitar:**
- grillas de KPI;
- sumar Ofrendas y Cafetería;
- "líquido" sin comisión;
- "Conciliado" sin vínculo;
- esperado editable;
- jerga técnica;
- errores crudos;
- gradientes o violeta;
- "Sincronizar" como CTA principal.

**Base de componentes:** Base UI o shadcn (Dialog, Sheet, Popover, Tabs, Tooltip, Toast) + TanStack Table en modo headless. Requiere OK de Atlas. Se migra de forma gradual, empezando por el preview.

## 5. Gate de experiencia visual: especificación del preview para Builder

**Ruta:** `/preview/finanzas-2026` con `/hoy`, `/movimientos`, `/caja`, `/caja/cerrar`, `/conciliacion`, `/ofrendas`, `/cafeteria`, `/atencion`.
- Solo admin o flag de entorno.
- **Cero lecturas y escrituras a Firestore.**
- Banner "Vista previa con datos de ejemplo".

**Componentes:** AppShell2026, MoneyAmount, StatusBadge, AttentionQueue, DataTable + FilterToolbar + SavedViews + TotalsStrip, DetailSheet + AuditTimeline, CashSession, DenominationCounter, PayoutRow + LinkDepositDialog + ExplainDifferenceDialog, IntegrationStatus, SourceSplit.

**Mock:**
- 2 cuentas SumUp;
- ~45 movimientos: 1 anulado, 1 reembolso, 1 posible duplicado;
- 4 payouts: conciliado, parcial, con diferencia, y pendiente con comisión desconocida;
- 3 depósitos, 1 de ellos sin vincular;
- cajas: Ofrendas cerrada con −$4.500 y doble conteo, Cafetería abierta, 1 reabierta v2;
- 1 error de sync traducido;
- historial de auditoría;
- un período que cruza el 09/09.

**Criterios de aceptación:**
1. Toda cifra lleva a su desglose en ≤2 clics.
2. Ofrendas y Cafetería nunca se suman sin etiqueta.
3. "Líquido" solo aparece con la comisión real.
4. Los estados se entienden en escala de grises.
5. El cierre de caja se completa a 375px con una mano, con targets ≥44px.
6. El esperado no se puede editar.
7. Toda diferencia exige motivo.
8. La tabla muestra ≥15 filas a 1440×900.
9. Montos tabulares y a la derecha.
10. Los errores aparecen en español y proponen una acción.
11. AA verificado.
12. Reduced motion respetado.
13. Designer hace revisión visual por captura.

## 6. Quick wins en la UI actual (requieren OK de Navigator, porque cambian textos financieros)

- Retirar el pill "Conciliado" (`:633`).
- Renombrar "líquido" a "bruto − reembolsos" (comisión no disponible) (`:332,350,586`).
- Quitar "Total del día" (`:341-344`).
- No sumar en "Recaudación SumUp" (`summary-page.tsx:355-381`).
- Ocultar "Editar" en importados (`transaction-list.tsx:67-79`).
- Cambiar el mensaje de sync "conciliado" (`:491`).
- Recortar el selector de año a los años con datos.

## 7. Riesgos y preguntas de UX

1. Si no se consigue la comisión real, "Líquido" y "Por recibir" quedan como "no disponible".
2. Quitar "Total del día" puede verse como que "faltan números": hay que comunicarlo.
3. ¿Quién opera la caja en el culto, con qué dispositivo y con qué conectividad? Si no hay red, se necesita modo offline.
4. ¿El banco entrega CSV o hay que registrar a mano?
5. Falta verificar en vivo el comportamiento móvil real; el coordinador vio que el panel de 800px ya usa el layout apilado.
6. Evidencia visual limitada de caja y conciliación: conviene revisar el dashboard SumUp real con la sesión del usuario.
