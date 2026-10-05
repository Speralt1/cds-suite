# 23 · Integrantes › Consolidación V1 (Fast Track): especificación de producción

> **Estado:** código en `mission/consolidation-v1-fasttrack` (stacked sobre PR #5 `mission/platform-core-calendar-v1` @ `73b9040`). **NO DESPLEGADO.** Ningún dato real, ninguna migración de usuarios aplicada.
> **Objetivo:** rollout controlado el **miércoles 7-10-2026**, después de la Etapa B (PR #5). Runbook en el [doc 25](25-consolidation-v1-rollout.md); revisión de seguridad en el [doc 24](24-consolidation-v1-security-review.md).
> **Referencias:** UX y lógica validadas en la preview de PR #4 (docs 16, 16a, 16b, 16c, 17). Este documento **manda** sobre ellos para producción.

## 1. Alcance V1

| Entra | Detalle |
|---|---|
| Dashboard | Indicadores: Nuevos del mes · Sin primer contacto · Seguimientos vencidos. Bloques: Necesitan atención · Nuevos recientes · Seguimientos pendientes · Volvieron |
| Personas | Lista con búsqueda, filtros y orden; ficha; crear; editar datos operacionales; responsable; estado; "No contactar" |
| Visitas | Persona, fecha, actividad del calendario (opcional), observación breve. Append-only: nunca se sobrescribe |
| Seguimientos | Tipo (WhatsApp, llamada, presencial, otro) · resultado (contactado, sin respuesta, número inválido, no desea contacto, otro) · observación · próxima acción + fecha · responsable |
| Estados | Por contactar · En seguimiento · Integrándose · Integrado · Sin continuidad. `lifecycleStage` separado de `consolidationStatus` |
| Alertas (derivadas) | Sin responsable · Sin primer contacto > 48 h · Seguimiento vencido · Volvió · Varios días sin volver > 21 d · Posible duplicado |
| WhatsApp | Enlace `wa.me` generado localmente; oculto con "No contactar" |
| Rutas | `/integrantes` → `/integrantes/consolidacion` (dashboard) · `/atencion` · `/personas` · `/nueva` · `/persona?id=` |

| **No entra** (diferido) | Motivo |
|---|---|
| Confesión de fe, bautismo | Dato sensible (creencias religiosas). Requiere base de licitud (Ley 21.719) |
| Fecha de nacimiento, cumpleaños, edad | Minimización. La alerta "Cumpleaños próximo" se excluye |
| Menores de edad | V1 es **solo adultos** (aviso visible en el registro). Sin flujo de niños/adolescentes |
| Datos médicos, legales, familiares sensibles, pastorales confidenciales | Fuera de finalidad |
| Archivos, documentos, fotografías | Fuera de finalidad |
| Anular visitas, fusionar personas, posponer/descartar alertas, ajustes de umbrales | LATER |
| Directorio, Miembros, Familias, Ministerios, Asistencia | Submódulos futuros: no se muestran |

## 2. Identidad única

- Una persona = un documento `membersPeople/{personId}` durante todo su ciclo de vida.
- `lifecycleStage`: `en_consolidacion | integrante` (dónde está). `consolidationStatus` (en qué va el acompañamiento).
- Marcar **Integrado** cambia `lifecycleStage = integrante` en el mismo documento. **Nunca** se crea otra persona.
- Duplicados: se advierten, **nunca** se bloquean, fusionan ni borran.

## 3. Privacidad y datos mínimos

Campos permitidos en `membersPeople` (F3). Cualquier otro campo está prohibido por validación del servidor:

| Grupo | Campo | Tipo | Nota |
|---|---|---|---|
| Identidad | `fullName` | string 1–120 | espacios colapsados |
| | `phoneE164` | string E.164 | normalizado en el servidor |
| | `email` | string ≤160 \| null | trim + minúsculas |
| Ingreso | `entryDate` | "YYYY-MM-DD" | fecha local de registro (Santiago), la pone el servidor, inmutable |
| | `firstVisitAt` | "YYYY-MM-DD" | fecha de la primera visita declarada al registrar (≤ hoy; en el request se llama `firstVisitDate`) |
| | `arrivalSource` | enum \| null | invitación · redes sociales o transmisión en vivo · evangelismo o campaña · pasaba por el lugar · actividad · otro (nunca "otra iglesia": sería afiliación religiosa) |
| | `calendarEventId` | string \| null | actividad de llegada (solo el id) |
| | `invitedBy` | string ≤80 \| null | texto operacional breve |
| Consolidación | `lifecycleStage` | enum | |
| | `consolidationStatus` | enum | |
| | `closedReason` | enum \| null | solo con `sin_continuidad` |
| | `followUpOwnerUid` | uid \| null | validado en el servidor |
| | `doNotContact` | bool | |
| Sistema | `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `revision` | | timestamps del servidor |
| **Proyección** (justificada, §5.1) | `visitCount`, `firstVisitDate`, `lastVisitDate`, `followUpCount`, `lastFollowUpDate`, `firstContactDate`, `nextAction`, `nextActionDate`, `nextActionOwnerUid` | | derivados del historial, sin PII nueva. `firstVisitDate` = visita más antigua registrada (puede diferir de `firstVisitAt` si luego se registra una visita anterior) |

**Campos agregados respecto de F3 y su justificación:**
- `closedReason` (enum, sin texto libre en la persona): F10 exige motivo para "Sin continuidad"; el texto opcional del motivo vive solo en `membersPersonChanges`.
- **Proyección:** permite que el dashboard y las alertas se calculen leyendo **una** colección (`membersPeople`) sin escanear todo el historial. La mantiene la Function en la **misma transacción** que escribe el historial append-only, por lo que no es una segunda fuente de verdad: se puede recalcular desde `membersVisits`/`membersFollowUps`. No contiene datos personales nuevos (`nextAction` es el texto operacional ≤120 del último seguimiento).

**Notas** (F4): solo observaciones operacionales breves:
- visita: `note` ≤ 280; seguimiento: `note` ≤ 280, `nextAction` ≤ 120; motivo de cierre: `reasonNote` ≤ 200.
- Todo formulario con notas muestra: *"No registres información médica, legal, familiar sensible ni detalles pastorales confidenciales."*
- Sin textareas ilimitados: contador visible y `maxLength`; el servidor rechaza lo que exceda.

## 4. Modelo de Firestore

Todas las colecciones son **de solo lectura** para el cliente (`allow write: if false`) y las escribe el Admin SDK desde las Functions. Lectura: `members.consolidation.read` (o `manage`, que lo implica) o admin. Nunca `approved()` ni fallback legacy.

### 4.1 `membersPeople/{personId}`
Estado actual (§3). `personId` = 24 hex derivados de `sha256(uid:person:requestId)` (idempotencia).

### 4.2 `membersVisits/{visitId}` (append-only)
`personId`, `date` (YMD ≤ hoy), `calendarEventId | null`, `note | null`, `firstVisit` (bool), `createdAt`, `createdBy`.

### 4.3 `membersFollowUps/{followUpId}` (append-only)
`personId`, `contactDate` (YMD ≤ hoy), `type`, `result`, `note | null`, `nextAction | null`, `nextActionDate | null`, `ownerUid | null`, `createdAt`, `createdBy`.

### 4.4 `membersPersonChanges/{changeId}` (auditoría append-only)
`personId`, `action` (`person_created | profile_updated | owner_changed | do_not_contact_changed | status_changed | stage_changed | visit_recorded | follow_up_recorded`), `field | null`, `from | null`, `to | null`, `changedFields` (solo **nombres** de campos de perfil, nunca sus valores), `reason | null` (motivo de cierre), `reasonNote | null`, `refId | null` (visita o seguimiento), `revision` (de la persona tras el cambio), `actorUid`, `at` (timestamp del servidor).

- Estado, etapa, responsable y "No contactar" guardan `from`/`to` (enums, bools o uids).
- Los cambios de nombre/teléfono/correo/origen/invitado guardan **solo** `changedFields` (sin valores → sin copiar PII al log).

### 4.5 Por qué cuatro colecciones de primer nivel (y no subcolecciones)
- Reglas simples e iguales para las 4 (`get/list` con un único gate, escritura denegada).
- Consultas por persona con un índice compuesto `personId ASC, createdAt DESC` (o `at DESC`); sin collection group.
- Rollback: se deshabilita leer/escribir sin tocar ninguna colección financiera ni de calendario.

## 5. Escrituras: Functions callables (región `southamerica-west1`)

| Callable | Permiso | Qué hace (una transacción) |
|---|---|---|
| `membersPersonCreate` | manage | Crea persona (`por_contactar`, `en_consolidacion`) + primera visita + change `person_created` (+ `owner_changed` si hay responsable). Devuelve `{personId, replay, duplicates[]}` |
| `membersPersonUpdate` | manage | Datos operacionales, responsable y "No contactar". Exige `expectedRevision`. Changes `profile_updated` / `owner_changed` / `do_not_contact_changed` |
| `membersStatusChange` | manage | Transición del pipeline (§6). Exige `expectedRevision`. Change `status_changed` (+ `stage_changed` al integrar) |
| `membersVisitCreate` | manage | Visita append-only + proyección + change `visit_recorded`. Devuelve `{visitId, replay, suggestReopen}` |
| `membersFollowUpCreate` | manage | Seguimiento append-only + proyección + change `follow_up_recorded`; aplica la sugerencia **solo si** viene confirmada y coincide con la recalculada |
| `membersOwnerOptions` | read | Lista `{uid, displayName}` de usuarios **activos** con `members.consolidation.manage` (incluye admins). Sin correos |

Requisitos comunes:
- Auth obligatoria; perfil `users/{uid}` activo; permiso con `can()` del modelo compartido (admin implícito; **sin** fallback legacy para Integrantes).
- Payload: objeto plano, ≤ 4 KB serializado, claves desconocidas → `members/invalid-argument` con `{fields}`. Validación en `lib/shared/members.ts` (compilada a `functions/shared/members.js`).
- Teléfono normalizado en el servidor (E.164, reglas chilenas, extranjeros con `+`). Correo trim + minúsculas.
- Timestamps del servidor; fechas locales calculadas con `localToday(clock.now())` en America/Santiago.
- **Idempotencia** (doble submit): `requestId` del cliente → id determinista; si el documento existe y es del mismo actor, se devuelve el resultado sin escribir (`replay: true`).
- **Concurrencia:** `revision` de la persona; `expectedRevision` distinto → `members/conflict` (la UI pide recargar).
- **Responsable válido:** usuario existente, `active == true` y `can(manage)`. Si no → `members/invalid-owner`. Nunca se confía en uids del cliente sin validarlos.
- **Calendario:** `calendarEventId` solo si quien escribe tiene `calendar.read`; el evento debe existir y no estar archivado. Nunca se copia el título ni datos de la persona al evento.
- Errores sanitizados: `HttpsError` con clave `members/*`; el log no incluye nombres, teléfonos ni correos.

### 5.0 Detalles de implementación
- Cada visita y cada seguimiento suben la `revision` de la persona (la UI siempre usa la del snapshot vigente).
- `membersFollowUpCreate` sin `ownerUid` usa el responsable actual de la persona (no se revalida: es el ya asignado; si perdió el acceso, la alerta "Sin responsable" lo muestra).
- Los cambios `status_changed`/`stage_changed`/`do_not_contact_changed` producidos por un seguimiento llevan `refId` = id del seguimiento; `person_created` lleva `refId` = id de la primera visita.
- La búsqueda de posibles duplicados corre después de confirmar la transacción (solo advierte; nunca bloquea).

### 5.1 Proyección del resumen
`projectVisit` / `projectFollowUp` (`lib/shared/members.ts`) recalculan `visitCount`, `firstVisitDate`, `lastVisitDate`, `followUpCount`, `lastFollowUpDate`, `firstContactDate` y la próxima acción vigente (la del seguimiento registrado más recientemente).

## 6. Pipeline

| Desde | Hacia | Requisito |
|---|---|---|
| (crear) | Por contactar | automático |
| Por contactar | En seguimiento | manual, o sugerido por el primer seguimiento "contactado" (**se confirma**) |
| activo | Integrándose | manual |
| activo | Integrado | manual + `confirmIntegrated: true`; `lifecycleStage = integrante` |
| activo | Sin continuidad | motivo (enum) obligatorio; texto si el motivo es "Otro" |
| Sin continuidad | En seguimiento | "Reabrir" manual; se **sugiere** al registrar una visita (botón, nunca premarcado) |
| Integrado | — | **no se reabre en V1**: el diálogo de confirmación dice "En esta versión no se puede deshacer." |

- Sugerencias del seguimiento: aparecen **premarcadas** y quien guarda puede desmarcarlas (aceptación parcial permitida: solo estado o solo "No contactar"). El servidor recalcula la sugerencia; si no coincide (`members/suggestion-mismatch`, la persona cambió entre medio), la UI avisa, recalcula desde el snapshot vigente y pide guardar de nuevo.
- Persona **integrante**: la ficha no ofrece "Cambiar estado" (el servidor lo rechaza) y deja de aparecer en alertas. Registrar visitas (asistencia) y editar datos siguen permitidos; el servidor también acepta seguimientos para no perder historial.

"No desea contacto" en un seguimiento sugiere "No contactar" + "Sin continuidad" (motivo `no_desea_contacto`). **Nada cambia en silencio.**

## 7. Alertas (derivadas en el cliente, nunca guardadas)

Aplican a personas activas (`en_consolidacion`, ≠ `sin_continuidad`, sin "No contactar"), salvo duplicados (todas):

| Alerta | Regla |
|---|---|
| Sin responsable | `followUpOwnerUid` vacío o no está en `membersOwnerOptions` (inactivo o sin permiso) |
| Sin primer contacto | sin `firstContactDate` y > 48 h desde `createdAt` |
| Seguimiento vencido | `nextActionDate` < hoy |
| Volvió | `lastVisitDate > firstVisitDate` (una visita en una **fecha posterior** a la primera; dos visitas el mismo día no cuentan), `lastVisitDate` en los últimos 7 días y sin seguimiento posterior (`lastFollowUpDate < lastVisitDate`) |
| Varios días sin volver | > 21 días desde `lastVisitDate` |
| Posible duplicado | mismo `phoneE164` o mismo `email` en otra persona |

**Fórmulas de indicadores y bloques** (fecha local de Santiago):
- Nuevos del mes: personas con `entryDate` en el mes actual.
- Sin primer contacto (+48 h): cantidad de alertas "Sin primer contacto".
- Seguimientos vencidos: cantidad de alertas "Seguimiento vencido".
- Nuevos recientes: `en_consolidacion` con `entryDate` en los últimos 14 días.
- Seguimientos pendientes: activas con `nextActionDate` entre hoy y hoy + 7.
- Volvieron (bloque): activas con `lastVisitDate > firstVisitDate` y `lastVisitDate` en los últimos 7 días, **tengan o no seguimiento posterior** (es el registro positivo de quién volvió). La **alerta** "Volvió" de la cola de atención exige además que no haya seguimiento posterior (es la tarea pendiente de agradecer).
- **Regla operativa V1:** no cargar visitantes históricos (contarían como nuevos del mes).

Al registrar una visita en una fecha que ya tiene visita, el formulario advierte sin bloquear: "Ya hay una visita registrada el {fecha}. ¿Registrar otra?".

## 7b. Operación y corrección de errores (V1 no tiene borrar, anular ni fusionar)

| Situación | Qué hacer en V1 |
|---|---|
| Dato mal escrito (nombre, teléfono, correo, origen) | **Editar** (queda auditado: qué campos cambiaron, sin valores) |
| Persona registrada dos veces / por error | Cerrar el registro sobrante como **Sin continuidad**, motivo "Otro", nota "Registro duplicado/erróneo". Sigue contando en "Nuevos del mes" de ese mes y la alerta "Posible duplicado" persiste (descartarla es LATER) |
| Familias que comparten WhatsApp | Es normal: "Posible duplicado" es una advertencia, no un error (se explica en la capacitación) |
| Visitante sin teléfono | **Nunca inventar un número** (un número inventado abre WhatsApp hacia un tercero real). Sin teléfono, no se registra en V1 |
| **Menor registrado por error** o **persona que pide borrar sus datos** | No se corrige en la app. **Propuesta (requiere decisión de Salvador):** única excepción a "nunca se borran datos": Salvador elimina manualmente (consola/Admin SDK) la persona y sus visitas, seguimientos y cambios, y lo anota en el doc 21 **sin PII** (fecha, motivo, cantidad de documentos) |

- Aviso verbal sugerido al registrar: "Usaremos tu teléfono solo para contactarte desde la iglesia." Revisión legal (Ley 21.719) antes de ampliar datos: LATER.
- La auditoría de perfil guarda solo nombres de campos (minimización): un valor sobrescrito por error no se recupera desde el log.

## 8. Calendario

- Visita/ingreso pueden asociar `calendarEventId`; nunca es obligatorio (basta la fecha).
- El selector solo se muestra con `calendar.read` y lista las actividades de esa fecha que la persona ya puede leer.
- En la ficha, el título de la actividad se resuelve en el cliente leyendo `calendarEvents/{id}` **solo** con `calendar.read`; sin él se muestra "Actividad del calendario".
- La página pública de Calendario y `calendarPublicFeed` no leen ni conocen colecciones `members*`.

## 9. Acceso

- Permisos nuevos: `members.consolidation.read`, `members.consolidation.manage` (manage → read).
- Admin: acceso completo implícito. Resto: **solo** con el permiso guardado explícitamente en `permissions[]` (perfil v1).
- **El fallback legacy NO otorga Integrantes** (ni a pastor). `migrate-access-v1.mjs` no agrega estos permisos.
- Configuración › Usuarios y permisos muestra el grupo "Integrantes" para otorgar/revocar.
- `MAX_STORED_PERMISSIONS` pasa de 8 a 10 (catálogo guardable completo).

## 10. Índices (derivados de las consultas reales)

| Colección | Campos | Consulta |
|---|---|---|
| `membersVisits` | `personId ASC, createdAt DESC` | historial de visitas de la ficha |
| `membersFollowUps` | `personId ASC, createdAt DESC` | historial de seguimientos de la ficha |
| `membersPersonChanges` | `personId ASC, at DESC` | historial de cambios de la ficha |

`membersPeople` se lee con `orderBy(entryDate desc)` (+ `limit`) y las búsquedas de duplicados del servidor son igualdades de un campo: índices automáticos.

## 11. Matriz PREVIEW (PR #4) → PRODUCCIÓN

| Pieza de la preview | Decisión | Producción | Notas |
|---|---|---|---|
| `lib/suite-preview/phone.ts` | **Reutilizar** (endurecida) | `lib/shared/members.ts` | Mismas reglas; además rechaza `+56` con nacional que no empieza en 2–9 y no-strings. Compartida con Functions |
| `lib/suite-preview/consolidation.ts` | **Adaptar** | `lib/members/consolidation.ts` + `lib/shared/members.ts` | Alertas/dashboard/atención desde la **proyección** de la persona (no desde arrays en memoria). Sin edad, cumpleaños, menor, tri-estado ni ajustes. Pipeline y sugerencias pasan a lo compartido (servidor = autoridad) |
| `lib/suite-preview/types.ts` (Integrantes) | **Reescribir** | `lib/shared/members.ts`, `lib/members/types.ts` | Modelo del §3–§4 |
| `components/suite-preview/members/use-members.ts` | **Reescribir** | `lib/members/use-members.ts`, `client.ts`, `api.ts` | Firestore en vivo + callables; estados reales (carga, error, sin permiso, offline) |
| `model.ts`, `vocab.tsx` | **Adaptar** | `components/members/model.ts`, `vocab.tsx` | Rutas `/integrantes/...`; sin badges Menor/Cumpleaños/TriState |
| `dashboard.tsx` | **Adaptar** | `components/members/dashboard.tsx` | Sin bloque de cumpleaños; estados reales; KPI "Sin primer contacto (+48 h)" |
| `attention.tsx` | **Adaptar** | `components/members/attention.tsx` | Sin nota de "Ajustes" simulados |
| `people.tsx` | **Adaptar** | `components/members/people.tsx` | Sin columna Edad ni filtro Menores; etiqueta "No contactar"; WhatsApp real |
| `person.tsx` | **Adaptar** | `components/members/person.tsx` | Sin nacimiento, fe, bautismo, notas iniciales ni área de integración; con origen, invitado por, "Llegó a", "Editar datos"; historial en vivo |
| `person-form.tsx` | **Reescribir** | `components/members/person-form.tsx` | Campos del §3; aviso solo adultos; nota ≤280 con contador y advertencia |
| `sheets.tsx` | **Adaptar** | `components/members/sheets.tsx` | Callables reales; hoja "No contactar"; Reabrir como banner tras la visita; confirmación de Integrado aparte ("no se puede deshacer") |
| `settings.tsx` (Ajustes de umbrales) | **Excluir** | — | Umbrales fijos 48 h / 21 d / 14 d / 7 d |
| "Ver como", toasts demo, WhatsApp simulado, fixtures, `DEMO_NOW`, store en memoria, provider de la preview | **Excluir** | — | `check:no-preview` lo verifica en la build |
| `members.css` | **Portar** | `components/members/members.css` | Prefijo `mem-`, scope `.cds-members`; sin reglas de cumpleaños/menor/tri-estado/visitas anuladas |
| `tests/suite-preview/consolidation.test.ts`, `phone.test.ts`, `members-screens.test.tsx` | **Adaptar** | `tests/members/*`, `tests/platform/shared-members.test.ts` | + tests de Functions, reglas y e2e con emuladores |
| Docs 16 / 16a / 16b / 16c / 17 | Referencia | Este doc manda para producción | — |
