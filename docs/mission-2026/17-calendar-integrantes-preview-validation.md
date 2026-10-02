# 17 · Calendario + Integrantes / Consolidación: validación de la preview

> **NO DEPLOY · NO PRODUCTION · PREVIEW ONLY.**
> Es una vista previa aislada con datos de demostración. No lee ni escribe Firestore, no modifica reglas ni Functions y no forma parte del build que se despliega.

**Fecha:** 2026-10-02
**Rama:** `mission/calendar-integrantes-preview`
**Base:** `mission/ux-finanzas-2026-preview` @ `8e79cd1` (Draft PR #3)
**Especificación:** [16-calendar-integrantes-product-spec.md](16-calendar-integrantes-product-spec.md) y sus anexos [16a](16a-navigator-product-model.md) (Navigator), [16b](16b-designer-design-lock.md) (Designer) y [16c](16c-atlas-architecture.md) (Atlas)

## 1. Estado inicial

| Chequeo | Resultado |
|---|---|
| Checkout | `~/Documents/Proyectos Desarrollo/Proyects/CDS/cds-suite`. La carpeta de trabajo de la sesión (`Proyects/Suite CDS`) estaba vacía, igual que en la misión anterior |
| Rama / HEAD | `mission/ux-finanzas-2026-preview` @ `8e79cd1`, árbol limpio |
| Upstream | `origin/mission/ux-finanzas-2026-preview`, 0/0 |
| PR #3 | Draft, abierto, base `mission/slice6-usability` |
| Rama nueva | `mission/calendar-integrantes-preview` no existía ni local ni remota; se creó desde `8e79cd1` |
| Gates base | lint ✓ · typecheck ✓ · `npm test` **223/223** ✓ |
| Lecturas obligatorias | CLAUDE.md, PROJECT_CONTEXT.md, PR #3, docs 14 y 15, `lib/auth/access-provider.tsx`, `lib/finance/permissions.ts`, `lib/settings/users*.ts`, `components/settings/users-permissions-panel.tsx`, AppShell productivo y shell de la Financial UX V2 |

No se tocaron `mission/slice6-usability`, `mission/slice3a-sumup-fees` ni `feature/preproduccion-mobile-v1`.

## 2. Proceso ejecutado

```
Navigator (modelo de producto, 16a)
   ↓
Designer (Design Lock, 16b)  ∥  Atlas (arquitectura, 16c)     → conciliación del Conductor (16 §10)
   ↓
Builder: base (lógica pura, store, shell, rutas, guardia)  →  3 Builders en paralelo (Calendario · Consolidación · Configuración)
   ↓
Ciclo 1: capturas (72) → Designer + Atlas → correcciones (3 fixers en paralelo)
Ciclo 2: capturas (72) → Designer + Atlas → correcciones
Ciclo 3: capturas finales (72) → verificación final de Designer + Atlas
   ↓
Gates completos (lint, typecheck, test, build ×2, guardia de deploy)
```

**Notas de proceso:**
- Designer y Atlas corrieron en paralelo, no en secuencia, y el Conductor resolvió sus conflictos en 16 §10: `?perfil=`, `persona?id=`, `compartir/demo?t=`, ruta propia del Resumen del Líder, Reportes y Configuración de Finanzas como módulos globales con atajos en la subnav financiera, y WhatsApp simulado.
- El agente Builder del plugin agotó su límite de 24 turnos leyendo contexto, sin escribir código, dentro de un worktree temporal. Ese worktree vacío y su rama se eliminaron, y la construcción pasó a agentes de propósito general que trabajaron directo en la rama.
- El agente Atlas del plugin no tiene shell. Su revisión del ciclo 1 quedó parcial, así que las revisiones de código de los 3 ciclos las hizo un agente con rol Atlas y acceso a git, grep y vitest.
- La sesión se reinició una vez. Los agentes retomaron sin pérdida, porque el trabajo estaba en disco, pero el scratchpad se vació: hubo que recrear el script de capturas y levantar de nuevo el servidor de desarrollo.

## 3. Commits

| Commit | Qué |
|---|---|
| `70e7d1a` | docs: especificación (doc 16) y anexos 16a–16c |
| `73d9285` | feat: lógica pura de CDS Suite (permisos, rutas, áreas, recurrencia, calendario, consolidación, store) |
| `1260e98` | feat: shell global, perfil simulado, guardia de acceso y rutas |
| `0329a1b` | build: la guardia de deploy detecta la preview de CDS Suite |
| `fa4d7c9` | test: permisos, rutas, recurrencia, proyección pública, consolidación, store, aislamiento y guardia |
| `45e2650` | build: hojas de estilo por módulo |
| `ab28d0f` | feat: Configuración › Áreas y Usuarios y permisos |
| `da05a1a` | feat: Integrantes › Consolidación |
| `3c50054` | feat: Calendario, calendario público y reporte de calendario |
| `538e1f0` | fix: correcciones del ciclo 1 |
| `cb9d0ee` | fix: correcciones del ciclo 2 |
| *(este doc)* | docs: validación y capturas |

## 4. Arquitectura implementada

- **Un solo shell (`SuiteShell`)** que evoluciona desde la Financial UX V2:
  - sidebar de 240 px con la lista de módulos y el módulo activo expandido;
  - rail de 72 px entre 768 y 1279;
  - top bar con selector de módulo y bottom bar calculada por `bottomTabs(módulo, perfil)` por debajo de 768.
  - `FinancialShell` conserva su export y su firma y compone `SuiteShell`, así que los tests de PR #3 siguen sin cambios.
- **Rutas:**
  - `app/preview/layout.tsx` tiene el gate `notFound()`, `SuiteProvider` y `AccessGate`;
  - `app/preview/(suite)/` agrupa los módulos nuevos;
  - `app/preview/(publico)/` tiene la página pública, sin shell;
  - `app/preview/finanzas-2026/` queda sin cambios de URL.
  - Son 32 páginas `page.preview.tsx` y no hay segmentos dinámicos.
- **Estado:**
  - el perfil simulado vive en `?perfil=`;
  - un reducer puro en memoria (`lib/suite-preview/store.ts`) se siembra desde fixtures, sobrevive a la navegación y se reinicia al recargar;
  - el reducer revalida los permisos del actor en cada acción, como defensa en profundidad que espeja las reglas futuras.
- **Lógica pura reutilizable** en `lib/suite-preview/`: `access`, `routes`, `modules`, `areas`, `recurrence`, `calendar`, `share`, `phone`, `consolidation`, `report`, `report-pdf` y `dates`. No usa React y está pensada para promoverse a producción sin reescribirse.
- **Reloj único:** `DEMO_TODAY`/`DEMO_NOW` (domingo 04-10-2026 13:30) en `lib/finance-preview/clock.ts`, el mismo de la Financial UX V2.

## 5. Modelo de acceso demostrado

| Perfil (`?perfil=`) | Aterriza en | Ve |
|---|---|---|
| `admin`: Administración (demo) | Finanzas › Hoy | Todo, incluida Configuración |
| `pastor`: Daniel Herrera | Calendario | Todo menos Configuración |
| `lider`: Matías Contreras (Jóvenes) | Calendario | Finanzas › Resumen, Calendario (gestiona Jóvenes), Reportes › Calendario |
| `diacono`: Pedro Navarro (Multimedia y Varones) | Calendario | Igual que Líder, con sus dos áreas |
| `finanzas`: Marcela Soto | Finanzas › Hoy | Finanzas completo, Calendario en lectura, Reportes |
| `consolidacion`: Carolina Vidal | `/integrantes/consolidacion` | Integrantes, Calendario en lectura, Reportes › Calendario |
| `sin-permisos` | "Aún no tienes módulos asignados" | Nada, sin redirecciones ni loop |
| `lider-fallback` | Calendario (su módulo inicial Finanzas ya no está permitido) | Aviso en Usuarios y en "Ver como" |

- **Ingreso simulado:** `/preview`. Cada fila calcula "Entra a …" con la misma función que usa la app (`resolveInitialModule`).
- **"Ver como":** vive en el banner de demostración, con borde dashed, porque es una herramienta de la preview y no del producto.
- **Deep link no permitido:** redirige al módulo inicial con el aviso "No tienes acceso a {módulo}. Te llevamos a {módulo}."

## 6. Pantallas implementadas

| Ruta | Contenido |
|---|---|
| `/preview` | Ingreso simulado (8 perfiles) |
| `/preview/finanzas-2026/*` | Financial UX V2 sin cambios de contenido |
| `/preview/finanzas-2026/resumen` | Resumen financiero agregado para el Líder: 3 cifras, sin desglose ni nombres |
| `/preview/calendario` | Mes, Semana y Agenda (por defecto en móvil). Filtro por área, leyenda, detalle con acciones según permisos, crear y editar con recurrencia, cancelar y eliminar (archivar) con motivo |
| `/preview/calendario/mis-actividades` | Responsable (editable) frente a Participa (solo lectura) |
| `/preview/calendario/compartir` | Enlace público: copiar, regenerar, desactivar y activar, "qué se publica / qué nunca se publica" |
| `/preview/calendario/compartir/demo` | Calendario público sin login ni shell: Agenda y Mes, filtro por área, detalle público, "no disponible" |
| `/preview/reportes/finanzas` | Reporte financiero de V2 dentro del módulo Reportes |
| `/preview/reportes/calendario` | Filtros (período, área y "solo responsable", estado, visibilidad), resumen, tabla o lista, PDF local con vista previa fiel |
| `/preview/integrantes/consolidacion` | Inicio: 3 indicadores, Necesitan atención, Cumpleaños, Nuevos, Seguimientos pendientes y Volvieron |
| `/preview/integrantes/consolidacion/atencion` | Cola completa agrupada por alerta |
| `/preview/integrantes/consolidacion/personas` | Búsqueda, filtros y orden. Tabla en desktop, lista en móvil con acciones rápidas |
| `/preview/integrantes/consolidacion/persona?id=` | Ficha: datos (tri-estado explícito), próxima acción, alertas, historial con primera visita marcada |
| `/preview/integrantes/consolidacion/nueva` | Nueva persona: teléfono normalizado, edad calculada, tri-estado, aviso de duplicado no bloqueante |
| `/preview/integrantes/consolidacion/ajustes` | Parámetros de alertas en solo lectura (Propuesta) |
| `/preview/configuracion/areas` | Áreas con paleta cerrada (solo colores libres), activación con consecuencias |
| `/preview/configuracion/usuarios` | Rol base + cargo + permisos (implicados bloqueados) + áreas + módulo inicial con aviso de fallback |
| `/preview/configuracion/finanzas` | Ajustes de finanzas: integraciones, categorías y días de culto |

- **Estados forzables:** `?estado=cargando|vacio|error` en las pantallas principales.
- **Acciones:** toda acción muestra "Simulación: no se guardó nada." y lo creado se ve de inmediato en todas las pantallas hasta recargar.

## 7. Decisiones clave

- **Recurrencia** (16 §5.1):
  - **Entra en la preview:** semanal, quincenal y mensual por día de la semana (1.º–4.º o último) con fecha final; "editar toda la serie"; "cancelar solo esta fecha"; "cancelar la serie desde hoy".
  - **Queda para el siguiente slice** (deshabilitado con Propuesta): "editar solo esta", "esta y las siguientes" y "mismo día N".
  - En una serie ya iniciada no se cambian día, hora ni frecuencia, para no reescribir el historial. Una serie terminada o con cancelación de serie es de solo lectura para `manage_assigned`.
- **Nada se borra:** "Eliminar" archiva con motivo, "Cancelar" deja la actividad visible y tachada, y las visitas anuladas guardan autor y fecha.
- **Una identidad por persona:** `lifecycleStage` (dónde está) separado de `consolidationStatus` (en qué va). "Nuevo" y "Volvió" son badges derivados, no estados. Ningún estado cambia sin confirmación: el primer contacto exitoso *sugiere* "En seguimiento".
- **Color de la actividad = color del área responsable.** Las participantes se muestran como chips con nombre.
- **WhatsApp simulado:** los teléfonos ficticios podrían ser números reales, así que no se navega a `wa.me`.
- **Calendario público:** proyección por lista blanca (`toPublicEvent`, sin spread) y los mismos textos para un enlace inválido o desactivado.

## 8. Tests

| Gate | Base (`8e79cd1`) | Final |
|---|---|---|
| `npm run lint` | ✓ | ✓ (0 warnings) |
| `npm run typecheck` | ✓ | ✓ |
| `npm test` | 223/223 | **493/493** (+270 nuevos en 18 archivos; **`tests/finance-preview/` sin modificar**: `git diff 70e7d1a..HEAD -- tests/finance-preview` vacío) |
| `npm run build` (×2, antes y después de `build:preview`) | ✓ | ✓, sin `out/preview` |
| `node scripts/check-no-preview.mjs` sobre el build por defecto | ✓ | ✓ |
| `npm run build:preview` + guardia | — | build ✓ (47 páginas); la guardia **falla (exit 1)** como se espera |
| `grep CANARIO`/canarios en el HTML público prerenderizado | — | 0 |
| `npm run test:rules` | — | **No ejecutado:** las reglas no cambiaron |

**Tests nuevos (`tests/suite-preview/`):**

| Pedido por la misión | Archivo(s) |
|---|---|
| Permisos simulados | `access.test.ts` (cierre, `settings.manage` solo con admin, presets, migración de roles, `validateProfileChange`), `store.test.ts` (revalidación por actor en cada acción) |
| Módulo inicial | `access.test.ts` (B.7 pasos 1–7, fallback, sin módulos), `settings-screens.test.tsx` (cambiar permisos cambia el aterrizaje en la sesión) |
| Filtrado por áreas | `calendar.test.ts` (`filterByAreas`, "solo responsable"), `calendar-screens.test.tsx` |
| Colores por área | `areas.test.ts` (`eventColor` = responsable; color único entre activas; área inactiva conserva el color) |
| Eventos públicos frente a internos | `share.test.ts`, `calendar.test.ts` |
| Calendario compartido sanitizado | `share.test.ts` (claves exactas en profundidad, canarios ausentes, tokens regenerados o desactivados), `public-view.test.tsx` (render de todas las vistas y detalles sin canarios, títulos de equipo, correos ni nombres) |
| Edad derivada | `consolidation.test.ts` (`ageAt`, 29-02 → 28-02, sin fecha → "—") |
| Registro de visitas | `store.test.ts` (solo se agregan), `members-screens.test.tsx` (cantidad y última visita en la lista y la ficha) |
| Timeline | `consolidation.test.ts`, `members-screens.test.tsx` |
| Alertas | `consolidation.test.ts` (8 alertas con fixture y contra-fixture, `doNotContact`, orden de Atención) |
| Duplicados | `phone.test.ts` (normalización chilena y extranjera), `consolidation.test.ts`, `members-screens.test.tsx` (aviso no bloqueante) |
| Navegación según permisos | `routes.test.ts` (propiedad: todo perfil × toda ruta termina en una ruta permitida, sin loop), `suite-shell.test.tsx` |
| Aislamiento Firebase | `isolation.test.ts` (grafo transitivo, red y almacenamiento con conteos, reloj, jspdf dinámico, allowlist de `public/**`, controles positivos), `structure.test.ts`, `deploy-guard.test.ts` |
| Recurrencia (extra) | `recurrence.test.ts` (fechas verificadas: 1.er sábado, último viernes, `until` inclusivo, vigilia nocturna, cancelaciones) |
| Reporte (extra) | `report.test.ts` (filtros, orden, sin notas internas, paginación del PDF igual a la vista previa) |

**Aserciones de `tests/suite-preview` ajustadas dentro de la misión:** dos, ambas por cambios de texto pedidos por Designer y con la misma fuerza o más:
- etiquetas de "Repetir" ("Cada semana, los domingos");
- nota de zona horaria, que además ahora exige que no aparezca "America/Santiago".

Ningún test previo a la misión cambió.

## 9. Revisión Designer + Atlas (3 ciclos)

| Ciclo | Designer (visual) | Atlas (código e invariantes) |
|---|---|---|
| 1 | **PASS WITH FIXES.** 3 Alta: viewport en blanco al final de cada página (el host de toasts heredaba `min-height: 100dvh`), rail de Finanzas desbordado a 1024 y bloques superpuestos ilegibles en Semana. Además 17 Media/Baja: fechas en formato en-US, alertas solo con ícono, canarios visibles, dominio de hosting real, etc. | **PASS WITH FIXES.** Sin fugas ni ruptura de aislamiento. Media: botones sin nombre accesible en móvil, `replaceState(window.history.state)` que desincroniza la URL con el router de Next, series terminadas editables por `manage_assigned`. Baja: "Llegó a" mostraba actividades de equipo sin `calendar.read`, colisión de CSS en el login, validaciones del seguimiento |
| 2 | **PASS WITH FIXES.** Las 3 Alta cerradas. 2 Alta nuevas: badges que chocaban con el estado en Personas a 390, y panel heredado de usuarios ficticios en Ajustes de finanzas. 7 Media (motivo truncado a 1440, segmented faltante en Reportes › Finanzas, paginación del PDF, filtros desalineados, simulador vacío bajo 400 px, barra inferior en Nueva persona, filtro móvil incompleto) | **PASS WITH FIXES.** 1 Alta: el seguimiento de una persona cuyo responsable perdió el acceso (p-07) fallaba al guardar. 5 Baja |
| 3 | **PASS** (verificación final) | **PASS** (verificación final) |

### 9.1 Ciclo 3 (verificación final sobre `cb9d0ee` y la ronda 3)

**Designer: PASS.**
- Se verificaron como corregidos los 13 hallazgos del ciclo 2 (A1–A2, M1–M7, B1–B5) y los 5 ítems que habían quedado sin verificar: diálogo de cancelar recurrente, línea de fecha del historial en móvil, dominio neutro, copy " · responsable" y etiquetas de repetición, y crear a pantalla completa sin handle.
- No hay hallazgos Bloqueantes, Altos ni Medios. Los 29 criterios de 16b §17 están en ✓.
- El criterio 16 ("Eliminar explica que archiva") se completó después con la captura `i2-eliminar-actividad-1440.jpg`.
- **Baja, opcionales:**
  - el locale de los inputs nativos depende del navegador; los ecos en es-CL lo compensan;
  - "Mis actividades" ocupa 2 líneas en la barra inferior a 390;
  - "Ver como: Consolid." se lee como truncado;
  - "Próxima acción" truncada a 1440/1280 (falta line-clamp de 2 líneas);
  - el badge "Activo" de Compartir va en tono info, no success.

**Atlas: PASS.**
- Todos los hallazgos del ciclo 2 están resueltos, sin regresiones.
- El sentinel "Sin asignar" se traduce a `null` antes del dispatch y nunca llega al store como uid.
- `calendarPdfLayout` es puro y jspdf sigue cargándose solo de forma dinámica.
- `publicRecurrenceLabel` no lee motivos.
- Se re-verificó: 493/493, tsc limpio, `tests/finance-preview` intacto, sin `replaceState(window.history.state)`, sin anclas `wa.me`, sin `Date` fuera de `dates.ts` y sin imports prohibidos.
- **Baja, opcionales:**
  - el link "Usuarios y permisos" de Ajustes de finanzas no conserva `?perfil=` si se abre en una pestaña nueva;
  - un `import()` dinámico redundante en el reporte;
  - falta un test de UI de "Sin asignar";
  - `calendarPdfLayout` no imita a autoTable con una fila más alta que una página. Hoy no puede ocurrir: la descripción tiene un máximo de 1.000 caracteres.

Estos Baja quedan registrados como pendientes (§12) y no se corrigieron, para no abrir un cuarto ciclo.

**Métricas automáticas finales (ronda 3, 72 capturas a 1440, 1280, 1024, 768, 390 y 375):** ver [screens-calendar-integrantes/_metricas.txt](screens-calendar-integrantes/_metricas.txt).
- **Overflow de página = 0** y **overflow dentro de contenedores = 0** en todas.
- **0 errores de consola**, **0 jerga** (UID, Firestore, token, canarios, `America/Santiago`) y **0 "Saldo"**.
- **Targets móviles ≥44 px** en todas las pantallas nuevas. La única excepción son los controles de período de Finanzas › Hoy (40–42 px), heredados de PR #3 y fuera del alcance de esta misión.
- La métrica "blank" marca espacio bajo el contenido solo en las pantallas centradas sin shell (ingreso y sin módulos), y ahí es lo esperado.

## 10. Capturas

En [screens-calendar-integrantes/](screens-calendar-integrantes/): 50 JPEG de la ronda 3. Las móviles están reducidas a 1x.

| Pedido por la misión | Archivo |
|---|---|
| Calendario desktop | `a-calendario-mes-lider-1440.jpg`, `b-calendario-semana-1440.jpg`, `b2-calendario-semana-vigilia-1440.jpg`, `c-calendario-rail-1024.jpg` |
| Calendario móvil | `d-calendario-agenda-390.jpg`, `e-calendario-mes-375.jpg` |
| Crear actividad | `f2-crear-actividad-recurrencia-1440.jpg`, `f3-crear-actividad-390.jpg` |
| Filtro por área | `g-filtro-area-1440.jpg`, `g2-filtrado-jovenes-1440.jpg`, `g3-filtro-area-390.jpg` |
| Calendario público | `k-publico-1440.jpg`, `k2-publico-390.jpg`, `k4-publico-375-detalle.jpg`, `k5-publico-no-disponible-390.jpg` |
| Configuración de áreas | `l-areas-1440.jpg`, `l2-areas-editor-1440.jpg` |
| Usuarios y permisos | `m-usuarios-1440.jpg`, `m2-usuarios-editor-lider-1440.jpg`, `m3-usuarios-editor-fallback-1440.jpg` |
| Consolidación dashboard | `n-consolidacion-dashboard-1440.jpg`, `n3-consolidacion-dashboard-390.jpg` |
| Lista de personas desktop | `o-personas-1440.jpg`, `o3-personas-1024.jpg` |
| Lista móvil | `p-personas-375.jpg` |
| Ficha persona | `q-ficha-1440.jpg`, `q2-ficha-390.jpg` |
| Registrar visita | `s-registrar-visita-1440.jpg`, `s2-registrar-visita-390.jpg` |
| Seguimiento | `t2-seguimiento-sugerencia-1440.jpg` |
| Cumpleaños | `u-cumpleanos-1440.jpg` |
| Extra: acceso y shell | `v-ingreso-1440.jpg`, `w-ver-como-1440.jpg`, `x-aviso-sin-acceso-1440.jpg`, `y-sin-modulos-1440.jpg`, `ab-resumen-lider-1440.jpg` |
| Extra: Finanzas con el shell nuevo (regresión) | `aa-finanzas-hoy-admin-1440.jpg`, `aa-finanzas-hoy-admin-1024.jpg`, `aa-finanzas-hoy-admin-390.jpg` |
| Extra: calendario | `h-detalle-sin-permiso-1440.jpg`, `i-cancelar-recurrente-1440.jpg`, `i2-eliminar-actividad-1440.jpg`, `j-compartir-1440.jpg`, `mis-actividades-lider-1440.jpg` |
| Extra: reportes y configuración | `z-reporte-calendario-1440.jpg` (con vista previa del PDF), `z2-reporte-calendario-lider-390.jpg`, `reportes-finanzas-1440.jpg`, `configuracion-finanzas-1440.jpg` |
| Extra: nueva persona | `r2-nueva-persona-duplicado-1440.jpg`, `r3-nueva-persona-390.jpg` |

## 11. Archivos modificados

**Archivos existentes modificados** (todos dentro de la preview; ninguno productivo):
- `components/finance-preview/shell.tsx`: `FinancialShell` compone `SuiteShell`. `BASE`/`NAV_GROUPS` se mueven a `nav.ts` y se reexportan. `replaceState(null)`.
- `components/finance-preview/context.tsx`: el toast se delega en la suite, y se resincroniza con `QUERY_EVENT` sin re-render innecesario.
- `components/finance-preview/screens/analisis.tsx`: props opcionales (`variant` en `ConfiguracionScreen`; `pdfLabel` y `belowHeader` en `ReportesScreen`). Sin props, V2 queda igual.
- `components/finance-preview/screens/hoy.tsx`: el link "Ver reporte del período" apunta a la ruta nueva.
- `lib/finance-preview/fixtures.ts`: reexporta el reloj desde `clock.ts` (mismos valores).
- `app/preview/finanzas-2026/{reportes,configuracion}/page.preview.tsx`: redirigen a `/preview/reportes/finanzas` y `/preview/configuracion/finanzas`.
- `scripts/check-no-preview.mjs`: detecta los sentinels FX y SX y las rutas nuevas. Acepta `CDS_OUT_DIR`, solo para su test.

**Nuevos:**
- `app/preview/layout.tsx`, `app/preview/page.preview.tsx`, `app/preview/(suite)/**`, `app/preview/(publico)/**` y `app/preview/finanzas-2026/resumen/`;
- `components/finance-preview/nav.ts` y `lib/finance-preview/clock.ts`;
- `components/suite-preview/**` y `lib/suite-preview/**`;
- `tests/helpers/import-graph.ts` y `tests/suite-preview/**`;
- `docs/mission-2026/16*.md`, `17-…` y `screens-calendar-integrantes/`.

**No se tocó:**
- `firestore.rules`, `storage.rules`, `functions/`, `firebase.json`, `next.config.ts` ni las dependencias de `package.json`;
- `lib/finance/**`, `lib/auth/**`, `lib/settings/**`, `app/(private)/**`, `app/layout.tsx` ni `app/globals.css`;
- ninguna pantalla productiva;
- `tests/finance-preview/**`.

## 12. Pendientes

**Para que Salvador valide** (16 §11, con su valor por defecto aplicado):
1. Pipeline de 5 estados, con "Nuevo" y "Volvió" como badges derivados.
2. Pastor y Finanzas siguen escribiendo en finanzas.
3. Finanzas y Consolidación ven el Calendario en lectura.
4. Un Líder publica actividades sin aprobación.
5. Parámetros de alertas: 48 h, 21 días y 14 días.
6. Consolidación ve a todas las personas.
7. Menores: sin dato del adulto responsable.
8. Módulo inicial del Pastor nuevo: Calendario.
9. Sin `?perfil` se entra como Administración.
10. Rutas `persona?id=` y `compartir/demo?t=`.
11. CTAs "Agradecer" e "Invitar".
12. Alcance de la recurrencia.

**Siguiente slice:**
- recurrencia: "editar solo esta", "esta y las siguientes", "mismo día N", reactivar una actividad cancelada;
- consolidación: descartar o fusionar duplicados, posponer alertas, parámetros editables, `read_assigned` si el equipo crece;
- aprobación de actividades públicas;
- submódulos de Integrantes (Directorio, Miembros, Ministerios, Familias, Asistencia).

**Baja:**
- los Baja del ciclo 3 de Designer y Atlas (§9.1);
- la anulación de una visita guarda autor y fecha, pero el historial no los muestra todavía;
- el badge de Atención de Finanzas no baja al resolver ítems (es una simulación heredada de PR #3).

**No verificable con capturas:**
- foco visible por teclado en todos los controles;
- tooltips del rail;
- `prefers-reduced-motion`;
- lector de pantalla.

Están implementados (`:focus-visible`, `aria-*`, media query), pero no se revisaron con teclado ni con lector real.

## 13. Riesgos

1. **Datos sensibles (bloqueante de producción).** La confesión de fe y el bautismo son datos sensibles (creencias religiosas) y se registran menores. Antes del backend hay que revisar con asesoría legal la base de licitud, la finalidad, la retención, el derecho de supresión y el consentimiento del adulto responsable (Ley 21.719, vigente desde diciembre de 2026).
2. **Build con flag desplegado por error.** `npm run build:preview` escribe en `out/`. Mitigación: tres barreras más la guardia en `predeploy`, con su propio test. Antes de cualquier deploy: `rm -rf out && npm run build`.
3. **El flag `CDS_FINANCE_PREVIEW` ahora habilita toda la preview de CDS Suite**, no solo Finanzas.
4. **Divergencia entre preview y producción.** La lógica de `lib/suite-preview` es pura, pero también es una reimplementación. En el slice real conviene promoverla, no reescribirla, y agregar un test de paridad entre `IMPLIES` y las reglas.
5. **Notas internas de actividades:** las ve todo `calendar.read`. En producción el campo debe advertir "No escribas datos personales de integrantes".
6. **`AuthProvider` en el root layout:** la preview, incluida la página pública, carga el SDK de Firebase Auth. Es herencia de PR #3: no hay lecturas ni escrituras de Firestore.
7. **La página pública de la preview** proyecta en el cliente desde el store completo, que está en el bundle por diseño. En producción la proyección la hace una Function con el token hasheado (16c §D.8). **Nunca** se abre una colección pública.

## 14. Qué se necesita para pasar a producción

Es el checklist completo de 16c §I (resumen):
- **Reglas Firestore v2:**
  - doble lectura `role`/`permissions`, con `can()` por lista de implicantes;
  - colecciones `areas`, `calendarEvents` (+ `changes`), `calendarShareLinks` (privada) y `people/**` (visitas y cambios solo de creación, sin `age` guardada);
  - `test:rules` completo y un test de paridad con `IMPLIES`.
- **Functions:** `calendarPublicFeed` (hash del token, `toPublicEvent` compartido, caché corta, respuesta uniforme) y la supresión o anonimización de personas.
- **Hosting:**
  - rewrites `/calendario/compartir/**` → HTML estático y `/api/calendario-publico/**` → Function;
  - `Referrer-Policy: no-referrer` en la página pública.
- **Índices:** `calendarEvents(status, seriesEnd)`, `people(lifecycleStage, consolidationStatus, entryDate)`, y `visits`/`followUps` por persona y fecha.
- **Migración de usuarios:** backfill idempotente con `--dry-run` y aprobación humana; `access-provider` con doble lectura; retiro posterior de `legacyRole`.
- **Desnormalización** de `visitCount`, `lastVisitDate` y `nextAction*` con consistencia forzada en reglas.
- **Auditoría** (`PersonChange` y `EventChange`) en el mismo batch, con `revision`.
- **Zona horaria:** constante `America/Santiago`; "hoy" calculado en Santiago.
- **Asesoría legal** (riesgo 1).
- **Directorio:** vínculo futuro entre `titheProfiles` y `Person`, sin exponer diezmos a Consolidación.

## 15. Cómo ejecutar la preview

```bash
cd ~/Documents/Proyectos\ Desarrollo/Proyects/CDS/cds-suite
git switch mission/calendar-integrantes-preview
npm run dev
```

Abrir <http://localhost:3000/preview> y elegir un perfil. No requiere login ni emuladores.
- **Perfil directo:** `?perfil=lider`, `?perfil=consolidacion`, etc. (por ejemplo `/preview/calendario?perfil=lider`).
- **Vista del calendario:** `?vista=mes|semana|agenda`; fecha con `?fecha=2026-10-30`; áreas con `?areas=jovenes`.
- **Estados:** `?estado=cargando|vacio|error`.
- **Página pública:** `/preview/calendario/compartir/demo`.
- **Build estático de la preview (solo local, nunca desplegar):** `npm run build:preview`. Luego `rm -rf out && npm run build` para dejar un `out/` limpio.

## 16. Qué NO se desplegó

**Nada.**
- Sin `firebase deploy`, sin canal de preview y sin cambios en Hosting, Firestore, Functions, Storage ni Authentication.
- Sin merge y sin cambio de default branch.
- Sin datos reales: todas las personas, teléfonos (`+56 9 5555 01xx`) y correos (`@demo.invalid`) son ficticios.
- La rama se publica en GitHub solo para revisión, con un Draft PR marcado **NO DEPLOY / NO PRODUCTION / PREVIEW ONLY** contra `mission/ux-finanzas-2026-preview`.
