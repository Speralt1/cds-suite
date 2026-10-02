# Calendario + Integrantes / Consolidación: modelo de producto (Navigator)

**Estado:** propuesta. Salvador la valida y después pasa a Designer, Atlas y Builder.
**Fuentes:** el brief de la misión, PROJECT_CONTEXT, los docs 14 y 15, y el código actual (`lib/finance/types.ts`, `lib/finance/permissions.ts`, `lib/settings/users.ts`, `lib/auth/access-provider.tsx`, `components/settings/users-permissions-panel.tsx`, `firestore.rules`, `components/finance/shared.tsx`, `components/finance/dashboard/summary-page.tsx`).
**Convenciones:** FACT = está en el brief o en el código. HYPOTHESIS = supuesto mío, hay que confirmarlo. RISK = riesgo. REC = recomendación.

## 0. Lo que hay hoy (FACT, verificado en el código)

- **Roles:** hay 4 roles fijos (`admin | pastor | finance | leader`) en `users/{uid}`. No existen permisos, áreas ni módulo inicial.
- **Funciones de las reglas (`firestore.rules`):**
  - `details()` cubre admin, pastor y finance. Lee y escribe movimientos, diezmos, campañas y ofrendas.
  - `pastoral()` cubre admin y pastor. Da acceso a `pastoralFollowups`.
  - `approved()` cubre los 4 roles. Permite leer `financeMonthlySummaries`; por eso el leader ve los KPIs.
- **Navegación:**
  - todos los roles aterrizan en `/finanzas` (`app/page.tsx`, `app/login/page.tsx` y `dashboard/page.tsx`);
  - el leader solo ve Finanzas › Resumen (KPIs de totales);
  - Configuración es solo para admin (`settings-guard.tsx`);
  - Reportes financieros está detrás de `DetailGuard` (detalle).
- **Personas en finanzas:** ya existen entidades de persona, `titheProfiles` (que tiene `pastoralContactAuthorized`) y `pastoralFollowups`.
- **Preview:** `DEMO_TODAY = "2026-10-04"` vive en `lib/finance-preview/fixtures.ts`. La persona demo de finanzas es "M. Soto".

## A. Actores y jobs-to-be-done

| Actor | Job principal | Al iniciar sesión necesita |
|---|---|---|
| **Administrador** | Mantener la operación: usuarios, áreas, permisos y finanzas completas. | Llegar a su módulo inicial configurable (por defecto Finanzas, por compatibilidad). Tener acceso a todo y a Configuración. |
| **Pastor** | Ver la iglesia completa: agenda, personas nuevas y finanzas. No administra el sistema. | Ver el calendario global y gestionar cualquier actividad. Ver Consolidación completa y Finanzas con detalle. No tiene Configuración. |
| **Líder / Diácono** | Programar y mantener al día las actividades de su área. Conocer el estado financiero general. | Llegar a Calendario, a "Mis actividades" de sus áreas, con un botón "Crear actividad". Ver el resumen financiero en cifras agregadas. |
| **Finanzas** | Registrar y controlar el dinero. | Llegar a Finanzas (Hoy). Además, Calendario en lectura para saber qué cultos y eventos hay. |
| **Consolidación** | Que ninguna persona nueva quede sin contacto ni seguimiento. | Llegar directo a `/integrantes/consolidacion`: el dashboard con "Necesitan atención" y la acción "Nueva persona". Nunca pasa por un selector de módulo. |
| **Visitante público** | Saber qué actividades hay y cuándo. | Abrir el link compartido sin login, en solo lectura, con filtro por área y detalle público. |

## B. Modelo de acceso

### B.1 Composición

`AccessProfile = baseRole + cargo + permissions[] + areaIds[] + initialModule`

- **baseRole:** `admin | standard`.
  - `admin` recibe implícitamente **todo** el catálogo, incluido `settings.manage`.
  - `standard` recibe solo los permisos que tiene guardados.
  - **Invariante:** `settings.manage` está entre los permisos efectivos si y solo si `baseRole = admin`. Así nadie puede darse privilegios a sí mismo desde Usuarios.
- **cargo:** es una etiqueta humana y un *preset*. Valores: `Administración | Pastor | Líder | Diácono | Finanzas | Consolidación`.
  - Elegir un cargo propone sus permisos y su módulo inicial; después se pueden editar.
  - Cambiar el cargo vuelve a proponer el preset, pide confirmación y nunca sobrescribe en silencio.
  - Cada usuario tiene **un cargo**. Varios cargos queda para LATER: los casos mixtos se resuelven agregando permisos.
- **permissions:** se guardan como lista. Siempre se evalúa el **cierre**:
  - `finance.details.read` implica `finance.summary.read`;
  - `finance.records.manage` y `finance.pastoral.manage` implican `finance.details.read`;
  - `calendar.events.manage_all` implica `calendar.events.manage_assigned`, y esta implica `calendar.read`;
  - `members.consolidation.manage` implica `members.consolidation.read`.
- **areaIds:** las áreas asignadas. Solo dan poder junto con `manage_assigned`.
- **initialModule:** `finanzas | calendario | integrantes/consolidacion`.

### B.2 Catálogo de permisos

| Permiso | Qué habilita | Origen |
|---|---|---|
| `finance.summary.read` | Finanzas › Resumen con cifras agregadas, sin drill-down ni nombres. | Brief |
| `finance.details.read` | Movimientos, Ofrendas, Cafetería, Diezmos, Campañas, Caja, Atención y Reportes financieros. | Brief |
| `finance.records.manage` | Registrar, editar y anular movimientos, diezmos y campañas. | **Agregado.** Hoy `details()` lee **y** escribe. Sin este permiso la migración perdería o regalaría escritura. |
| `finance.pastoral.manage` | Seguimiento pastoral en fichas de diezmo (`pastoralFollowups`). | **Agregado (compatibilidad).** Es lo único que hoy distingue a pastor de finance. En la preview es solo de compatibilidad, sin UI nueva. |
| `calendar.read` | Calendario global, incluidas las actividades "solo equipo", y el reporte de calendario. | Brief |
| `calendar.events.manage_assigned` | Crear, editar, cancelar y eliminar actividades cuyo **área responsable** sea una de mis áreas activas. | Brief |
| `calendar.events.manage_all` | Gestionar todas las actividades y el enlace público (copiar, regenerar, desactivar). | Brief. Decisión: el enlace público no tiene permiso propio. |
| `members.consolidation.read` | Ver la lista, la ficha, el timeline, el dashboard y las alertas. | Brief |
| `members.consolidation.manage` | Registrar personas, visitas y seguimientos, cambiar el estado, asignar responsable y ajustar los parámetros de alertas. | Brief |
| `settings.manage` | Usuarios, Áreas y la configuración de finanzas e integraciones. | Brief (solo admin) |

**Descartado: `members.consolidation.read_assigned`.**
- El equipo es chico y el responsable rota.
- Ver solo "mis personas" crea puntos ciegos justo en las alertas "sin responsable".
- Queda para LATER si el equipo crece. Atlas debe dejar el modelo preparado (el campo `followUpOwnerUid` ya existe).

### B.3 Presets por cargo

| Cargo | baseRole | Permisos | Áreas | Módulo inicial |
|---|---|---|---|---|
| Administración | admin | todos | opcional | finanzas (configurable) |
| Pastor | standard | `finance.summary.read`, `finance.details.read`, `finance.records.manage`, `finance.pastoral.manage`, `calendar.events.manage_all`, `members.consolidation.manage` (con sus implicados) | opcional | calendario |
| Líder / Diácono | standard | `finance.summary.read`, `calendar.events.manage_assigned` | **al menos 1** (si falta, se advierte) | calendario |
| Finanzas | standard | `finance.records.manage` (implica details y summary), `calendar.read` | — | finanzas |
| Consolidación | standard | `members.consolidation.manage`, `calendar.read` | opcional | integrantes/consolidacion |

**Pastor frente a Admin:** la única diferencia funcional es `settings.manage` (Usuarios, Áreas y Configuración). Es FACT del brief y coincide con el código actual.

### B.4 Migración de los 4 roles actuales

| Rol hoy | Pasa a | Módulo inicial |
|---|---|---|
| `admin` | baseRole admin, cargo Administración | finanzas (igual que hoy) |
| `pastor` | preset Pastor | **finanzas**: se conserva la experiencia actual hasta que la persona lo cambie |
| `finance` | preset Finanzas | finanzas |
| `leader` | preset Líder (`summary` + `manage_assigned`). Sin áreas hasta que el admin las asigne; mientras tanto solo puede leer el calendario, y Usuarios muestra "Sin áreas asignadas". | calendario (lo dice el brief) |

RISK para Atlas:
- `access-provider` (`isAuthorized` y el `key` por `role`) y las reglas (`validUser` con `hasOnly`, `details()`) dependen de `role`.
- La producción necesita una transición con doble lectura: mantener `legacyRole` hasta que las reglas lean `permissions`.

### B.5 Reglas de `manage_assigned`

1. Puedo crear una actividad solo con `responsibleAreaId ∈ misÁreas activas`.
2. Puedo editar, cancelar o eliminar una actividad solo si su responsable está hoy en `misÁreas activas`.
3. Ser **área participante no da edición**. La actividad aparece en "Mis actividades" en solo lectura.
4. No puedo cambiar el área responsable a una que no sea mía.
5. Puedo agregar como participantes áreas que no son mías: es informativo. HYPOTHESIS.
6. Las actividades pasadas (fecha anterior a hoy) son de solo lectura para `manage_assigned`. `manage_all` puede corregirlas.
7. Si el área se desactiva, `manage_assigned` pierde la edición de esas actividades. `manage_all` la conserva.

### B.6 Visibilidad de módulos

Un módulo está visible si y solo si el usuario tiene algún permiso efectivo de ese módulo:

- **Finanzas:** `finance.summary.read`. Con solo summary se ve únicamente Resumen.
- **Calendario:** `calendar.read`.
- **Integrantes:** `members.consolidation.read`. El índice redirige al primer submódulo permitido, que hoy solo es Consolidación.
- **Reportes:** `finance.details.read` **o** `calendar.read`.
  - La sección financiera requiere `finance.details.read`, igual que el `DetailGuard` actual.
  - La sección calendario requiere `calendar.read`.
  - **Decisión:** el Líder ve Reportes solo con el reporte de calendario. **No** ve el resumen financiero en Reportes; ya lo tiene en Finanzas › Resumen y los reportes incluyen categorías y detalle.
- **Configuración:** `settings.manage`.
- Los parámetros de alertas de Consolidación viven en Integrantes › Consolidación › Ajustes, con `members.consolidation.manage`. No están en Configuración.

Un deep link a un módulo no permitido redirige al módulo inicial resuelto y muestra el aviso "No tienes acceso a {módulo}".

### B.7 Resolución del módulo inicial (algoritmo exacto)

```
1. Si no hay perfil o active=false: pantalla "Tu cuenta no tiene acceso autorizado" (la actual).
2. eff = (baseRole=admin) ? CATÁLOGO : cierre(permissions)
3. permitidos = [finanzas, calendario, integrantes/consolidacion, reportes, configuracion]
              filtrados por B.6 (el orden fijo es el de la navegación)
4. Si permitidos está vacío: pantalla "Tu cuenta está activa, pero aún no tiene módulos asignados.
   Pide al administrador que te asigne permisos." + Cerrar sesión. Sin redirección y sin loop.
5. Si initialModule ∈ permitidos: usar initialModule.
6. Si no, si preset(cargo).initialModule ∈ permitidos: usar ese.
7. Si no: permitidos[0].
```

- En la práctica el paso 7 nunca termina en Reportes ni en Configuración, porque esos módulos implican Finanzas o Calendario.
- El `initialModule` inválido **no se reescribe en silencio**. Usuarios muestra: "El módulo inicial ya no está permitido; se abrirá {X}".
- Al guardar, la UI solo ofrece módulos permitidos.

## C. Entidades de dominio

**Convenciones comunes:**
- auditoría `createdBy/At` y `updatedBy/At`;
- `revision` en las entidades editables;
- **nunca se borra físicamente** (como `allow delete: if false` hoy);
- todas las fechas y horas se guardan **locales a America/Santiago** (`YYYY-MM-DD`, `HH:mm`) y no como instantes UTC. Así los cambios de horario de Chile (septiembre y abril) no corren las recurrencias.

### Area
- **Campos:** `id` (slug estable), `name` (1–40, único sin distinguir mayúsculas), `color` (token de una paleta cerrada de unos 10 colores con ≥3:1 sobre blanco), `description?` (≤200), `active`, `order`, auditoría.
- **Invariantes:**
  - el color es único entre las áreas activas;
  - un área referenciada no se elimina, solo se desactiva;
  - un área inactiva no se puede elegir para actividades nuevas, pero las existentes conservan su nombre y color;
  - el nombre siempre acompaña al color (nunca solo color).

### AccessProfile (`users/{uid}`)
- **Campos:** `uid`, `displayName`, `email` (minúsculas, inmutable), `active`, `baseRole`, `cargo`, `permissions[]`, `areaIds[]`, `initialModule`, `legacyRole?` (transición), auditoría.
- **Invariantes:**
  - siempre hay al menos 1 admin activo;
  - nadie puede quitarse a sí mismo admin ni desactivarse (FACT, ya existe);
  - `permissions` es subconjunto del catálogo;
  - `settings.manage` solo con admin;
  - `areaIds` solo contiene áreas existentes;
  - `manage_assigned` sin áreas es válido, pero muestra advertencia.

### CalendarEvent
- **Campos:**
  - `id`, `title*` (1–120), `responsibleAreaId*`, `participantAreaIds[]` (únicas, sin el responsable, máx. 8);
  - `startDate*`, `endDate` (por defecto = `startDate`, ≥ `startDate`; cubre campamentos y vigilias que cruzan medianoche);
  - `allDay`; `startTime` (obligatorio si `!allDay`) y `endTime?` (fin > inicio cuando `endDate = startDate`);
  - `location?` (≤120), `publicDescription?` (≤1000), `internalNotes?` (≤1000, nunca público);
  - `visibility: public | team` (por defecto **team**);
  - `status`; `recurrence`; `seriesId?`; auditoría;
  - `cancelledBy/At/Reason`, `archivedBy/At/Reason`, `revision`.
- **Recurrencia (`RecurrenceRule`):**
  - `{ freq: none | weekly | biweekly | monthly, until: date (inclusive, obligatoria si freq ≠ none, máx. 12 meses desde el inicio), monthly?: { weekday, ordinal: 1|2|3|4|-1 } }`;
  - **weekly:** cada 7 días desde el inicio. **biweekly:** cada 14 días;
  - **monthly:** "n-ésimo {día de semana} del mes" (por ejemplo "primer sábado"). Las iglesias se rigen por días de semana y así se evita el problema del día 31;
  - si la fecha de inicio cae en la 5.ª semana, se guarda `-1` ("último");
  - si cae en la 4.ª y además es la última del mes, el formulario ofrece "cuarto" o "último";
  - `exceptions[]`: `{date, type: cancelled, reason}`.
- **Auditoría:** `EventChange { at, by, action: created | updated | cancelled | archived, changedFields[] }`. Se guarda.

### CalendarShareLink
- **Campos:** `id`, `token` (≥128 bits aleatorios, url-safe), `active`, `createdAt/By`, `regeneratedAt/By?`, `deactivatedAt/By?`.
- **Invariantes:**
  - hay como máximo 1 enlace por iglesia;
  - al regenerar, el token anterior queda inválido de inmediato;
  - "Activar" después de desactivar **genera un token nuevo**.
- **Producción:** proyección sanitizada (ver E.3). Nunca una colección pública con la data interna.

### Person (identidad única en todo su ciclo de vida)
- **Campos:**
  - `id`, `fullName*` (1–120);
  - `phoneE164*` y `phoneRaw` (lo que se escribió);
  - `email?` (normalizado), `birthDate?`;
  - `faithConfession` y `baptized`: `si | no | sin_informacion` (por defecto `sin_informacion`; en la UI son 3 opciones explícitas, nunca un checkbox);
  - `entryDate` (= fecha local de creación, inmutable en la preview), `initialNotes?`, `followUpOwnerUid?`;
  - `lifecycleStage`, `consolidationStatus`, `closedReason?`, `doNotContact` (bool), auditoría.
- **Dos conceptos separados:**
  - **`lifecycleStage`** dice dónde está la persona en la iglesia: `en_consolidacion | integrante`. A futuro: `miembro`, `inactivo`, `trasladado`. Decide en qué submódulos aparece.
  - **`consolidationStatus`** dice en qué punto va el acompañamiento (ver D.2). Solo cambia mientras `lifecycleStage = en_consolidacion`.
  - **Único acoplamiento:** pasar a `Integrado` cambia `lifecycleStage` a `integrante`.
- **Derivados (no se guardan):** `age`, `visitCount`, `lastVisitDate`, `nextAction`, `alerts`, `isMinor` (edad < 18).

### Visit
- **Campos:** `id`, `personId`, `date` (≤ hoy), `activityEventId?` (actividad del calendario de esa fecha) o `activityLabel` (texto, por ejemplo "Culto domingo"), `note?` (≤500), `voided`, `voidReason?`, auditoría.
- **Invariantes:**
  - al crear la persona se crea la **primera visita** con `date = entryDate`;
  - una visita nueva **nunca modifica** otra;
  - una visita registrada por error se anula con motivo y no se borra;
  - si se repite la misma persona, fecha y actividad, se advierte (no se bloquea).

### FollowUp (contacto o seguimiento)
- **Campos:**
  - `id`, `personId`, `date` (≤ ahora);
  - `type: whatsapp | llamada | presencial | otro`;
  - `result: contactado | sin_respuesta | numero_invalido | no_desea_contacto | otro`;
  - `note?` (≤1000), `nextAction?` (≤200), `nextActionDate?` (≥ `date`), `ownerUid` (responsable de la próxima acción; por defecto el responsable de la persona), auditoría.
- **Invariantes:**
  - la próxima acción vigente de la persona es la del **FollowUp más reciente**; uno nuevo la reemplaza;
  - `no_desea_contacto` propone `doNotContact = true` y "Sin continuidad".

### TimelineEvent: **derivado, no se guarda**
Es una vista que ordena por fecha (más nuevo primero) estos registros guardados:
- la creación de la persona y la primera visita;
- las visitas;
- los seguimientos;
- los `PersonChange` (sí se guardan): `{at, by, field: status | owner | faithConfession | baptized | stage, from, to, reason?}`.

Sin `PersonChange` el historial de estados no se puede reconstruir. Por eso se guarda.

### Alert: **derivada**
`{type, personId, severity, since, detail}`. Se calcula al leer y no se guarda. "Posponer" y "descartar" quedan para LATER.

### ConsolidationSettings
| Parámetro | Por defecto | Rango |
|---|---|---|
| `firstContactMaxHours` | 48 | 12–168 |
| `noReturnDays` | 21 | 7–90 |
| `birthdayLeadDays` | 14 | 1–31 |
| `recentNewDays` | 14 | 7–60 |
| `returnedRecentDays` | 7 | 1–30 |

- Las edita `members.consolidation.manage`. En la preview se muestran en solo lectura.
- **Edad:** años cumplidos entre `birthDate` y hoy (Santiago). Sin fecha de nacimiento se muestra "—".
- **Validación de `birthDate`:** no puede ser futura y no puede ser de hace más de 110 años.

## D. Estados

### D.1 CalendarEvent

| Estado | Guardado | Significado | Dónde se ve |
|---|---|---|---|
| `programada` | sí | Vigente. | En todas partes. |
| *Realizada* | **derivado** | `programada` con fin < ahora. Solo se muestra; no es editable para `manage_assigned`. | En todas partes. |
| `cancelada` | sí | No se realiza. Exige motivo (3–300, interno). | En calendario y reportes, tachada con "Cancelada". En público, solo el rótulo "Cancelada", sin motivo. |
| `archivada` | sí | "Eliminar": creada por error o duplicada. Exige motivo. | En ninguna vista. Solo en la auditoría del admin. |

- **Transiciones:**
  - `programada → cancelada` solo si la actividad es de hoy o futura;
  - `programada | cancelada → archivada`.
  - "Confirmada" queda descartada: no aporta.
  - "Reactivar" una cancelada queda para LATER.
- **Serie recurrente:** "Cancelar solo esta" agrega una excepción. "Cancelar la serie" cancela las ocurrencias desde hoy; las pasadas siguen como Realizadas.

### D.2 Pipeline de Consolidación (final, 5 estados guardados)

| Estado | Tipo | Entrada |
|---|---|---|
| **Por contactar** | Inicial, automático al registrar. | — |
| **En seguimiento** | **SUGERIDO** | El primer FollowUp con `result = contactado` hace que el formulario muestre "Cambiar a En seguimiento" ya marcado. Lo confirma quien guarda. |
| **Integrándose** | MANUAL | Participa en un área o discipulado. |
| **Integrado** | MANUAL, con diálogo de confirmación. | Cambia `lifecycleStage` a `integrante` y cierra la consolidación activa. |
| **Sin continuidad** | MANUAL, con motivo obligatorio: no responde · se cambió de iglesia · se mudó · no desea contacto · otro. | Cierra el caso. |

**Mapeo desde la referencia de 8 estados:**
- "Nuevo" pasa a ser un **badge derivado**: ingreso hace ≤ `recentNewDays` días.
- "Contactado" queda absorbido por En seguimiento.
- "Volvió" pasa a ser un **badge y una alerta derivados**: la última visita no es la primera y fue hace ≤ `returnedRecentDays` días.
- Motivo: volver es un **hecho** (una visita), no una etapa. Si fuera estado, cambiaría solo o quedaría desactualizado.

**Transiciones permitidas:**
- avanzar o retroceder entre los estados activos: MANUAL, registrado en `PersonChange`;
- Sin continuidad → En seguimiento ("Reabrir"): MANUAL. **Se sugiere** al registrar una visita de una persona cerrada (banner "Esta persona volvió. ¿Reabrir seguimiento?");
- Integrado → reabrir: LATER, pertenece a Integrantes.

**Regla general:** el sistema **nunca cambia un estado en silencio**. Solo sugiere dentro de una acción que el usuario confirma.

## E. Reglas de negocio

### E.1 Actividades
- **Quién gestiona:** crear, editar, cancelar y eliminar siguen B.5. `manage_all` puede gestionar todo.
- **Color:** **heredado** del área responsable. Las participantes se muestran como chips pequeños, sin gradientes.
- **Visibilidad:** `team` lo ven todos los usuarios con `calendar.read` (no se restringe por área; las actividades privadas por área quedan para LATER). `public` además se publica en el enlace.
- **Quién publica:** cualquier gestor puede marcar una actividad como pública. HYPOTHESIS: no hace falta aprobación. Un flujo de aprobación queda para LATER.

### E.2 Recurrencia: recomendación para que Designer y Atlas cierren
- **En la preview:**
  - el modelo completo;
  - el selector de las 4 opciones con fecha final;
  - la expansión correcta de las ocurrencias en las fixtures, cubierta con tests unitarios: weekly, biweekly, monthly con ordinal 1–4 y −1, `until` inclusivo y cruce de mes;
  - "Editar toda la serie";
  - "Cancelar solo esta" (excepción);
  - "Cancelar la serie desde hoy".
- **Siguiente slice:**
  - "Editar solo esta" (mover la hora de una ocurrencia);
  - "Esta y las siguientes" (dividir la serie);
  - "Mismo día N del mes".
- En la preview esas opciones aparecen deshabilitadas con la pill **Propuesta**.
- **Motivo:** cancelar una ocurrencia (lluvia, feriado) es el caso real más frecuente y su modelo (lista de fechas excluidas) es trivial y correcto. Dividir una serie es donde suelen aparecer los bugs.

### E.3 Enlace público: lista blanca exacta
- **Por actividad pública:** `title`, `startDate`, `endDate`, `allDay`, `startTime`, `endTime`, `location`, `publicDescription`, `responsibleArea {slug, name, color}`, `participantAreas [{slug, name, color}]`, `status ∈ {programada, cancelada}` y un id opaco de la proyección.
- **Encabezado:** "Casa de Salvación" y la lista de áreas activas que tienen actividades públicas (para el filtro).
- **Rango navegable:** desde el mes anterior hasta 6 meses adelante.
- **Nunca se publican:**
  - actividades team o archivadas;
  - `internalNotes`, el motivo de cancelación, la auditoría y los uid, nombres o correos de usuarios;
  - permisos, Integrantes y finanzas.
- **Enlace inactivo o token inválido:** "Este calendario no está disponible", sin revelar si el enlace existió.

### E.4 Personas, visitas y seguimiento
- Registrar una visita agrega un registro; la cantidad y la fecha de la última visita se recalculan.
- **"Abrir WhatsApp":** `https://wa.me/<E164 sin +>`, sin texto prellenado con datos. Se oculta si `doNotContact`. No guarda conversaciones.
- **Responsable de seguimiento:** debe ser un usuario activo con `members.consolidation.manage`. Si pierde el acceso, la persona cae en la alerta "Sin responsable".

### E.5 Duplicados
- **Teléfono:**
  1. Quitar espacios, guiones, puntos y paréntesis.
  2. Si empieza con `+`, se respeta el código de país (hay asistentes migrantes: +58, +51, +509, etc.). Válido con 8–15 dígitos.
  3. `56` + 9 dígitos se guarda como `+56XXXXXXXXX`.
  4. 9 dígitos que empiezan con 9 son celular: `+569XXXXXXXX`.
  5. 9 dígitos que empiezan con 2–8 son fijo: `+56` + dígitos.
  6. 8 dígitos son un celular antiguo: `+569` + dígitos (HYPOTHESIS).
  7. Lo demás es inválido y se rechaza con ayuda en pantalla.
  - Se muestra como `+56 9 1234 5678`.
- **Correo:** `trim` y minúsculas, sin otras transformaciones.
- **Al registrar:** si hay coincidencia, aparece una advertencia que **no bloquea**, con tres opciones: "Ver ficha existente", "Registrar visita a esa persona" o "Es otra persona, continuar". Las familias comparten teléfono.
- **Alerta persistente:** sigue mientras existan 2 personas con el mismo teléfono o correo. Descartar el par y fusionar fichas queda para LATER (Atlas).

### E.6 Alertas (por defecto)

Aplican solo a personas activas: `en_consolidacion`, estado distinto de Sin continuidad y sin `doNotContact`. Los duplicados aplican a todas.

| Alerta | Regla | Justificación |
|---|---|---|
| Sin responsable | `followUpOwnerUid` vacío o inválido. | Si nadie es dueño, nadie llama. |
| Sin primer contacto | Ningún FollowUp con `contactado` y ahora − creación > **48 h**. Muestra el n.º de intentos. | Una persona que llega el domingo se contacta antes del miércoles, a tiempo para invitarla al culto de mitad de semana. |
| Seguimiento vencido | `nextActionDate` < hoy. | — |
| Cumpleaños próximo | El próximo cumpleaños cae entre hoy y hoy + **14** días. | Abarca 2 domingos y deja tiempo para un saludo o una llamada. |
| Persona que volvió | Visita no primera en los últimos **7** días y sin FollowUp posterior. | Es positiva y urgente: hay que agradecer. |
| Varios días sin volver | Última visita hace más de **21** días. | Equivale a 3 domingos sin venir. |
| Posible duplicado (teléfono o correo) | Coincidencia normalizada. | — |

**Cumpleaños:**
- se calcula la próxima ocurrencia ≥ hoy, incluido el cruce de año;
- para el **29-02**, en años no bisiestos se usa el **28-02**, tanto para la alerta como para el cambio de edad;
- es una decisión documentada.

## F. Dashboard de Consolidación

**Indicadores** (Designer decide si son 3 o 4; cada uno lleva a la lista filtrada):
1. **Nuevos este mes**, que responde "¿Cuántas personas nuevas llegaron?".
2. **Sin primer contacto**, que responde "¿A quién no hemos contactado?".
3. **Seguimientos vencidos**, que responde "¿Quién necesita seguimiento?".
4. **Volvieron (7 d)**, que responde "¿Quién volvió?".

**Secciones:**
- **Necesitan atención:** una fila por persona, con su motivo de mayor prioridad y "+n alertas". El orden es:
  1. Sin responsable
  2. Sin primer contacto
  3. Seguimiento vencido
  4. Volvió sin seguimiento
  5. Varios días sin volver
  6. Posible duplicado
  Dentro de cada grupo, lo más antiguo o más vencido va primero. Cada fila tiene una CTA con verbo: Asignar, Contactar, Registrar seguimiento, Revisar.
- **Cumpleaños próximos** responde "¿Quién cumple años pronto?": fecha, edad que cumple y botón de WhatsApp.
- **Nuevos recientes:** ingresos de los últimos 14 días.
- **Seguimientos pendientes:** próximas acciones de los próximos 7 días. Las vencidas ya están en Atención.
- **Personas que volvieron:** visitas no primeras de los últimos 7 días.

## G. Reporte de calendario

- **Filtros:**
  - período: mes, con rango personalizado opcional;
  - área: responsable **o** participante, con el interruptor "solo responsable";
  - estado: programada, realizada, cancelada (las archivadas nunca aparecen);
  - visibilidad: todas, pública o equipo.
- **Orden:** fecha ascendente; dentro del día, primero las de todo el día y después por hora de inicio.
- **Columnas:** fecha · hora · actividad · área responsable · áreas participantes · lugar · estado · visibilidad · descripción pública.
- **Encabezado:** Casa de Salvación · período · filtros aplicados · "Generado por {nombre} el {fecha}" · conteo por estado y por área.
- **Nunca incluye** `internalNotes` ni el motivo de cancelación.
- **PDF:** generación local con jspdf si Atlas no ve riesgo de alcance. Lleva el rótulo "Vista previa · datos de demostración".

## H. Matriz de privacidad

| Dato \ permiso | sin permisos | calendar.read | manage_assigned | manage_all | fin.summary | fin.details | cons.read | cons.manage | settings |
|---|---|---|---|---|---|---|---|---|---|
| Integrantes (personas, visitas, seguimiento) | — | **—** | — | — | — | — | Ver | Ver y editar | (admin: todo) |
| Actividades team (incl. notas internas) | — | Ver | Ver + editar las de mis áreas | Ver y editar todas | — | — | — | — | ✓ |
| Actividades públicas | (enlace público) | Ver | ídem | ídem | — | — | — | — | ✓ |
| Enlace público | — | — | — | Administrar | — | — | — | — | ✓ |
| Resumen financiero (agregado) | — | — | — | — | Ver | Ver | — | — | ✓ |
| Detalle financiero y reportes financieros | — | — | — | — | — | Ver (escribir requiere `records.manage`) | — | — | ✓ |
| Usuarios, Áreas, Configuración | — | — | — | — | — | — | — | — | Administrar |

`calendar.read` por sí solo **no ve nada** de Integrantes, ni siquiera conteos. El enlace público nunca contiene datos de personas.

## I. Alcance

**IN (preview, solo fixtures):**
- shell global multimódulo y simulador de perfiles con el aterrizaje según el módulo inicial;
- Calendario: Mes, Semana, Agenda, Mis actividades, filtro por área, crear, editar, cancelar, eliminar (archivar), detalle, recurrencia según E.2;
- enlace público sanitizado y su administración;
- reporte de calendario;
- Configuración › Áreas y Usuarios con cargo, permisos, áreas y módulo inicial;
- Consolidación: dashboard, lista, ficha, nueva persona, visita, seguimiento, alertas, duplicados y ajustes en solo lectura.

**OUT (siguiente slice):**
- backend real, reglas y proyección pública;
- migración de roles;
- editar una ocurrencia o dividir una serie;
- descartar o fusionar duplicados y posponer alertas;
- `read_assigned`;
- aprobación de actividades públicas;
- reactivar una cancelada.

**FUTURE:** Directorio, Miembros, Ministerios, Familias, Asistencia (no se implementan; como mucho aparecen como "Próximamente").

RISK: `titheProfiles` (finanzas) y `Person` son dos identidades de persona. **No se fusionan ahora.** Directorio debe decidir cómo vincularlas sin exponer diezmos a Consolidación.

### Criterios de aceptación de la preview
1. Al cambiar de perfil simulado, la navegación (sidebar, rail y bottom nav) muestra solo los módulos de B.6.
2. Administración aterriza en su módulo inicial; Finanzas en `/finanzas`; Líder en `/calendario`; Consolidación en `/integrantes/consolidacion`, sin pantallas intermedias.
3. Un perfil cuyo `initialModule` ya no está permitido abre el módulo según el paso 6 o 7 de B.7, y Usuarios muestra la advertencia.
4. Un perfil activo sin permisos ve la pantalla "sin módulos asignados" y no entra en un loop de redirección.
5. Un deep link a un módulo no permitido redirige y avisa.
6. El Líder ve Finanzas › Resumen solo con cifras agregadas y no llega a Movimientos, Diezmos ni Reportes financieros.
7. El Líder ve Reportes solo con la sección Calendario.
8. Pastor ve lo mismo que Admin salvo Configuración.
9. Un Líder de Jóvenes puede crear, editar, cancelar y eliminar actividades con responsable Jóvenes, y no puede hacerlo con actividades de otra área ni donde Jóvenes solo participa.
10. El formulario del Líder solo ofrece sus áreas activas como responsable.
11. El color de la actividad es siempre el del área responsable. Las participantes son chips; no hay gradientes.
12. Un área inactiva no aparece al crear actividades; sus actividades existentes conservan su nombre y color.
13. Cancelar exige motivo y deja la actividad visible como "Cancelada". "Eliminar" exige motivo y la oculta de todas las vistas.
14. Una serie semanal, una quincenal, una mensual de "primer sábado" y una de "último viernes" generan exactamente las fechas esperadas hasta `until` inclusive.
15. "Cancelar solo esta" afecta solo a esa ocurrencia.
16. El enlace público muestra solo actividades públicas y no archivadas, con los campos de la lista blanca. Un test verifica que el output no contiene ninguna clave fuera de esa lista, ni los textos de `internalNotes` o del motivo de cancelación de las fixtures, ni correos o nombres de usuarios.
17. Un token regenerado o desactivado muestra "no disponible"; el token anterior deja de funcionar.
18. El reporte de calendario respeta los filtros, ordena por fecha y hora y no incluye notas internas.
19. La edad se calcula y nunca se guarda. Sin fecha de nacimiento se muestra "—".
20. El cumpleaños del 29-02 aparece el 28-02 en años no bisiestos.
21. Confesión y Bautizado tienen 3 opciones; el valor por defecto es "Sin información" y se conserva al guardar. Los indicadores no cuentan "Sin información" como "No".
22. Registrar una visita incrementa la cantidad, actualiza la última visita y agrega un hito al timeline sin modificar las visitas anteriores.
23. Un seguimiento con próxima acción reemplaza la acción vigente. Si `nextActionDate` < hoy, se genera "Seguimiento vencido".
24. Ningún estado cambia sin confirmación. El primer contacto exitoso propone "En seguimiento".
25. Pasar a Integrado cambia la etapa; la persona sale de las vistas activas y conserva todo su historial.
26. Cada una de las 8 alertas se dispara con su fixture y no se dispara con su contra-fixture, según los parámetros por defecto.
27. "Necesitan atención" respeta el orden de F, con una fila por persona.
28. `+56 9 1234 5678`, `912345678` y `56912345678` se normalizan igual y generan "posible duplicado". `+58 412…` se acepta como número extranjero.
29. Con `doNotContact` se ocultan WhatsApp y las alertas.
30. Un perfil con solo `calendar.read` no ve ningún dato, conteo ni ruta de Integrantes.
31. La preview no importa Firebase (el test de aislamiento existente se extiende a las rutas nuevas).
32. Toda acción muestra "Simulación: no se guardó nada."

## J. Guía de fixtures

- **Hoy demo:** domingo **04-10-2026 13:30** (CLST). Se reutiliza el `DEMO_TODAY` de un helper único.
- **Calendario de referencia:** el 04-10 es el **primer domingo del mes**, así que hay Santa Cena. El 03-10 es el 1.er sábado, el 05-10 el 1.er lunes y el 30-10 el último viernes.
- **Áreas** (9 activas + 1 inactiva):
  - Pastoral
  - Alabanza
  - Jóvenes
  - Niños (Escuela Dominical)
  - Damas
  - Varones
  - Intercesión
  - Multimedia (sonido y transmisión)
  - Consolidación
  - Matrimonios: **inactiva**
- **Actividades:**

| Actividad | Responsable · participantes | Cuándo | Visibilidad |
|---|---|---|---|
| Culto dominical (Santa Cena el 1.er domingo) | Pastoral · Alabanza, Multimedia, Niños | Semanal, dom 11:00–13:00 | Pública |
| Escuela dominical | Niños | Semanal, dom 11:00–12:30 | Pública |
| Culto de oración y estudio bíblico | Pastoral · Intercesión | Semanal, mié 19:30–21:00 | Pública |
| Reunión de jóvenes | Jóvenes · Alabanza | Semanal, vie 20:00–22:00 | Pública |
| Ensayo de alabanza | Alabanza · Multimedia | Semanal, sáb 17:00–19:00 | Equipo |
| Ayuno congregacional | Intercesión | Mensual, 1.er sáb 10:00–13:00 | Pública |
| Vigilia | Intercesión | Mensual, último vie 22:00–02:00 (termina al día siguiente) | Pública |
| Reunión de damas | Damas | Quincenal, mar 19:00 | Pública |
| Desayuno de varones | Varones | Mensual, 2.º sáb 09:00 | Pública |
| Reunión de líderes | Pastoral | Mensual, 1.er lun 20:00. Con `internalNotes` | Equipo |
| Reunión de consolidación | Consolidación. `internalNotes` con un nombre ficticio para el test de fuga | — | Equipo |
| Campamento de jóvenes | Jóvenes | 17–18-10, varios días | — |
| Fiesta de luz | Niños | 31-10 | — |
| Evangelismo en la plaza | — | **Cancelada** por lluvia (motivo interno) | — |
| Actividad archivada (duplicado) | — | — | — |

Sobre la recurrencia de las fixtures:
- en la reunión de jóvenes hay una ocurrencia cancelada como excepción;
- en el ensayo de alabanza, la ocurrencia del 10-10 está cancelada.

- **Usuarios (ficticios):**
  - Administración (demo);
  - Pastor Daniel Herrera;
  - Líder Matías Contreras (Jóvenes);
  - Diácono Pedro Navarro (Multimedia y Varones);
  - Finanzas Marcela Soto, que coincide con "M. Soto" del preview financiero;
  - Consolidación Carolina Vidal;
  - un usuario "Sin permisos";
  - un Líder con `initialModule = finanzas` pero sin finanzas, para probar el fallback.
- **Personas (unas 14, nombres claramente ficticios):**
  - **Teléfonos:** `+56 9 5555 01xx`.
  - **Correos:** `@demo.invalid`.
  - **Casos que deben cubrir:**
    - ingresó hoy sin responsable;
    - ingresó el 30-09 sin contacto (supera 48 h);
    - seguimiento vencido el 01-10;
    - volvió hoy (visitas 13-09, 20-09 y 04-10);
    - última visita el 06-09 (supera 21 días);
    - cumpleaños hoy, el 05-10 y el 10-10;
    - nacida el 29-02;
    - par con el mismo teléfono (madre e hijo);
    - par con el mismo correo;
    - Integrándose (Jóvenes);
    - Integrado;
    - Sin continuidad con `no_desea_contacto`;
    - teléfono +58;
    - menor de 16 años con fe y bautismo en "Sin información";
    - sin fecha de nacimiento.

## K. Preguntas abiertas para Salvador (con la decisión por defecto)

1. ¿Pipeline de 5 estados, con "Nuevo" y "Volvió" como badges derivados? **Por defecto: sí.**
2. ¿Pastor y Finanzas pueden **escribir** en finanzas (`finance.records.manage`), como hoy? **Por defecto: sí, por compatibilidad.**
3. ¿Finanzas y Consolidación ven el Calendario (`calendar.read`)? **Por defecto: sí**, porque las actividades no son sensibles y ordenan la semana.
4. ¿Un Líder puede publicar actividades sin aprobación? **Por defecto: sí.** La aprobación queda para LATER.
5. Parámetros de alertas: 48 h, 21 días y 14 días. **Por defecto: esos.** Se pueden ajustar.
6. ¿Consolidación ve a todas las personas o solo las asignadas? **Por defecto: a todas** (no se crea `read_assigned`).
7. ¿Registrar menores de edad requiere un dato del adulto responsable? **Por defecto: sin campo nuevo en la preview.** Se marcan como "menor" de forma derivada y queda como RISK para producción.
8. ¿Qué módulo inicial tendrá el Pastor nuevo? **Por defecto: Calendario.** El pastor migrado conserva Finanzas.

## Handoffs

**Designer**
- **Objetivos de UX:**
  - una sola aplicación que crece desde la Financial UX V2;
  - cada cargo aterriza en lo que necesita.
- **Flujos:**
  - login y aterrizaje;
  - crear o editar una actividad (con área y recurrencia);
  - cancelar y eliminar;
  - compartir;
  - nueva persona con aviso de duplicado;
  - registrar visita;
  - registrar seguimiento con sugerencia de estado;
  - Atención → acción.
- **Jerarquía:**
  - en Consolidación: Atención > indicadores > secciones;
  - en Calendario: Agenda primero en móvil;
  - el responsable de la actividad siempre visible.
- **Estados críticos:** Cancelada, Realizada, Propuesta (opciones de recurrencia del siguiente slice), sin áreas, sin módulos, enlace no disponible, `doNotContact`, menor de edad.
- **Accesibilidad:** el área siempre con nombre además del color; colores de área ≥3:1; tri-estado con 3 radios; targets de 44 px.
- **Pendientes de Designer:** cuántos indicadores (3 o 4) y cómo se presentan las opciones de recurrencia.

**Atlas**
- **Entidades:** las de C. Atlas confirma la recurrencia de E.2.
- **Invariantes:**
  - cierre de permisos;
  - `settings.manage` solo con admin;
  - siempre hay al menos 1 admin activo;
  - nada se borra físicamente;
  - las visitas se agregan, no se reescriben;
  - el estado no cambia sin acción del usuario.
- **Consistencia:** el estado y su `PersonChange` se escriben en la misma transacción. Al regenerar el token, el anterior se invalida en ese momento.
- **Sensibles:** la proyección pública (lista blanca, nunca una colección interna pública), la edición de permisos y los datos de menores.
- **Migración:** de `role` a `permissions`, con doble lectura (`access-provider`, `validUser` y las reglas `details`/`pastoral`/`approved`).
- **Fechas:** locales a America/Santiago.
- **Escala:** una iglesia; menos de 30 usuarios, menos de 2.000 personas y unas 600 actividades al año.

**Builder**
- Fixtures según J, con `DEMO_TODAY` único.
- Funciones puras testeables:
  - `effectivePermissions`, `visibleModules`, `resolveInitialModule`;
  - `canManageEvent`, `expandRecurrence`, `toPublicEvent`;
  - `normalizePhoneCL`, `normalizeEmail`, `ageAt`, `nextBirthday`;
  - `computeAlerts`, `attentionQueue`, `timeline`.
- Criterios de aceptación 1–32.

**Conductor:** n/a. El proceso no requiere IA ni automatización inteligente; las alertas son reglas deterministas.

**Brain:** el repositorio `salva-ai-brain` no estaba accesible en esta sesión, así que no se consultó ni se escribió aprendizaje. Tampoco aplica: no hay ningún aprendizaje nuevo con evidencia todavía. La separación etapa/estado se puede evaluar como candidata después de la validación de Salvador.