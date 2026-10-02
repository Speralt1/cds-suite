# 16-design · CDS Suite: Calendario + Integrantes / Consolidación. Design Lock

**Autor:** Designer · **Estado:** listo para Builder (con las preguntas abiertas de §16) · **Fecha:** 2026-10-02
**Rama:** `mission/calendar-integrantes-preview`
**Entradas:** brief de la misión (`brief de la misión`), modelo de Navigator (`16a-navigator-product-model.md`, base de producto), docs 14 y 15, `components/finance-preview/{shell.tsx, ui.tsx, finance-preview.css}` y las capturas de V2 (`a-hoy-desktop-1440.jpg`, `b-hoy-mobile-390.jpg`, `hoy-1024x768-rail.jpg`, todas vistas).
**Brain:** no accesible en esta sesión. No se consultó ni se escribió aprendizaje.

> Este documento **extiende** el doc 14 y no lo reemplaza. Siguen vigentes los tokens `--fx-*`, la tipografía, Panel, StatusBadge, Toast, `<dialog>`, Skeleton, EmptyState, ErrorState, las reglas responsive de §11 y la accesibilidad de §12 y §13. Todo el CSS nuevo va bajo `.fx`, con clases `fx-*` y tokens nuevos `--fx-area-*`, `--fx-cal-*` y `--fx-sim-*`.

---

## 0. Problema de diseño, insumos y restricciones

**Problema de diseño.** La Financial UX V2 tiene que convertirse en **una sola aplicación multimódulo**: Finanzas · Calendario · Integrantes · Reportes · Configuración. La navegación cambia según el perfil, cada cargo aterriza en lo que necesita y la experiencia financiera aprobada no se rompe. A eso se suman tres superficies nuevas:
- un calendario operativo con color por área;
- una página pública de solo lectura para visitantes que llegan desde el teléfono;
- un CRM ligero de Consolidación, donde lo central es "que nadie quede sin contacto".

**Restricciones (FACT):**
- es una preview con fixtures: sin Firebase, sin storage y sin fetch (el test de aislamiento existente se extiende);
- no se agregan dependencias de UI; se usan `lucide-react`, `<dialog>` y `<details>` nativos, y jspdf, que ya está en las dependencias;
- en móvil: targets de 44 px, inputs de 16 px, sin scroll horizontal y sin tablas de más de 3 columnas;
- el día de demostración es el **domingo 04-10-2026 a las 13:30**;
- la semana empieza el **lunes**, según la convención es-CL. Decisión.

**Decisiones abiertas de Navigator que cierro aquí:**
- **3 indicadores en Consolidación** (§9.2).
- **Presentación de la recurrencia:** un select con etiquetas dinámicas + "Hasta" + una línea de resumen. Las opciones del siguiente slice se ven deshabilitadas con la pill Propuesta (§5.6).

---

## 1. Disponibilidad de fuentes, investigación y matriz de referencias

**Herramientas disponibles:** el navegador integrado (funcionó), WebSearch y WebFetch. Refero MCP ya había respondido `NO_SUBSCRIPTION` en la misión anterior y no se reintentó. El coordinador cortó la investigación por presupuesto después de unas 20 llamadas.

| Referencia | Fuente | Capa | Disponibilidad | Qué aprendemos (evidencia) | Usar | Rechazar |
|---|---|---|---|---|---|---|
| Planning Center Calendar, captura oficial de producto | planningcenter.com/calendar | A/E (dominio iglesia) | OFFICIAL / FREE PUBLIC | **SCREEN VIEWED** (captura oficial estática a ~1440). Arriba a la izquierda, el selector de producto "calendar ▾"; pestañas de sección (Events · Rooms · Resources · People); panel izquierdo "Filter" con tags de color con forma "Categoría: valor" (Department: Youth Group); celdas de mes con 2 eventos como línea "ícono + título + hora"; semana actual sombreada | El área es la primera dimensión de filtro, con un chip de color **y el nombre**. Eventos de una línea con hora. Un switcher de producto indica que es una sola plataforma | Gradiente de marketing; pestañas horizontales (nuestra sección vive en la sidebar); el panel de filtros siempre abierto (aquí va en un popover para no quitar ancho a la grilla) |
| Church Center (calendario público de PCO) | Ayuda de Planning Center (texto vía búsqueda) + 2 calendarios reales | A (dominio) | Ayuda: TEXT DESCRIPTION. Calendarios reales: **NOT AVAILABLE** (2 iglesias con el calendario desactivado, 404; no se insistió) | La vista Lista está siempre activa y Mes es opcional; hay "destacados"; publicado frente a no publicado (interno) | La Agenda es la vista por defecto del público y del móvil; el concepto pública / solo equipo | Galería con imágenes; inscripciones |
| Google Calendar, embed público ("Festivos en Chile", es-CL) | calendar.google.com/calendar/embed | A/D (embed de solo lectura) | FREE PUBLIC | **SCREEN VIEWED** a escritorio (mes) y a 375 (modo agenda). Toolbar: [Hoy] ‹ › "Octubre de 2026 ▾", imprimir, selector de vista [Mes ▾]; pie con el nombre del calendario + "Los eventos se muestran en la zona horaria (GMT-03:00) Hora de Chile". **En móvil, la agenda muestra solo un día con una línea "ahora" y el resto de la pantalla vacía** | El orden de la toolbar (Hoy, ‹ ›, título, vista); la nota de zona horaria en el pie; chip de día completo dentro de la celda | La agenda móvil con días vacíos (la nuestra salta los días sin actividades y siempre muestra contenido); chips sin hora; el "+ Añadir a Google Calendar" en la preview |
| Financial UX V2 (implementada) | capturas del repo | Base | Archivo local | **SCREEN VIEWED** a 1440, a 1024 con rail y a 390. Sidebar oscura de 240 px, rail de 72 px, top bar + bottom bar, banner gris, métricas de 148 px | Es la base que se extiende: tokens, medidas y componentes | — |
| Planning Center People (workflows, listas) | planningcenter.com/people | A (dominio CRM) | FREE PUBLIC | **TEXT DESCRIPTION** (se leyó el texto de la página; la captura de workflows no se inspeccionó). Workflows de pasos hacia una meta ("hacerse miembro"); listas por reglas (cumpleaños, nuevos de los últimos 6 meses, "no ha servido en un tiempo"); notas en el perfil; actividad por ministerio | Pipeline simple con pasos; las listas derivadas por regla se mapean a nuestras alertas y badges derivados; el perfil como hub de toda la actividad | Automatizaciones; emails masivos; background checks |
| Google Calendar app (semana/agenda), Apple Calendar móvil, Notion Calendar, sidebar de Linear, timeline de HubSpot, follow-ups de Breeze | — | A/E | **TEXT DESCRIPTION** (conocimiento previo, **no abierto en esta sesión**) | Semana con grilla horaria y scroll inicial a la mañana; Apple: mes compacto con puntos + lista del día debajo; Linear: módulos con secciones anidadas; HubSpot: timeline cronológico inverso con filtro por tipo | Solo como patrones generales, marcados HYPOTHESIS | Estilos visuales de cualquiera de ellos |
| Refero MCP | MCP | A | CONNECTED MCP → `NO_SUBSCRIPTION` (misión anterior) | — | — | No se reintentó |

**Cobertura de la investigación: LIMITED.**
- **SUFFICIENT** para el shell multimódulo (la base propia ya validada + el switcher de PCO) y para el calendario y su embed público (PCO + Google vistos).
- **LIMITED** para Consolidación (lista, ficha, timeline): **ninguna pantalla de CRM se vio**. La dirección se apoya en texto de PCO People y en los patrones propios ya validados (Atención de Finanzas, `DetailSheet`, `TransactionsTable`). Las medidas de la ficha y del timeline son RECOMMENDATION.

**Evidencia visual:** STRONG para el calendario (PCO, captura oficial vista; Google Embed visto en desktop y móvil). LIMITED para el CRM (solo texto). NOT AVAILABLE para Church Center en vivo.

**Investigación de componentes: LIMITED.**
- Por decisión no se agrega ninguna librería: ni FullCalendar ni react-day-picker.
- La grilla de mes y de semana se implementa con CSS grid propio. Es razonable porque son fixtures acotados y una sola zona horaria.
- Los primitivos son nativos: `<dialog>`, `<details>`, `input type="date|time|tel"`, checkboxes y radios con label de 44 px.
- No se consultaron shadcn ni Base UI en esta sesión, por presupuesto.

**Señal de investigación premium: LOW.** Mobbin o Refero con flujos de CRM móvil acelerarían la ficha y el timeline, pero no bloquean nada: el patrón es estándar.

---

## 2. Dirección dominante

**DIRECCIÓN PRINCIPAL:** la **Financial UX V2 ("instrumento sereno y exacto")** convertida en suite. La sidebar oscura verde-tinta pasa a ser una **lista de módulos con el módulo activo expandido** y el lienzo claro se mantiene. El Calendario toma la estructura de **Planning Center Calendar**: el área como color + nombre, el filtro por área y eventos de una línea con hora. La página pública toma la **toolbar del embed de Google**.

**REFERENCIAS SECUNDARIAS (aportan patrones, no estilo):**
- PCO: el switcher de producto, como concepto "una plataforma".
- Church Center: la Lista o Agenda como vista pública por defecto.
- Google Embed: la nota de zona horaria y el orden de la toolbar.
- PCO People: el pipeline de pasos y las listas derivadas.
- Atención de Finanzas: la cola con verbo + objeto, que se replica en Consolidación.

**SE TOMA:** el color de área con nombre visible; los chips de una línea con hora; la Agenda primero en móvil; la cola de atención con CTA verbal; el `DetailSheet` lateral.

**NO SE TOMA:** gradientes de marketing; pestañas horizontales de sección; galerías con imagen; avatares fotográficos; tarjetas de "pipeline kanban" (no hacen falta con 5 estados y unas 15 personas activas); el violeta como color de producto.

**POR QUÉ:** el dueño ya aprobó V2. El brief exige "una aplicación, no tres pegadas", y PCO es la referencia más cercana del dominio iglesia que se pudo ver.

---

## 3. Shell global (evolución de V2)

### 3.1 Patrón decidido: lista de módulos + secciones del módulo activo anidadas

Se descarta el switcher en dropdown (estilo PCO) para desktop por tres motivos:
1. con 5 módulos o menos, una lista visible cuesta menos que un menú;
2. la preview tiene que **demostrar** cómo cambia la navegación según el perfil (CA-1 de Navigator);
3. no esconde módulos.

**Sidebar desktop (≥1280), 240 px, mismo fondo y padding que el doc 14 §3.2:**

```
┌──────────────────────────┐
│ [CS] Casa de Salvación   │  marca 56px; sub fija "CDS Suite" (12 side-muted)
│      CDS Suite           │
│                          │
│ ◎ Finanzas            ⌄  │  módulo inactivo: fila 36px, ícono 18, 14/600 side-text
│ ▣ Calendario          ⌃  │  módulo activo: texto #fff, chevron rotado, SIN relleno
│   ▌Calendario            │  sección activa: fila 32px, 13/500, fondo side-active + barra 3×16 #7fc79c
│    Mis actividades       │  sección inactiva: 13/500 side-text, padding-left 28px, ícono 16
│    Compartir             │  (solo manage_all)
│ ◍ Integrantes         ⌄  │
│ ▥ Reportes            ⌄  │
│ ⚙ Configuración       ⌄  │
│ ─────────────────────────│
│ (MC) Matías Contreras    │  footer: usuario simulado (nombre 13/500 + cargo 12 muted)
│      Líder · Jóvenes     │
└──────────────────────────┘
```

**Reglas:**
- **Orden fijo:** Finanzas · Calendario · Integrantes · Reportes · Configuración. Solo se renderizan los módulos permitidos (B.6). Un módulo no permitido **no aparece**: ni deshabilitado ni con candado.
- **Clic en un módulo:** navega a su sección de entrada. No es un toggle. Solo el módulo activo muestra sus secciones; los demás quedan colapsados. No hay expansión por hover.
- **Módulo con una sola sección** (por ejemplo, Finanzas del Líder = solo Resumen, o Reportes con solo Calendario): el módulo mismo es la hoja. No se expande, no lleva chevron y recibe el relleno activo.
- **Labels de grupo dentro de un módulo** (FUENTES en Finanzas, CONSOLIDACIÓN en Integrantes): 11/600 en mayúsculas, alto 24, `padding-left: 28px`, `margin-top: 8px`.
- **Íconos de módulo:** Finanzas `CircleDollarSign` · Calendario `CalendarDays` · Integrantes `UsersRound` · Reportes `ChartColumn` · Configuración `Settings`.
- **Marcado:**
  - `<nav aria-label="CDS Suite">`;
  - cada módulo es un `<li>` con un link (`aria-current="true"` si el módulo contiene la ruta) y una `<ul>` anidada de secciones (`aria-current="page"` en la hoja);
  - el chevron es decorativo (`aria-hidden`).
- El `nav` hace `overflow-y: auto` y el footer queda fijo.

**Secciones por módulo (las rutas son orientativas; Builder confirma):**

| Módulo | Secciones (ícono) | Ruta de entrada |
|---|---|---|
| Finanzas (detalle) | Hoy `LayoutDashboard` · Atención `Inbox` + badge · Movimientos `ArrowLeftRight` · Caja `Wallet` · Conciliación `Scale` · FUENTES: Ofrendas · Diezmos · Cafetería · Campañas | `/preview/finanzas-2026` (sin cambios) |
| Finanzas (solo resumen) | Resumen (hoja) | `/preview/finanzas-2026` en modo resumen (§3.8) |
| Calendario | Calendario `Calendar` · Mis actividades `CalendarCheck` (solo con `manage_assigned`) · Compartir `Share2` (solo con `manage_all`) | `/preview/calendario` |
| Integrantes | CONSOLIDACIÓN: Inicio `LayoutDashboard` · Atención `Inbox` + badge · Personas `Contact` · Ajustes `SlidersHorizontal` | `/preview/integrantes/consolidacion` |
| Reportes | Finanzas `CircleDollarSign` (con `finance.details.read`) · Calendario `CalendarDays` (con `calendar.read`) | `/preview/reportes/finanzas` o `/calendario` |
| Configuración | Áreas `Tags` · Usuarios y permisos `UserCog` · Días de culto `CalendarClock` · Finanzas e integraciones `Plug` | `/preview/configuracion/areas` |

**Cambios en Finanzas (lo único que se toca):**
- Salen de la sidebar financiera "ANÁLISIS: Reportes" y "SISTEMA: Configuración"; pasan a ser los módulos globales.
- `/preview/finanzas-2026/reportes` redirige a `/preview/reportes/finanzas`, que renderiza **el mismo contenido** de §8.11 del doc 14.
- `/preview/finanzas-2026/configuracion` redirige a `/preview/configuracion/finanzas`.
- "Ver reporte del período →" en Hoy apunta a la ruta nueva.
- Todo lo demás de Finanzas queda **idéntico**.

**Marca:** el subtítulo pasa de "Finanzas" a **"CDS Suite"**, fijo. El nombre del módulo ya está en la navegación y en el h1, y una marca estable refuerza que es una sola aplicación.

### 3.2 Rail tablet (768–1279), 72 px

```
[CS]
(◎)  módulo 44×44, ícono 20, gap 4
(▣)  módulo activo: fondo side-hover #1d3229, ícono #fff, sin barra
(◍)
(▥)
(⚙)
 ──  divisor 1×24 side-line
[▌▤]  secciones del módulo activo: 40×40, ícono 18, gap 2; sección activa = side-active + barra 3×20
[ ✓ ]
[ ⤴ ]
 …
(MC) footer: avatar con tooltip "Matías Contreras · Líder"
```

- Tooltips como en el doc 14 §3.3 (300 ms, a la derecha). Cada link lleva `aria-label`.
- Badge de 16 px en Atención. Sin flyout: las secciones del módulo activo ya se ven, así que no hace falta.
- **Presupuesto de alto a 1024×768:** marca 56 + módulos 5×48 + divisor 17 + secciones de Finanzas 9×42 + footer 64 ≈ 755 px. El `nav` hace `overflow-y: auto` como respaldo.

### 3.3 Móvil (<768)

**Banner de demostración (44 px, no sticky):**
- izquierda: `FlaskConical` + "Vista previa";
- derecha: el **simulador** `[Ver como: Líder ▾]` (§3.5).

**Top bar (56 px, `#14231d`):**

```
[CS] [Calendario ⌄]                 [Demo] (MC)
```

- **Botón de módulo:** alto 44, 15/600 blanco, `ChevronDown` 16. Abre el sheet "Cambiar de módulo":
  - filas de 56 px con ícono 20 + nombre 15/500 + descripción 13 muted;
  - descripciones: "Actividades y agenda de la iglesia" · "Personas nuevas y su seguimiento" · "Ingresos, gastos y caja" · "Reportes de finanzas y calendario" · "Áreas, usuarios y ajustes";
  - el módulo actual lleva `Check`.
  - Si el usuario tiene un solo módulo, el botón es texto plano, sin chevron.
- El avatar (44) abre "Cuenta": nombre, cargo, áreas y "Cerrar sesión" (simulación, que vuelve a `/preview`).

**Bottom bar: regla `bottomTabs(módulo, perfil)` (función pura y testeable):**
1. Ranura 1 y ranura 2: las dos secciones principales del módulo activo.
2. Ranura central: la **acción de crear** del módulo si el perfil puede crear. Si no puede, la ranura no existe (la barra queda con 4).
3. Ranura 4: la **Atención** del módulo si existe. Si no, un **atajo** al primer otro módulo permitido, en el orden fijo, con el ícono y el nombre del módulo.
4. Ranura 5: **Más**, siempre. Contiene: las secciones restantes del módulo · "Otros módulos" · Cuenta.
5. La barra nunca tiene menos de 3 ni más de 5 ítems y nunca lleva relleno sin función.

| Módulo activo · perfil | Barra |
|---|---|
| Finanzas · detalle + records.manage (Admin, Pastor, Finanzas) | [Hoy] [Movimientos] [+ Registrar] [Atención] [Más] (sin cambios) |
| Finanzas · solo resumen (Líder) | [Resumen] [Calendario↗] [Más] |
| Calendario · gestiona (Líder, Pastor, Admin) | [Calendario] [Mis actividades] [+ Crear] [Finanzas↗ *o el primer otro módulo*] [Más] |
| Calendario · solo lectura (Finanzas, Consolidación) | [Calendario] [Finanzas↗ / Integrantes↗] [Más] |
| Integrantes · gestiona (Consolidación, Pastor, Admin) | [Inicio] [Personas] [+ Nueva] [Atención] [Más] |
| Integrantes · solo lectura | [Inicio] [Personas] [Atención] [Más] |
| Reportes | [Finanzas] [Calendario] [Más] (o [Calendario] [atajo] [Más] para el Líder) |
| Configuración | [Áreas] [Usuarios] [Más] |

- Un **atajo** a otro módulo lleva un ícono 22 con un mini `ArrowUpRight` de 10 px en la esquina, decorativo. Su label es el nombre del módulo y su `aria-label` es "Ir a Finanzas".
- Los "+" de crear usan el círculo de 44 px `--fx-primary` del doc 14. Label: "Crear" en Calendario y "Nueva" en Integrantes.

### 3.4 Pantalla de ingreso simulada `/preview` (demuestra §18)

Sin shell. Lienzo `--fx-canvas`, banner de demostración arriba y una tarjeta centrada de 480 px de ancho (100 % con 16 px de margen en móvil):

```
[CS]  Casa de Salvación · CDS Suite
Ingresar a la vista previa                       h1 22/600
Elige con qué perfil quieres entrar. En CDS real cada persona
entra con su propia cuenta y llega directo a su módulo.   13 muted
┌──────────────────────────────────────────────┐
│ (AD) Administración (demo)       Entra a Finanzas      › │  fila 64px
│ (DH) Daniel Herrera · Pastor     Entra a Calendario    › │
│ (MC) Matías Contreras · Líder (Jóvenes)  Entra a Calendario › │
│ (PN) Pedro Navarro · Diácono (Multimedia, Varones) Entra a Calendario › │
│ (MS) Marcela Soto · Finanzas     Entra a Finanzas      › │
│ (CV) Carolina Vidal · Consolidación  Entra a Consolidación › │
│ (SP) Usuario sin permisos        Sin módulos asignados › │
│ (LF) Líder con módulo inicial no permitido  Entra a Calendario* › │
└──────────────────────────────────────────────┘
* Su módulo inicial (Finanzas) ya no está permitido.     12 muted
```

- Cada fila es un link a la ruta resuelta por `resolveInitialModule` y fija el perfil en el contexto.
- No hay pantalla intermedia.
- La columna "Entra a" se calcula con la misma función que usa la app (no va escrita a mano).

### 3.5 Simulador de perfil "Ver como" (herramienta de la preview, no del producto)

**Dónde vive:**
- **Desktop y tablet:** dentro del `DemoBanner`, que pasa de 32 a **40 px** (`--fx-banner-h: 40px`; el `thead` sticky usa la variable). A la derecha del texto va el botón `fx-sim-trigger`:
  - alto 32, radius 8, fondo `#fff`, borde **1 px dashed `--fx-proposal-border`**;
  - texto 12/600 `--fx-proposal`;
  - ícono `UserRoundCog` 14 + "Ver como: Líder · Matías Contreras" + `ChevronDown`.
- **Móvil:** el botón ocupa la mitad derecha del banner de 44 px. Visualmente mide 28 de alto, con un área táctil de 44.

El estilo dashed y gris de Propuesta lo separa del producto. **Nunca va en la sidebar ni en la top bar oscura.**

**Popover (desktop, 360 px) o bottom sheet (móvil):**
- título "Ver como (vista previa)";
- 8 filas de 52 px iguales a las de §3.4, con `Check` en la actual;
- pie en 12 muted: "Herramienta de la vista previa. Cambia el perfil para ver cómo cambia la navegación." + link "Volver a la pantalla de ingreso".

**Al cambiar de perfil:**
1. Se navega a la ruta del módulo inicial resuelto. No se mantiene la página actual, porque eso podría no estar permitido.
2. Toast: **"Ahora ves CDS como Líder · Matías Contreras. Entraste a Calendario."**
3. La sidebar y la barra inferior se re-renderizan. Los ítems nuevos hacen un fade de 150 ms (Motion §14).

**Estado:**
- vive en el contexto de un `PreviewSuiteProvider` montado en el layout de `/preview` (nuevo, por encima de Finanzas);
- se refleja en la URL con `?como=lider`, usando el mismo patrón `replaceState` que `?periodo=`;
- sin `localStorage` (el test de aislamiento lo prohíbe);
- perfil por defecto si no hay `?como`: Administración.

### 3.6 "No tienes acceso a {módulo}" y "Sin módulos asignados"

**Aviso de acceso.** Un deep link a un módulo no permitido redirige al módulo inicial y muestra, sobre el header de página, una franja info:
- alto ≥44, fondo `--fx-info-bg`, ícono `ShieldAlert` `--fx-info`, texto 14;
- **"No tienes acceso a Integrantes. Te llevamos a Calendario."**;
- botón `X` "Cerrar aviso", `role="status"`;
- desaparece al navegar.

**Sin módulos asignados.** Pantalla completa sin sidebar ni barra inferior (el banner de demostración y "Ver como" siguen visibles):
- marca CS de 40 px;
- h1 "Aún no tienes módulos asignados";
- cuerpo: "Tu cuenta está activa, pero todavía no tiene permisos. Pide al administrador que te asigne un módulo.";
- botón Secondary "Cerrar sesión" (simulación → `/preview`);
- sin redirecciones y sin loop.

### 3.7 Header de página
Se reutiliza `FinancialHeader`, renombrado conceptualmente `PageHeader`: título, subtítulo y acciones. El `PeriodSelector` es opcional: no aparece en Calendario (que tiene su propia toolbar), en Consolidación ni en Configuración.

### 3.8 Finanzas en modo resumen (Líder)
`/preview/finanzas-2026` con `finance.summary.read` y sin `details`:
- h1 "Resumen financiero" y subtítulo "Cifras generales del período. El detalle lo administra el equipo de Finanzas.";
- las 3 `MetricCard` con la cifra, la variación y las notas fijas, **sin** "Ver desglose →", sin composición por nombre y sin popover con links;
- no hay Atención, gráfico de fuentes, actividad reciente ni "+ Registrar";
- se mantiene el gráfico de evolución (cifras agregadas) con "Ver como tabla".

---

## 4. Sistema visual de áreas

### 4.1 Paleta cerrada (10 colores)

Contrastes calculados con la fórmula WCAG 2.x sobre `#ffffff`. Hay que **verificarlos con herramienta en el build** (mismo criterio que el doc 14).

| Token (`--fx-area-{c}`) | Swatch / barra | Contraste swatch | `-ink` (texto) | Contraste ink | `-soft` (fondo de chip) | Área de fixture |
|---|---|---|---|---|---|---|
| azul | #2f6fb0 | 5,2:1 | #245a8f | 7,2:1 | #e6eef7 | Pastoral |
| indigo | #5b5fc7 | 5,3:1 | #464aa6 | 7,5:1 | #ebebf8 | Alabanza |
| naranjo | #c4561d | 4,5:1 | #a3461a | 6,1:1 | #f8ebe3 | Jóvenes |
| ambar | #a06a00 | 4,6:1 | #7d5300 | 6,8:1 | #f5eedf | Niños (Escuela Dominical) |
| frambuesa | #b03a8a | 5,8:1 | #8f2e70 | 7,5:1 | #f5e7f1 | Damas |
| cafe | #8a5a3c | 5,8:1 | #6e4529 | 8,2:1 | #f1ebe7 | Varones |
| teal | #1f7f86 | 4,7:1 | #17646a | 6,9:1 | #e3f0f1 | Intercesión |
| pizarra | #5e6b78 | 5,7:1 | #4a5560 | 7,6:1 | #edeff1 | Multimedia |
| verde | #3d8a3f | 4,3:1 | #2e6e30 | 6,3:1 | #e7f1e7 | Consolidación |
| carmin | #b83a4b | 6,0:1 | #962d3c | 7,6:1 | #f6e7e9 | Matrimonios (**inactiva**; su color queda libre para áreas nuevas) |

**Reglas:**
- El swatch o la barra solo exige ≥3:1 (no es texto) y todos los swatches cumplen.
- **El texto en color de área usa siempre `-ink`**, que mantiene ≥4,5:1 incluso sobre su `-soft`.
- El texto de los títulos dentro de chips y bloques va en `--fx-ink` (no en color de área). El color vive en la barra y el swatch.
- **El nombre del área acompaña siempre al color**: en el chip, en la agenda, en el detalle, en la leyenda y en el filtro. Hay dos excepciones:
  - el chip de mes en desktop, donde la persona ve la leyenda del filtro y el `title` + `aria-label` llevan el área;
  - los puntos del mes móvil, con lista textual debajo.
- **Daltonismo:** azul/indigo y naranjo/carmín/café se confunden en protanopia y deuteranopia. Por eso el color nunca es la única señal, y en el filtro y la leyenda siempre va el nombre.
- No hay gradientes, ni bordes multicolor, ni mezclas de color por participantes.

### 4.2 Cómo se renderiza una actividad

| Contexto | Anatomía |
|---|---|
| **Chip de mes** (desktop) | Alto 22, radius 4, fondo `-soft` del responsable, barra izquierda de 3 px del swatch, padding 0 6 px, 12/500 `--fx-ink`: **"11:00 Culto dominical"** (hora en tabular 12/400 muted). `Lock` de 11 px al final si es "Solo equipo". Truncado con ellipsis. `aria-label="Culto dominical, domingo 4, 11:00 a 13:00, Pastoral, pública"` |
| **Barra de día completo o varios días** | Alto 22, ocupa varias celdas en la fila superior de la semana, fondo `-soft`, barra izquierda solo en el primer segmento. Texto "Campamento de jóvenes". Si continúa en la semana siguiente, `ChevronRight` de 12 px al final |
| **Bloque de semana** | Fondo `-soft`, borde izquierdo de 3 px, radius 6, padding 4 px 6 px. Título 12/600 y hora 12 muted, y si el alto alcanza, el área 11/500 `-ink`. Alto mínimo 22 (30 min) |
| **Fila de agenda** | Hora (columna de 56 px, "11:00" / "13:00" en dos líneas) · barra vertical de 4×36 px del swatch · título 15/500 · línea 2 en 13 muted: **"Pastoral** · con Alabanza, Multimedia +1 · Templo" (el nombre del responsable va en `-ink` 13/600) |
| **Participantes** | En la agenda y el detalle: "con …" en texto. En el detalle: chips `AreaChip` (alto 24, punto de 8 px del swatch + nombre 12/500 `--fx-ink`, borde 1 px `--fx-line`, radius 999). En el mes no se muestran |
| **Cancelada** | Título con `line-through` y color `--fx-muted`, `-soft` reemplazado por `--fx-surface-2`. La barra queda con el swatch. En la agenda, el detalle y la semana: `StatusBadge` "Cancelada" (`Ban`, neutral). En el chip de mes: ícono `Ban` de 11 px antes del título |
| **Realizada** (fin < ahora, derivado) | Título en `--fx-muted` y fondo `--fx-surface-2`. La barra queda con el swatch. Badge "Realizada" (`CircleCheck`, neutral) solo en el detalle y la agenda |
| **Área inactiva** | Las actividades existentes conservan el nombre y el color. En el detalle, el chip del área lleva el sufijo "(inactiva)" en 12 muted. No aparece en el select de crear |

**`AreaPill`** (responsable, en el detalle y la ficha del área): alto 28, barra izquierda de 4 px del swatch, fondo `-soft`, texto 13/600 `-ink`: "Jóvenes" + " · responsable" en 12/400.

---

## 5. Calendario

### 5.1 Toolbar (todas las vistas)

**Desktop (≥768), una fila de 40 px bajo el h1 "Calendario"** (subtítulo "Actividades de todas las áreas de la iglesia."):

```
[Hoy] [‹][›]  Octubre 2026          [Mes|Semana|Agenda]  [Áreas: Todas ▾]  [⋯]  [+ Crear actividad]
```

- **Hoy:** Secondary de 36 px. Se deshabilita cuando hoy está visible.
- **‹ ›:** botones de 36 px con `aria-label` "Mes anterior" / "Semana anterior".
- **Título del período:** h2 18/600 "Octubre 2026" / "28 sep – 4 oct 2026" / "Desde hoy".
- **Segmented:** `aria-pressed`, alto 32.
- **Filtro de áreas:** chip de 32 px (§5.2).
- **`⋯`:** "Compartir calendario" (solo `manage_all`) · "Ver reporte" → Reportes › Calendario.
- **Primary "+ Crear actividad":** solo con `manage_assigned`/`manage_all` **y** al menos 1 área activa propia (o `manage_all`). Si no puede crear, el botón **no aparece**: un solo Primary por vista, y no es una acción que el usuario deba descubrir.
- El estado vive en la URL: `?vista=mes|semana|agenda&fecha=2026-10-04&areas=jovenes,alabanza`.

**Móvil (<768):**
- fila 1: `‹` · "Octubre 2026" (17/600) · `›` · [Hoy];
- fila 2: segmented a ancho completo **[Agenda | Mes]** (la Semana no se ofrece por debajo de 768) + botón "Áreas (2)" de 44 px;
- "+ Crear" vive en la bottom bar;
- vista por defecto en móvil: **Agenda**; en desktop: **Mes**.

### 5.2 Filtro por área

- **Chip:** "Áreas: Todas" o "Áreas: Jóvenes, Alabanza" (si son más de 2: "Áreas (3)"). Cuando está activo lleva fondo `--fx-primary-soft` y un `X` "Quitar filtro de áreas".
- **Popover de 300 px (desktop) o bottom sheet (móvil):**
  - links "Todas" · "Ninguna";
  - lista de checkboxes de 20 px dentro de filas de 40 px (44 en móvil): swatch de 12 px + nombre 14 + conteo del período 12 muted tabular a la derecha ("12");
  - las áreas inactivas no aparecen, salvo que tengan actividades en el período visible: entonces aparecen al final con "(inactiva)";
  - separador y el switch **"Solo como responsable"**, con la ayuda: "Si está apagado, también muestra actividades donde el área participa.";
  - en móvil, footer sticky con [Limpiar] y el Primary "Ver 18 actividades".
- **Leyenda:** en Mes y Semana desktop, bajo la toolbar, línea 12 muted con las áreas visibles: "■ Pastoral ■ Alabanza …". Se puede ocultar con "Ocultar leyenda" y en el preview queda visible por defecto.

### 5.3 Vista Mes (desktop)

- Grilla de 7 columnas lunes→domingo. Header de días de 32 px (12/600 muted, "LUN"…"DOM"). Celdas con borde 1 px `--fx-line` sobre `--fx-surface`.
- **Celda:** número de día 13/500 arriba a la izquierda (hoy: círculo de 24 px `--fx-primary` con texto blanco + `aria-current="date"`). Los días fuera del mes van en muted sobre `--fx-surface-2`.
- **Máximo de chips por celda:**
  - **3 a ≥1280** (celda de ~116 px de alto);
  - **2 entre 1024 y 1279**;
  - **2 sin hora entre 768 y 1023**.
- **Excedente:** link "+2 más" (12/600 primary, alto 20). Abre un **popover de día** de 300 px con h3 "domingo 4 de octubre" y todos los chips, foco atrapado y Esc para cerrar.
- **Orden dentro del día:** primero los de todo el día, después por hora de inicio y después por nombre de área.
- **Clic en chip:** abre el `EventDetailSheet` y al cerrar el foco vuelve al chip.
- Clic en una celda vacía: no hace nada en la preview.

### 5.4 Vista Semana (desktop y tablet)

- **Columnas:** medianil de horas de 56 px + 7 días. El header de día muestra "lun 28" y el de hoy va resaltado.
- **Fila de todo el día:** hasta 2 líneas de barras + "+n".
- **Grilla 00:00–24:00:** hora de 44 px, con **scroll inicial a las 07:00**. El contenedor tiene `max-height: calc(100dvh - 220px)` y un mínimo de 480.
  - Motivo: la vigilia (vie 22:00 → sáb 02:00) tiene que verse completa. Con un rango 07–23 quedaría cortada.
- **Línea "ahora":** solo en el día de hoy, 2 px `--fx-danger` con un punto de 8 px y `aria-hidden` (en el demo, dom 13:30).
- **Superposiciones:** columnas lado a lado, máximo 3. Si son más, la 3.ª columna muestra "+n" y abre el popover del día. Ejemplo: Culto dominical 11:00–13:00 junto a Escuela dominical 11:00–12:30.
- **Actividad que cruza medianoche:** bloque hasta las 24:00 con "continúa" (`ChevronDown` 10) y su continuación desde las 00:00 del día siguiente.

### 5.5 Vista Agenda (por defecto en móvil y en el calendario público)

- **Rango:** desde hoy hasta el fin del mes visible + 14 días. Arriba, el botón ghost "Ver días anteriores" (carga el mes previo).
- **Solo días con actividades.** Nunca días vacíos (se rechaza el patrón visto en Google Embed móvil).
- **Header de día sticky** (`top`: 0 en móvil y banner-h en desktop), de 36 px, 13/600, fondo `--fx-canvas`:
  - "**Hoy** · domingo 4 de octubre";
  - "Mañana · lunes 5 de octubre";
  - "sábado 10 de octubre".
- **Ancla "Hoy":** al cargar, la vista hace scroll a hoy. Si hoy no tiene actividades, se inserta igual el header "Hoy · domingo 4 de octubre" con la línea 13 muted "Sin actividades hoy.".
- **Filas** (`<li>`, alto mínimo 64, padding 12 px 0, divisor 1 px): anatomía de §4.2. Toda la fila es un `<button>` que abre el detalle.
- **Desktop:** columna centrada de máx. 880 px.

**Mes en móvil (variante compacta):**
- grilla de 7 × 5–6 con celdas de ~48 px: número de día 15/500 + hasta 3 puntos de 6 px con el color del responsable;
- si hay más de 3: "+" de 10 px;
- el día seleccionado (por defecto hoy) va en un círculo `--fx-primary-soft`;
- debajo, la **lista del día seleccionado** con las filas de agenda (patrón Apple Calendar, HYPOTHESIS/TEXT);
- celda del día como botón de 44 px mínimo de alto con `aria-label` "sábado 10 de octubre, 3 actividades".

### 5.6 Mis actividades (`/preview/calendario/mis-actividades`)

- h1 "Mis actividades", subtítulo "**Tus áreas:** ■ Jóvenes" (chips `AreaChip`; para Pedro: Multimedia · Varones).
- Segmented: **[Responsable · 6] [Participa · 3]**.
  - **Responsable:** lista agenda (próximas primero; "Ver pasadas" al final) con un botón `⋯` de 36 px (44 en móvil) por fila: Editar · Cancelar · Eliminar.
  - **Participa:** las mismas filas sin `⋯`, con la nota arriba (12 muted, `Info`): "Tu área participa, pero la organiza otra área. Solo puedes verlas."
- **Sin áreas** (`EmptyState`, ícono `Tags`): "Aún no tienes áreas asignadas" · "Pide al administrador que te asigne un área para crear y administrar actividades." Sin CTA.
- **Responsable vacío:** "Tus áreas no tienen actividades próximas" + [Crear actividad].

### 5.7 Detalle de actividad: `EventDetailSheet`

Usa el `DetailSheet` del doc 14 (440 px a la derecha / bottom sheet de 92dvh).

```
[▌Jóvenes · responsable]                      (X)
Reunión de jóvenes                          h2 20/600
[◷ Programada] [🌐 Pública]                 badges
viernes 9 de octubre · 20:00 – 22:00         15/500
↻ Se repite cada viernes hasta el 18 dic 2026   13 muted
📍 Salón de jóvenes
── Áreas participantes ──
(● Alabanza)
── Descripción ──
Alabanza, palabra y convivencia…
── Notas internas  🔒 Solo equipo ──        (bloque fondo surface-2, radius 8)
Traer parlante extra.
── Historial ──
Creada por Matías Contreras · 12-09-2026
Editada por Matías Contreras · 20-09-2026 (horario)
───────── footer sticky ─────────
[Editar] [Cancelar actividad]        [Eliminar]
```

- **Visibilidad:**
  - "Pública" (`Globe`, info) con la ayuda "Aparece en el calendario compartido.";
  - "Solo equipo" (`Lock`, neutral) con la ayuda "Solo la ven usuarios de CDS.".
- **Estado:**
  - Programada (`Clock`, info);
  - Realizada (`CircleCheck`, neutral);
  - Cancelada (`Ban`, neutral) + "Cancelada el 02-10 · Motivo: Lluvia" (el motivo solo lo ve el equipo).
- **Recurrencia (resumen):**
  - "Se repite cada viernes hasta el 18 dic 2026";
  - "Cada 2 semanas, los martes, hasta…";
  - "El primer sábado de cada mes hasta…";
  - "El último viernes de cada mes hasta…".
  - Si hay excepciones: "1 fecha cancelada (vie 2 oct)".
- **Footer según permiso:**
  - **Puede gestionar:** Editar (Secondary) · Cancelar actividad (Secondary) · Eliminar (ghost con texto `--fx-danger`, alineado a la derecha). En las actividades pasadas con `manage_assigned`, solo Eliminar está deshabilitado (ver la pregunta abierta en §16) y Editar/Cancelar se deshabilitan con la explicación "Las actividades pasadas solo las corrige Pastor o Administración."
  - **No puede gestionar:** los 3 botones con `aria-disabled="true"` (estilo deshabilitado; el foco sigue llegando) y debajo, 12 muted con `Info`, enlazado por `aria-describedby`:
    - "Solo el área responsable (Alabanza), Pastor o Administración pueden modificar esta actividad.";
    - o, si su área solo participa: "Tu área participa en esta actividad, pero la organiza Pastoral."
  - **Solo lectura pura** (sin ningún permiso de gestión): no hay footer.

### 5.8 Crear y editar: `EventFormSheet`

Sheet de **560 px** en desktop. En móvil es **pantalla completa** (100dvh) con header sticky ("Nueva actividad", `X`) y footer sticky ([Cancelar] [Guardar actividad]). Campos de 44 px en móvil (16 px) y 36 px en desktop. Labels arriba, 13/600.

1. **Área responsable\*:** select con solo las áreas activas propias (todas con `manage_all`), cada opción con su swatch. Si el usuario tiene **una sola** área: texto fijo "■ Jóvenes" con la ayuda "Es tu única área asignada.". Debajo, la vista previa **no seleccionable**: "Color: [▌ Jóvenes 20:00 Reunión de jóvenes] · Lo define el área responsable."
2. **Título\*:** máx. 120. Contador visible desde los 100.
3. **Fecha\*** · switch **"Todo el día"** · **Hora de inicio** / **Hora de término** (`type="time"`, en la misma fila en desktop y apiladas en móvil). Checkbox "Termina otro día", que muestra **Fecha de término**.
4. **Lugar:** opcional, máx. 120.
5. **Repetir:** select con etiquetas calculadas desde la fecha de inicio:
   - "No se repite" (por defecto);
   - "Cada semana, los viernes";
   - "Cada 2 semanas, los viernes";
   - "Cada mes, el segundo viernes";
   - además, si la fecha cae en la 4.ª semana y es la última del mes: "Cada mes, el último viernes".
   
   Si la opción no es "No se repite", aparece **"Hasta\*"** (fecha, `max` = inicio + 12 meses) con la ayuda "Incluye esa fecha. Máximo 12 meses." Debajo, la línea de resumen en vivo (13 muted, `Repeat`): **"Se repetirá 11 veces: del 9 oct al 18 dic 2026."**
   
   Debajo, un `<details>` "Más opciones de repetición" con la pill **Propuesta**, que contiene radios deshabilitados:
   - "El mismo día de cada mes (día 9)";
   - "Personalizado".
   
   Con la ayuda: "Llegará en una próxima versión."
6. **Áreas participantes:** botón multi-select "Agregar áreas" que abre un popover con checkboxes (sin el responsable, máx. 8). Las elegidas se muestran como `AreaChip` con `X`. Ayuda: "Participar no da permiso para editar."
7. **Visibilidad\*:** 2 radios-tarjeta de 56 px:
   - "**Solo equipo CDS** · La ven usuarios con acceso al calendario." (por defecto);
   - "**Pública** · También aparece en el calendario compartido.".
8. **Descripción pública:** textarea de 4 filas, máx. 1000. Ayuda: "Visible para todos si la actividad es pública."
9. **Notas internas:** textarea de 3 filas con `Lock`. Ayuda: "Nunca se publican."

**Al editar una actividad repetida**, antes de abrir el form aparece el dialog "Editar actividad repetida":
- radio "Toda la serie" (seleccionado);
- "Solo esta fecha" y "Esta y las siguientes", deshabilitados con la pill Propuesta;
- botones [Volver] [Continuar].

**Validación** (inline al salir del campo y al guardar; errores `role="alert"`, foco al primer error, borde `--fx-danger` + `TriangleAlert` 14 + texto 12):
- "Escribe un título."
- "Elige el área responsable."
- "Elige una fecha."
- "Indica la hora de inicio o marca «Todo el día»."
- "La hora de término debe ser después del inicio."
- "La fecha de término no puede ser anterior al inicio."
- "Indica hasta cuándo se repite."
- "La repetición puede durar como máximo 12 meses."
- "Solo puedes crear actividades de tus áreas." (defensivo)

**Guardar:** toast "Simulación: no se guardó nada." Cierra el sheet. La actividad **no** se agrega a las fixtures (simulación pura, como en Finanzas).

### 5.9 Cancelar y eliminar (`<dialog>` de 480 px; bottom sheet en móvil)

**Cancelar:**
- **Título:** "Cancelar «Reunión de jóvenes»".
- **Si es recurrente**, radios:
  - "**Solo esta fecha** · viernes 9 de octubre" (por defecto);
  - "**Toda la serie desde hoy** · Las fechas pasadas quedan como realizadas."
- **Motivo (obligatorio):** textarea de 3–300. Ayuda: "Solo lo ve el equipo."
- **Nota** (`Info`): "Seguirá visible como «Cancelada». En el calendario público se verá «Cancelada», sin el motivo."
- **Botones:** [Volver] · Destructive [Cancelar actividad] (deshabilitado hasta que el motivo tenga 3 caracteres).

**Eliminar (archiva):**
- **Título:** "Eliminar «…»".
- **Cuerpo:** "Se quitará de todas las vistas, de los reportes y del calendario público. No se borra: queda guardada en el historial con el motivo."
- **Si es recurrente:** "Se eliminará toda la serie. Para quitar una sola fecha, usa «Cancelar»."
- **Motivo (obligatorio):** select "Creada por error · Duplicada · Otro" + nota.
- **Botones:** [Volver] · Destructive [Eliminar].

### 5.10 Compartir calendario (`/preview/calendario/compartir`, solo `manage_all`)

Página dentro del módulo, en una columna de máx. 720 px:

```
Compartir calendario                                  h1
Un enlace de solo lectura con las actividades públicas.
┌ Enlace ───────────────────────────────────────────┐
│ [✓ Activo]  Creado el 01-09-2026 por Administración │
│ [ https://cds.app/calendario/compartir/••••k3Qz ][Copiar enlace] │
│ Abrir vista pública ↗                              │
│ ───────────────────────────────────────────────── │
│ [Regenerar enlace]   [Desactivar enlace]           │
└───────────────────────────────────────────────────┘
┌ Qué se publica ───────────┐┌ Qué nunca se publica ─────┐
│ ✓ Título, fecha, hora      ││ ⊘ Actividades «Solo equipo» │
│ ✓ Lugar                    ││ ⊘ Notas internas y motivos  │
│ ✓ Descripción pública      ││ ⊘ Nombres y correos de usuarios │
│ ✓ Área responsable y       ││ ⊘ Datos de Integrantes       │
│   participantes            ││ ⊘ Información financiera     │
│ ✓ «Cancelada», sin motivo  ││ ⊘ Actividades eliminadas     │
└───────────────────────────┘└───────────────────────────┘
```

- El campo es `readonly`, en monospace 13, y muestra el enlace completo. "Copiar enlace" → toast "Enlace copiado." (en la preview copia la URL demo real `/preview/calendario/compartir/demo`).
- **Regenerar** → dialog: "¿Regenerar el enlace? El enlace actual dejará de funcionar de inmediato. Quienes lo tengan verán «Este calendario no está disponible»." [Volver] [Regenerar enlace].
- **Desactivar** → dialog: "¿Desactivar el enlace? Nadie podrá ver el calendario compartido hasta que lo actives con un enlace nuevo." [Volver] Destructive [Desactivar].
- **Estado inactivo:** badge "Desactivado" (neutral, `Ban`), sin campo y con el Primary "Activar con un enlace nuevo".
- Para quien no tiene `manage_all`, la sección no aparece en la sidebar. Si entra por deep link, ve el aviso de §3.6 adaptado: "No tienes acceso a Compartir calendario."

---

## 6. Calendario público `/preview/calendario/compartir/demo`

**Sin shell, sin sidebar y sin "Ver como".** Solo una línea de demostración arriba, de 28 px, gris: "Vista previa · datos de demostración". Mismo `.fx`, con fondo `--fx-canvas` y contenido de máx. 960 px.

```
┌────────────────────────────────────────────┐ header 64px blanco, borde inferior --fx-line
│ [CS] Casa de Salvación                      │ 16/600
│      Calendario de actividades              │ 13 muted
└────────────────────────────────────────────┘
‹  Octubre 2026  ›   [Hoy]
[Agenda | Mes]                    [Áreas (Todas) ▾]
HOY · DOMINGO 4 DE OCTUBRE
11:00 ▌ Culto dominical · Santa Cena
13:00 ▌ Pastoral · con Alabanza, Multimedia +1 · Templo
11:00 ▌ Escuela dominical
12:30 ▌ Niños · Sala de niños
MARTES 6 DE OCTUBRE
19:00 ▌ Reunión de damas …
…
Horarios en hora de Chile continental.               12 muted (pie)
```

- **Vista por defecto:** Agenda en todos los anchos (el visitante busca "qué viene"). Mes disponible.
- **Navegación:** desde el mes anterior hasta 6 meses adelante. Las flechas se deshabilitan en los extremos con el `aria-label` "No hay más meses publicados".
- **Filtro:** solo las áreas activas con actividades públicas. Sin el switch "Solo como responsable" (simplicidad).
- **Detalle público:** bottom sheet en móvil y sheet de 440 en desktop: área responsable (`AreaPill`, sin "· responsable": dice "Organiza: Jóvenes"), título, fecha y hora, recurrencia en texto, lugar, participantes y descripción pública.
  - Si está cancelada: badge "Cancelada" y la línea "Esta actividad no se realizará." **Nunca** el motivo.
  - Sin historial, sin notas y sin acciones de edición.
- **Vacío del período:** "No hay actividades publicadas en octubre." + "Ver noviembre →".
- **No disponible** (token inválido o desactivado), página completa centrada:
  - ícono `CalendarX2` de 24 en un círculo de 48;
  - h1 "Este calendario no está disponible";
  - "Es posible que el enlace haya cambiado. Pide el enlace actualizado a la iglesia.";
  - sin otro detalle, sin login y sin revelar si el enlace existió.
- **Confianza:** sin ruido de producto, sin "Iniciar sesión", tipografía de sistema 15/22 en móvil, targets de 44 y el pie con la zona horaria (patrón visto en Google Embed).

---

## 7. Reportes (módulo)

- **Ruta:** `/preview/reportes` → primera sección permitida.
- **Header:** h1 "Reportes". Bajo el h1, links con forma de segmented (son navegación: `aria-current="page"`): **[Finanzas] [Calendario]**, solo los permitidos. Si hay uno solo, no se muestra el segmented y el h1 dice "Reportes · Calendario".
- **Finanzas:** el contenido actual de §8.11 del doc 14, sin cambios.

### 7.1 Reporte de calendario (`/preview/reportes/calendario`)

**Filtros** (`FilterToolbar` del doc 14):
- Período (stepper de mes + opción "Rango personalizado" en el popover, con 2 fechas);
- Áreas (multi, con el switch "Solo como responsable");
- Estado (checkboxes: Programada · Realizada · Cancelada);
- Visibilidad (radios: Todas · Pública · Solo equipo).

En móvil: botón "Filtros (n)" que abre un sheet.

**Franja de resumen** (dentro del panel, 13): "**42 actividades** · 30 realizadas · 9 programadas · 3 canceladas". Debajo, "Por área:", con el swatch y el nombre y conteo de cada área en línea ("■ Pastoral 12 · ■ Jóvenes 8 …"). **Sin gráfico.**

**Acción:** Secondary "Descargar PDF" en el header.

**Tabla** (orden: fecha ascendente; dentro del día, primero las de todo el día y después por hora; no se puede reordenar en la preview):

| Columna | Ancho | Contenido |
|---|---|---|
| Fecha | 96 | "vie 9 oct" |
| Hora | 88 | "20:00–22:00" / "Todo el día" |
| Actividad | 1fr (mín. 220) | título 13/500 + descripción pública 12 muted, `line-clamp` 1 |
| Responsable | 132 | swatch 10 + nombre |
| Participantes | 160 | nombres separados por coma, `line-clamp` 2 |
| Lugar | 128 | — |
| Estado | 116 | `StatusBadge` |
| Visibilidad | 104 | `Globe`/`Lock` + texto |

**Responsive por ancho del contenedor** (container queries; lección P11 del doc 15):
- **<1000 px:** Participantes pasa a una 2.ª línea de Actividad ("con Alabanza").
- **<840:** se ocultan Lugar y Visibilidad (Visibilidad pasa a ícono junto al título).
- **<600 (móvil):** lista de 2 líneas:
  - línea 1: "vie 9 oct · 20:00" y el estado;
  - línea 2: título + área.

**PDF (mock con jspdf, generado localmente):** A4 **horizontal**, márgenes de 15 mm, Helvetica.

```
Casa de Salvación                                   VISTA PREVIA · DATOS DE DEMOSTRACIÓN
Reporte de actividades · Octubre 2026
Filtros: Áreas: todas · Estados: todos · Visibilidad: todas
Generado por Matías Contreras el 04-10-2026 13:30
Resumen: 42 actividades · 30 realizadas · 9 programadas · 3 canceladas
Por área: Pastoral 12 · Jóvenes 8 · …
┌Fecha─┬Hora──┬Actividad──────┬Responsable┬Participantes┬Lugar┬Estado┬Visib.┬Descripción pública┐
│■ cuadrado de 2,5 mm del color del área antes del nombre del responsable                       │
└───────────────────────────────────────────────────────────────────────────────────────┘
                                                                  Página 1 de 2
```

- **Encabezado de tabla:** fondo `#eef0ec`, texto 8 pt bold, filas de 8 pt y zebra `#f9faf8`.
- **Canceladas:** el texto "Cancelada" en la columna Estado (sin color de fondo).
- **Nunca incluye** notas internas ni motivos.

---

## 8. Integrantes

**Decisión: no se muestran los submódulos futuros** (Directorio, Miembros, Ministerios, Familias, Asistencia), ni en la sidebar ni con "Próximamente". Agregarían ruido y promesas a un equipo que hoy solo usa Consolidación.
- `/preview/integrantes` redirige a `/preview/integrantes/consolidacion`.
- La estructura escala con labels de grupo: cuando exista Directorio, aparecerá su propio label dentro de Integrantes.

---

## 9. Consolidación

### 9.1 Vocabulario visual de estados y alertas

**Estados del pipeline** (`StatusBadge`, ícono + texto + tono):

| Estado | Ícono | Tono |
|---|---|---|
| Por contactar | `PhoneOutgoing` | warning |
| En seguimiento | `MessageCircle` | info |
| Integrándose | `Sprout` | success |
| Integrado | `CircleCheck` | success (sólido) |
| Sin continuidad | `CircleSlash` | neutral |

**Badges derivados** (outline de 1 px, sin relleno, alto 20, 11/600):
- "Nuevo" (`UserPlus`, borde y texto `--fx-primary`);
- "Volvió" (`DoorOpen`, `--fx-success`);
- "Menor de edad" (`Shield`, neutral);
- "No contactar" (`BellOff`, `--fx-danger`).

**Alertas** (ícono en un círculo de 32 px `-bg`):

| Alerta | Ícono | Tono | CTA |
|---|---|---|---|
| Sin responsable | `UserX` | review | Asignar |
| Sin primer contacto | `PhoneMissed` | warning | Contactar |
| Seguimiento vencido | `AlarmClock` | warning | Registrar seguimiento |
| Volvió sin seguimiento | `DoorOpen` | success | Agradecer → abre Seguimiento |
| Varios días sin volver | `CalendarX2` | neutral | Contactar |
| Posible duplicado | `Copy` | info | Revisar |
| Cumpleaños próximo | `Cake` | info | Saludar (WhatsApp) |

### 9.2 Dashboard (`/preview/integrantes/consolidacion`, "Inicio")

**Indicadores: 3, decidido.**
- **Nuevos este mes:** ¿cuántas llegaron?
- **Sin primer contacto:** ¿a quién no hemos contactado?
- **Seguimientos vencidos:** ¿quién necesita seguimiento?

**Por qué no 4:**
- "¿Quién volvió?" y "¿Quién cumple años?" se responden con **nombres**, no con una cifra. Por eso son secciones con un conteo en el header.
- Se mantiene la regla V2 de máximo 3 métricas por pantalla.
- Es coherente con Hoy de Finanzas.

**`CountTile`** (variante compacta, no la `MetricCard` de 148 px):
- alto mínimo 96, padding 16;
- label 13/500 muted + ícono 16;
- valor 28/34 600 tabular;
- una línea de contexto 12 muted;
- el link "Ver personas →" va a Personas con el filtro aplicado.

| Tile | Valor | Contexto |
|---|---|---|
| Nuevos este mes | 5 | "2 en los últimos 7 días" |
| Sin primer contacto | 2 | "La más antigua llegó hace 4 días" |
| Seguimientos vencidos | 1 | "Desde el jueves 1 de octubre" |

Con valor 0: `CircleCheck` success + "Todo al día".

**Desktop 1440:**

```
┌sidebar┬ Vista previa · datos de demostración …        Ver como: Consolidación · Carolina Vidal ▾ ┐
│       │ Consolidación                                          [Registrar visita] [+ Nueva persona] │
│       │ Personas nuevas y su acompañamiento · domingo 4 de octubre                                   │
│       │ ┌Nuevos este mes─┐┌Sin primer contacto┐┌Seguimientos vencidos┐          (4|4|4, 96px)       │
│       │ │5  2 en 7 días →││2  más antigua 4 d →││1  desde jue 1 oct →  │                              │
│       │ ┌Necesitan atención (6) ──────────── (8 col) ┐┌Cumpleaños próximos (3) (4 col)┐             │
│       │ │(UX) Sofía Ramírez  [Nuevo]                 ││hoy · Andrés Pino · cumple 27  │             │
│       │ │ Sin responsable · llegó hoy     [Asignar]  ││      [WhatsApp]               │             │
│       │ │(PM) Pablo Muñoz                            ││lun 5 · Rosa Fuentes · 45  [WA]│             │
│       │ │ Sin primer contacto · hace 4 d · 1 intento ││sáb 10 · Tomás Fuentes · 12 [WA]│            │
│       │ │ +1 alerta                    [Contactar]   ││Ver todos →                    │             │
│       │ │ …5 filas máx · Ver las 6 →                 │└───────────────────────────────┘             │
│       │ └────────────────────────────────────────────┘                                              │
│       │ ┌Nuevos recientes (5)┐┌Seguimientos próximos (3)┐┌Volvieron (1)──────┐   (4|4|4)           │
│       │ │dom 4 · Sofía R.    ││mar 6 · Llamar a Ana     ││dom 4 · Javier Soto│                     │
│       │ │…                   ││  Carolina V.            ││ 3.ª visita [Agradecer]│                 │
└───────┴────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Fila de "Necesitan atención"** (mín. 64 px, divisor 1 px):
- iniciales en un círculo de 32 px `--fx-neutral-bg` (nunca foto) **o** el ícono de la alerta principal. Decisión: **el ícono de la alerta**, porque comunica el motivo;
- nombre 14/600 (link a la ficha) + badges derivados;
- motivo principal en 13 `--fx-ink`: "**Sin primer contacto** · llegó el mié 30 sep (hace 4 días) · 1 intento";
- "+1 alerta": badge neutral, con tooltip y `aria-label` que listan las demás alertas;
- a la derecha, una CTA Secondary de 32 px (44 en móvil) con el verbo.

**Orden de la cola:** el de Navigator §F. Hay una fila por persona.

En el preview, la CTA abre el sheet que corresponde: Asignar → select de responsable · Contactar / Registrar seguimiento / Agradecer → `FollowUpSheet` · Revisar → la ficha con la alerta de duplicado.

**Secciones (paneles con h2 + conteo):**
- **Cumpleaños próximos** (14 días): "hoy" / "lun 5 oct" · nombre · "cumple 27" · botón WhatsApp de 32 (oculto con No contactar). El 29-02 se muestra "sáb 28 feb (nació el 29)".
- **Nuevos recientes** (14 días): fecha de ingreso · nombre · estado.
- **Seguimientos próximos** (7 días): fecha · acción · responsable. Título "Seguimientos pendientes", con el subtítulo "Próximos 7 días. Los vencidos están en Necesitan atención."
- **Volvieron** (7 días): fecha · nombre · "3.ª visita" + "Agradecer" si no tiene seguimiento posterior.
- Cada sección muestra un máximo de 5 filas + "Ver todos →" (Personas filtrada).

**Móvil 390 (respeta Atención > indicadores > secciones):**

```
[Vista previa            Ver como: Consolidación ▾]
[CS] [Integrantes ⌄]               [Demo] (CV)
Consolidación                         h1 20
Domingo 4 de octubre
Necesitan atención (6)                h2
 ⚠ Pablo Muñoz · Sin primer contacto · hace 4 d
   [Contactar ─────────── ancho completo 44px]
 ⓡ Sofía Ramírez · Sin responsable
   [Asignar ────────────────────────────]
 ⏰ Ana Torres · Seguimiento vencido 1 oct
   [Registrar seguimiento ──────────────]
 Ver las 6 →
┌ En números ───────────────────────┐   1 panel, 3 filas de 48px
│ Nuevos este mes            5  ›   │
│ Sin primer contacto        2  ›   │
│ Seguimientos vencidos      1  ›   │
└───────────────────────────────────┘
Cumpleaños próximos (3) …
Volvieron (1) …
Nuevos recientes (5) …
Seguimientos próximos (3) …
[Inicio][Personas][(+) Nueva][Atención•6][Más]
```

**Atención** (`/consolidacion/atencion`): la cola completa agrupada por tipo de alerta. Headers de grupo 11/600 + conteo (patrón `AttentionPanel` del doc 14), columna de máx. 880 px y una persona por fila en su grupo de mayor prioridad.

### 9.3 Personas (`/consolidacion/personas`)

**Toolbar:**
- search de 280 px "Buscar nombre, teléfono o correo" (busca también el teléfono sin formato);
- chips:
  - Estado;
  - Responsable (incluye "Sin responsable");
  - Alertas (Necesita atención, Sin primer contacto, Vencido, Volvió, Sin volver, Duplicado, Cumpleaños);
  - Etiquetas (Nuevos, Volvieron, Menores);
- switch "Incluir cerrados" (Integrado y Sin continuidad; apagado por defecto);
- select **"Ordenar: Necesitan atención primero"** (por defecto) · Ingreso más reciente · Última visita más antigua · Próxima acción · Nombre A–Z;
- a la derecha, el Primary "+ Nueva persona".

**Tabla desktop** (panel sin padding horizontal; `thead` sticky; filas de 52 px porque llevan 2 líneas en Nombre):

| Columna | Ancho | Contenido |
|---|---|---|
| Nombre | 1fr (mín. 200) | 13/600 link + badges derivados en línea. Línea 2, 12 muted: los íconos de alertas (14 px, máx. 3, con `aria-label`) |
| Edad | 56, a la derecha | "34" / "—" |
| Teléfono | 128 | "+56 9 5555 0112", tabular |
| Ingreso | 84 | "dom 13 sep" |
| Última visita | 96 | "dom 4 oct" |
| Visitas | 64, a la derecha | "3" |
| Responsable | 120 | "Carolina V." / "Sin asignar" (review, `UserX`) |
| Estado | 140 | `StatusBadge` |
| Próxima acción | 168 | "Llamar" + línea 2 "mar 6 oct". Vencida: `AlarmClock` + texto `--fx-warning` "Vencida · 1 oct" |
| Acciones | 48 | `⋯` de 32 px: Registrar visita · Registrar seguimiento · Abrir WhatsApp · Ver ficha |

**Container queries por ancho de la tabla** (lección P11):
- **≥1100:** todas las columnas.
- **940–1099:** se ocultan Ingreso y Visitas. "3 visitas" pasa a la línea 2 de Última visita.
- **760–939:** se ocultan también Teléfono y Responsable. El teléfono pasa a la línea 2 de Nombre.
- **<760:** lista móvil.

**Lista móvil** (`<ul>`, filas de mín. 76 px; toda la fila lleva a la ficha):

```
Pablo Muñoz  [Nuevo]                    [⚠ Por contactar]   (estado como ícono 16 + texto 12)
28 años · 1 visita · llegó mié 30 sep                      13 muted
⚠ Sin primer contacto · hace 4 días                [⋯ 44px] 13 en tono de la alerta
```

- Si no hay alertas, la línea 3 muestra la próxima acción: "Próxima: Llamar · mar 6 oct".
- El botón `⋯` (`aria-label` "Acciones para Pablo Muñoz") abre un sheet con filas de 56 px: Registrar visita · Registrar seguimiento · Abrir WhatsApp · Ver ficha.
- Con No contactar, no aparece WhatsApp.

**Vacíos:**
- "Ninguna persona coincide con «…»." [Limpiar búsqueda]
- Sin filtros y sin datos: "Aún no hay personas en Consolidación" · "Registra a quienes visitan la iglesia por primera vez." [Nueva persona]

### 9.4 Ficha de persona (`/consolidacion/{persona-demo}`)

**Desktop:**

```
← Personas
Javier Soto  [Volvió] [En seguimiento]                      h1 22/600 + badges
34 años · Ingresó el dom 13 sep 2026 · Responsable: Carolina Vidal       13 muted
                      [Registrar visita] [Registrar seguimiento] [WhatsApp] [⋯]
┌ Próxima acción (8 col) ─────────────────────┐┌ Datos (4 col) ───────────────┐
│ ⏰ Invitar al culto del miércoles            ││ Teléfono   +56 9 5555 0104   │
│ mié 7 oct · Carolina Vidal  [Registrar seguimiento] ││ Correo  javier@demo.invalid │
└─────────────────────────────────────────────┘│ Nacimiento 12-03-1992 (34)   │
┌ Historial ─────────────── [Todo|Visitas|Seguimientos|Cambios] ┐│ Confesión de fe  Sí │
│ dom 4 oct  ◉ Visita · Culto dominical                  ││ Bautizado  ⓘ Sin información │
│            Registrada por Carolina Vidal · "Vino con su esposa" ││ Ingreso  dom 13 sep 2026 │
│ jue 24 sep ◉ Seguimiento · WhatsApp · Contactado       ││ Visitas  3 · última dom 4 oct │
│            "Agradeció la llamada." Próxima: …          ││ Responsable Carolina Vidal │
│ jue 24 sep ⇄ Estado: Por contactar → En seguimiento    ││ Estado  En seguimiento │
│ dom 20 sep ◉ Visita · Culto dominical                  ││ Etapa  En consolidación │
│ dom 13 sep ★ Primera visita · Culto dominical · Registró Carolina V. │└──────────────┘
│                                                        │┌ Alertas (1) ───────────────┐
└────────────────────────────────────────────────────────┘│ DoorOpen Volvió hoy sin seguimiento │
                                                          └─────────────────────────────┘
```

- **Acciones:** Primary "Registrar visita" · Secondary "Registrar seguimiento" · Secondary "WhatsApp" (`MessageCircle`). `⋯`: Cambiar estado · Asignar responsable · Editar datos (simulación) · Anular una visita.
- **WhatsApp en la preview:** no abre `wa.me` (es un número ficticio). Muestra el toast **"Simulación: se abriría WhatsApp con +56 9 5555 0104."** En producción, `https://wa.me/56955550104` en una pestaña nueva y sin texto prellenado.
- **Datos:** `<dl>` en filas de 36 px, con el label 12 muted y el valor 13/500.
  - Tri-estado: "Sí" / "No" / "Sin información" (muted + `CircleHelp` 14). Nunca un checkbox.
  - Sin fecha de nacimiento: "—" y "Edad desconocida".
- **Historial:**
  - columna de fecha de 80 px (12/600);
  - ícono de 28 px en un círculo `-bg` según el tipo: Visita `MapPin` · Primera visita `Star` · Seguimiento `MessageCircle`/`Phone`/`Users`/`Ellipsis` según el tipo · Cambio `ArrowRightLeft` · Creación `UserPlus`;
  - título 14/500 y meta 12 muted, con la nota entre comillas en 13;
  - visita anulada: título tachado + "Anulada: registrada por error" (neutral);
  - orden: lo más nuevo primero;
  - segmented de filtro con `aria-pressed`.
- **Próxima acción vacía:** "Sin próxima acción" + "Registrar seguimiento".
- **Persona Integrada:** franja success arriba: "Javier es integrante desde el 20-09. Su historial de Consolidación se conserva." Sin CTA de visita o seguimiento de Consolidación (las acciones quedan para Integrantes a futuro).
- **No contactar:** franja neutral `BellOff`: "Pidió no ser contactada (24-09). No se muestran WhatsApp ni alertas." Sin botón WhatsApp.
- **Menor:** badge "Menor de edad" y la nota 12 muted en Datos: "Contacta a través de un adulto responsable." (RISK de Navigator K7: sin campo nuevo).

**Móvil:**

```
← Personas
Javier Soto                           20/600
[Volvió] [En seguimiento]
34 años · Ingresó dom 13 sep · Carolina V.
[Visita][Seguimiento][WhatsApp]   3 botones iguales de 44px (ícono + label)
┌ Próxima acción ───────────────┐
│ Invitar al culto del miércoles│
│ mié 7 oct · Carolina V.       │
└───────────────────────────────┘
Alertas (1)
▾ Datos  (details abierto por defecto)
Historial  [Todo|Visitas|Seg.|Cambios]  (segmented con scroll interno si no cabe; 44px)
 dom 4 oct · Visita · Culto dominical …
```

`⋯` va en la top bar de la página, como botón de 44 a la derecha de "← Personas".

### 9.5 Nueva persona (`/consolidacion/nueva`)

Página, no sheet: es un formulario largo de primer contacto, a veces en el hall de la iglesia. Columna de máx. 640 px y footer sticky en móvil.

1. **Contacto:**
   - **Nombre completo\***.
   - **Teléfono\*** (`type="tel"`, `inputmode="tel"`). Ayuda: "Ej.: 9 1234 5678. Si es de otro país, incluye el código: +58 412 555 0101." Al salir del campo, si es válido, aparece debajo en 12 `--fx-success` con `Check`: "Se guardará como +56 9 5555 0112". Si es inválido: "Revisa el número: debe tener 9 dígitos (o el código de país)."
   - **Correo**.
   - **Fecha de nacimiento** (`type="date"`, `max` = hoy). Cuando es válida: "Tiene 34 años" o "Tiene 12 años · menor de edad".
2. **Fe:**
   - **Confesión de fe:** 3 radios en línea de 44 px: Sí · No · **Sin información** (marcado por defecto);
   - **Bautizado:** ídem.
   - Ayuda del grupo: "Si no lo sabes, deja «Sin información»."
3. **Seguimiento:**
   - **Responsable de seguimiento:** select con los usuarios con `consolidation.manage` + "Sin asignar". Con "Sin asignar": ayuda warning "Aparecerá en Necesitan atención hasta que alguien la tome."
   - **Notas iniciales:** máx. 1000.
   - **Llegó a** (HYPOTHESIS, §16): select con las actividades del calendario de hoy ("Culto dominical · 11:00"), por defecto la más cercana a la hora actual, más "Otra…".
4. **Fila fija de solo lectura:** "**Fecha de ingreso:** hoy, domingo 4 de octubre de 2026 · Se registra automáticamente."

**Duplicado** (se evalúa al salir del campo teléfono o correo; **no bloquea**). Panel warning bajo el campo, con `role="status"`:

```
⚠ Ya hay una persona con este teléfono
   Rosa Fuentes · ingresó dom 13 sep · En seguimiento
   [Ver ficha existente] [Registrar visita a Rosa] [Es otra persona, continuar]
```

- Las familias comparten teléfono, por eso no se impide guardar.
- "Es otra persona, continuar" colapsa el panel a una línea 12 muted: "Marcada como otra persona. Quedará el aviso «posible duplicado» para revisarlo después."
- "Guardar persona" sigue habilitado siempre.

**Footer:** [Cancelar] · Primary [Guardar persona]. Al guardar: toast de simulación y vuelta a Personas.

### 9.6 Registrar visita (`VisitSheet`, 440 / bottom sheet)

- Título "Registrar visita · Javier Soto".
- **Fecha** (por defecto hoy, máx. hoy).
- **Actividad o servicio:** select con las actividades del calendario en esa fecha + "Otra…" (que abre un texto).
- **Nota (opcional)**.
- **Aviso no bloqueante:** "Ya hay una visita de Javier el dom 4 oct en Culto dominical."
- **Persona Sin continuidad:** banner info "Javier volvió. ¿Reabrir su seguimiento?" + checkbox **sin marcar** "Reabrir y pasar a En seguimiento".
- **Footer:** [Cancelar] [Guardar visita].
- **Después de guardar**, en la preview: toast + actualización local de la ficha y la lista ("Visitas 4 · última hoy") + un nuevo hito en el historial con un resaltado de 1,2 s (§14).

### 9.7 Registrar seguimiento (`FollowUpSheet`)

- Arriba, Secondary "Abrir WhatsApp" a ancho completo (oculto con No contactar).
- **Fecha** (por defecto ahora).
- **Tipo:** 4 radios-botón de 44 px: WhatsApp · Llamada · Presencial · Otro.
- **Resultado:** radios: Contactado · Sin respuesta · Número inválido · No desea contacto · Otro.
- **Nota**.
- **Próxima acción** (texto, con chips de sugerencia 32 px: "Invitar al culto del miércoles" · "Llamar de nuevo" · "Invitar a un grupo") + **Fecha de la próxima acción** (≥ fecha).
- **Responsable** (por defecto, el de la persona).
- **Sugerencias de estado** (aparecen según el resultado; caja `--fx-primary-soft`):
  - resultado Contactado y estado Por contactar: checkbox **marcado** "Cambiar estado a **En seguimiento**";
  - resultado No desea contacto: checkboxes **marcados** "Marcar **No contactar**" y "Cerrar como **Sin continuidad** (motivo: no desea contacto)";
  - nota: "Puedes desmarcarlo. Ningún estado cambia sin tu confirmación."
- **Reemplazo de acción:** si existía una próxima acción, línea 12 muted: "Reemplaza la próxima acción actual: «Llamar» (1 oct)."
- **Footer:** [Cancelar] [Guardar seguimiento].

### 9.8 Cambiar estado (dialog)

- Radios de los 5 estados, cada uno con una descripción de 12 muted:
  - Por contactar: "Aún no hay un primer contacto exitoso."
  - En seguimiento: "Ya hubo contacto y se está acompañando."
  - Integrándose: "Participa en un área o discipulado."
  - Integrado: "Pasa a ser integrante de la iglesia."
  - Sin continuidad: "Se cierra el acompañamiento."
- **Sin continuidad:** muestra "Motivo (obligatorio)": select No responde · Se cambió de iglesia · Se mudó · No desea contacto · Otro + nota.
- **Integrado:** muestra la caja info "Javier pasará a ser integrante. Saldrá de las listas activas de Consolidación y conservará todo su historial." El botón cambia a "Confirmar: Integrado".
- **Botones:** [Volver] [Guardar cambio].

### 9.9 Ajustes (`/consolidacion/ajustes`)

- h1 "Ajustes de Consolidación".
- Panel "Alertas", con un badge "Solo lectura en la vista previa" (neutral, `Lock`).
- Filas de 56 px: label 14/500 · valor 15/600 tabular · explicación 12 muted.
  - Horas máximas para el primer contacto: **48 h**. "Quien llega el domingo se contacta antes del miércoles."
  - Días sin una nueva visita: **21 días**. "Equivale a 3 domingos."
  - Anticipación de cumpleaños: **14 días**.
  - "Nuevo" durante: **14 días**.
  - "Volvió" durante: **7 días**.

---

## 10. Configuración

**Decisión:** la configuración actual de finanzas-2026 se reparte así:
- **Días de culto** pasa a una sección propia de la iglesia: la usan Finanzas y, a futuro, Calendario;
- **Integraciones (SumUp) + Categorías** pasan a "Finanzas e integraciones";
- **Usuarios** se reemplaza por el nuevo "Usuarios y permisos".

### 10.1 Áreas (`/preview/configuracion/areas`)

**Tabla desktop:**

| Columna | Ancho | Contenido |
|---|---|---|
| Área | 1fr | swatch 16 radius 4 + nombre 13/600 |
| Descripción | 1fr | 13 muted, `line-clamp` 1 |
| Actividades próximas | 120, a la derecha | — |
| Estado | 140 | switch de 44×24 + texto "Activa"/"Inactiva" |
| Acciones | 72 | "Editar" |

- **Header:** h1 "Áreas", subtítulo "Organizan el calendario y los permisos de los líderes. El color de cada actividad viene de su área." Primary "+ Nueva área".
- **Móvil:** filas de 64 px con swatch + nombre + "12 actividades · Activa" + chevron.

**Editor (sheet de 440):**
- **Nombre\*:** máx. 40. Error "Ya existe un área con ese nombre."
- **Descripción:** máx. 200.
- **Color\*:** radiogroup de **solo los colores disponibles**. Cada swatch es un radio de 40 px (44 en móvil), radius 8, con el nombre del color debajo (12): "Carmín". El seleccionado lleva un anillo de 2 px `--fx-ink-strong` + `Check` blanco.
  - Línea 12 muted: "Los demás colores están en uso por otras áreas activas."
  - Si el color está libre porque su área está inactiva: "Libre (lo usaba Matrimonios, inactiva)".
  - Al editar, el color actual del área siempre aparece.
  - **Sin colores libres:** "Todos los colores están en uso. Desactiva un área para liberar el suyo." y "Guardar" deshabilitado.
- **Vista previa:** "Así se verá: [▌ Nueva área 19:00 Reunión]".

**Desactivar** (dialog): "¿Desactivar Matrimonios? No se podrá elegir en actividades nuevas. Sus 3 actividades conservan su nombre y color. Los líderes de esta área ya no podrán editarlas." [Volver] [Desactivar].

### 10.2 Usuarios y permisos

**Lista:**

| Columna | Ancho | Contenido |
|---|---|---|
| Usuario | 1fr | nombre 13/600 + correo 12 muted |
| Cargo | 120 | — |
| Áreas | 180 | chips |
| Módulo inicial | 140 | — |
| Estado | 110 | — |
| Avisos | 40 | `TriangleAlert` warning con tooltip |

En móvil: filas de 2–3 líneas.

**Editor de usuario** (página `/configuracion/usuarios/{id}`):

```
← Usuarios y permisos
Matías Contreras                                   [Cancelar] [Guardar cambios]
matias@demo.invalid · [Activo ●]
┌ Resumen (12 col, franja primary-soft) ─────────────────────────────────────┐
│ Verá: Finanzas (solo resumen) · Calendario · Reportes (Calendario)          │
│ Entrará a: Calendario                                                        │
└──────────────────────────────────────────────────────────────────────────────┘
┌ Cargo y áreas (5 col) ───────────┐┌ Permisos (7 col) ─────────────────────────┐
│ Cargo [Líder ▾]                  ││ FINANZAS                                   │
│ Al cambiar el cargo se proponen  ││ ☑ Ver resumen financiero                   │
│ sus permisos.                    ││   Cifras generales, sin detalle.           │
│ Áreas asignadas                  ││ ☐ Ver detalle financiero                   │
│ [■ Jóvenes ×] [+ Agregar área]   ││   Movimientos, diezmos, caja y reportes.   │
│ Módulo inicial [Calendario ▾]    ││ ☐ Registrar y editar movimientos           │
│ Solo módulos permitidos.         ││ ☐ Seguimiento pastoral en diezmos          │
│ ⚠ avisos aquí                    ││ CALENDARIO                                 │
└──────────────────────────────────┘│ ☑ Ver calendario  (incluido en «Gestionar…»)│ ← marcado + deshabilitado
                                    │ ☑ Gestionar actividades de sus áreas       │
                                    │ ☐ Gestionar todas las actividades y el     │
                                    │   enlace público                           │
                                    │ INTEGRANTES                                │
                                    │ ☐ Ver Consolidación                        │
                                    │ ☐ Gestionar Consolidación                  │
                                    │ SISTEMA                                    │
                                    │ 🔒 Administrar configuración               │
                                    │   Solo usuarios con cargo Administración.  │
                                    └────────────────────────────────────────────┘
```

- **Checkboxes** de 20 px en filas de mín. 44 px: label 14/500 + descripción 12 muted. Headers de grupo 11/600.
- **Permiso implicado:** queda marcado y deshabilitado, con el sufijo 12 muted "Incluido en «Gestionar actividades de sus áreas»". Se calcula con `effectivePermissions`.
- **Cargo Administración:** todos los permisos marcados y deshabilitados, con la nota "Administración tiene todos los permisos, incluida la configuración."
- **"Administrar configuración":** nunca es editable. Muestra el candado + "Solo usuarios con cargo Administración."
- **Cambiar de cargo** (dialog): "¿Aplicar los permisos sugeridos para Pastor? Se reemplazarán los permisos marcados y el módulo inicial." [Mantener los actuales] [Aplicar sugeridos].
- **Avisos** (warning, `TriangleAlert`):
  - "Gestiona actividades de sus áreas, pero no tiene áreas asignadas."
  - "El módulo inicial (Finanzas) ya no está permitido; se abrirá Calendario."
  - "Es el único administrador activo; no se puede desactivar ni cambiar de cargo." (estos controles quedan deshabilitados)
  - Sobre uno mismo: "No puedes quitarte el acceso de administrador ni desactivarte."
- **Módulo inicial:** select limitado a los módulos de entrada permitidos (Finanzas · Calendario · Consolidación).
- **Móvil:** todo en una columna: Resumen → Cargo y áreas → Permisos. Footer sticky.

---

## 11. Layouts por viewport (ASCII)

**Calendario Mes, desktop 1440 (perfil Líder):**

```
┌sidebar 240───┬ Vista previa · datos de demostración. Nada se guarda.   Ver como: Líder · Matías Contreras ▾ ┐
│CS Casa de S. │ Calendario                                                                                │
│  CDS Suite   │ Actividades de todas las áreas de la iglesia.                                             │
│◎ Finanzas    │ [Hoy][‹][›] Octubre 2026         [Mes|Semana|Agenda] [Áreas: Todas ▾] [⋯] [+ Crear actividad] │
│▣ Calendario ⌃│ ■Pastoral ■Alabanza ■Jóvenes ■Niños ■Damas ■Varones ■Intercesión ■Multimedia ■Consolidación│
│ ▌Calendario  │ LUN      MAR      MIÉ      JUE      VIE      SÁB      DOM                                 │
│  Mis activ.  │ 28       29       30       1        2        3        ④                                   │
│▥ Reportes    │                   ▌19:30 Culto     ▌20:00 Re ▌10:00 Ay ▌11:00 Culto domin.             │
│              │                                    ⊘ cancel. ▌17:00 En ▌11:00 Escuela dom.             │
│              │ 5        6        7        8        9        10       11                                  │
│              │ ▌20:00 Re▌19:00 Da ▌19:30 Culto     ▌20:00 Re ▌09:00 De ▌11:00 Culto…                     │
│              │                                              ⊘17:00 En▌11:00 Escuela…                     │
│ (MC) Matías  │ …  17–18: [▌Campamento de jóvenes ──────────]       31: ▌Fiesta de luz  +1 más             │
└──────────────┴───────────────────────────────────────────────────────────────────────────────────────────┘
```

**Calendario, 1024 con rail:** rail de 72 + contenido de 904. Toolbar en 2 filas:
- fila 1: Hoy ‹ › título · [+ Crear actividad];
- fila 2: segmented · Áreas · `⋯`.

Mes con 2 chips por celda + "+n más".

**Agenda móvil, 390/375:**

```
[⚗ Vista previa           Ver como: Líder ▾]   44
[CS] [Calendario ⌄]          [Demo] (MC)        56
Calendario                                      h1 20
‹  Octubre 2026  ›                       [Hoy]
[  Agenda  |   Mes   ]            [Áreas (Todas)]
HOY · DOMINGO 4 DE OCTUBRE          (sticky 36)
11:00 ▌ Culto dominical · Santa Cena    🌐
13:00 ▌ Pastoral · con Alabanza, Mult…
11:00 ▌ Escuela dominical
12:30 ▌ Niños · Sala de niños
MAÑANA · LUNES 5 DE OCTUBRE
20:00 ▌ Reunión de líderes          🔒
      ▌ Pastoral · Oficina
…
[Calendario][Mis actividades][(+)Crear][Finanzas↗][Más]
```

**Consolidación dashboard:** ver §9.2. A **1024** queda así: fila de 3 tiles; Necesitan atención a 12 columnas; Cumpleaños | Volvieron (6|6); Nuevos | Seguimientos (6|6).

**Personas desktop 1440:**

```
Personas                                                     [+ Nueva persona]
[🔍 Buscar nombre, teléfono o correo] [Estado▾][Responsable▾][Alertas▾][Etiquetas▾] ○ Incluir cerrados  Ordenar: Necesitan atención primero ▾
14 personas · 6 necesitan atención
Nombre                Edad Teléfono         Ingreso  Últ. visita Visitas Responsable  Estado           Próxima acción   ⋯
Sofía Ramírez [Nuevo]  19  +56 9 5555 0101  dom 4 oct dom 4 oct    1   ⓡSin asignar  ⚠Por contactar   —
 ⓡ                                                                                                   
Pablo Muñoz [Nuevo]    28  +56 9 5555 0102  mié 30 sep mié 30 sep  1   Carolina V.   ⚠Por contactar   Llamar · hoy
 ⚠ ⓒ
Ana Torres             41  +56 9 5555 0103  dom 6 sep dom 27 sep   3   Carolina V.   💬En seguimiento ⏰Vencida · 1 oct
…
```

**Personas móvil:** ver §9.3.

**Ficha desktop y móvil:** ver §9.4.

**Editor de usuarios:** ver §10.2. A 1024: 5|7 → 12 apilado si el contenedor mide menos de 880.

---

## 12. Estados (`?estado=cargando|vacio|error` en cada pantalla nueva)

| Pantalla | Cargando | Vacío | Error |
|---|---|---|---|
| Calendario Mes | grilla con 6 semanas de celdas skeleton y 1–2 barras de 22 px | El mes se renderiza, con un `EmptyState` sobre la grilla: "No hay actividades en octubre" · "Prueba con otras áreas o crea una actividad." [Crear actividad] (si puede) | "No pudimos cargar el calendario" · "Revisa tu conexión e inténtalo de nuevo." [Reintentar] |
| Calendario Agenda | 3 headers de día + 6 filas skeleton de 64 px | "No hay actividades próximas." Con filtro: "Ninguna actividad de las áreas elegidas." [Mostrar todas las áreas] | ídem |
| Mis actividades | 5 filas | ver §5.6 | ídem |
| Compartir | panel skeleton | (estado inactivo, §5.10) | "No pudimos cargar el enlace." |
| Calendario público | 6 filas | "No hay actividades publicadas en octubre." | "No pudimos cargar el calendario. Inténtalo más tarde." / "Este calendario no está disponible" |
| Reporte de calendario | franja + 8 filas | "No hay actividades con estos filtros." [Limpiar filtros] | ídem |
| Consolidación Inicio | 3 tiles de 96 px + 5 filas | Atención vacía: `CircleCheck` + "Todo al día" · "Nadie necesita atención ahora." Sin personas: "Aún no hay personas en Consolidación" [Nueva persona] | "No pudimos cargar Consolidación" [Reintentar] |
| Personas | 8 filas de 52 px | §9.3 | ídem |
| Ficha | header + 2 paneles skeleton | Historial con solo la primera visita (nunca vacío) | "No encontramos esta persona." [Volver a Personas] |
| Áreas | 6 filas | "Aún no hay áreas" · "Crea la primera para organizar el calendario." [Nueva área] | ídem |
| Usuarios | 6 filas | (siempre hay ≥1 admin) | ídem |

---

## 13. Accesibilidad (además del doc 14 §12)

1. El área nunca se comunica solo por color: hay nombre visible o `aria-label`/`title`. Las pantallas se revisan en escala de grises y con un simulador de deuteranopia.
2. **Grilla de mes:**
   - `role="grid"` con `aria-label="Octubre 2026"`; las celdas son `gridcell`;
   - flechas para moverse entre días, Enter para abrir el popover del día y Tab para entrar a los chips;
   - `aria-current="date"` en hoy.
   - Alternativa aceptable para la preview: una tabla semántica con un botón por día. Builder elige una y la documenta.
3. Los chips y los bloques de eventos son `<button>` con un `aria-label` completo (título, fecha, hora, área, visibilidad y estado).
4. **Tri-estado:** `<fieldset>` + `<legend>` + 3 radios. "Sin información" se marca de forma explícita.
5. Los botones deshabilitados por permiso usan `aria-disabled` + una explicación enlazada (`aria-describedby`). Nunca solo el atributo `disabled` sin explicación.
6. Los dialogs y sheets siguen el doc 14 (foco inicial, Esc, devolución del foco). Los motivos obligatorios llevan `aria-required` y un error `role="alert"`.
7. **Simulador "Ver como":** `aria-haspopup="dialog"`. El cambio de perfil se anuncia por el toast (`polite`).
8. **Targets:** 44 en móvil (puntos de mes móvil: el target es toda la celda) y ≥32 en desktop. Los chips de mes miden 22 de alto, con un ancho ≥ al de la celda, y se aceptan como excepción en desktop porque la alternativa por teclado existe y la agenda los lista.
9. **Contraste:** la paleta de §4.1 (swatch ≥3:1, ink ≥4,5:1). Se verifica en el build.
10. Fechas legibles en `aria-label` ("domingo 4 de octubre") y `lang="es-CL"`. Las horas en formato 24 h.

---

## 14. Revisión de motion

| Qué | Por qué se mueve | Duración | Con reduced motion | Evidencia |
|---|---|---|---|---|
| Cambio de perfil: re-render de la navegación | Orientación (qué cambió) | Fade de 150 ms de los ítems nuevos | Instantáneo | HYPOTHESIS |
| Expandir o colapsar las secciones del módulo activo | Continuidad | 150 ms en alto + rotación del chevron | Instantáneo | HYPOTHESIS (heredada del doc 14) |
| Sheets y dialogs | Continuidad | 200 ms (doc 14) | Fade de 100 ms | Doc 14 |
| Popover de día y de filtro | Feedback | Fade + scale .98→1 en 120 ms | Fade | HYPOTHESIS |
| Cambio de mes o semana | Orientación | **Sin animación** (evita mareo y lentitud) | — | Decisión |
| Hito nuevo en el historial o fila que cambió | Feedback | Fondo `--fx-primary-soft` que se desvanece en 1,2 s | Sin animación (queda 1,2 s sin transición) | HYPOTHESIS |
| Ítem de Atención resuelto | Feedback | Colapso de 200 ms (doc 14) | Sin animación | Doc 14 |
| Línea "ahora" | — | Estática | — | — |

No se usan `transition-all`, parallax ni count-up.

---

## 15. Copy deck (es-CL)

**Shell y acceso:**
- "CDS Suite" · "Cambiar de módulo" · "Otros módulos" · "Saltar al contenido".
- "No tienes acceso a {módulo}. Te llevamos a {módulo inicial}."
- "Aún no tienes módulos asignados" · "Tu cuenta está activa, pero todavía no tiene permisos. Pide al administrador que te asigne un módulo." · "Cerrar sesión".
- **Simulador:** "Ver como:" · "Ver como (vista previa)" · "Herramienta de la vista previa. Cambia el perfil para ver cómo cambia la navegación." · "Ahora ves CDS como {nombre}. Entraste a {módulo}."
- **Ingreso:** "Ingresar a la vista previa" · "Elige con qué perfil quieres entrar. En CDS real cada persona entra con su propia cuenta y llega directo a su módulo." · "Entra a {módulo}".

**Calendario:**
- "Crear actividad" · "Nueva actividad" · "Editar actividad" · "Guardar actividad" · "Cancelar actividad" · "Eliminar" · "Volver".
- "Hoy" · "Mes" · "Semana" · "Agenda" · "Áreas: Todas" · "Solo como responsable" · "+{n} más".
- "Pública" · "Solo equipo" · "Programada" · "Realizada" · "Cancelada".
- "Se repite cada viernes hasta el 18 dic 2026" · "Se repetirá {n} veces: del {inicio} al {fin}." · "Llegará en una próxima versión."
- "Color: lo define el área responsable." · "Participar no da permiso para editar." · "Nunca se publican."
- "Solo el área responsable ({área}), Pastor o Administración pueden modificar esta actividad."
- "Tu área participa, pero la organiza otra área. Solo puedes verlas."
- **Compartir:** "Compartir calendario" · "Copiar enlace" · "Enlace copiado." · "Regenerar enlace" · "Desactivar enlace" · "Activar con un enlace nuevo" · "Qué se publica" · "Qué nunca se publica".
- **Público:** "Calendario de actividades" · "Organiza: {área}" · "Esta actividad no se realizará." · "Horarios en hora de Chile continental." · "Este calendario no está disponible".

**Consolidación:**
- "Nueva persona" · "Guardar persona" · "Registrar visita" · "Guardar visita" · "Registrar seguimiento" · "Guardar seguimiento" · "Abrir WhatsApp" · "Cambiar estado" · "Asignar responsable".
- "Necesitan atención" · "Cumpleaños próximos" · "Nuevos recientes" · "Seguimientos pendientes" · "Volvieron" · "Todo al día" · "Nadie necesita atención ahora."
- **Alertas:** "Sin responsable" · "Sin primer contacto · hace {n} días · {n} intento(s)" · "Seguimiento vencido · {fecha}" · "Volvió sin seguimiento" · "{n} días sin volver" · "Posible duplicado (teléfono)" · "Cumple {n} el {fecha}".
- **CTA:** "Asignar" · "Contactar" · "Registrar seguimiento" · "Agradecer" · "Revisar" · "Saludar".
- **Formularios:** "Sin información" · "Si no lo sabes, deja «Sin información»." · "Se guardará como {teléfono}" · "Ya hay una persona con este teléfono" · "Ver ficha existente" · "Registrar visita a {nombre}" · "Es otra persona, continuar" · "Fecha de ingreso: hoy, {fecha} · Se registra automáticamente."
- **Sugerencias:** "Cambiar estado a En seguimiento" · "Puedes desmarcarlo. Ningún estado cambia sin tu confirmación." · "{Nombre} volvió. ¿Reabrir su seguimiento?"
- **Integrado:** "{Nombre} pasará a ser integrante. Saldrá de las listas activas de Consolidación y conservará todo su historial."

**Configuración:**
- "Áreas" · "Nueva área" · "Los demás colores están en uso por otras áreas activas." · "Todos los colores están en uso. Desactiva un área para liberar el suyo."
- "Usuarios y permisos" · "Verá:" · "Entrará a:" · "Incluido en «{permiso}»" · "Solo usuarios con cargo Administración." · "¿Aplicar los permisos sugeridos para {cargo}?"

**Global:**
- **Toast:** "Simulación: no se guardó nada." · WhatsApp: "Simulación: se abriría WhatsApp con {teléfono}."
- **Privacidad** (pie de la ficha y de Personas, 12 muted): "Datos personales de uso pastoral. Solo los ve el equipo de Consolidación."
- **Prohibidos en la UI:** UID · Firestore · token · ID · backend · proyección · permiso técnico (`calendar.read`) · slug. Se dice "enlace", nunca "token".

---

## 16. Handoffs

### 16.1 Builder

**DESIGN GOAL:** una suite multimódulo que extiende V2 sin tocar la experiencia financiera, con Calendario, la página pública, el reporte, Consolidación y Configuración según §3–§10.

**DOMINANT DIRECTION:** §2. **REFERENCES:** §1. **DESIGN LOCK:** §3–§15.

**INVENTARIO** (las rutas se suman a las de Finanzas):
- `/preview` (ingreso);
- `/preview/calendario` (`?vista=`) · `/mis-actividades` · `/compartir` · `/compartir/demo` (pública) · `/compartir/{inválido}` (no disponible);
- `/preview/reportes/finanzas|calendario` (+ PDF);
- `/preview/integrantes` → `/consolidacion` · `/atencion` · `/personas` · `/nueva` · `/{persona-demo}` · `/ajustes`;
- `/preview/configuracion/areas|usuarios|usuarios/{id}|dias-de-culto|finanzas`;
- pantalla "sin módulos";
- redirecciones de §3.1.

**COMPONENTES NUEVOS:**
- **Shell:** `SuiteShell` (generaliza `FinancialShell`) · `SuiteSidebar(variant full|rail)` · `MobileNav` con `bottomTabs()` · `ModuleSwitchSheet` · `ProfileSimulator` · `AccessNotice` · `NoModulesScreen` · `PreviewLogin`.
- **Áreas:** `AreaChip` · `AreaPill` · `AreaSwatch` · `AreaFilter`.
- **Calendario:** `CalendarToolbar` · `MonthGrid` · `MonthGridCompact` · `WeekGrid` · `AgendaList` · `DayPopover` · `EventChip` · `EventDetailSheet` · `EventFormSheet` · `RecurrenceField` · `CancelEventDialog` · `ArchiveEventDialog` · `ShareLinkPanel` · `PublicCalendarPage`.
- **Reportes:** `CalendarReport` · `buildCalendarPdf()`.
- **Consolidación:** `CountTile` · `AttentionQueue` (reutiliza los estilos de `AttentionItem`) · `PeopleTable` / `PeopleList` · `PersonHeader` · `PersonTimeline` · `NextActionCard` · `PersonForm` · `DuplicateNotice` · `VisitSheet` · `FollowUpSheet` · `StatusDialog` · `TriStateField`.
- **Configuración:** `AreaEditor` · `ColorPicker` · `UserEditor` · `PermissionChecklist`.

Los estados, variantes e interacciones de cada componente están en las secciones citadas.

**RESPONSIVE:** §3.2–§3.3, §5.1–§5.5, §7.1, §9.3, §11. Container queries en todas las tablas nuevas.

**PRIORIDAD DE IMPLEMENTACIÓN:**
1. shell + simulador + ingreso + `bottomTabs`;
2. áreas (tokens, chips) + Calendario Agenda/Mes + detalle;
3. Personas + ficha + sheets de visita y seguimiento + dashboard;
4. form de actividad + recurrencia + cancelar/eliminar;
5. Configuración (Áreas, Usuarios);
6. página pública + compartir;
7. Semana + reporte + PDF.

**Builder no decide:** colores de área, número de indicadores, la regla de la bottom bar, la ubicación del simulador ni el copy. Cualquier desviación vuelve a Designer.

### 16.2 Atlas (solo lo que el UX necesita técnicamente)

- **PROBLEMA:** estado de perfil simulado entre rutas, expansión de recurrencias y proyección pública.
- **REQUISITOS:**
  - `PreviewSuiteProvider` en el layout de `/preview`, con perfil + `?como=` y sin storage;
  - `bottomTabs`, `visibleModules` y `resolveInitialModule` como funciones puras compartidas por la sidebar, el rail, la barra móvil, el ingreso y "Entra a";
  - `toPublicEvent` alimenta la página pública (nunca filtrar en el componente);
  - la URL "copiable" de la preview apunta a `/demo`;
  - container queries (soporte del navegador objetivo).
- **ACEPTACIÓN:** la página pública no importa fixtures internas sin pasar por la proyección (test).
- **RIESGO:** `--fx-banner-h` pasa a 40 px y afecta el `thead` sticky de Movimientos (regresión visual).

### 16.3 Navigator (decisiones que el diseño necesita, no resueltas aquí)

1. **"Llegó a" (actividad de la primera visita) en Nueva persona.** El modelo crea la primera visita, pero el formulario del brief no tiene ese campo. Propuesta: select opcional con valor por defecto (§9.5). ¿Se acepta?
2. **Actividades pasadas con `manage_assigned`.** B.5.6 dice "solo lectura". ¿Incluye "Eliminar" (archivar un duplicado pasado)? El diseño asume **que no**.
3. **Atajo de módulo en la bottom bar.** Se usa "el primer otro módulo permitido". ¿Salvador prefiere uno fijo por cargo (por ejemplo, Líder → Finanzas Resumen)? Coincide en los presets actuales.
4. **"Agradecer"** como CTA de "Volvió sin seguimiento": ¿el vocabulario es adecuado para el equipo?

---

## 17. Criterios de aceptación de la revisión visual

1. Con cada uno de los 8 perfiles, la sidebar, el rail y la bottom bar muestran solo los módulos permitidos. Los módulos no permitidos no aparecen, ni siquiera deshabilitados.
2. La sidebar muestra solo las secciones del módulo activo. Un módulo de una sola sección es hoja sin chevron. La marca dice "Casa de Salvación / CDS Suite".
3. Finanzas (Admin) se ve **idéntica** a V2 salvo: la marca, la lista de módulos, Reportes y Configuración fuera del grupo financiero, y el banner de 40 px. Se compara con las capturas de V2 a 1440, 1024 y 390.
4. A 1024×768 el rail muestra los módulos, el divisor y las secciones del módulo activo, con tooltips, sin cortar el footer.
5. La bottom bar coincide con la tabla de §3.3 para cada combinación de módulo y perfil. Nunca tiene más de 5 ni menos de 3 ítems.
6. "Ver como" está en el banner gris con borde dashed (nunca en la sidebar ni en la top bar). Al cambiar de perfil se aterriza en el módulo inicial y aparece el toast.
7. `/preview` lista los 8 perfiles con "Entra a …", calculado con la misma función.
8. El deep link no permitido muestra el aviso. El perfil sin permisos ve "Aún no tienes módulos asignados", sin loop.
9. Los colores de área son los de §4.1. Todo color de área va con su nombre (en la leyenda, la agenda, el detalle y el filtro). No hay gradientes.
10. Mes a 1440: máx. 3 chips + "+n más" por celda. A 1024: 2. La celda de hoy está marcada y la semana empieza el lunes.
11. La Semana muestra la vigilia del viernes 30-10 completa (22:00–02:00, en dos segmentos) y las superposiciones del domingo en columnas.
12. La Agenda es la vista por defecto en móvil, sin días vacíos, con el header de día sticky y el ancla "Hoy".
13. Las canceladas se ven tachadas + "Cancelada" (ícono + texto). Las realizadas, atenuadas. El público nunca muestra el motivo.
14. El detalle muestra el área responsable de forma prominente, los participantes, la visibilidad, el estado y la recurrencia en texto. Las notas internas solo aparecen dentro de la app. Los botones sin permiso llevan su explicación.
15. El formulario del Líder ofrece solo sus áreas. El color no es seleccionable. La recurrencia muestra las 4 opciones con etiquetas calculadas + "Hasta" + el resumen; las opciones futuras llevan Propuesta.
16. Cancelar una actividad recurrente ofrece "Solo esta fecha" / "Toda la serie desde hoy" y exige motivo. Eliminar explica que se archiva.
17. Compartir muestra el enlace, Copiar, Regenerar y Desactivar (con confirmación) y las listas "se publica / nunca se publica". No aparece la palabra "token".
18. La página pública no tiene sidebar, se usa bien a 375 (targets de 44, sin scroll horizontal) y su estado "no disponible" no revela nada.
19. Reportes muestra el segmented [Finanzas | Calendario] solo con ambos permisos. El Líder ve solo Calendario. El PDF es A4 horizontal con el rótulo de vista previa y sin notas internas.
20. El dashboard de Consolidación tiene exactamente 3 indicadores. En móvil, "Necesitan atención" va primero. Una fila por persona con el motivo principal, "+n" y una CTA con verbo.
21. La tabla de Personas no desborda su panel a 1440, 1280, 1024 y 768 (métrica por contenedor). A 390 y 375 es una lista de 2–3 líneas con acciones de 44.
22. La ficha muestra la edad calculada ("—" sin fecha), el tri-estado con "Sin información" visible, la próxima acción y el historial completo, con la primera visita marcada.
23. Nueva persona: tri-estado en 3 radios con "Sin información" por defecto, el teléfono normalizado visible, el aviso de duplicado con 3 opciones (no bloquea) y la fecha de ingreso automática.
24. El seguimiento propone "Cambiar a En seguimiento" ya marcado. "No desea contacto" propone No contactar + Sin continuidad. Ningún estado cambia sin confirmar.
25. Con No contactar no hay WhatsApp ni alertas para esa persona. La persona menor lleva su badge.
26. El editor de áreas muestra solo los colores libres, con nombre. El editor de usuarios muestra los permisos implicados marcados y deshabilitados, "Administrar configuración" bloqueado, los avisos de áreas y de fallback, y el módulo inicial limitado.
27. Toda acción muestra "Simulación: no se guardó nada." No aparecen UID, Firestore, token ni nombres de permisos técnicos.
28. Escala de grises: los estados, las alertas y las áreas se entienden por ícono y texto.
29. **Capturas obligatorias** (escritorio a 1440×900 salvo que se indique otra cosa):
    - a. Calendario Mes (Líder);
    - b. Calendario Semana;
    - c. Calendario a 1024×768 (rail);
    - d. Calendario móvil Agenda a 390;
    - e. Mes móvil a 375;
    - f. Crear actividad con recurrencia (desktop y móvil a 390);
    - g. Filtro por área abierto;
    - h. Detalle sin permiso;
    - i. Cancelar recurrente;
    - j. Compartir;
    - k. Calendario público a 390, a 1440 y "no disponible";
    - l. Configuración › Áreas + editor de color;
    - m. Usuarios y permisos, lista + editor (Líder con aviso);
    - n. Consolidación dashboard a 1440 y a 390;
    - o. Personas a 1440, a 1280 y a 1024;
    - p. Personas móvil a 375;
    - q. Ficha a 1440 y a 390;
    - r. Nueva persona con duplicado;
    - s. Registrar visita;
    - t. Seguimiento con sugerencia de estado;
    - u. Cumpleaños próximos (sección visible, incluido el caso 29-02);
    - v. `/preview` ingreso;
    - w. "Ver como" abierto;
    - x. Aviso "No tienes acceso";
    - y. Sin módulos;
    - z. Reportes › Calendario + PDF;
    - aa. Finanzas Hoy a 1440, a 1024 y a 390 con el shell nuevo (regresión);
    - ab. Resumen financiero del Líder.

---

## 18. Qué NO hacer

- Convertir la sidebar en dos columnas (rail de módulos + panel de secciones) ni usar pestañas horizontales de sección: rompe V2.
- Mostrar módulos bloqueados con candado, o submódulos "Próximamente" en Integrantes.
- Poner "Ver como" dentro de la sidebar, la top bar oscura o el footer de usuario (se confunde con el producto).
- Dejar que el usuario elija el color de una actividad, mezclar colores de participantes, usar gradientes o bordes multicolor.
- Usar color de área como único indicador, o texto en el color de swatch sin la variante `-ink`.
- Agenda con días vacíos; Semana en móvil; tablas de más de 3 columnas en móvil; tablas más anchas que su panel.
- Una cuarta métrica en Consolidación, KPI cards decorativas, un kanban de pipeline o avatares con foto.
- Checkboxes para Confesión o Bautizado, o tratar "Sin información" como "No".
- Bloquear el registro por un duplicado, o cambiar un estado sin confirmación.
- Mostrar el motivo de cancelación, las notas internas o nombres de usuarios en el calendario público, el reporte o el PDF.
- La palabra "token", "UID", "Firestore" o nombres de permisos técnicos en la UI.
- Animar el cambio de mes, usar `transition-all` o agregar librerías de calendario o UI.
- CSS fuera de `.fx`, o tocar las pantallas productivas.

---

## Estado de la investigación y cierre

- **Investigación UX central:** LIMITED. El calendario y el shell tienen respaldo; el CRM se apoya solo en texto.
- **Investigación de componentes:** LIMITED (primitivos nativos y componentes propios; sin librería por decisión).
- **Revisión de motion:** hecha (§14). Las duraciones son HYPOTHESIS.
- **Tipografía y color:** la tipografía se hereda del doc 14 (evidencia previa). La paleta de áreas está calculada con la fórmula WCAG; queda como RECOMMENDATION hasta verificarla en el build.
- **Evidencia visual:** STRONG para el calendario (PCO oficial y Google Embed vistos). LIMITED para Consolidación. NOT AVAILABLE para Church Center en vivo (2 intentos, 404).
- **Señal premium:** LOW.

**Learning:** el Brain no estaba accesible. Hay un candidato débil, **que no se registra** porque viene de una sola referencia: "Las agendas móviles deben saltar los días sin eventos; el embed de Google muestra un día vacío y desperdicia la pantalla". Hay que validarlo con el uso real de la preview.

**Fuentes web consultadas:**
- [Planning Center Calendar](https://www.planningcenter.com/calendar)
- [Planning Center People](https://www.planningcenter.com/people)
- [Planning Center Help: view your church calendar](https://help.planningcenter.com/en/140936-view-your-church-calendar.html)
- [Planning Center Help: show events on Church Center](https://help.planningcenter.com/en/show-events-on-church-center.html)
- [Google Calendar embed: Festivos en Chile](https://calendar.google.com/calendar/embed?src=es.cl%23holiday%40group.v.calendar.google.com&ctz=America%2FSantiago&hl=es)

**Archivos relevantes (absolutos):**
- `docs/mission-2026/14-financial-ux-v2-design-lock.md`
- `docs/mission-2026/15-financial-ux-v2-validation.md`
- `components/finance-preview/shell.tsx`
- `components/finance-preview/finance-preview.css`
- brief de la misión (doc 16 §1)
- [16a](16a-navigator-product-model.md)