# PROJECT_CONTEXT

> Punto de entrada obligatorio para cualquier IA, persona o agente que trabaje en CDS Suite.
> Leer este archivo antes de proponer arquitectura, reorganizar ramas, desplegar o iniciar una nueva Slice.

## 1. Identidad del proyecto

- **Nombre:** CDS Suite
- **Propósito:** suite operativa para Casa de Salvación, con foco actual en finanzas, SumUp, ofrendas, cafetería, diezmos, movimientos, reportes y configuración.
- **Owner:** Salvador
- **Repositorio:** `Speralt1/cds-suite`
- **Checkout canónico local:** `~/Documents/Proyectos Desarrollo/Proyects/CDS/cds-suite`
- **Base histórica/default actual de GitHub:** `feature/base-cds-suite`
- **Línea de integración / preproducción:** `feature/preproduccion-mobile-v1`
- **Rama activa de trabajo:** `mission/slice6-usability`
- **Trabajo posterior preservado:** `mission/slice3a-sumup-fees`
- **Trello:** pendiente de enlazar.

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
- **Base histórica:** `feature/base-cds-suite` @ `42408d6`
- **Integración / preproducción:** `feature/preproduccion-mobile-v1` @ `648afd1`
- **Rama activa principal:** `mission/slice6-usability`
- **HEAD previo a este contexto:** `70652bd`
- **Upstream:** `origin/mission/slice6-usability`
- **Local vs upstream al último chequeo:** `0 / 0`
- **PR activo principal:** #1
- **Trabajo posterior preservado:** `mission/slice3a-sumup-fees` @ `6d67de5`
- **Checkout canónico local:** `~/Documents/Proyectos Desarrollo/Proyects/CDS/cds-suite`
- **Última sincronización de contexto:** 2026-09-27
<!-- AUTO-STATUS:END -->

## 17. Siguiente acción exacta

> No iniciar una nueva rama principal todavía.

Primero:
1. decidir el destino del PR #1;
2. confirmar qué parte de Slice 3A debe integrarse después;
3. mantener `feature/preproduccion-mobile-v1` como línea de integración mientras esa decisión siga abierta;
4. no cambiar todavía la default branch de GitHub.

## 18. Hitos recientes

- Financial Core 2026 modelado e implementado en Slices 1, 1b y 6.
- PR #1 abierto hacia preproducción.
- Slice 3A preservado en GitHub.
- Worktree temporal Slice 3A retirado sin perder commits.
- Checkout principal movido a `Proyectos Desarrollo`.
- `PROJECT_CONTEXT.md` adoptado como contrato de continuidad.
