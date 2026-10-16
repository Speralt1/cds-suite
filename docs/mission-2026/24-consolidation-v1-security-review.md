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

### 6.1 Clasificación de los archivos compartidos con PR #5 (`git diff --name-status 73b9040..HEAD`)

| Archivo (compartido) | Cambio | Clase | Efecto en Finanzas |
|---|---|---|---|
| `functions/sumup/**`, `functions/auth/**`, `lib/finance/**`, `components/finance/**`, `storage.rules`, `firebase.json` | **ninguno** (`git diff --stat` vacío) | financiero | ninguno |
| `firestore.rules` | +28/−2: `implicants()` y `membersRead()`, catálogo v1 (+2, máx. 10), 4 bloques `members*` | compartido | ninguno: los gates financieros no cambian; `tests/rules/finance.test.ts` 17/17 e `integrations.test.ts` 5/5 (los 22 históricos) siguen verdes |
| `functions/index.js` | +37/−0, solo al final | compartido | ninguno: SumUp, campañas y calendario idénticos; deploy por nombre |
| `lib/shared/access.ts`, `lib/shared/types.ts` (+ `functions/shared/access.js`, `types.js` generados) | +2 permisos, `IMPLIES` manage→read, módulo `members` | compartido | ninguno: Atlas comparó `can()` de `73b9040` vs HEAD en 16.403 perfiles (147.627 comprobaciones): **0 diferencias fuera de `members.*`** |
| `lib/access/*`, `lib/settings/users.ts`, `components/layout/app-shell.tsx` | etiquetas, grupo "Integrantes", ruta, ícono, barra móvil con 5 módulos | compartido (navegación/permisos) | ninguno: admin/pastor/finance/leader conservan exactamente sus módulos financieros (tests #47–#50) |
| `scripts/migrate-access-v1.mjs` (+ `.d.mts`) | bloque Integrantes en `--summary` | compartido (ops) | ninguno: el plan de migración no cambia |
| `scripts/build-shared.mjs`, `package.json` | +`members` en `SHARED_FILES`; script `check:no-preview` | build | ninguno |
| `scripts/seed-*`, `tests/**` | seeds de emulador y tests | test | — |
| `firestore.indexes.json` | +3 índices `members*` | aditivo | ninguno |
| Resto (`lib/members`, `components/members`, `app/(private)/integrantes`, `functions/members`, docs) | nuevo | solo Integrantes | — |

### 6.2 Reglas

Diff completo de `firestore.rules`: 2 entradas en `implicants()`, el helper `membersRead()`, 2 permisos en `permissionCatalogNoSettings()`, `size() <= 10` y los 4 bloques `members*`. Ningún helper financiero ni de calendario cambia.

## 7. SumUp CASH

- Esta rama nace de PR #5 (`73b9040`) y **no** contiene commits de `mission/sumup-cash-intake-v1`; no se leyó esa rama ni se hizo cherry-pick.
- `functions/sumup/**`, el sync, `paymentMethod`, la fecha de inicio de CASH y el backfill no se tocan.

## 8. Revisiones independientes

| Revisión | Resultado | Detalle |
|---|---|---|
| Navigator (alcance, flujo, pipeline, IA) | FIXES_REQUIRED → **corregido** | M1 "Volvió" por fecha posterior + aviso de visita del mismo día; M2 procedimiento de corrección (doc 23 §7b; la excepción de borrado para menores/solicitud de eliminación **requiere decisión de Salvador**); M3 Integrado irreversible explícito; M4 este doc. Menores aplicados (KPI +48 h, No contactar en formularios, responsable preseleccionado, notas con contador, origen "evangelismo") |
| Atlas backend ([24a](24a-atlas-review.md)) | **PASS** (0 BLOCKER, 0 MAJOR) | A-01/A-02 (runbook) corregidos; A-05 (caracteres de control/bidi) corregido; NITs A-03/A-04/A-06…A-10 aceptados para después |
| Atlas cliente ([24b](24b-atlas-client-review.md)) | FIXES_REQUIRED → **re-verificación PASS** | F1 (MAJOR) y F2 (MAJOR) cerrados; F3/F4/F5/F6/F9/F10 cerrados; N1 (formulario de seguimiento congelado completo tras un intento) corregido en `1b7bd64`. Abiertos aceptados: F7, F8 (NIT), N2 (persona leída fuera del límite de 1000 no es en vivo; el servidor rechaza por revisión), N3 (NIT) |
| Designer (estático, sin navegador) | FIXES_REQUIRED → **corregido** | M1 encabezados de Atención; M2 footer sticky alineado al padding del shell; ritmo vertical, foco del menú, CTA en /nueva, 44 px táctiles, reduced motion. m5 (orden DOM del dashboard en móvil) aceptado. **Falta la verificación visual en navegador** a 1440/1024/390/375 (no se pudo levantar el entorno local en esta sesión) |

## 9. Veredicto

| Ítem | Estado |
|---|---|
| BLOCKER abiertos | **0** |
| MAJOR abiertos | **0** |
| Aislamiento financiero | **PASS** (sin cambios financieros; `can()` idéntico fuera de `members.*`; 22 tests financieros de reglas verdes) |
| SumUp CASH | **PASS** (sin commits ni conceptos de CASH) |
| Privacidad V1 | **PASS** (campos mínimos; excluidos verificados en código, servidor y build) |
| Verificación visual en navegador (1440/1024/390/375) | **PASS** (2026-10-05, `localhost:3000` levantado por Salvador con emuladores y datos ficticios, perfil `consolidacion@cds.test`). 5 pantallas + sheets/diálogos; sin overflow horizontal, sin contenido cortado ni campos excluidos. Correcciones en `07906e2` (doc 24 §10) |
| Decisiones de Salvador | **RESUELTAS (2026-10-05):** D1 aprobado (sin deploy inmediato; GO por fase), D2 aprobado (solo baseline técnico; controles financieros intactos), D3 piloto = Salvador como Admin (0 grants), D4 migración masiva diferida, D5 aprobado con condiciones, excepción de eliminación aprobada con restricción. Doc 25 §1 y §8 |

**Conclusión:** código apto para el rollout controlado; QA visual PASS (§10); decisiones resueltas. **READY TO START C-A0 ON HUMAN GO** (doc 25 §1.1).

## 10. QA visual en navegador (2026-10-05)

Entorno: `localhost:3000` (proyecto `demo-cds-suite`, emuladores Auth/Firestore/Functions, 14 personas ficticias), perfil `consolidacion@cds.test` (manage + calendar.read, sin finanzas). Solo lectura: ningún formulario se guardó. Método: capturas por breakpoint + sonda DOM (overflow horizontal, elementos fuera del viewport, objetivos táctiles < 44 px, texto excluido).

| Pantalla | 1440 | 1024 | 390 | 375 |
|---|---|---|---|---|
| Inicio (dashboard) | PASS | PASS | PASS | PASS |
| Atención | PASS | — (igual que 1440) | PASS | PASS |
| Personas (tabla / lista + menú de fila) | PASS | PASS (columnas colapsadas) | PASS | PASS |
| Ficha (+ Cambiar estado → Integrado anidado, Editar datos) | PASS | PASS | PASS | PASS |
| Nueva persona (+ aviso de duplicado, footer sticky) | PASS | — | PASS | PASS |
| Navegación (sidebar / rail / barra inferior / cuenta) | PASS | PASS | PASS | PASS |

Módulos visibles para el perfil: Calendario · Integrantes · Reportes (sin Finanzas), correcto.

**Defectos encontrados y corregidos (`07906e2`):**
- MAJOR: subnav "Consolidación · Atención · Personas" no cabía a 375–390 ("Personas" cortada o bajo el degradado) → "Inicio · Atención · Personas" (etiqueta de la preview) y pestañas compactas en teléfonos.
- MAJOR: Nueva persona sin separación entre campos dentro de cada sección (no se había portado el margen base `.fx-field`) → 12 px como la preview; 16 px bajo el aviso de adultos.
- MINOR: "No desea contacto" desbordaba su opción a 375 → la etiqueta envuelve.
- MINOR: ritmo vertical duplicado en el seguimiento por el fieldset congelado (`display: contents`) → regla extendida.
- MINOR: la ficha y el registro activaban "Consolidación" en la subnav → activan "Personas".
- MINOR: encabezado de la ficha decía "Sin asignar" cuando el responsable existe pero perdió el acceso → "sin acceso".

**Abiertos (aceptados):** m5 del Designer (orden DOM del dashboard en móvil vs. visual), sin impacto visual.
