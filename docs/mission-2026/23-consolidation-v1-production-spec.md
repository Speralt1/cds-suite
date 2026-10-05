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
| | `firstVisitAt` | "YYYY-MM-DD" | fecha de la primera visita (≤ hoy) |
| | `arrivalSource` | enum \| null | invitación · redes sociales · pasaba por el lugar · actividad · otro |
| | `calendarEventId` | string \| null | actividad de llegada (solo el id) |
| | `invitedBy` | string ≤80 \| null | texto operacional breve |
| Consolidación | `lifecycleStage` | enum | |
| | `consolidationStatus` | enum | |
| | `closedReason` | enum \| null | solo con `sin_continuidad` |
| | `followUpOwnerUid` | uid \| null | validado en el servidor |
| | `doNotContact` | bool | |
| Sistema | `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `revision` | | timestamps del servidor |
| **Proyección** (justificada, §5.1) | `visitCount`, `lastVisitDate`, `followUpCount`, `lastFollowUpDate`, `firstContactDate`, `nextAction`, `nextActionDate`, `nextActionOwnerUid` | | derivados del historial, sin PII nueva |

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

### 5.1 Proyección del resumen
`projectVisit` / `projectFollowUp` (`lib/shared/members.ts`) recalculan `visitCount`, `lastVisitDate`, `followUpCount`, `lastFollowUpDate`, `firstContactDate` y la próxima acción vigente (la del seguimiento registrado más recientemente).

## 6. Pipeline

| Desde | Hacia | Requisito |
|---|---|---|
| (crear) | Por contactar | automático |
| Por contactar | En seguimiento | manual, o sugerido por el primer seguimiento "contactado" (**se confirma**) |
| activo | Integrándose | manual |
| activo | Integrado | manual + `confirmIntegrated: true`; `lifecycleStage = integrante` |
| activo | Sin continuidad | motivo (enum) obligatorio; texto si el motivo es "Otro" |
| Sin continuidad | En seguimiento | "Reabrir" manual; se **sugiere** al registrar una visita |
| Integrado | — | no se reabre en V1 |

"No desea contacto" en un seguimiento sugiere "No contactar" + "Sin continuidad" (motivo `no_desea_contacto`). **Nada cambia en silencio.**

## 7. Alertas (derivadas en el cliente, nunca guardadas)

Aplican a personas activas (`en_consolidacion`, ≠ `sin_continuidad`, sin "No contactar"), salvo duplicados (todas):

| Alerta | Regla |
|---|---|
| Sin responsable | `followUpOwnerUid` vacío o no está en `membersOwnerOptions` (inactivo o sin permiso) |
| Sin primer contacto | sin `firstContactDate` y > 48 h desde `createdAt` |
| Seguimiento vencido | `nextActionDate` < hoy |
| Volvió | `visitCount ≥ 2`, `lastVisitDate` en los últimos 7 días y sin seguimiento posterior (`lastFollowUpDate < lastVisitDate`) |
| Varios días sin volver | > 21 días desde `lastVisitDate` |
| Posible duplicado | mismo `phoneE164` o mismo `email` en otra persona |

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
