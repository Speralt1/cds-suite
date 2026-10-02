# 16 · Calendario + Integrantes / Consolidación: especificación de producto

> **NO DEPLOY · NO PRODUCTION · PREVIEW ONLY.**
> Diseño de producto y arquitectura para una preview navegable con datos de demostración. No lee ni escribe Firestore, no modifica reglas ni Functions y no forma parte del build desplegable.

**Fecha:** 2026-10-02
**Rama:** `mission/calendar-integrantes-preview`, creada desde `mission/ux-finanzas-2026-preview` @ `8e79cd1` (Draft PR #3)
**Proceso:** Navigator → Designer ∥ Atlas → conciliación del Conductor → Builder → revisión (Designer + Atlas) → correcciones → tests.

**Anexos (los insumos completos, sin editar):**
- [16a · Modelo de producto (Navigator)](16a-navigator-product-model.md): actores, modelo de acceso, entidades, estados, reglas de negocio, privacidad, alcance, 32 criterios de aceptación y fixtures.
- [16b · Design Lock (Designer)](16b-designer-design-lock.md): shell global, sistema de áreas, Calendario, página pública, Reportes, Consolidación, Configuración, layouts, copy y 29 criterios visuales.
- [16c · Arquitectura (Atlas)](16c-atlas-architecture.md): rutas, shell, estado, store, motor de permisos, recurrencia, proyección pública, teléfonos, PDF, tests, riesgos y checklist de producción.

Este documento resume los tres anexos y **manda sobre ellos** donde dicen algo distinto (§10).

---

## 1. Objetivo

CDS Suite deja de ser una aplicación solo financiera. La preview tiene que permitir que Salvador valide la UX, la arquitectura de información, los permisos y los flujos de dos módulos nuevos antes de construir el backend:
- **Calendario**, con color por área, actividades recurrentes, un enlace público y un reporte;
- **Integrantes**, cuyo primer submódulo es **Consolidación**: el seguimiento de las personas nuevas.

Módulos superiores: **Finanzas · Calendario · Integrantes · Reportes · Configuración**, dentro de **una sola aplicación** que evoluciona desde la Financial UX V2 aprobada, sin romperla.

## 2. Arquitectura de la preview

```
app/preview/
  layout.tsx                 gate notFound() + SuiteProvider (perfil, store, toast, aviso) + AccessGate
  page.preview.tsx           /preview: ingreso simulado ("¿Con qué perfil entras?")
  finanzas-2026/             Financial UX V2: misma URL y mismo layout.tsx
    resumen/                 nuevo: resumen agregado para quien solo tiene finance.summary.read
  (suite)/                   layout con SuiteShell: Calendario, Integrantes, Reportes, Configuración
  (publico)/calendario/compartir/demo   página pública, sin shell
components/suite-preview/**  shell, provider, gate, pantallas
lib/suite-preview/**         lógica pura (sin React): permisos, rutas, áreas, recurrencia,
                             calendario, proyección pública, teléfonos, consolidación, reporte, store
```

**Barreras de aislamiento** (se heredan de PR #3 y se extienden):
1. **Compilación:** las páginas usan `.preview.tsx`, que solo existe en `next dev` o con `CDS_FINANCE_PREVIEW=1`. El build por defecto no emite ninguna ruta `/preview/*`.
2. **Runtime:** `notFound()` en `app/preview/layout.tsx`.
3. **Deploy:** `scripts/check-no-preview.mjs` detecta el sentinel nuevo `SX_PREVIEW_SENTINEL_V1_c41e` y las rutas nuevas. `firebase.json` ya lo ejecuta antes de cualquier deploy de hosting y no se modifica.
4. **Tests:** recorrido transitivo de imports (sin Firebase ni `lib/finance|auth|settings`), sin red ni almacenamiento (ahora también `sessionStorage` y `document.cookie`), estructura de rutas y la guardia de deploy probada sobre carpetas temporales.

**Estado:**
- El perfil simulado vive en la URL (`?perfil=lider`), igual que `?periodo=` en V2. Sin `?perfil` se entra como Administración, para que los links de PR #3 sigan funcionando.
- Lo que se crea en la sesión (actividades, personas, visitas, seguimientos) vive en un reducer puro en memoria: se ve de inmediato en todas las pantallas y se pierde al recargar.
- Toda acción muestra **"Simulación: no se guardó nada."**

**Sin segmentos dinámicos.** `output: "export"` no puede prerenderizar ids creados en la sesión. Por eso la ficha es `persona?id=…` y el enlace público, `compartir/demo?t=…`. Producción tendrá la misma restricción: Hosting es estático. Detalle en 16c §A.3 y §D.7.

## 3. Modelo de acceso

`AccessProfile = baseRole + cargo + permisos + áreas + módulo inicial`

| Permiso | Habilita |
|---|---|
| `finance.summary.read` | Finanzas › Resumen: cifras agregadas, sin detalle ni nombres |
| `finance.details.read` | Todo Finanzas y los reportes financieros |
| `finance.records.manage` | Registrar, editar y anular en finanzas (hoy lo da `details()` en las reglas) |
| `finance.pastoral.manage` | Seguimiento pastoral de diezmos (compatibilidad con `pastoral()`) |
| `calendar.read` | Calendario global, incluidas las actividades "solo equipo", y el reporte de calendario |
| `calendar.events.manage_assigned` | Gestionar actividades cuya **área responsable** es una de mis áreas |
| `calendar.events.manage_all` | Gestionar todas las actividades y el enlace público |
| `members.consolidation.read` | Ver Consolidación |
| `members.consolidation.manage` | Registrar personas, visitas y seguimientos; cambiar estado y responsable |
| `settings.manage` | Áreas, Usuarios y configuración. **Solo existe a través de `baseRole = admin`** |

- **Cierre:** `details` implica `summary`; `records` y `pastoral` implican `details`; `manage_all` implica `manage_assigned`, que implica `calendar.read`; `consolidation.manage` implica `read`.
- **Un módulo es visible** si y solo si el usuario tiene algún permiso de ese módulo. Los módulos no permitidos **no aparecen**, ni siquiera deshabilitados.
- **Módulo inicial:** se usa el configurado; si ya no está permitido, el del preset del cargo; si tampoco, el primer módulo permitido. Un perfil sin módulos ve "Aún no tienes módulos asignados", sin redirecciones.
- **Deep link a una ruta no permitida:** redirige al módulo inicial con el aviso "No tienes acceso a {módulo}".

**Presets por cargo:**

| Cargo | Aterriza en | Ve |
|---|---|---|
| Administración | Finanzas (configurable) | Todo |
| Pastor | Calendario (el pastor migrado conserva Finanzas) | Todo menos Configuración |
| Líder / Diácono | Calendario | Finanzas › Resumen, Calendario (gestiona sus áreas), Reportes › Calendario |
| Finanzas | Finanzas | Finanzas completo, Calendario en lectura, Reportes |
| Consolidación | `/integrantes/consolidacion` | Integrantes, Calendario en lectura, Reportes › Calendario |

**Compatibilidad:** `admin → Administración`, `pastor → Pastor`, `finance → Finanzas`, `leader → Líder` (sin áreas hasta que el admin las asigne). El plan de migración a producción, con doble lectura `role`/`permissions`, está en 16c §D.2. **Las reglas no se tocan en esta misión.**

**Perfiles de la preview** (8): Administración (demo) · Daniel Herrera, Pastor · Matías Contreras, Líder (Jóvenes) · Pedro Navarro, Diácono (Multimedia y Varones) · Marcela Soto, Finanzas · Carolina Vidal, Consolidación · Usuario sin permisos · Líder con módulo inicial no permitido (demuestra el fallback).

## 4. Áreas

- **Campos:** `id`, nombre, color (paleta cerrada de 10, cada uno con una variante `-ink` para texto y una `-soft` para fondos), descripción opcional, activa/inactiva.
- **Color de las actividades:** la actividad **hereda el color del área responsable**; nadie lo elige.
- **Áreas participantes:** chips con el nombre. No hay gradientes ni mezclas.
- **El nombre acompaña siempre al color.**
- **Área inactiva:** no se ofrece al crear actividades. Las actividades existentes conservan su nombre y color.
- **Fixtures:** Pastoral, Alabanza, Jóvenes, Niños, Damas, Varones, Intercesión, Multimedia, Consolidación y Matrimonios (inactiva).

## 5. Calendario

- **Vistas:** Mes, Semana y Agenda. La Agenda es la vista por defecto en móvil y en la página pública, y salta los días sin actividades. La semana empieza el lunes.
- **Pantallas:** Calendario global · Mis actividades (las de mis áreas: editables si soy responsable, de solo lectura si solo participo) · filtro por área · detalle · crear y editar · cancelar · eliminar · compartir.
- **Estados:**
  - `programada`;
  - *realizada*: derivada, cuando el fin es anterior a ahora;
  - `cancelada`: exige motivo, sigue visible y tachada;
  - `archivada`: es lo que la UI llama "Eliminar". Exige motivo, queda en el historial y desaparece de las vistas.
  - **Nada se borra.**
- **Permisos:**
  - `manage_assigned` gestiona solo las actividades cuyo responsable es su área, desde hoy en adelante;
  - ser área participante no da edición;
  - `manage_all` gestiona todo.

### 5.1 Recurrencia: decisión (Navigator + Designer + Atlas)

**Entra en la preview:**
- el modelo completo: `none | weekly | biweekly | monthly` con `until` inclusivo y obligatorio, como máximo 12 meses y 60 ocurrencias;
- la regla mensual como "n-ésimo día de la semana del mes" (1.º–4.º o último);
- la expansión exacta de ocurrencias en fechas locales, con tests de fechas verificadas;
- "Editar toda la serie";
- "Cancelar solo esta fecha" (una excepción con motivo);
- "Cancelar la serie desde hoy" (`seriesCancellation`: las ocurrencias pasadas quedan como realizadas y las futuras como canceladas).

**Queda para el siguiente slice** (visible, deshabilitado y con la pill Propuesta):
- "Editar solo esta fecha";
- "Esta y las siguientes" (dividir la serie);
- "Mismo día N de cada mes".

**Enmienda de Atlas:** en una serie que ya empezó, "Editar toda la serie" **no** permite cambiar día, hora ni frecuencia, porque reescribiría el historial. Ese caso es justamente "Esta y las siguientes".

**Motivo:** cancelar una fecha (lluvia, feriado) es el caso real más frecuente y su modelo es trivial y correcto. Dividir una serie es donde aparecen los bugs, y el brief pide no implementar una recurrencia incorrecta. Las actividades de varios días (campamento) no son recurrentes; las que cruzan la medianoche (vigilia 22:00–02:00) sí pueden serlo.

### 5.2 Calendario compartido

- **Ruta:** `/preview/calendario/compartir/demo` (en producción, `/calendario/compartir/{token}`). Sin login y sin el shell de la app.
- **Funciones:** Agenda y Mes, filtro por área y detalle público.
- **Proyección por lista blanca** (`toPublicEvent`, nunca con spread). Solo se publican:
  - título, fechas y horas;
  - lugar y descripción pública;
  - área responsable y áreas participantes (slug, nombre y color);
  - estado `programada | cancelada`, sin motivo.
- **Nunca se publican:** actividades "solo equipo" o archivadas, notas internas, motivos, correos, ids internos, permisos, Integrantes ni finanzas.
- **Administración** (`manage_all`): Copiar, Regenerar (el enlace anterior deja de funcionar) y Desactivar.
- **Enlace inválido o desactivado:** muestra lo mismo, "Este calendario no está disponible".
- **Producción:** una Function que verifica el hash del token y aplica la misma proyección. **Nunca** una colección pública. Ver 16c §D.8.

### 5.3 Reportes

- **Reportes es un módulo** con dos secciones:
  - **Finanzas:** el reporte de V2, con `finance.details.read`;
  - **Calendario:** con `calendar.read`.
- El Líder ve solo Calendario.
- **Reporte de calendario:**
  - **filtros:** período, área (responsable o participante, con la opción "solo responsable"), estado y visibilidad;
  - **orden:** por fecha, primero las de todo el día y después por hora;
  - **columnas:** fecha · hora · actividad · área responsable · participantes · lugar · estado · descripción pública.
- **"Descargar PDF":** se genera localmente con jspdf (ya está en las dependencias, se importa de forma dinámica y no usa red). Es A4 horizontal, con el rótulo "Vista previa · datos de demostración" y sin notas internas.

## 6. Integrantes › Consolidación

**Una identidad por persona.** `Person` tiene dos conceptos separados:
- `lifecycleStage` (`en_consolidacion → integrante`, y a futuro miembro, inactivo…) dice **dónde está** la persona;
- `consolidationStatus` dice **en qué va** su acompañamiento.

Pasar a Integrado cambia la etapa sin crear otra entidad. No habrá migración desde un sistema aislado de "personas nuevas".

**Pipeline** (5 estados guardados; nada cambia sin confirmación):

| Estado | Tipo |
|---|---|
| Por contactar | Inicial, automático al registrar |
| En seguimiento | **Sugerido**: el primer seguimiento con resultado "contactado" lo propone ya marcado, y quien guarda lo confirma |
| Integrándose | Manual |
| Integrado | Manual con confirmación; cambia la etapa a integrante |
| Sin continuidad | Manual con motivo obligatorio; "Reabrir" se sugiere si la persona vuelve |

- "Nuevo" y "Volvió" son **badges derivados** (ingreso reciente, y visita no primera reciente), no estados. Volver es un hecho, no una etapa.
- "Contactado" queda absorbido por En seguimiento.

**Registro:**
- nombre* y teléfono* (normalizado a E.164 con reglas chilenas; se aceptan extranjeros con `+`);
- nacimiento y correo;
- confesión de fe y bautizado con **3 opciones** (Sí / No / Sin información, por defecto Sin información);
- responsable y notas;
- la fecha de ingreso es automática;
- la edad **se calcula, no se guarda** (el 29-02 cumple el 28-02 en años no bisiestos);
- al crear la persona se crea su primera visita.

**Visitas y seguimientos:**
- registrar una visita **agrega** un registro, nunca sobrescribe; la cantidad y la última visita se recalculan;
- un seguimiento registra tipo, resultado, nota, próxima acción con su fecha y responsable;
- el timeline es derivado (creación, visitas, seguimientos y cambios de estado guardados).

**Alertas** (derivadas, con parámetros por defecto que en el futuro serán configurables):

| Alerta | Regla |
|---|---|
| Sin responsable | No tiene un responsable válido |
| Sin primer contacto | Más de **48 h** desde el ingreso sin un contacto exitoso |
| Seguimiento vencido | La próxima acción tenía fecha anterior a hoy |
| Cumpleaños próximo | En los próximos **14** días |
| Volvió | Visita no primera en los últimos **7** días, sin seguimiento posterior |
| Varios días sin volver | Más de **21** días desde la última visita |
| Posible duplicado | El mismo teléfono normalizado o el mismo correo. **Nunca bloquea** el registro |

"No contactar" oculta WhatsApp y las alertas, salvo las de duplicado.

**Dashboard: 3 indicadores** (Designer), cada uno con link a la lista filtrada:
- Nuevos del mes;
- Sin primer contacto;
- Seguimientos vencidos.

Debajo van las secciones Necesitan atención (una fila por persona, ordenada por prioridad) · Cumpleaños próximos · Nuevos recientes · Seguimientos pendientes · Volvieron.

**Lista:** búsqueda, filtros y orden. En desktop es una tabla con las 9 columnas del brief; en móvil, una lista de 2–3 líneas con acciones rápidas (Registrar visita · Seguimiento · WhatsApp · Ver ficha).

**WhatsApp:** en la preview el botón **simula** y muestra el número. Los teléfonos ficticios podrían pertenecer a personas reales, así que no se navega a `wa.me`.

**Futuros submódulos** (Directorio, Miembros, Ministerios, Familias, Asistencia): el modelo los permite, pero **no se muestran** en la preview.

## 7. Privacidad (mínimo acceso)

- Los datos de Integrantes solo se ven con `members.consolidation.*`. Con solo `calendar.read` no aparece ningún dato, conteo ni ruta de Integrantes.
- La página pública solo recibe la proyección sanitizada. Un test verifica que no contenga ninguno de los "canarios" de las fixtures: notas internas, motivos, títulos archivados, correos, teléfonos ni nombres.
- Las notas internas de una actividad las ve todo `calendar.read`. En producción el campo debe advertir "No escribas datos personales de integrantes".
- **Bloqueante de producción:** la confesión de fe y el bautismo son datos sensibles (creencias religiosas) y se registran menores. Antes del backend hay que revisar la base de licitud, la finalidad, la retención y el consentimiento del adulto responsable con asesoría legal (Ley 21.719, vigente desde diciembre de 2026). Ver 16c §I.3.

## 8. Rutas de la preview

| Ruta | Pantalla | Acceso |
|---|---|---|
| `/preview` | Ingreso simulado | — |
| `/preview/finanzas-2026/*` | Financial UX V2 (sin cambios de contenido) | `finance.details.read` |
| `/preview/finanzas-2026/resumen` | Resumen financiero agregado | `finance.summary.read` |
| `/preview/calendario` (`?vista=mes\|semana\|agenda`) | Calendario global | `calendar.read` |
| `/preview/calendario/mis-actividades` | Mis actividades | `manage_assigned` |
| `/preview/calendario/compartir` | Administración del enlace | `manage_all` |
| `/preview/calendario/compartir/demo` (`?t=`) | Calendario público | público |
| `/preview/integrantes` | Redirige al primer submódulo (Consolidación) | `consolidation.read` |
| `/preview/integrantes/consolidacion` | Dashboard | `consolidation.read` |
| `/preview/integrantes/consolidacion/atencion` | Necesitan atención | `consolidation.read` |
| `/preview/integrantes/consolidacion/personas` | Lista | `consolidation.read` |
| `/preview/integrantes/consolidacion/nueva` | Nueva persona | `consolidation.manage` |
| `/preview/integrantes/consolidacion/persona?id=…` | Ficha | `consolidation.read` |
| `/preview/integrantes/consolidacion/ajustes` | Parámetros de alertas (solo lectura) | `consolidation.read` |
| `/preview/reportes` | Redirige a la primera sección permitida | `details` o `calendar.read` |
| `/preview/reportes/finanzas` | Reporte financiero de V2 | `finance.details.read` |
| `/preview/reportes/calendario` | Reporte de calendario + PDF | `calendar.read` |
| `/preview/configuracion` | Redirige a Áreas | `settings.manage` |
| `/preview/configuracion/areas` | Áreas | `settings.manage` |
| `/preview/configuracion/usuarios` | Usuarios y permisos | `settings.manage` |
| `/preview/configuracion/finanzas` | Integraciones y días de culto (contenido de V2) | `settings.manage` |

## 9. Shell global

- **Sidebar (≥1280):** una lista de módulos con el módulo activo expandido; solo aparecen los módulos permitidos. La marca pasa a "Casa de Salvación · CDS Suite".
- **Rail (768–1279):** los módulos, un divisor y las secciones del módulo activo, con tooltips.
- **Móvil:** top bar con el selector de módulo y bottom bar calculada por `bottomTabs(módulo, perfil)` (entre 3 y 5 ítems, con "+ Crear" o "+ Nueva" solo si el perfil puede).
- **"Ver como"** (simulador de perfil): vive en el banner gris de demostración, con borde dashed. Nunca va en la sidebar, porque es una herramienta de la preview y no del producto.

Finanzas se ve igual que en V2, salvo la marca, la lista de módulos y el banner de 40 px.

## 10. Conciliación del Conductor (manda sobre 16a, 16b y 16c)

| # | Tema | Conflicto | Resolución |
|---|---|---|---|
| R1 | Parámetro del perfil | Designer `?como=`, Atlas `?perfil=` | **`?perfil=`** con slugs: `admin`, `pastor`, `lider`, `diacono`, `finanzas`, `consolidacion`, `sin-permisos`, `lider-fallback` |
| R2 | Ruta de la ficha | Brief `/{persona-demo}`, Atlas `persona?id=` | **`persona?id=`**: el export estático no admite ids creados en la sesión |
| R3 | Token inválido | Designer `/compartir/{inválido}`, Atlas `?t=` | **`/compartir/demo?t=`** |
| R4 | Resumen del Líder | Designer: modo resumen dentro de `/finanzas-2026`; Atlas: ruta `/resumen` | **Ruta `/preview/finanzas-2026/resumen`** con el contenido de 16b §3.8. La guardia lleva al Líder de Hoy a Resumen |
| R5 | Reportes y Configuración de Finanzas | Designer los saca de la subnav financiera (con redirecciones); Atlas los deja en Finanzas con un hub. El test de PR #3 exige que la nav "Finanzas" tenga links que empiecen con "Reportes" y "Configuración" | **Viven en los módulos globales:** `/preview/reportes/finanzas` y `/preview/configuracion/finanzas`. La subnav financiera conserva **atajos** "Reportes financieros ↗" y "Configuración financiera ↗" (este último solo con `settings.manage`) que llevan a esas rutas. Las rutas viejas `/finanzas-2026/reportes` y `/configuracion` redirigen. El test se cumple sin tocarlo y sin duplicar pantallas |
| R6 | Días de culto | Designer: sección propia en Configuración | **Dentro de "Finanzas e integraciones"**, como en V2. Reduce rutas sin perder contenido |
| R7 | Consolidación › Atención | No estaba en el árbol de Atlas | **Se agrega** `/consolidacion/atencion` (16b §3.1) |
| R8 | WhatsApp | El brief pide "Abrir WhatsApp" | **Se simula** (Atlas 16c §F): el toast muestra el número. `waLink()` existe y tiene test |
| R9 | Nota interna con un nombre ficticio (fixture de Navigator) | Atlas: rompe el criterio 30 | **Se usa un canario**, nunca un nombre de persona |
| R10 | Preguntas de Designer (16b §16.3) | — | Se aceptan los defaults: "Llegó a" como select opcional; `manage_assigned` no archiva actividades pasadas; el atajo móvil es el primer otro módulo permitido; "Agradecer" como CTA de "Volvió" (**a validar por Salvador**) |
| R11 | Preguntas de Navigator (16a §K) y de Atlas | — | Se aplican los defaults de cada uno; quedan listados en §11 para que Salvador los valide |

## 11. Decisiones que Salvador debe validar

1. Pipeline de 5 estados, con "Nuevo" y "Volvió" como badges derivados.
2. Pastor y Finanzas siguen escribiendo en finanzas (`finance.records.manage`).
3. Finanzas y Consolidación ven el Calendario en lectura.
4. Un Líder publica actividades sin aprobación.
5. Parámetros de alertas: 48 h, 21 días, 14 días.
6. Consolidación ve a todas las personas, no solo a las asignadas.
7. Menores: no hay campo de adulto responsable en la preview (riesgo legal, §7).
8. Módulo inicial del Pastor nuevo: Calendario.
9. Sin `?perfil` se entra como Administración.
10. Rutas `persona?id=` y `compartir/demo?t=` en lugar de los segmentos literales del brief.
11. CTA "Agradecer" para una persona que volvió.
12. Recurrencia: lo que entra y lo que queda para el siguiente slice (§5.1).

## 12. Plan de construcción

1. **Base:** lógica pura en `lib/suite-preview` con sus tests, fixtures y store; shell global, provider, guardia de acceso, layouts, ingreso, rutas y guardia de deploy.
2. **En paralelo:** Calendario (vistas, detalle, formulario, recurrencia, compartir, página pública, reporte y PDF) · Consolidación (dashboard, lista, ficha, nueva persona, visita, seguimiento, estado, ajustes) · Configuración (áreas y usuarios), Resumen financiero y Reportes › Finanzas.
3. Capturas a 1440, 1280, 1024, 768, 390 y 375, con métricas automáticas de overflow (página y contenedor), consola y jerga.
4. Revisión de Designer (visual) y de Atlas (código e invariantes); hasta 3 ciclos de corrección.
5. Gates: lint, typecheck, `npm test`, `npm run build` ×2 y la guardia de deploy.

Los resultados se documentan en el doc 17.

## 13. Qué necesita producción

Es el checklist completo de 16c §I:
- **Reglas:** v2 con doble lectura y las colecciones `areas`, `calendarEvents`, `calendarShareLinks` y `people/**`.
- **Functions:** `calendarPublicFeed` y la supresión o anonimización de personas.
- **Hosting:** rewrites.
- **Índices.**
- **Migración:** backfill de usuarios idempotente, con aprobación humana.
- **Desnormalización** con consistencia en reglas.
- **Auditoría** en el mismo batch.
- **Zona horaria** America/Santiago.
- **Asesoría legal** sobre datos sensibles y menores.
- **Vínculo futuro** entre `titheProfiles` y `Person` (Directorio), sin exponer diezmos a Consolidación.
