# Plan de port UX a producción: Platform Core V1 + Calendario

**Designer · 2026-10-02**
**Rama de trabajo:** `mission/platform-core-calendar-v1`, sobre la base productiva `mission/slice6-usability`.

## Resumen

Este plan lleva la dirección aprobada en PR #4 a producción. Las decisiones que más cambian respecto de la preview:

- **El shell se reescribe en Tailwind** con tokens nuevos en `globals.css`. No se porta el CSS `.fx` de la preview.
- **Finanzas solo cambia de shell.** Su contenido no se toca.
- **Las secciones de Finanzas se mueven a la sidebar.** `FinanceNav` deja de montarse.
- **El enlace compartido se muestra una sola vez.** Esto se diseñó como un flujo honesto con cuatro estados.
- **El control de visibilidad tiene tres estados** según el permiso nuevo `calendar.events.publish_assigned`.
- **Usuarios y permisos evoluciona el panel productivo actual.** No hay una segunda implementación.

Hay seis preguntas abiertas para Navigator (§8.1), sobre todo el alcance del permiso de publicar. Ninguna bloquea empezar el shell.

---

## 0. Estado de las fuentes

**Investigación web:** no se hizo. Fue una restricción explícita del encargo (presupuesto de turnos). Se aplica la excepción de patrón ya investigado: la dirección visual ya está aprobada en PR #4 tras 3 ciclos de Designer PASS, y este trabajo es un port, no un diseño nuevo.

**Qué se leyó (FACT, archivos abiertos):**
- Producción:
  - `app/globals.css` (tokens `--color-*` y CSS por bloques de Finanzas, Configuración y Campañas);
  - `components/layout/app-shell.tsx`;
  - `components/finance/shared.tsx` (`FinanceNav`, `Modal`, `Notice`, `Loading`, `Empty`, `DetailGuard`);
  - `components/settings/users-permissions-panel.tsx` y `components/settings/configuration-page.tsx`;
  - `components/finance/dashboard/summary-page.tsx` (primeras 140 líneas);
  - `lib/finance/permissions.ts`;
  - `app/(private)/layout.tsx` y `app/(private)/finanzas/layout.tsx`.
- Preview, en `rama PR #4: `:
  - `16b-designer-design-lock.md` completo (salvo el detalle de Consolidación, que no aplica);
  - `17-calendar-integrantes-preview-validation.md`.
- Capturas vistas (SCREEN VIEWED):
  - `a-calendario-mes-lider-1440.jpg`;
  - `m2-usuarios-editor-lider-1440.jpg`;
  - `j-compartir-1440.jpg`;
  - `aa-finanzas-hoy-admin-1440.jpg`.

**Lo que no pude leer:**
- **Valores exactos de los tokens `--fx-side-*`.** Viven en `components/finance-preview/finance-preview.css` de PR #3, que no está en el árbol. Los valores que doy abajo como #14231d, #1d3229 y #7fc79c salen del lock. El resto es HYPOTHESIS y Builder los copia con `git show mission/ux-finanzas-2026-preview:components/finance-preview/finance-preview.css`.
- **Los docs 14 y 16c** (arquitectura de Atlas). Las referencias a la proyección pública y al hash del token vienen del resumen del doc 17.

**Baseline:**
- Baseline de la preview: DISPONIBLE (lock y validación).
- Baseline de producción: código actual.
- Brain: no consultado.

**Estado de cierre:**

| Ítem | Estado |
|---|---|
| Cobertura de investigación | SUFFICIENT para el port: la dirección está aprobada y validada visualmente |
| Evidencia visual | STRONG (4 capturas aprobadas vistas + código productivo leído) |
| Investigación de componentes | LIMITED. No se investigaron librerías nuevas, por decisión: se reutilizan los primitivos productivos (`<dialog>` de `Modal`, `Notice`, botones `.button-*`) y los componentes de la preview |
| Señal premium | NONE |

**Revisión de motion:** al final de §7.

---

## 1. Decisión de shell para producción

### 1.1 Recomendación: shell nuevo en Tailwind con tokens nuevos, sin portar `.fx`

Hay tres opciones.

**A. Portar `finance-preview.css` con scope `.fx`.** Se descarta:
- traería un segundo sistema de diseño completo (tipografía, superficies, `--fx-canvas`, botones) dentro de la app productiva;
- habría dos `.button-primary` conceptuales y dos `Modal`;
- tendría riesgo alto de colisión con las clases productivas `.panel` y `.notice`, que tienen el mismo nombre y otra semántica.

**B. Shell en Tailwind con tokens nuevos en `@theme`. Es la que recomiendo.**
- `app-shell.tsx` ya es Tailwind puro, así que el reemplazo es local.
- El contenido productivo usa clases globales (`.finance-*`, `.kpi`, `.panel`) que no dependen del shell.

**C. Mantener el shell blanco y solo agregar módulos.** Se descarta porque no cumple la dirección aprobada.

**Tokens que se agregan a `@theme inline` en `app/globals.css`.** Se agregan sin modificar los existentes:

```
/* Shell oscuro (copiar valores exactos de --fx-side-* de PR #3) */
--color-side: #14231d;            /* FACT (lock) */
--color-side-hover: #1d3229;      /* FACT (lock) */
--color-side-active: <de PR #3>;  /* fondo de la sección activa */
--color-side-accent: #7fc79c;     /* barra 3px de la sección activa, FACT (lock) */
--color-side-text: <de PR #3>;    /* texto inactivo, ≥4.5:1 sobre --color-side */
--color-side-muted: <de PR #3>;   /* subtítulo de la marca, cargo del usuario */
--color-side-line: <de PR #3>;    /* divisores */
/* Semánticos que faltan en producción */
--color-info: <de PR #3 --fx-info>;  --color-info-soft: <--fx-info-bg>;
--color-success: var(--color-primary);  /* producción usa primary como éxito; mantener */
/* Áreas: 10 × 3 tokens, valores exactos de 16b §4.1 */
--color-area-azul / -azul-ink / -azul-soft … --color-area-carmin / -carmin-ink / -carmin-soft
```

**CSS nuevo del Calendario, de Áreas y de Compartir:**
- va en un bloque nuevo `/* Platform Core · Calendario */` de `globals.css`, o en un archivo `app/calendar.css` importado desde `globals.css`;
- usa prefijos únicos `cal-*`, `area-*` y `share-*`;
- se construye **sobre los tokens productivos** (`--color-ink`, `--color-line`, `--color-primary`, `--color-canvas`).

No se crea un `--fx-*` en producción.

### 1.2 Componentes en `components/layout/`

| Componente | Responsabilidad |
|---|---|
| `SuiteShell` | Reemplaza a `AppShell`. Se monta en `app/(private)/layout.tsx` dentro de `AccessProvider`. Contiene el skip-link, `<aside>` (sidebar o rail), la top bar móvil, `<main id="main-content">`, la bottom bar móvil y el host de avisos (toast + `AccessNotice`). `AppShell` se elimina en el mismo PR, sin convivencia |
| `ModuleNav` (`variant="full" \| "rail"`) | Lista de módulos con el módulo activo expandido (16b §3.1, rail §3.2). `<nav aria-label="CDS Suite">`. `aria-current="true"` en el módulo y `"page"` en la sección |
| `SuiteBrand` | "CS" + "Casa de Salvación" / "CDS Suite" (fijo). Sustituye a `Brand` dentro del shell. `Brand` se conserva para login y las páginas públicas de campañas |
| `AccountFooter` | Avatar con inicial, nombre visible (`displayName`; si falta, el correo), cargo · áreas y botón **"Cerrar sesión"** visible en desktop (ícono + texto, 44 px). En el rail: avatar con tooltip y menú "Cuenta". Conserva el manejo de error actual de `handleLogout` |
| `MobileTopBar` | 56 px `--color-side`: marca CS, botón de módulo (abre `ModuleSwitchSheet`) y avatar (abre `AccountSheet` con "Cerrar sesión") |
| `MobileBottomBar` | Calculada con `bottomTabs(módulo, access)`. Entre 3 y 5 ítems. `padding-bottom: env(safe-area-inset-bottom)` |
| `ModuleSwitchSheet`, `AccountSheet` | Bottom sheets basados en `<dialog>`. Se reutiliza el patrón de `Modal` productivo: `showModal`, Esc y devolución del foco |
| `AccessNotice` | Franja info "No tienes acceso a {módulo}. Te llevamos a {módulo inicial}." con `role="status"` y botón cerrar |
| `NoModulesScreen` | Pantalla completa sin shell |
| `SuiteToast` | Región `role="status"` (polite) para confirmaciones breves de acciones nuevas del Calendario. Finanzas sigue usando su `Notice` inline sin cambios |

**Ancho y breakpoints** (Tailwind v4 por defecto):

| Viewport | Navegación | Contenido |
|---|---|---|
| ≥1280 (`xl`) | Sidebar de 240 px (`w-60`) | `xl:ml-60` |
| 768–1279 (`md`) | Rail de 72 px (`w-18`) | `md:ml-18` |
| <768 | Top bar + bottom bar | `pb-[calc(64px+env(safe-area-inset-bottom))]` |

- `<main>` mantiene `mx-auto max-w-7xl` y el padding actual (`px-6 sm:px-8 lg:px-12`, `py-9 lg:py-12`) para no alterar la composición de Finanzas.
- Se eliminan:
  - la cabecera blanca "Mi espacio / Finanzas";
  - el badge "CDS Suite · V0.2";
  - el footer "Casa de Salvación", porque la marca ya está en el shell.
- La clase `.app-main-nav` de `globals.css` queda huérfana y se borra.

### 1.3 Registro de módulos (fuente única)

`lib/platform/modules.ts`, pura y testeable. Se promueve desde `lib/suite-preview/modules|routes|access`; no se reescribe (Atlas confirma). Exporta:
- `MODULES`: orden fijo **Finanzas · Calendario · Reportes · Configuración**. **Integrantes no existe en el registro**: no aparece ni deshabilitado ni como "Próximamente".
- `visibleModules(access)`.
- `moduleSections(moduleId, access)`.
- `resolveInitialModule(access)` (módulo inicial guardado → primer permitido → ninguno).
- `bottomTabs(moduleId, access)`.

| Módulo | Ícono | Secciones (ruta) · requisito | Entrada |
|---|---|---|---|
| Finanzas, detalle | `CircleDollarSign` | Resumen `/finanzas` · Movimientos `/finanzas/movimientos` · Ofrendas y Cafetería `/finanzas/ofrendas` · Diezmos `/finanzas/diezmos` · Campañas `/finanzas/campanas` · requiere `canSeeDetails` | `/finanzas` |
| Finanzas, solo resumen | `CircleDollarSign` | Hoja única "Finanzas" → `/finanzas` (sin chevron) · requiere `finance.summary.read` | `/finanzas` |
| Calendario | `CalendarDays` | Calendario `/calendario` · Mis actividades `/calendario/mis-actividades` (requiere `manage_assigned`) · Compartir `/calendario/compartir` (requiere `manage_all`) | `/calendario` |
| Reportes | `ChartColumn` | Finanzas `/reportes/finanzas` (detalle financiero) · Calendario `/reportes/calendario` (`calendar.read`) | primera permitida |
| Configuración | `Settings` | Áreas `/configuracion/areas` · Usuarios y permisos `/configuracion/usuarios` · Finanzas e integraciones `/configuracion/finanzas` · General `/configuracion/general` · requiere `settings.manage` | `/configuracion/areas` |

**Descripciones del selector móvil:**
- Finanzas: "Ingresos, gastos y caja"
- Calendario: "Actividades y agenda de la iglesia"
- Reportes: "Reportes de finanzas y calendario"
- Configuración: "Áreas, usuarios y ajustes"

### 1.4 Cómo conviven Finanzas y `FinanceNav`

**Decisión: las secciones de Finanzas pasan a la sidebar y al rail, y `FinanceNav` deja de montarse. El contenido de Finanzas no cambia.**

Por qué:
- La regla aprobada es que **el módulo activo se expande en la sidebar**. Calendario y Configuración lo hacen; si Finanzas mantuviera pestañas horizontales, el shell tendría dos modelos de navegación.
- El riesgo es acotado. `FinanceNav` es solo navegación: los datos viven en `FinanceDataCacheProvider`, que se queda en `app/(private)/finanzas/layout.tsx`.

Cambios concretos:
1. **`app/(private)/finanzas/layout.tsx`:**
   - se quita `<FinanceNav />`;
   - se conserva `<FinanceDataCacheProvider>` y el `<h1>Finanzas</h1>`, para que la jerarquía h1 módulo → h2 de cada `FinancePageHeader` quede intacta;
   - `mt-6` sobre children pasa a `mt-4` (ajuste visual menor; opcional).
2. **`FinanceNav`:**
   - el export se elimina de `shared.tsx` en este slice;
   - su lista de ítems se mueve a `moduleSections("finance", access)`, para que haya una sola fuente;
   - los tests que lo cubran se reescriben contra `moduleSections`, con las mismas aserciones de visibilidad por rol.
   - Las clases `.finance-nav*` y `--finance-nav-top` quedan huérfanas y se eliminan.
3. **"Reportes" sale de Finanzas y pasa al módulo Reportes:**
   - `/reportes/finanzas` renderiza **el mismo componente** productivo de `/finanzas/reportes`, envuelto en `FinanceDataCacheProvider` (**riesgo**: sin el provider se rompe);
   - `/finanzas/reportes` queda como redirect de cliente a `/reportes/finanzas`. Con export estático se necesita una página de redirect y no `next.config` (Atlas confirma).
4. **Bottom bar de Finanzas con detalle:** [Resumen] [Movimientos] [Ofrendas] [Diezmos] [Más].
   - "Ofrendas" es el label corto de "Ofrendas y Cafetería"; el h1/h2 de la página mantiene el nombre completo.
   - "Más" contiene: Campañas · Reportes financieros ↗ · Otros módulos · Cuenta.
   - **Sin ranura "+"**: producción no tiene un "Registrar" global y las acciones siguen en el contenido. No se inventa un flujo nuevo.
5. **Finanzas solo resumen (Líder):** sidebar con la hoja "Finanzas" y bottom bar [Finanzas] [Calendario↗] [Más].
6. **Atención:** producción no tiene Atención financiera y no se agrega.

### 1.5 "Sin módulos", aviso de deep link y guardas

- **Sin módulos** (cuenta activa sin ningún permiso de módulo): pantalla sin sidebar ni bottom bar.
  - Marca CS de 40 px.
  - h1 "Aún no tienes módulos asignados".
  - Cuerpo: "Tu cuenta está activa, pero todavía no tiene permisos. Pide al administrador que te asigne un módulo."
  - Botón secundario "Cerrar sesión". Sin redirecciones y sin loop.
- **Deep link a un módulo o sección no permitida:** redirige a `resolveInitialModule` y muestra el `AccessNotice`:
  - "No tienes acceso a Configuración. Te llevamos a Calendario."
  - Para secciones: "No tienes acceso a Compartir calendario. Te llevamos a Calendario."
  - Desaparece al navegar.
- **`DetailGuard`** de Finanzas se mantiene como segunda barrera.
- **Cuenta inactiva:** se mantiene el flujo actual de `AuthGuard`/`isAuthorized`; no es la pantalla "sin módulos".

---

## 2. Pantallas de Calendario en producción

### 2.1 Qué se porta de la preview y qué se adapta

| Preview (`components/suite-preview/**`) | Producción |
|---|---|
| `CalendarToolbar`, `MonthGrid`, `MonthGridCompact`, `WeekGrid`, `AgendaList`, `DayPopover`, `EventChip`, `AreaChip`/`AreaPill`/`AreaSwatch`, `AreaFilter` | Se portan tal cual en estructura y medidas (16b §4–§5), reescribiendo las clases `fx-*` a `cal-*`/`area-*` con tokens productivos. Datos reales vía hook (Atlas) |
| `EventDetailSheet` | Se porta. Se cambia el badge de visibilidad y el footer según el permiso de publicar (§2.3). "Historial" muestra el nombre real del autor (es interno) |
| `EventFormSheet` + `RecurrenceField` | Se porta. **Se quitan** las opciones con pill "Propuesta" (el `<details>` "Más opciones de repetición" y los radios deshabilitados de "Editar actividad repetida"): en producción no se muestran promesas. Si solo existe "Toda la serie", el dialog previo se reemplaza por una línea en el form: "Los cambios se aplican a toda la serie." |
| `CancelEventDialog`, `ArchiveEventDialog` | Se portan igual, con motivo obligatorio |
| `ShareLinkPanel` | Se rediseña (§2.4) |
| `PublicCalendarPage` | Se porta sin la línea "Vista previa · datos de demostración" (§2.5) |
| `?estado=` forzable, fixtures, `DEMO_NOW`, toasts "Simulación…" | **Se eliminan.** El reloj real es "hoy en America/Santiago" (sin mostrar ese identificador en la UI) |
| Integrantes, Consolidación y el filtro "Llegó a" | Fuera de alcance |

La vista por defecto es **Mes** en desktop y **Agenda** en móvil (Agenda también en la página pública). La semana empieza el lunes. Mes muestra máx. 3 chips a ≥1280, 2 entre 1024 y 1279 y 2 sin hora entre 768 y 1023. Semana no existe por debajo de 768.

### 2.2 Estados con datos reales

| Estado | Calendario (Mes/Semana/Agenda) | Mis actividades | Reporte |
|---|---|---|---|
| Cargando | Skeleton: Mes con 6 semanas de celdas y 1–2 barras de 22 px; Agenda con 3 headers de día + 6 filas de 64 px. `role="status"` "Cargando actividades…" | 5 filas skeleton | Franja + 8 filas |
| Vacío | La grilla se renderiza + `Empty` sobre la grilla: "No hay actividades en octubre" · "Prueba con otras áreas o crea una actividad." [Crear actividad] solo si puede crear. Agenda con filtro: "Ninguna actividad de las áreas elegidas." [Mostrar todas las áreas] | Responsable vacío: "Tus áreas no tienen actividades próximas" [Crear actividad]. Sin áreas: "Aún no tienes áreas asignadas" · "Pide al administrador que te asigne un área para crear y administrar actividades." (sin CTA) | "No hay actividades con estos filtros." [Limpiar filtros] |
| Error de red | "No pudimos cargar el calendario" · "Revisa tu conexión e inténtalo de nuevo." [Reintentar] | igual | igual |
| Permiso denegado (reglas) | "Ya no tienes acceso a esta información" · "Puede que tus permisos hayan cambiado. Recarga la página o pide ayuda al administrador." [Recargar] | igual | igual |
| Sin conexión (detectado) | Franja warning sobre la toolbar: "Sin conexión. Puedes ver lo último que se cargó; para crear o editar necesitas conexión." Las acciones de escritura quedan `aria-disabled` y su explicación dice lo mismo | igual | El botón "Descargar PDF" sigue disponible si hay datos |
| Error al guardar | El form **no se cierra** y conserva lo escrito. `Notice` error arriba del footer: "No pudimos guardar la actividad. Revisa tu conexión e inténtalo de nuevo." Si el error es de permiso: "No tienes permiso para guardar esta actividad. Si cambiaron tus áreas o permisos, recarga la página." | — | — |

**Confirmaciones** (`SuiteToast`):
- "Actividad creada."
- "Cambios guardados."
- "Actividad cancelada."
- "Actividad eliminada."
- "Actividad publicada."
- "La actividad ya no es pública."

Nunca aparecen códigos (`permission-denied`, `unavailable`) ni "Firestore". Se mapean en una función `calendarErrorMessage(error)`, análoga a `errorMessage` de Finanzas.

### 2.3 Control de publicación (`calendar.events.publish_assigned`)

**Regla de UX.** "Pública" se puede elegir solo si el usuario tiene `manage_all`, o si tiene publicar y el área responsable es una de sus áreas. El resto de la gestión no cambia: el líder sigue pudiendo crear y editar actividades "Solo equipo" de sus áreas.

**En el form (campo Visibilidad, 2 radios-tarjeta de 56 px, "Solo equipo CDS" seleccionado por defecto):**

| Estado | Render |
|---|---|
| **Puede publicar** | Ambas tarjetas habilitadas. Ayuda bajo el grupo: "Si eliges Pública, aparecerá en el calendario compartido. Las notas internas nunca se publican." |
| **No puede publicar** | La tarjeta "Pública" se renderiza con `aria-disabled="true"` (el foco llega, la selección no), en tono atenuado y con `Lock` de 14 px. La ayuda **siempre visible** (no tooltip), enlazada con `aria-describedby`: "Para publicar actividades de Jóvenes necesitas el permiso «Publicar actividades de sus áreas». Puedes guardarla como Solo equipo y pedir a Pastor o Administración que la publique." |
| **Cambia el área responsable a una sin permiso** (si el permiso es por área; ver pregunta 1 en §8.1) | Si estaba "Pública", pasa a "Solo equipo" y aparece un `Notice` inline: "Cambiamos la visibilidad a Solo equipo: no puedes publicar actividades de Varones." |
| **Edita una actividad ya pública sin permiso** | "Pública" queda seleccionada y bloqueada en ambas direcciones, con la ayuda: "Esta actividad ya es pública. Puedes editar sus datos, pero solo Pastor o Administración pueden cambiar su visibilidad." Si se debe impedir también la edición de campos públicos, es la pregunta 2 de §8.1 |

**En el detalle (`EventDetailSheet`):**
- **Badge:**
  - "Pública" (`Globe`, tono info) con la línea "Aparece en el calendario compartido.";
  - "Solo equipo" (`Lock`, neutral) con la línea "Solo la ven usuarios de CDS.".
- **Quien puede publicar y la actividad es "Solo equipo":** botón secundario **"Publicar"** en el footer, junto a Editar y Cancelar actividad. Abre un dialog:
  - "¿Publicar «Reunión de jóvenes»?"
  - "Aparecerá en el calendario compartido con su título, fecha, hora, lugar, descripción pública y áreas. Las notas internas y los motivos nunca se publican." Si es recurrente: "Se publicará toda la serie."
  - [Volver] [Publicar].
  - Si no hay enlace activo, se agrega la nota info: "Hoy no hay un enlace compartido activo. Se verá cuando Administración active uno."
- **Quien puede publicar y la actividad es pública:** "Dejar de publicar". Dialog:
  - "¿Dejar de publicar «…»?"
  - "Dejará de verse en el calendario compartido. Seguirá visible para el equipo."
  - [Volver] [Dejar de publicar].
- **Líder que gestiona la actividad pero no puede publicar:** no ve el botón "Publicar". Bajo el badge "Solo equipo", en 12 muted con `Info`: "Para publicarla, pide a Pastor o Administración." No se usa un botón deshabilitado extra, para que el footer no tenga tres acciones grises.
- **Actividad de un área ajena:** igual que en la preview. Editar, Cancelar actividad y Eliminar con `aria-disabled` + "Solo el área responsable (Alabanza), Pastor o Administración pueden modificar esta actividad." Las variantes "Tu área participa…" y "Las actividades pasadas solo las corrige Pastor o Administración." se mantienen.

### 2.4 Compartir calendario: el enlace se muestra una sola vez

**Principio:** nunca mostrar un enlace enmascarado ni un "Copiar" que no puede funcionar. El enlace en claro existe solo en memoria, en la respuesta de generar o regenerar.

| Estado | Contenido del panel "Enlace" |
|---|---|
| **A. Nunca creado** | `Empty` con ícono `Share2`: "Aún no hay un enlace para compartir" · "Crea un enlace de solo lectura con las actividades públicas." Primary [Crear enlace] |
| **B. Recién creado o regenerado** (solo en esta visita a la página) | Franja `success` arriba: **"Enlace listo. Cópialo ahora: por seguridad no lo volveremos a mostrar."** Campo `readonly` monospace 13 con el enlace completo; al recibir foco se selecciona todo. Primary **[Copiar enlace]** → toast "Enlace copiado." y el botón pasa a "Copiado" con `Check` durante 2 s. Link "Abrir vista pública ↗" en pestaña nueva con `rel="noreferrer"`. Línea 12 muted: "Si cierras o recargas esta página, tendrás que generar un enlace nuevo para volver a copiarlo." Botón terciario [Listo] → estado C. Si se pulsa "Listo" sin haber copiado, se confirma: "¿Terminar sin copiar el enlace? El enlace queda activo, pero no podrás verlo de nuevo. Para compartirlo tendrás que generar uno nuevo." [Volver] [Terminar] |
| **C. Activo** (visitas posteriores) | Badge "Activo" (tono success, `CircleCheck`). Texto: **"Enlace activo · creado el 01-10-2026 por {nombre}"**. Explicación 13 muted: "Por seguridad, el enlace solo se muestra al crearlo. Si necesitas compartirlo otra vez, genera uno nuevo: el anterior dejará de funcionar." Acciones: Secondary [Generar enlace nuevo] · ghost danger [Desactivar enlace]. **Sin campo, sin "Copiar" y sin "Abrir vista pública"**, porque no existe el valor |
| **D. Desactivado** | Badge "Desactivado" (neutral, `Ban`) + "Desactivado el {fecha} por {nombre}". Primary [Activar con un enlace nuevo], que lleva a B |

**Dialogs:**
- **Generar enlace nuevo:**
  - "¿Generar un enlace nuevo?"
  - "El enlace actual dejará de funcionar de inmediato. Quienes lo tengan verán «Este calendario no está disponible». El enlace nuevo se mostrará una sola vez para que lo copies."
  - [Volver] [Generar enlace nuevo].
- **Desactivar:**
  - "¿Desactivar el enlace?"
  - "Nadie podrá ver el calendario compartido hasta que actives un enlace nuevo."
  - [Volver] Destructive [Desactivar].

**Errores:**
- Fallo al generar: "No pudimos generar el enlace. Revisa tu conexión e inténtalo de nuevo." Si es una regeneración, agregar "El enlace anterior sigue funcionando.", **solo si Atlas garantiza que la operación es atómica**.
- Fallo del portapapeles: "No pudimos copiar automáticamente. El enlace quedó seleccionado: cópialo con Ctrl+C o mantén presionado para copiar." El campo se autoselecciona.
- Carga: skeleton del panel. Error: "No pudimos cargar el estado del enlace." [Reintentar].

**Se conservan** las dos tarjetas "Qué se publica" y "Qué nunca se publica" (16b §5.10, ver la captura `j-compartir`), con un ítem agregado en "Qué se publica": "Solo actividades marcadas como Pública". **Nunca** aparece la palabra "token".

### 2.5 Calendario público

Ruta pública **sin shell**, igual que hoy `app/campanas`. Se porta `PublicCalendarPage`:
- header blanco de 64 px "Casa de Salvación / Calendario de actividades";
- Agenda por defecto en todos los anchos y Mes disponible;
- filtro por áreas activas con actividades públicas;
- detalle público ("Organiza: Jóvenes"; cancelada → "Esta actividad no se realizará.", sin motivo);
- pie "Horarios en hora de Chile continental.".

**Se quita** la línea de demostración.

**Estados:**
- cargando: 6 filas skeleton;
- vacío: "No hay actividades publicadas en octubre." + "Ver noviembre →";
- error de red: "No pudimos cargar el calendario. Revisa tu conexión e inténtalo de nuevo." [Reintentar];
- enlace inválido, regenerado o desactivado: **la misma** pantalla "Este calendario no está disponible" · "Es posible que el enlace haya cambiado. Pide el enlace actualizado a la iglesia." Sin login y sin revelar si existió.

Targets de 44 px, sin scroll horizontal a 375.

---

## 3. Configuración › Áreas y › Usuarios y permisos

### 3.1 Estructura del módulo

`configuration-page.tsx` deja de usar las pestañas `.settings-nav`. Cada sección pasa a ser una ruta de la sidebar:

| Ruta | Contenido |
|---|---|
| `/configuracion/areas` | Nuevo |
| `/configuracion/usuarios` | El `UsersPermissionsPanel` evolucionado |
| `/configuracion/finanzas` | El `FinanceSettingsPanel` actual, sin cambios |
| `/configuracion/general` | El `GeneralSettings` actual |

`/configuracion` redirige a Áreas. `SettingsGuard` envuelve todas las rutas. Se elimina el header "ADMINISTRACIÓN / Configuración / Categorías financieras y permisos básicos": cada página tiene su propio h1.

### 3.2 Áreas

Se porta 16b §10.1.

**Lista desktop:** tabla con Área (swatch + nombre) · Descripción · Actividades próximas · Estado (switch + texto) · Editar.
**Móvil:** filas de 64 px con swatch + nombre + "12 actividades · Activa" + chevron.

**Editor:** se usa el `Modal` productivo (centrado de 600 px en desktop, bottom sheet en móvil). Así no se crea un sheet lateral nuevo solo para esto.
- Nombre (máx. 40). Error: "Ya existe un área con ese nombre."
- Descripción (máx. 200).
- Color: radiogroup **solo con los colores libres**, cada uno con su nombre. "Los demás colores están en uso por otras áreas activas." Sin colores libres: "Todos los colores están en uso. Desactiva un área para liberar el suyo." y Guardar deshabilitado con esa explicación.
- Vista previa: "Así se verá: [▌ Nueva área 19:00 Reunión]".

**Desactivar:**
- "¿Desactivar Matrimonios?"
- "No se podrá elegir en actividades nuevas. Sus 3 actividades conservan su nombre y color. Los líderes de esta área ya no podrán editarlas."
- [Volver] [Desactivar].

**Estados:**
- vacío: "Aún no hay áreas" · "Crea la primera para organizar el calendario." [Nueva área];
- error: "No pudimos cargar las áreas." [Reintentar].

### 3.3 Usuarios y permisos: evolución del panel existente

Se mantienen las funciones productivas: `createManagedUser`, `resendPasswordSetup`, `updateManagedUser`, `useManagedUsers`, el aviso "Acceso seguro" y las protecciones de la cuenta propia. **No hay un segundo panel**: se modifica `users-permissions-panel.tsx`.

**Lista.** Se reemplaza la grilla de tarjetas editables inline por una lista compacta de solo lectura:
- **desktop:** filas con Usuario (nombre + correo) · Cargo · Áreas (chips con swatch) · Módulo inicial · Estado ("Activo" / "Sin acceso") · Avisos (`TriangleAlert` + texto corto visible, no solo el ícono) · [Editar];
- **móvil:** filas de 2–3 líneas;
- encabezado: "8 usuarios · 2 con avisos".
- Se conserva la nota "Cuentas de acceso".

**Editor.** El `Modal` productivo, ampliado a 720 px en desktop (variante `wide`) y a pantalla completa en móvil con footer sticky. Header: nombre, correo y badge de estado. Bloques en este orden:

1. **Resumen** (franja `--color-primary-soft`):
   - "Verá: Finanzas (solo resumen) · Calendario (gestiona sus áreas) · Reportes (Calendario)"
   - "Entrará a: Calendario"
   - **No** se incluye "Ver como este perfil".
2. **Acceso:**
   - switch **"Cuenta activa"** · "Puede ingresar a CDS Suite." (reemplaza el select "Estado");
   - switch **"Administrador (rol base)"** · "Tiene todos los permisos, incluida la configuración." Al apagarlo: "Accede solo con los permisos marcados abajo."
3. **Cargo, áreas y módulo inicial:**
   - **Cargo:** select. Ayuda: "Al cambiar el cargo se proponen sus permisos; nada cambia sin tu confirmación." Al cambiarlo aparece el dialog "¿Aplicar los permisos sugeridos para Pastor? Se reemplazarán los permisos marcados y el módulo inicial." [Mantener los actuales] [Aplicar sugeridos].
   - **Áreas asignadas:** chips seleccionables con swatch + nombre + `Check`. Ayuda: "Con «Gestionar actividades de sus áreas» podrá crear y editar actividades de estas áreas."
   - **Módulo inicial:** select limitado a **Finanzas · Calendario** permitidos. Debajo: "→ Al ingresar abrirá: Calendario" · "Solo se ofrecen los módulos que puede ver."
4. **Permisos.** Grupos con headers de 11/600. Checkboxes de 20 px en filas de 44 px, label 14/500 + descripción 12 muted. El copy está en §3.4.
   - Un permiso implicado queda **marcado y deshabilitado**, con el sufijo "Incluido en «{permiso}»".
   - Con Administrador activo, todo queda marcado y deshabilitado con la nota "Administración tiene todos los permisos, incluida la configuración."
5. **Footer:**
   - izquierda: [Reenviar acceso] (secondary, `Mail`; solo si no es uno mismo) · [Quitar acceso] (`.button-danger`; solo si está activo y no es uno mismo);
   - derecha: [Cancelar] [Guardar cambios]. Guardar queda deshabilitado mientras no haya cambios.
   - "Quitar acceso" pasa de `window.confirm` a un dialog: "¿Quitar el acceso de {nombre}? Ya no podrá entrar a CDS Suite, pero se conservará su historial. Puedes devolverle el acceso después." [Volver] [Quitar acceso].

**Crear usuario.** Se extiende `CreateUserForm`:
- Nombre · Correo · Cargo (precarga los permisos sugeridos) · Áreas (solo si el cargo propone gestionar actividades);
- se mantiene el bloque "Acceso seguro";
- éxito: el mensaje actual + link "Revisar permisos", que abre el editor;
- el mensaje de fallo de envío del correo se mantiene.

**Avisos** (tono warning con `TriangleAlert`, en el editor y resumidos en la lista):
- Líder sin áreas: **"Gestiona actividades de sus áreas, pero no tiene áreas asignadas. No podrá crear actividades hasta que le asignes una."**
- Publicar sin áreas: "Puede publicar actividades de sus áreas, pero no tiene áreas asignadas."
- Módulo inicial no permitido: **"El módulo inicial (Finanzas) ya no está permitido; al ingresar se abrirá Calendario."** Es solo una advertencia: el guardado ajusta el módulo inicial al que se resolvió, con confirmación.
- Sin módulos: "No tiene permisos de ningún módulo. Al ingresar verá «Aún no tienes módulos asignados»."
- Único administrador: "Es el único administrador activo; no se puede desactivar ni quitarle el rol de administrador." Esos switches quedan deshabilitados con esa explicación.
- Uno mismo: se conserva "Por seguridad no puedes quitarte el rol administrador ni desactivar tu propia cuenta."

### 3.4 Copy de permisos (lenguaje simple)

Los grupos que no tienen módulo en este slice, como Integrantes, no aparecen.

| Grupo | Label | Descripción |
|---|---|---|
| FINANZAS | Ver resumen financiero | Cifras generales del período, sin movimientos ni nombres. |
| FINANZAS | Ver detalle financiero | Movimientos, ofrendas, diezmos, campañas y reportes. |
| FINANZAS | Registrar y editar movimientos | Crear, corregir y anular registros financieros. |
| FINANZAS | Seguimiento pastoral en diezmos | Ver y escribir notas pastorales de diezmantes. |
| CALENDARIO | Ver calendario | Ver todas las actividades, incluidas las de Solo equipo. |
| CALENDARIO | Gestionar actividades de sus áreas | Crear, editar, cancelar y eliminar actividades de las áreas asignadas. |
| CALENDARIO | **Publicar actividades de sus áreas** | Marcar como Pública una actividad de sus áreas para que aparezca en el calendario compartido. |
| CALENDARIO | Gestionar todas las actividades y el enlace público | Cualquier área, publicar y administrar el enlace compartido. |
| SISTEMA | 🔒 Administrar configuración | Solo usuarios con rol Administrador. (nunca editable) |

Los permisos de Reportes no tienen checkbox propio: se derivan de "Ver detalle financiero" y "Ver calendario". La regla se explica una vez, en 12 muted, bajo el grupo CALENDARIO: "Los reportes se muestran según lo que la persona puede ver." Las implicaciones exactas (por ejemplo, si publicar incluye gestionar) las define Atlas/Navigator; la UI las lee de `effectivePermissions`.

---

## 4. Módulo Reportes

- `/reportes` lleva a la primera sección permitida. h1 "Reportes".
- Bajo el h1 va un segmented con links [Finanzas] [Calendario] (`aria-current="page"`) **solo si ambos están permitidos**. Con uno solo, no hay segmented y el h1 dice "Reportes · Calendario".
- **Finanzas:** la pantalla productiva actual de reportes, sin cambios de contenido, dentro de `FinanceDataCacheProvider`.
- **Calendario:** se porta 16b §7.1:
  - filtros de Período (mes + rango personalizado), Áreas (+ "Solo como responsable"), Estado y Visibilidad; en móvil, "Filtros (n)" en un sheet;
  - franja de resumen "42 actividades · 30 realizadas · 9 programadas · 3 canceladas" + "Por área:" con swatch y nombre;
  - tabla con responsive por contenedor;
  - Secondary "Descargar PDF". Sin resultados queda `aria-disabled` con la explicación "No hay actividades con estos filtros para descargar."
- El reporte respeta lo que el usuario puede ver: un líder con `calendar.read` ve también las actividades Solo equipo, porque es interno.

**Requisitos del PDF de producción** (A4 horizontal, márgenes de 15 mm, Helvetica):
1. **Sin franja "Vista previa / Datos de demostración"**, ni ningún rótulo de demo.
2. Encabezado: "Casa de Salvación" · "Reporte de actividades · {período legible}" (por ejemplo "Octubre 2026", o "1 al 15 de octubre de 2026").
3. **Línea "Filtros aplicados:"**, siempre presente y explícita, incluso sin filtros: "Áreas: Jóvenes, Alabanza (solo como responsable) · Estados: Programada, Realizada · Visibilidad: Todas". Sin filtros: "Áreas: todas · Estados: todos · Visibilidad: todas".
4. "Generado por {nombre} el 02-10-2026 a las 14:05 (hora de Chile)".
5. Resumen y "Por área" con los mismos números que la pantalla.
6. Tabla: Fecha · Hora · Actividad · Responsable (cuadrado de 2,5 mm del color + nombre) · Participantes · Lugar · Estado (texto) · Visibilidad (texto) · Descripción pública.
7. Pie de cada página: "Página n de m". En la última página: "No incluye notas internas, motivos de cancelación ni actividades eliminadas."
8. Nunca incluye notas internas, motivos ni correos.
9. Nombre de archivo: `actividades-2026-10.pdf` (o `actividades-2026-10-01_2026-10-15.pdf` para un rango).

---

## 5. Copy deck de producción (es-CL)

**Shell:**
- "CDS Suite" · "Cambiar de módulo" · "Otros módulos" · "Más" · "Cuenta" · "Cerrar sesión" · "Cerrando…" · "Saltar al contenido"
- "No tienes acceso a {módulo}. Te llevamos a {módulo inicial}." · "Cerrar aviso"
- "Aún no tienes módulos asignados" · "Tu cuenta está activa, pero todavía no tiene permisos. Pide al administrador que te asigne un módulo."

**Errores genéricos:**
- Red: "No pudimos cargar {la información}. Revisa tu conexión e inténtalo de nuevo." [Reintentar]
- Sin conexión: "Sin conexión. Puedes ver lo último que se cargó; para crear o editar necesitas conexión."
- Permiso al leer: "Ya no tienes acceso a esta información. Puede que tus permisos hayan cambiado. Recarga la página o pide ayuda al administrador."
- Permiso al guardar: "No tienes permiso para guardar estos cambios. Si cambiaron tus áreas o permisos, recarga la página."
- Inesperado: "Algo salió mal. Inténtalo de nuevo en unos minutos."

**Calendario:**
- Acciones y estados: "Crear actividad" · "Nueva actividad" · "Editar actividad" · "Guardar actividad" · "Guardando…" · "Cancelar actividad" · "Eliminar" · "Publicar" · "Dejar de publicar" · "Volver"
- Visibilidad: "Solo equipo CDS · La ven usuarios con acceso al calendario." · "Pública · También aparece en el calendario compartido."
- Sin permiso de publicar: "Para publicar actividades de {área} necesitas el permiso «Publicar actividades de sus áreas». Puedes guardarla como Solo equipo y pedir a Pastor o Administración que la publique."
- En el detalle: "Para publicarla, pide a Pastor o Administración."
- Actividad ya pública: "Esta actividad ya es pública. Puedes editar sus datos, pero solo Pastor o Administración pueden cambiar su visibilidad."
- Cambio de área: "Cambiamos la visibilidad a Solo equipo: no puedes publicar actividades de {área}."
- Recurrente: "Los cambios se aplican a toda la serie."
- Notas internas: "Nunca se publican. No escribas datos personales de integrantes." (lo pide el riesgo 5 del doc 17)
- Toasts: "Actividad creada." · "Cambios guardados." · "Actividad cancelada." · "Actividad eliminada." · "Actividad publicada." · "La actividad ya no es pública."
- Validaciones: las de 16b §5.8 sin cambios.

**Compartir:**
- "Compartir calendario" · "Un enlace de solo lectura con las actividades públicas."
- "Aún no hay un enlace para compartir" · "Crear enlace"
- "Enlace listo. Cópialo ahora: por seguridad no lo volveremos a mostrar." · "Copiar enlace" · "Enlace copiado." · "Copiado" · "Listo"
- "Si cierras o recargas esta página, tendrás que generar un enlace nuevo para volver a copiarlo."
- "Enlace activo · creado el {fecha} por {nombre}"
- "Por seguridad, el enlace solo se muestra al crearlo. Si necesitas compartirlo otra vez, genera uno nuevo: el anterior dejará de funcionar."
- "Generar enlace nuevo" · "Desactivar enlace" · "Activar con un enlace nuevo" · "Desactivado el {fecha} por {nombre}"
- Error: "No pudimos copiar automáticamente. El enlace quedó seleccionado: cópialo con Ctrl+C o mantén presionado para copiar."

**Público:**
- "Calendario de actividades" · "Organiza: {área}" · "Esta actividad no se realizará." · "Horarios en hora de Chile continental."
- Enlace inválido o desactivado: "Este calendario no está disponible" · "Es posible que el enlace haya cambiado. Pide el enlace actualizado a la iglesia."

**Dialogs de confirmación:**
- "¿Publicar «{título}»?" / "¿Dejar de publicar «{título}»?" (texto en §2.3)
- "Cancelar «{título}»" con motivo obligatorio (3–300) · "Seguirá visible como «Cancelada». En el calendario público se verá «Cancelada», sin el motivo."
- "Eliminar «{título}»" · "Se quitará de todas las vistas, de los reportes y del calendario público. No se borra: queda guardada en el historial con el motivo."
- "¿Generar un enlace nuevo?" / "¿Desactivar el enlace?" (§2.4)
- "¿Desactivar {área}?" (§3.2) · "¿Aplicar los permisos sugeridos para {cargo}?" · "¿Quitar el acceso de {nombre}?" (§3.3)

**Prohibido en la UI:** token · UID · ID · Firestore · backend · `calendar.*` · `finance.*` · slug · America/Santiago · "Simulación" · "Vista previa" · "Demo".

---

## 6. Capturas para la revisión UX (emuladores) y criterios de aceptación

### 6.1 Capturas

Se toman con datos sembrados en los emuladores; nunca con fixtures dentro del bundle. Desktop a 1440×900 y móvil a 390×844, salvo que se indique otra cosa.

| # | Captura | Perfil | Notas |
|---|---|---|---|
| 1 | Admin Calendario desktop | Admin | Mes, con chips de varias áreas, una cancelada y una Solo equipo |
| 2 | Líder Calendario desktop | Líder (Jóvenes, sin publicar) | Mes. Sidebar: Finanzas (hoja), Calendario expandido, Reportes |
| 3 | Líder Calendario móvil | Líder | Agenda por defecto, bottom bar [Calendario][Mis actividades][+ Crear][atajo][Más] |
| 4 | Crear actividad | Líder sin publicar | Desktop y 390. "Pública" `aria-disabled` + ayuda + recurrencia con resumen |
| 4b | Crear actividad | Líder con publicar | Ambas tarjetas habilitadas |
| 5 | Actividad de área ajena sin edición | Líder | Detalle con 3 acciones `aria-disabled` + explicación |
| 6 | Publicar actividad | Líder con publicar o Admin | Dialog "¿Publicar…?" + toast después |
| 6b | Detalle propio Solo equipo | Líder sin publicar | Badge + "Para publicarla, pide…" |
| 7 | Mis actividades | Líder | Responsable / Participa |
| 8 | Configuración › Áreas | Admin | Lista + editor de color con solo los colores libres |
| 9 | Configuración › Usuario | Admin | Editor de un Líder con el aviso "sin áreas" y otro con módulo inicial no permitido; implicados marcados y deshabilitados; "Administrar configuración" bloqueado |
| 10 | Reporte de calendario | Admin + Líder (390) | Filtros, resumen, tabla y una página del PDF con "Filtros aplicados" y sin rótulo demo |
| 11 | Calendario público desktop | — | Agenda, sin shell |
| 12 | Calendario público móvil | — | 375. Más el estado "no disponible" tras regenerar |
| 13 | Resumen de Finanzas del Líder | Líder (solo `finance.summary.read`) | Sin movimientos, sin nombres de diezmantes, sin acciones de registro |
| 14 | Finanzas Admin | Admin | Resumen a 1440, 1024 (rail) y 390 (bottom bar), comparado con las capturas actuales de producción |
| 15 | Compartir: estados B, C y D | Admin | Recién creado con "Cópialo ahora", Activo sin campo y Desactivado |
| 16 | Shell en el rail a 1024×768 | Admin en Configuración | Footer sin cortar |
| 17 | Aviso de deep link y "Sin módulos" | Líder → `/configuracion`; usuario sin permisos | — |
| 18 | Estados de error | Cualquiera | Error de red del calendario y error de guardado con el form abierto |

### 6.2 Criterios de aceptación (para mi revisión)

1. La sidebar (≥1280), el rail (768–1279) y la bottom bar (<768) muestran solo los módulos permitidos, en el orden Finanzas · Calendario · Reportes · Configuración. Integrantes no aparece en ningún lugar.
2. Solo el módulo activo muestra sus secciones. Un módulo de una sola sección es hoja sin chevron. La marca dice "Casa de Salvación / CDS Suite".
3. Ya no existen la cabecera "Mi espacio /", el badge "V0.2", `FinanceNav` ni las pestañas `.settings-nav`.
4. El contenido de Finanzas (KPIs, toolbars, tablas, modales) se ve idéntico a producción, salvo el ancho disponible. Sin overflow a 1440, 1280, 1024, 768, 390 y 375. Los modales de Finanzas en móvil quedan por encima de la bottom bar.
5. `/finanzas/reportes` lleva a Reportes › Finanzas con el mismo contenido y los datos cargados.
6. La bottom bar coincide con `bottomTabs` (tabla de 16b §3.3, más la fila Finanzas de §1.4), con entre 3 y 5 ítems y labels sin truncar a 390.
7. El deep link no permitido muestra el aviso y redirige. La cuenta sin permisos ve "Aún no tienes módulos asignados", sin loop.
8. Áreas: los 10 colores de 16b §4.1. Todo color va con su nombre. El texto en color usa `-ink`. No hay gradientes.
9. Mes: máx. 3 chips por celda a ≥1280 y 2 a 1024, con "+n más". La semana empieza el lunes y hoy va marcado.
10. Agenda: es la vista por defecto en móvil y en la página pública, sin días vacíos, con header sticky y el ancla "Hoy".
11. Form: el Líder ve solo sus áreas activas. El color no se puede elegir. La recurrencia muestra etiquetas calculadas + "Hasta" + resumen. **No hay pills "Propuesta" ni opciones deshabilitadas futuras.**
12. Visibilidad: sin permiso de publicar, "Pública" queda `aria-disabled` con la ayuda visible enlazada por `aria-describedby`. Con permiso, se puede elegir. El guardado nunca falla en silencio por la visibilidad.
13. El detalle muestra el badge Pública/Solo equipo. "Publicar" y "Dejar de publicar" aparecen solo con permiso y siempre con confirmación. Sin permiso se ve la línea "Para publicarla, pide a Pastor o Administración."
14. Actividad de un área ajena: las acciones quedan `aria-disabled` con la explicación del área responsable.
15. Cancelar exige motivo, con "Solo esta fecha" / "Toda la serie desde hoy" si es recurrente. Eliminar explica que se archiva.
16. Compartir: el enlace solo es visible en el estado B. En C no hay campo, ni "Copiar", ni un valor enmascarado. Generar enlace nuevo advierte que el anterior deja de funcionar y que el nuevo se ve una vez. No aparece "token".
17. Página pública: sin shell ni rótulo demo, usable a 375 (targets de 44, sin scroll horizontal). Nunca muestra motivos ni notas. El enlace inválido y el desactivado muestran la misma pantalla.
18. Reportes: segmented solo con ambos permisos. El Líder ve solo Calendario.
19. PDF: sin franja demo, con "Filtros aplicados" siempre presente, "Generado por … (hora de Chile)", "Página n de m" y sin notas ni motivos.
20. El Líder con solo `finance.summary.read` ve el resumen permitido: sin movimientos, sin nombres de diezmantes, sin registrar y sin Reportes › Finanzas.
21. Usuarios: es el mismo panel productivo evolucionado. Crear, Reenviar acceso y Quitar acceso siguen funcionando. Están Rol base, Cargo, Permisos agrupados (implicados marcados y deshabilitados), "Administrar configuración" bloqueado, Áreas, Módulo inicial limitado y Cuenta activa.
22. Los avisos "sin áreas", "módulo inicial no permitido", "sin módulos" y "único administrador" se ven con ícono + texto.
23. "Quitar acceso" usa un dialog, no `window.confirm`.
24. No aparece "Ver como", banner demo, "Simulación", fixtures ni `?estado=` en producción (verificable con grep en el build).
25. Los errores de red, permiso y sin conexión usan el copy de §5. El form no pierde datos al fallar el guardado.
26. Escala de grises: estados, visibilidad y áreas se entienden por ícono y texto.
27. Teclado: foco visible en la sidebar, el rail (con tooltips), los chips, los dialogs y los sheets. Esc cierra y el foco vuelve. Con `prefers-reduced-motion` no hay transiciones.
28. Targets ≥44 px en móvil en todas las pantallas nuevas.

---

## 7. Qué NO hacer en producción

- Portar `finance-preview.css` o crear tokens `--fx-*`. Tampoco crear una segunda familia de botones, `Modal` o `Notice`.
- Tocar el contenido de las pantallas de Finanzas (estilos `.finance-*`, `.kpi`, toolbars o modales) dentro de este slice.
- Dejar `FinanceNav` y las secciones en la sidebar a la vez: sería doble navegación.
- Mostrar Integrantes, módulos con candado o "Próximamente".
- Mostrar opciones futuras con pill "Propuesta" o radios deshabilitados de recurrencia.
- Mostrar el enlace enmascarado (`••••k3Qz`), un "Copiar" que no puede copiar, o guardar el enlace en `localStorage` para "recordarlo".
- Usar la palabra "token" o cualquier nombre técnico de permiso en la UI.
- Ocultar "Pública" sin explicación, o mostrar un error de guardado para explicar un permiso que la UI pudo anticipar.
- Usar `window.confirm` en acciones nuevas.
- Mostrar un "+ Registrar" global en Finanzas, porque no existe ese flujo.
- Incluir "Ver como", el banner demo, `?estado=`, `DEMO_NOW`, fixtures o el texto "Simulación".
- Mostrar el rótulo "Vista previa" en el PDF.
- Animar el cambio de mes o semana, usar `transition-all` o agregar librerías de calendario o UI.
- Mostrar motivos, notas internas o correos en la página pública o el PDF.
- Mostrar Semana en móvil o tablas de más de 3 columnas en móvil.
- Duplicar la lógica de permisos en componentes: todo sale de `lib/platform/modules.ts` y `effectivePermissions`.

**Revisión de motion:**

| Movimiento | Propósito | Duración | Reduced motion |
|---|---|---|---|
| Expandir las secciones del módulo activo | Continuidad | 150 ms en alto + chevron | Instantáneo |
| Sheets y dialogs | Continuidad | 200 ms | Fade de 100 ms |
| Popovers de día y de filtro | Feedback | 120 ms, fade + scale .98→1 | Fade |
| Botón "Copiado" | Feedback | Se mantiene 2 s, sin transición | Igual |
| Cambio de mes o semana | — | Ninguna | — |

Las duraciones son HYPOTHESIS heredadas del lock. Producción ya tiene el reset global de `prefers-reduced-motion`.

---

## 8. Handoffs

### 8.1 Navigator: decisiones que el diseño necesita

1. **Alcance de `publish_assigned`:**
   - opción a) es global y aplica a todas las áreas asignadas;
   - opción b) es por área, y el editor necesita un toggle "Puede publicar" por chip de área.
   - El diseño por defecto es (a). Con (b) se activa el caso "cambia el área → vuelve a Solo equipo".
2. **Un líder sin publicar que edita una actividad ya pública** de su área: ¿puede editar sus campos públicos (título, hora, descripción) o queda bloqueada? El diseño por defecto permite editar los datos y bloquea la visibilidad.
3. **¿Un líder sin publicar puede pasar una actividad pública a "Solo equipo"?** El diseño por defecto dice que no.
4. **¿Publicar requiere un enlace activo, o se puede publicar sin enlace?** El diseño por defecto permite publicar y avisa que no hay enlace activo.
5. **Lista de cargos sin el módulo Integrantes:** ¿existe el cargo "Consolidación" en este slice?
6. **Actividades pasadas con `manage_assigned`:** ¿pueden eliminarse (archivar)? Es la pregunta abierta heredada de 16b §16.3. El diseño por defecto dice que no.

### 8.2 Atlas: necesidades técnicas de UX

- La operación de generar o regenerar devuelve el enlace en claro **una sola vez**. El cliente lo guarda solo en memoria del componente.
- La regeneración debe ser atómica, para poder decir "el anterior sigue funcionando" si falla. Se necesitan los metadatos `createdAt`/`createdBy` y `deactivatedAt`/`deactivatedBy`.
- Página pública: hay que decidir si el token va en el fragmento (`#`) o en la query, más `Referrer-Policy: no-referrer`. El link "Abrir vista pública" usa `rel="noreferrer"`. La respuesta debe ser uniforme para inválido y desactivado.
- `lib/platform/modules.ts` se promueve desde `lib/suite-preview`, con un test de paridad contra las reglas.
- Los errores de Firestore se mapean a las 4 categorías de §5. Hay que definir la detección de "sin conexión" y si la persistencia offline está activa.
- Con export estático, los redirects de `/configuracion` → `/configuracion/areas` y `/finanzas/reportes` → `/reportes/finanzas` se hacen en el cliente.
- `/reportes/finanzas` requiere `FinanceDataCacheProvider`.

### 8.3 Builder: prioridad de implementación

1. Tokens + `SuiteShell`/`ModuleNav`/barras móviles + registro de módulos + redirects. Validar la regresión de Finanzas a 1440, 1024 y 390 antes de seguir.
2. Configuración › Áreas + Usuarios y permisos (evolución).
3. Calendario: Agenda y Mes + detalle + form con visibilidad, después cancelar y eliminar, Mis actividades y Semana.
4. Compartir (4 estados) + página pública.
5. Reportes › Calendario + PDF.

Builder no decide copy, colores de área, la regla de la bottom bar ni el comportamiento del enlace de una sola vez. Cualquier desviación vuelve a Designer.

---

## 9. Preguntas abiertas y artefactos

- **Preguntas abiertas:** las de §8.1, y los valores exactos de `--fx-side-*`, que Builder copia desde PR #3.
- **Artefactos de referencia:**
  - `docs/mission-2026/ (rama mission/calendar-integrantes-preview) 16b-designer-design-lock.md`
  - `.../pr4-ref/17-calendar-integrantes-preview-validation.md`
  - `.../pr4-ref/screens/*.jpg`
- **Archivos productivos involucrados:**
  - `app/globals.css`
  - `components/layout/app-shell.tsx`
  - `app/(private)/layout.tsx`
  - `app/(private)/finanzas/layout.tsx`
  - `components/finance/shared.tsx`
  - `components/settings/configuration-page.tsx`
  - `components/settings/users-permissions-panel.tsx`
  - `lib/finance/permissions.ts`

**Aprendizaje (candidato débil, no registrado):** para un enlace secreto que no se almacena, el patrón "se muestra una vez + regenerar para volver a compartir" debe sustituir todo valor enmascarado o "Copiar" persistente. Hay que validarlo en la revisión con el administrador real. El Brain no se consultó.