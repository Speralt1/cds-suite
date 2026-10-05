# 25 · Consolidación V1: runbook del rollout controlado (miércoles 7-10-2026)

> **NO EJECUTADO.** Este documento solo prepara el rollout. Cada fase exige un **GO explícito de Salvador** y termina en **HARD STOP**.
> Spec: [doc 23](23-consolidation-v1-production-spec.md) · Seguridad: [doc 24](24-consolidation-v1-security-review.md) · Etapa B (Platform + Calendar): [doc 20](20-platform-calendar-rc1-readiness.md) §13–14 · Bitácora: [doc 21](21-controlled-rollout-log.md).

## 1. Dependencias y decisiones previas (antes del miércoles)

| # | Decisión / requisito | Por qué | Quién |
|---|---|---|---|
| D1 | **GO para empezar la Etapa B antes del cierre formal de A5** (A5 cierra "no antes del domingo 11-10", doc 21) | El plan aprobado en el doc 20 §2 era Etapa B *después* de A5. El brief de esta misión acepta no esperar otro domingo **si** se demuestra aislamiento financiero (doc 24 §6). Es un cambio del plan aprobado y lo decide Salvador | Salvador |
| D2 | Ajustar la observación A5 (`~/cds-ops/a5-check.mjs`, tarea `cds-a5-observacion-etapa-a`) | El script compara Rules/Hosting/Functions con los ids de la Etapa A. Cada deploy del miércoles lo hará reportar diferencias **esperadas**. Hay que actualizar los ids esperados tras cada fase (o pausar esas 3 comparaciones y mantener las financieras: montos, scheduler, SumUp, errores) | Salvador (fuera del repo) |
| D3 | Usuario piloto | Recomendado: **Salvador como admin** (acceso implícito, sin tocar ningún otro usuario). Si el piloto es otra persona, se le otorga el permiso desde Configuración (C-A8), lo que convierte **solo a ese usuario** a v1. Ojo: un piloto sin finanzas suma 1 al riesgo de rollback legacy (§5.1) | Salvador |
| D4 | La migración masiva de usuarios (`--apply`, doc 20 Fase 7) **no** es necesaria para Consolidación | Admin no la necesita; un piloto no admin se convierte a v1 al editarlo. Recomendación: diferirla para no sumar riesgo el miércoles | Salvador |
| D5 | PR #5 revisado y listo para mergear; PR de Consolidación revisado | Esta rama está **stacked** sobre PR #5 | Salvador |

## 2. Gates que deben estar en verde en el commit exacto

En un **checkout limpio** del commit a desplegar (`~/cds-deploy`):

```bash
npm ci && npm --prefix functions ci
```

```bash
npm run lint && npm run typecheck && npx vitest run
```

```bash
npm run test:rules && npm run test:emulator
```

```bash
node scripts/build-shared.mjs --check
```

```bash
rm -rf out && npm run build && npm run check:no-preview
```

`check:no-preview` exige las 6 rutas de Integrantes en `out/` y la ausencia de `/preview`, demo (`demo-cds-suite`, `@cds.test`, `@example.test`, teléfonos ficticios), preview (`suite-preview`, `finance-preview`, WhatsApp simulado) y campos excluidos (`faithConfession`, `baptized`, `birthDate`, …).

## 3. Fases

Reglas comunes: `--project cds-administracion` explícito; hora de inicio anotada en el doc 21; CLI del repo (`./node_modules/.bin/firebase`, doc 21 A3); consola del navegador abierta en los smokes; nunca escribir datos de prueba en producción.

| Fase | Comando / acción | Verificación | GO | STOP | Rollback |
|---|---|---|---|---|---|
| **C-A0 · Backup, snapshot, A5** | `gcloud firestore export gs://cds-administracion-backups/pre-consolidacion-$(date +%Y%m%d-%H%M) --project cds-administracion` · snapshot de solo lectura (ruleset, versión de Hosting, `functions:list`, índices) · correr `~/cds-ops/a5-check.mjs` | Export SUCCESSFUL; producción = Etapa A (`2d9939ab…`, `edb77ffc04532a95`, `-00006/-00007/-00002`); A5 sin STOP; **montos = baseline** | Todo OK y D1–D5 resueltos | Export falla, A5 con STOP, producción distinta | Nada cambió |
| **C-A1 · Etapa B (PR #5)** | Fases 0–5 del doc 20 §13 (índice de calendario, reglas RC1, Functions completas, Hosting RC1, smoke). **Sin** Fases 6–7 (migración) salvo GO aparte | Las del doc 20 (Finanzas idéntico, calendario OK, sync SumUp OK) | Smoke del doc 20 Fase 5 PASS | Cualquier diferencia en Finanzas | Doc 20 §14 |
| **C-A2 · Smoke Platform + Calendar** | Admin y pastor, solo lectura | Finanzas: montos = baseline A0; Calendario visible; **Integrantes NO aparece** (aún no hay Hosting de Consolidación); 0 DENY nuevos | Todo igual | Diferencias | Doc 20 §14 |
| **C-A2.5 · Merge del PR de Consolidación** | Con PR #5 ya mergeado: cambiar la base del PR de Consolidación a `feature/preproduccion-mobile-v1`, verificar que el diff muestre solo Consolidación, mergear (merge commit) | `git diff --stat <merge> <head-de-la-rama>` vacío | Diff vacío | Diff no vacío | `git revert -m 1` |
| **C-A3 · Índices** *(adelantado: ver §4)* | `./node_modules/.bin/firebase deploy --only firestore:indexes --project cds-administracion` | `firebase firestore:indexes` lista los 3 índices `members*`; en la consola pasan a **Habilitado** | 3 índices READY | El CLI propone **borrar** índices → responder **No** y STOP | No hace falta (aditivos, sin datos) |
| **C-A4 · Rules de Consolidación** | `./node_modules/.bin/firebase deploy --only firestore:rules --project cds-administracion` | Ruleset nuevo = `firestore.rules` del commit (byte a byte). Simulación de reglas (API `:test`): admin lee `membersPeople`; pastor legacy, leader y finance **no**; nadie escribe. Finanzas: smoke admin + pastor sin DENY nuevos | Simulación esperada y 0 DENY nuevos | Cualquier DENY en Finanzas o Calendario | Restaurar el ruleset de C-A1 (consola › Reglas › historial) |
| **C-A5 · Functions de Consolidación, POR NOMBRE** | `./node_modules/.bin/firebase deploy --only functions:membersPersonCreate,functions:membersPersonUpdate,functions:membersStatusChange,functions:membersVisitCreate,functions:membersFollowUpCreate,functions:membersOwnerOptions --project cds-administracion` | `functions:list`: 6 nuevas en `southamerica-west1`; **SumUp, campaignShare y calendario con la MISMA revisión que en C-A1**. Sin auth: `curl -s -X POST -H 'Content-Type: application/json' -d '{"data":{}}' https://southamerica-west1-cds-administracion.cloudfunctions.net/membersOwnerOptions` → `UNAUTHENTICATED` (no escribe nada) | 6 ACTIVE, revisiones financieras sin cambio | El CLI intenta tocar otras funciones; error de IAM; revisión de `sumupSync*` cambió | `firebase functions:delete <las 6> --region southamerica-west1 --project cds-administracion` (borra código, **no datos**) |
| **C-A6 · Hosting con Integrantes** | `rm -rf out && npm run build && npm run check:no-preview && ./node_modules/.bin/firebase deploy --only hosting --project cds-administracion` | `curl` 200 en `/integrantes/consolidacion` y demás rutas; `check:no-preview` OK | Deploy OK | `check:no-preview` falla | Consola › Hosting › historial → versión de C-A1 |
| **C-A7 · Smoke Admin** | Admin, **solo lectura** | Integrantes visible (5 módulos; barra móvil "Ajustes"); dashboard en **estado vacío**; Atención vacía; Personas vacía; lista de responsables carga (callable `membersOwnerOptions`); Finanzas = baseline; Calendario igual; consola sin errores; 0 DENY nuevos | Todo OK | Error, DENY o diferencia en Finanzas | C-A6 → C-A5 → C-A4 (en ese orden, §5) |
| **C-A8 · Permiso del piloto** | Solo si el piloto no es admin (D3): Configuración › Usuarios › editar → "Gestionar Consolidación" | `--summary`: `consolidation.manage explícito 1`; el piloto ve Integrantes; **un pastor sin el permiso NO lo ve** y el deep link `/integrantes/consolidacion` lo redirige con aviso | Exactamente 1 grant | Más grants o acceso de quien no debe | Quitar el permiso desde la UI (inmediato) |
| **C-A9 · Smoke de Consolidación (sin escribir)** | Piloto | Navegación por las 5 pantallas, formularios abiertos y cerrados **sin guardar**; advertencias visibles ("solo adultos", "no registres información médica…"); sin campos de nacimiento/fe/bautismo; WhatsApp no aparece sin personas | Todo OK | Cualquier campo sensible o error | C-A6 |
| **C-A10 · Primera persona real** | Solo en el **uso operacional normal** (p. ej. una persona nueva del culto). **Nunca** personas de prueba en producción | La persona aparece en "Nuevos recientes" y en Personas; `membersPersonChanges` tiene `person_created` con actor y hora | Registro OK | Error de la Function o dato mal guardado | Ver §5 (nunca se borran datos) |
| **C-A11 · Recorrido completo** | Con esa persona, en el uso normal: visita → seguimiento → (sugerencia confirmada) → alerta → timeline | Timeline con creación, visita, seguimiento y cambio de estado; alertas coherentes; auditoría completa | Todo OK | Cualquier inconsistencia | §5 |
| **C-A12 · Uso controlado** | Otorgar el permiso a las personas que Salvador decida (uno por uno) | `--summary` después de cada grant; observación diaria (§6) | Estable 7 días | Errores, DENY o quejas de privacidad | §5 |

## 4. Cambios de orden respecto del brief (y por qué)

- **Índices antes que Rules y Functions** (C-A3): son aditivos, tardan minutos en construirse y la ficha los necesita. Si se despliegan después del Hosting, la primera ficha abierta falla con `FAILED_PRECONDITION`.
- **Merge del PR de Consolidación (C-A2.5) antes de desplegar**, para que lo desplegado sea exactamente lo mergeado (misma práctica que A1/Etapa B).
- Rules → Functions → Hosting se mantiene: con Rules y Functions activas pero sin Hosting, Integrantes no es visible ni alcanzable (no hay UI y nadie tiene grants salvo admin).

## 5. Rollback (independiente de Finanzas y de SumUp CASH)

**Principio:** el rollback **oculta y detiene escrituras**; **nunca** borra datos. Los datos de personas quedan en Firestore, inaccesibles si se revierten las reglas.

Orden **R3 → R1 → R2 → R4** (Atlas A-01): los grants se revocan mientras la UI de Consolidación sigue publicada, porque la UI de C-A1 no tiene el grupo "Integrantes".

| Paso | Acción | Efecto |
|---|---|---|
| R3 · Revocar grants (higiene, primero) | Con el Hosting de Consolidación aún publicado: Configuración › Usuarios → quitar "Ver/Gestionar Consolidación" a quien lo tenga, incluidos los inactivos. Verificar con `node scripts/migrate-access-v1.mjs --project cds-administracion --summary` **desde un checkout del commit de Consolidación** (es el único `--summary` con ese bloque): `explicitRead + explicitManage + inactiveWithGrant == 0` | Deja los perfiles limpios para RC1. **No** es el cierre de acceso (eso es R2/R4): con las reglas RC1 esos permisos guardados no dan acceso a nada, y la UI de C-A1 los descartaría al guardar |
| R1 · Ocultar | Consola › Hosting › historial → **revertir a la versión de C-A1** | Integrantes desaparece del menú y de las rutas. Finanzas y Calendario quedan como en C-A1 |
| R2 · Detener escrituras | `./node_modules/.bin/firebase functions:delete membersPersonCreate membersPersonUpdate membersStatusChange membersVisitCreate membersFollowUpCreate membersOwnerOptions --region southamerica-west1 --project cds-administracion` | Nadie puede escribir (ni con la consola del navegador). No toca SumUp ni calendario. Los datos no se borran |
| R4 · Cerrar lectura | Consola › Reglas › historial → **restaurar el ruleset de C-A1** | Las 4 colecciones caen en el catch-all: nadie las lee desde el cliente. Datos intactos |
| R5 · Índices | No se tocan | Aditivos e inofensivos |

Si hay urgencia (exposición de datos), R1 + R2 + R4 pueden ir primero y R3 después: el acceso lo cierran las reglas, no los perfiles.

- Cada paso es independiente: ante un problema de UI basta R1; ante un problema de escrituras, R1 + R2.
- **Nunca** se revierte Financial Core ni se toca SumUp CASH en un rollback de Consolidación.
- Re-habilitar: C-A4 → C-A5 → C-A6 desde el mismo commit.

### 5.1 Caveat legacy ampliado (Atlas A-02, doc 20 §14)

Un usuario v1 con **solo** permisos de Integrantes guarda `role = "leader"` (rol derivado). Si alguna vez se volviera a las **reglas legacy de la Etapa A** (`e6b2084`), ese rol leería el **resumen financiero** mensual. El doc 20 lo aceptó con conteo 0; cada grant de C-A8/C-A12 a alguien sin finanzas lo sube.
- El detector existe: `--summary` → "v1 con riesgo de rollback".
- El rollback de Consolidación (R4) vuelve a **RC1**, no a las reglas legacy: sigue siendo seguro.
- Si algún día se vuelve a las reglas legacy: aplicar antes el procedimiento del doc 20 §14 (desactivar a esos usuarios) **y** R3.

## 6. Observación posterior

Diario durante 7 días (además de A5/Etapa B):
- `functions:list` (revisiones de las 6 `members*` y de SumUp sin cambios);
- logs `severity>=ERROR` de las `members*` (sin PII: el código solo registra método, nombre y código del error);
- evaluaciones de reglas DENY (esperadas: 0 en Finanzas);
- `node scripts/migrate-access-v1.mjs --project cds-administracion --summary` (bloque Integrantes: solo los grants decididos);
- montos financieros = baseline (A5).

## 7. Qué NO se hace el miércoles

- Ningún deploy de SumUp CASH (otro carril, otro PR, otro deploy).
- Ninguna migración masiva de usuarios sin GO aparte.
- Ninguna persona ficticia en producción.
- Ningún cambio de Financial Core.
