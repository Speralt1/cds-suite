# 24 · Consolidación V1: revisión de seguridad, privacidad y aislamiento

> **Estado:** revisión sobre `mission/consolidation-v1-fasttrack` (stacked sobre PR #5 @ `73b9040`). **NO DESPLEGADO.**
> Spec: [doc 23](23-consolidation-v1-production-spec.md) · Runbook: [doc 25](25-consolidation-v1-rollout.md).
> Las secciones §8 (Atlas) y §9 (veredicto) se completan con la revisión independiente de Atlas.

## 1. Qué protege esta revisión

| Activo | Clasificación | Dónde vive |
|---|---|---|
| Nombre, teléfono, correo de personas nuevas | **PII** (Ley 19.628; Ley 21.719 desde 12-2026) | `membersPeople` |
| Historial de visitas y seguimientos (fechas, resultados, notas breves) | PII operacional | `membersVisits`, `membersFollowUps` |
| Auditoría (quién cambió qué) | Interno | `membersPersonChanges` |
| Datos sensibles (creencias, salud, legales, familia, menores) | **Excluidos de V1** | En ninguna parte (validación del servidor + `check:no-preview`) |
| Finanzas, SumUp, Calendario | Fuera de alcance: **no deben cambiar** | Colecciones existentes |

## 2. Modelo de amenazas (y control)

| # | Amenaza | Control | Evidencia |
|---|---|---|---|
| T1 | Usuario sin permiso (p. ej. líder con Calendario) lee personas, cuenta registros o descubre ids | Reglas `get/list` solo con `membersRead()` = permiso v1 explícito o admin; sin `approved()`, sin fallback legacy | `tests/rules/members.test.ts`: 13 perfiles sin permiso → get, list y `count()` denegados, incluso con ids inventados |
| T2 | Pastor (fallback legacy) obtiene Integrantes por accidente | `legacyPermissions()` y `LEGACY_ROLE_ACCESS` no contienen `members.*`; la migración no los agrega | `tests/platform/members-access.test.ts`, `migration-summary.test.ts`, `tests/rules/members.test.ts` |
| T3 | Escritura directa desde el cliente (saltarse validación/auditoría) | `allow create, update, delete: if false` en las 4 colecciones; solo Admin SDK | `tests/rules/members.test.ts` (#36) |
| T4 | Callable invocada sin auth, sin permiso, inactivo o con permiso de lectura | `can(userDoc, "members.consolidation.manage")` en cada Function (inactivo ⇒ ∅) | `tests/functions/members-service.test.ts` (#37, #38) |
| T5 | Asignar como responsable a cualquiera (uid arbitrario) | El servidor verifica existencia, `active`, `can(manage)` | `members-service.test.ts` (#39) |
| T6 | Inyección de campos (mass assignment: `consolidationStatus`, `createdBy`, `birthDate`, …) | Parsers con lista blanca de claves; desconocidas → `invalid-argument` | `shared-members.test.ts`, `members-service.test.ts` (#40) |
| T7 | Payload gigante / abuso de notas | ≤ 4 KB serializado; límites por campo (nota 280, próxima acción 120); `maxInstances: 5` | (#41) |
| T8 | Doble envío crea personas duplicadas | `requestId` → id determinista; replay idempotente | (#17) |
| T9 | Ediciones concurrentes pisan cambios | `revision` + `expectedRevision` → `members/conflict` | `members-service.test.ts` |
| T10 | Cambio de estado silencioso (sugerencia aplicada sin confirmación) | El servidor solo aplica `applyStatus`/`applyDoNotContact` si llegan y **coinciden** con la sugerencia recalculada | (#25, #26) |
| T11 | Filtración de títulos privados del calendario a quien no tiene `calendar.read` | Solo se guarda el id; vincular exige `calendar.read`; el título se resuelve en el cliente solo con `calendar.read` | (#22, #23) |
| T12 | Datos de personas en el calendario público | El feed público y su página no conocen `members*`; las Functions de Integrantes nunca escriben `calendarEvents` | `tests/platform/members-isolation.test.ts` (#43) |
| T13 | PII en logs | Las Functions registran solo `{método, nombre y código del error}`; errores al cliente son claves `members/*` | Revisión de código (§8) |
| T14 | PII en la auditoría | Cambios de perfil guardan **solo nombres de campos**, nunca valores | `members-service.test.ts` |
| T15 | Build productiva con datos demo, preview o campos excluidos | `npm run check:no-preview` sobre `out/` | Gate del doc 25 §2 |
| T16 | Rollback que borre datos | Rollback = ocultar (Hosting) + detener escrituras (borrar Functions) + cerrar lectura (Rules); nunca borrar documentos | Doc 25 §5 |

## 3. Reglas de Firestore

- Nuevo helper `membersRead()` = `gate(['members.consolidation.read','members.consolidation.manage'], ['admin'])` (misma evaluación rápida que el resto, verificada contra la tabla canónica `implicants()`).
- 4 bloques idénticos: `allow get, list: if membersRead(); allow create, update, delete: if false;`.
- `users` v1: el catálogo guardable suma los 2 permisos y el máximo pasa de 8 a 10. El resto de la validación (rol derivado, auto-protección del admin, inmutables) no cambia.
- **Nada más cambia en el archivo.** Diff de reglas: §6.2.

## 4. Functions

- 6 callables en `southamerica-west1`, `timeoutSeconds: 20`, `memory: 256MiB`, `maxInstances: 5`. Se despliegan **por nombre** (doc 25 C-A5).
- Toda escritura en **una transacción** (lecturas antes que escrituras): persona + historial + proyección + auditoría.
- Timestamps del servidor (`FieldValue.serverTimestamp()`), fecha local de Santiago con el reloj del servidor.
- Errores sanitizados (`HttpsError` con clave `members/*` y, si aplica, `{fields: {campo: código}}` sin valores).

## 5. Privacidad

- Campos mínimos (doc 23 §3). Excluidos por diseño: confesión de fe, bautismo, nacimiento, menores, salud, legal, familia, archivos, fotos.
- Aviso visible en todos los formularios con notas; aviso "solo adultos" en el registro.
- WhatsApp: enlace local `wa.me` sin texto; oculto con "No contactar"; sin API ni almacenamiento de conversaciones.
- **Pendiente legal (no bloquea V1 operativa con datos mínimos):** antes de agregar datos sensibles o menores, revisar base de licitud, finalidad, retención y consentimiento con asesoría (Ley 21.719).

## 6. Aislamiento financiero (BLOCKER de la misión)

### 6.1 Clasificación de los archivos compartidos con PR #5

*(Se completa con el diff final: §10.)*

### 6.2 Reglas

*(Se completa con el diff final: §10.)*

## 7. SumUp CASH

- Esta rama nace de PR #5 (`73b9040`) y **no** contiene commits de `mission/sumup-cash-intake-v1`; no se leyó esa rama ni se hizo cherry-pick.
- `functions/sumup/**`, el sync, `paymentMethod`, la fecha de inicio de CASH y el backfill no se tocan.

## 8. Revisión de Atlas

*(Pendiente.)*

## 9. Veredicto

*(Pendiente.)*
