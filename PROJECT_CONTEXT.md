# PROJECT_CONTEXT

> Punto de entrada obligatorio para cualquier IA, persona o agente que trabaje en CDS Suite.
> Leer este archivo antes de proponer arquitectura, reorganizar ramas, desplegar o iniciar una nueva Slice.

> **Estado verificado el 03/11/2026:** integración `feature/preproduccion-mobile-v1` @ `531e42e` (PR #20 fusionado el 19/10). Consolidación y `fundsPosition: false` están en código, no desplegados. Hosting live `ec3d614eb95dc213` (16/10), Rules `5df51b09…`, sin Functions ni índices `members*`. Finanzas y Calendario sí están publicados. Ver [revisión vigente y evento](docs/mission-2026/38-project-review-event-20261103.md) y la **[hoja de ruta única](docs/mission-2026/41-roadmap-suite.md)**. Los relatos de §2–§9 y §18–§20 son históricos; §16–§17 tienen prioridad para continuar.

## 1. Identidad del proyecto

- **Nombre:** CDS Suite. **Nombre visible propuesto: «Alero · Casa de Salvación»** (doc 39; implementado en rama, no desplegado). El cambio de marca no toca proyecto Firebase, colecciones, Functions, rutas ni permisos.
- **Propósito:** suite operativa para Casa de Salvación, organizada por módulos (§1.1). Su foco actual son finanzas (SumUp, ofrendas, cafetería, diezmos, movimientos, reportes y configuración) y calendario.
- **Owner:** Salvador
- **Repositorio:** `Speralt1/cds-suite`
- **Checkout canónico local:** `~/Documents/Proyectos Desarrollo/Proyects/CDS/cds-suite`
- **Base histórica/default actual de GitHub:** `feature/base-cds-suite`
- **Línea de integración / preproducción:** `feature/preproduccion-mobile-v1`
- **Rama de integración activa:** `feature/preproduccion-mobile-v1` @ `531e42e`; Hosting vigente corresponde a la versión documentada para PR #32 / `1951f2b`.
- **Revisión en curso:** `review/consolidation-event-ux-20261103`, desde `531e42e`; login visual y simulación ficticia 300/15, sin producción (doc 38).
- **Rediseño y evento:** `design/suite-redesign-vplt-20261103`, apilada sobre la anterior: identidad Alero, núcleo de dominio de «Ve por los tuyos» con simulación, docs 39–41. Sin producción.
- **Dependencias:** `chore/deps-security-20261103` (PR #34) desde integración; audit productivo 9→0. Sin deploy.
- **Trabajo posterior preservado:** `mission/slice3a-sumup-fees`
- **Trello:** pendiente de enlazar.

### 1.1 Módulos de CDS Suite

| Módulo | Estado |
|---|---|
| **Finanzas** | Publicado: movimientos, caja, diezmos, resumen, conciliación y reportes. Tarjeta de saldo oculta en código nuevo, aún no publicada esa retirada. |
| **Calendario** | Publicado: actividades, áreas, permisos, enlace público y reporte. |
| **Reportes** | Finanzas y Calendario publicados. |
| **Configuración** | Áreas, usuarios/permisos y Finanzas publicados. |
| **Integrantes › Consolidación V1** | PR #20 fusionado en `531e42e`; probado con emuladores. **No desplegado**; no crear datos reales como prueba. |
| **Integrantes › Ve por los tuyos** | Núcleo de dominio y simulación 300/15 en rama; backend, permisos e integraciones propuestos (docs 40–41). Ruta productiva muestra «en preparación». |
| **Equipos** | Áreas y permisos como base; no hay módulo propio de turnos/equipos. |

El modelo de acceso nuevo es `role` (legacy, se conserva) + `baseRole` + `position` + `permissions[]` + `areaIds[]` + `homeModule` + `active` + `accessSchemaVersion`. Las reglas tienen un fallback exacto al rol legacy mientras dure la migración. Detalle en `docs/mission-2026/18-platform-core-calendar-production-spec.md` §3.

## 2. Regla de continuidad

CDS Suite NO está comenzando desde cero.

Una IA nueva debe entender primero la topología actual:

```
feature/base-cds-suite
42408d6
    │
    │ +29 commits
    ▼
feature/preproduccion-mobile-v1
648afd1
    │
    │ +37 commits
    ▼
mission/slice6-usability
70652bd
    │
    │ +14 commits
    ▼
mission/slice3a-sumup-fees
6d67de5
```

No cambiar la rama canónica o default por conveniencia antes de cerrar la estrategia de integración.

## 3. Estado verificado al 2026-09-27

### Checkout principal

- Rama: `mission/slice6-usability`
- HEAD previo a este documento: `70652bd`
- Upstream: `origin/mission/slice6-usability`
- Local vs upstream: `0 / 0`
- Working tree limpio
- Worktrees activos registrados: 1 checkout principal

### Worktree Slice 3A

El antiguo worktree:

`~/cds-suite-slice3a-validation`

fue auditado y retirado de forma segura.

Su HEAD era:

`6d67de5`

y coincidía exactamente con:

`origin/mission/slice3a-sumup-fees`

Por lo tanto:
- la carpeta temporal fue retirada;
- la rama local sigue existiendo;
- la rama remota sigue existiendo;
- no se perdió ningún commit.

## 4. Estado de ramas

### `feature/base-cds-suite`

- HEAD observado: `42408d6`
- Base histórica del proyecto.
- GitHub todavía la tiene como default branch.
- No representa el trabajo más avanzado actual.

### `feature/preproduccion-mobile-v1`

- HEAD observado: `648afd1`
- 29 commits por delante de la base histórica.
- Línea de integración / preproducción vigente.

### `mission/slice6-usability`

- HEAD observado antes de este archivo: `70652bd`
- 37 commits por delante de preproducción.
- 0 commits por detrás de preproducción.
- Es la rama del PR activo #1.

### `mission/slice3a-sumup-fees`

- HEAD observado: `6d67de5`
- 14 commits por delante de `mission/slice6-usability`.
- 0 commits por detrás de `mission/slice6-usability`.
- Contiene trabajo posterior de fees / settlements / revisión SumUp.
- No eliminar ni fusionar automáticamente.

## 5. PR activo

PR #1:

`mission/slice6-usability` → `feature/preproduccion-mobile-v1`

Título:

**Financial Core 2026: Slices 1, 1b y 6 (SumUp confiable, etiquetas veraces, usabilidad)**

Estado observado:
- abierto;
- no draft;
- mergeable;
- no mergeado.

El PR incluye Slices 1, 1b y 6 y documentación asociada.

## 6. Financial Core 2026

### Slice 1 — SumUp reliability

Incluye:
- clasificación determinista;
- watermark;
- paginación;
- lease contra sincronización simultánea;
- presupuesto por run;
- aislamiento por cuenta;
- idempotencia;
- observabilidad con `sumupSyncRuns`.

### Slice 1b — Etiquetas veraces

Principios:
- no mostrar “líquido” si la comisión real no existe en la fuente;
- evitar estados falsamente “conciliados”;
- SumUp en solo lectura cuando corresponde;
- no inventar montos.

### Slice 6 — Usabilidad

Incluye:
- navegación unificada;
- redirección hacia finanzas;
- resumen financiero;
- acciones rápidas;
- desglose por tipo de dinero;
- calendario financiero;
- mejoras de ofrendas/cafetería;
- diezmos;
- reportes;
- insights financieros;
- movimientos agrupados;
- UX móvil.

## 7. Slice 3A — SumUp fees

`mission/slice3a-sumup-fees` es trabajo posterior y separado.

Último commit observado:

`6d67de5`

Ese commit agrega tests dedicados para transacciones excluidas y settlements.

Verificación documentada en ese commit:
- `npx vitest run`: 261/261
- lint
- typecheck
- Next build
- `node --check` para Functions

Estos resultados corresponden a Slice 3A y no deben atribuirse automáticamente a cualquier otra rama futura.

## 8. Gates documentados del PR #1

El PR #1 documentó, en Mac el 2026-09-25:

- `npm ci` ✅
- `npm run lint` ✅
- `npm run typecheck` ✅
- `npx vitest run` ✅ 153/153
- `npm run test:rules` ✅ 22/22
- `npm run build` ✅

Estos resultados son evidencia histórica del PR, no sustituyen re-ejecutar gates si el código cambia.

## 9. Estado de despliegue

El PR #1 documenta explícitamente:

> Sin desplegar.

No asumir que:
- una rama subida a GitHub;
- un PR abierto;
- tests verdes;
- o un merge local

significan que Firebase / Functions / Firestore Rules estén desplegados.

Antes de cualquier despliegue:
1. verificar commit exacto;
2. revisar checklist;
3. revisar reglas Firestore;
4. revisar Functions;
5. revisar rollback;
6. obtener autorización humana.

## 10. Invariantes de finanzas

- No inventar comisión SumUp si la fuente no la entrega.
- No alterar transacciones SumUp desde cliente cuando son backend-only.
- Mantener trazabilidad.
- Separar bruto, reembolsos, fees y ajustes.
- No mezclar datos estimados con datos contables reales.
- No mostrar una etiqueta que sugiera una verdad financiera no respaldada.
- Preservar consistencia entre dashboard, movimientos y reportes.

## 11. Firestore y backend

Cambios en:
- `firestore.rules`;
- `functions/`;
- SumUp;
- sincronización;
- settlements;
- ajustes

requieren un nivel de revisión mayor que cambios puramente visuales.

No desplegar reglas o Functions como efecto colateral de un cambio de UI.

## 12. Protocolo obligatorio para IA

Antes de trabajar:

1. Leer `PROJECT_CONTEXT.md`.
2. Ejecutar:
   - `git status`
   - `git branch --show-current`
   - `git log -1`
   - verificar upstream.
3. Determinar en qué rama está la tarea.
4. Revisar PR #1 si la tarea toca Slices 1, 1b o 6.
5. Revisar `mission/slice3a-sumup-fees` si la tarea toca fees, payouts o settlements.
6. Leer solo los docs de `docs/mission-2026/` relevantes.
7. No crear otro roadmap paralelo.

Una IA NO debe:
- tratar `feature/base-cds-suite` como estado actual;
- fusionar ramas por “ordenar”;
- desplegar automáticamente;
- borrar Slice 3A;
- reescribir Financial Core desde cero;
- inventar cifras financieras.

## 13. Documentación relevante

Principalmente:

`docs/mission-2026/`

Incluye:
- baseline;
- modelo financiero;
- auditoría SumUp;
- conciliación/Getnet;
- financial truth check;
- UX audit / Design Lock;
- implementation plan;
- decisiones humanas;
- specs de Slice 6.

No leer toda la carpeta por defecto si la tarea es pequeña.

## 14. Ciclo de trabajo

1. Definir objetivo.
2. Definir Definition of Done.
3. Identificar Slice/rama.
4. Revisar docs mínimos.
5. Implementar.
6. Ejecutar tests relevantes.
7. lint/typecheck/build cuando aplique.
8. Commit.
9. Push.
10. PR/integración.
11. Validación humana.
12. Deploy separado si corresponde.
13. Actualizar Trello.
14. Actualizar este contexto si cambia estado global.

## 15. Definition of Done genérica

- [ ] objetivo definido;
- [ ] rama correcta;
- [ ] implementación terminada;
- [ ] tests relevantes verdes;
- [ ] lint verde;
- [ ] typecheck verde;
- [ ] build verde;
- [ ] rules tests cuando aplica;
- [ ] riesgos financieros revisados;
- [ ] commit creado;
- [ ] push confirmado;
- [ ] PR actualizado;
- [ ] validación humana realizada cuando aplica;
- [ ] deploy validado por separado cuando aplica;
- [ ] Trello actualizado;
- [ ] PROJECT_CONTEXT actualizado si cambió el estado global.

## 16. Estado automático

> Por ahora esta sección se actualiza manualmente.

<!-- AUTO-STATUS:START -->
- **Base histórica/default:** `feature/base-cds-suite` @ `084bd4d` (control plane; no es la base funcional).
- **Integración:** `feature/preproduccion-mobile-v1` @ `531e42e`, merge PR #20 el 19/10; CI SUCCESS, run `39199885370`.
- **Consolidación:** rama `integration/consolidation-v1-on-18925d6` @ `dc5fbf9`, ya contenida; PR #7 queda Draft histórico. **NOT DEPLOYED**.
- **Saldo esperado:** `FINANCE_FEATURES.fundsPosition = false` ya integrado; retirada no publicada aún.
- **Producción, lectura del 03/11:** Finanzas + Platform Core / Calendario publicados; Hosting `ec3d614eb95dc213`, release `1792125366342000` (16/10, versión documentada para PR #32 / `1951f2b`; Firebase no certifica SHA); Rules `5df51b09-b460-4515-8fb5-505983c8f1c8`; 6 Functions ACTIVE de SumUp, campañas y calendario, ninguna `members*`; sin índices compuestos `members*`.
- **Functions:** cualquier deploy por nombre y GO separado; no redesplegar SumUp como efecto colateral.
- **Previews conservadas:** PR #3 `8e79cd1`, PR #4 `b65e85b`. Lector de campañas: #8/#9 Draft, #9 conflictivo.
- **Slice 3A preservada:** `mission/slice3a-sumup-fees` @ `6d67de5` (14 commits exclusivos).
- **Checkout canónico histórico:** `~/Documents/Proyectos Desarrollo/Proyects/CDS/cds-suite`; esta revisión usa un worktree aislado y no lo reemplaza.
- **Evidencia vigente:** docs 38–41; lista nominal de accesos y revisiones del sitio del evento y del motor de mensajería en el expediente privado, fuera del repositorio público.
- **Sitio del evento:** el sistema de inscripciones vive en `Speralt1/web-casa-de-salvacion` (privado), en producción desde 01/11; edición 2026 el **28/11/2026 18:00, confirmada por el administrador el 03/11** (camino crítico en doc 41 §2). ~35 mesas; cada encargado marca decisiones en su mesa con un enlace propio y hace el seguimiento de su mesa (doc 40 §6b). Cada push a su rama de producción despliega.
- **Última verificación:** 2026-11-03. Ningún deploy ni cambio de permisos en esta revisión.
<!-- AUTO-STATUS:END -->

## 17. Siguiente acción exacta

0. Seguir la **hoja de ruta única (doc 41)**: F0 revisión de PR #33, PR #34 y la rama de rediseño; fecha del evento confirmada (28/11); confirmar nombre y logo.
1. Revisar el PR de login y simulaciones (doc 38) y su CI. Pruebas técnicas con perfiles ficticios, sin depender de titulares reales.
2. Para publicar Consolidación, reanudar doc 25 desde C-A0 con baseline vivo y backup; C-A2.5 (merge) ya está hecho. C-A3 índices → C-A4 Rules → C-A5 seis `members*` por nombre → C-A6 Hosting → smokes/piloto admin. El doc 25 conserva filas de estado anteriores al merge: usar la evidencia viva del doc 38.
3. Antes de abrir el evento a 15 responsables: separar inscripción de visita, asistencia por evento, consentimiento y acceso solo a asignados. V1 excluye decisiones religiosas; diseño restringido y aprobación separada antes de almacenarlas.
4. Mantener `feature/preproduccion-mobile-v1` como integración, preservar Slice 3A y no cambiar default.
5. **Ningún deploy** sin aprobación humana explícita por fase. No activar WSP ni enviar mensajes reales como efecto colateral.

## 18. Hitos recientes

- Financial Core 2026 modelado e implementado en Slices 1, 1b y 6.
- PR #1 abierto hacia preproducción.
- Slice 3A preservado en GitHub.
- Worktree temporal Slice 3A retirado sin perder commits.
- Checkout principal movido a `Proyectos Desarrollo`.
- `PROJECT_CONTEXT.md` adoptado como contrato de continuidad.
- 2026-10-02: previews de diseño PR #3 (Financial UX V2) y PR #4 (Calendario + Integrantes/Consolidación), solo fixtures, sin deploy.
- 2026-10-03: Platform Core V1 + Calendar implementado en código productivo (rama `mission/platform-core-calendar-v1`), validado con Firebase Emulator Suite. **No desplegado.**
- 2026-10-03/04: **Etapa A desplegada en producción** (PR #1 mergeado; Rules, Functions y Hosting de `e6b2084`). Backup previo, `feeAmount` = 0, alerta del scheduler SumUp, montos idénticos al baseline. Doc 21.
- 2026-10-03: RC1 / hardening previo al deploy (doc 20). Token del calendario público en el fragmento + POST; `--summary` en la migración; snapshot de producción; runbook por fases; GO FOR CONTROLLED DEPLOYMENT. **No desplegado.**

## 19. Platform Core V1 + Calendar (RC1, NOT DEPLOYED)

- **Rama:** `mission/platform-core-calendar-v1`, desde `origin/mission/slice6-usability` @ `e6b2084`. Draft PR contra `mission/slice6-usability`, marcado **NO DEPLOY · NO PRODUCTION DATA · EMULATOR VALIDATED**. **No mergear.**
- **Docs:**
  - `docs/mission-2026/18-platform-core-calendar-production-spec.md`, con anexos 18a (Atlas) y 18b (Designer);
  - `docs/mission-2026/19-platform-core-calendar-validation.md`.
- **Qué incluye:**
  - shell global por módulos;
  - acceso por permisos con fallback legacy exacto;
  - áreas;
  - Calendario (recurrencia V1 y auditoría atómica);
  - publicar separado de gestionar;
  - enlace público con token hasheado + Functions `calendarPublicFeed`/`calendarShareLinkManage`;
  - reporte de Calendario + PDF;
  - Configuración › Áreas y Usuarios y permisos;
  - migración `scripts/migrate-access-v1.mjs` (dry-run por defecto);
  - seed y experiencia local con emuladores.
- **Qué NO está desplegado:** nada. Ni reglas, ni Functions, ni índices, ni Hosting. La migración de usuarios **no** se ejecutó contra producción.
- **Relación con los PR:**
  - se construye sobre PR #1 (base productiva);
  - PR #3 y PR #4 son referencias de diseño y producto: se portó código revisado de forma selectiva, sin merges;
  - Integrantes/Consolidación sigue siendo solo preview;
  - Slice 3A queda preservado y fuera de esta misión.
- **RC1 (doc 20):**
  - el enlace público es `/calendario-publico#<token>` y el feed recibe el token por POST (nunca en la URL);
  - `node scripts/migrate-access-v1.mjs --project <id> --summary` da un dry-run solo con conteos;
  - el rollback a reglas legacy exige primero el procedimiento del doc 20 §14 (v1 sin finanzas);
  - en producción, PITR está desactivado y no hay backups ni alertas: se resuelven en la Fase 0 del rollout.
- **Local:** `npm run dev:platform` levanta Auth + Firestore + Functions con el proyecto `demo-cds-suite`, siembra datos ficticios y arranca Next sin tocar Firebase real. **Ojo:** `npm run dev` a secas usa `.env.local`, que apunta al proyecto real.

## 20. Integrantes › Consolidación V1 · Fast Track (NOT DEPLOYED)

- **Rama:** `mission/consolidation-v1-fasttrack`, creada desde PR #5 @ `73b9040` (stacked). Draft PR con base `mission/platform-core-calendar-v1`. **No mergear ni desplegar** sin el GO por fase del doc 25.
- **Docs:** `docs/mission-2026/23-consolidation-v1-production-spec.md` (spec y matriz preview → producción), `24-consolidation-v1-security-review.md` (+ anexos 24a/24b de Atlas), `25-consolidation-v1-rollout.md` (runbook C-A0…C-A12 y rollback).
- **Qué incluye:** permisos `members.consolidation.read/manage` (admin implícito; el fallback legacy no los otorga), módulo Integrantes, 4 colecciones `members*` de solo lectura para el cliente, 6 callables `members*` (escrituras transaccionales, idempotentes y auditadas), 3 índices, UI portada de PR #4 con privacidad reducida (sin datos religiosos, nacimiento ni menores), `check:no-preview`, `--summary` con el bloque de Integrantes.
- **Qué NO está desplegado:** nada (ni reglas, ni Functions, ni índices, ni Hosting). Ninguna persona real cargada. Ningún permiso otorgado.
- **Dependencia:** requiere la Etapa B (PR #5) desplegada antes (C-A1).
- **Integración con producción `18925d6` (2026-10-13):** rama `integration/consolidation-v1-on-18925d6` (merge real de `feature/preproduccion-mobile-v1` @ `18925d6` = PR #5 + PR #12, fix del presupuesto de expresiones de Rules). Conserva los helpers financieros especializados y agrega `membersRead()`. Detalle, márgenes y prerrequisitos de deploy en `docs/mission-2026/32-consolidation-integration-18925d6.md`. **NOT DEPLOYED**; la rama original de PR #7 no se modificó.
- **Estado (2026-10-08, R1/R4):** integrada sobre PR #5 `a8d782d`, que a su vez integra producción `a312c96` (CASH + R0G). Gates (unit, rules, emulador, build, `check:no-preview`) y Atlas en verde; QA visual de integración PASS. Lista para un **C-A0 fresco**. Nada desplegado.
- **Estado (2026-10-05, histórico):** QA visual PASS; 0 BLOCKER / 0 MAJOR; decisiones D1–D5 y excepción de eliminación **resueltas** (doc 25 §1): Etapa B puede empezar antes del cierre de A5 pero con GO por fase; piloto = Salvador como Admin, sin grants; migración masiva diferida. **Listo para iniciar C-A0 con GO humano.** Nada desplegado.
- **Aislado de:** Financial Core y SumUp CASH. Consolidación no modifica `functions/sumup/**`, `lib/finance/**` ni `components/finance/**`; esos archivos son idénticos a PR #5, y el modal de efectivo y el motor SumUp son idénticos a producción.
