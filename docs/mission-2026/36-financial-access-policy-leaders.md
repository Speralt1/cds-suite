# 36 · Política de acceso financiero: líderes y diáconos sin Finanzas por defecto

**Decisión del administrador (16/10/2026).** La información financiera queda disponible por defecto solo para Administración, Pastores y Tesorería (Finanzas). Líderes y diáconos no reciben permisos financieros automáticamente. El administrador puede otorgar a mano **«Ver resumen financiero»** (`finance.summary.read`) a un líder; ese permiso no da movimientos, fichas, administración financiera ni tesorería.

**Estado:** Draft PR, sin merge ni deploy (requiere GO de merge, Rules y Hosting).

## Qué cambia
| Pieza | Antes | Después |
|---|---|---|
| `LEGACY_ROLE_ACCESS.leader` (`lib/shared/access.ts` y copia `functions/shared/access.js`) | `finance.summary.read`, `calendar.read`, `calendar.events.manage_assigned` | `calendar.read`, `calendar.events.manage_assigned` |
| Cargos sugeridos **Líder** y **Diácono** (`lib/settings/users.ts`, derivados del mapeo) | incluían el resumen financiero | solo Calendario |
| Alta de usuario con rol líder, promoción de un perfil legacy y `migrate-access-v1` | heredaban el resumen | heredan solo Calendario |
| Firestore Rules `legacyPermissions('leader')` | con `finance.summary.read` | sin él |
| Firestore Rules `financeSummaryOf()` rama legacy | `role in ['admin','pastor','finance','leader']` | `role in ['admin','pastor','finance']` |

**No cambia:**
- El catálogo de permisos: «Ver resumen financiero» sigue en Configuración › Usuarios › Finanzas.
- Las implicaciones: el resumen no implica detalle.
- Los cargos Pastor, Finanzas y Administración.
- Los perfiles v1 existentes: sus permisos guardados son explícitos y no se tocan.

## Detector de riesgo de rollback
`migrate-access-v1 --summary` sigue calculando «v1 con riesgo de rollback» contra lo que dan las **reglas ya publicadas** (hasta `80a69cd5` y las legacy de la Etapa A), mediante `PREVIOUS_RULES_LEGACY_FINANCE`. Así no oculta el riesgo real de volver a esas reglas. Con estas reglas nuevas, ese riesgo desaparece para el rol `leader`.

## Verificación
- **Matriz de acceso** (Rules test API, 286 casos, 13 perfiles) contra el ruleset publicado `80a69cd5`: **1 diferencia**, `legacy-leader get financeMonthlySummaries` ALLOW → DENY. Admin, pastor y finance (legacy y v1), inactivos y anónimos: sin cambios.
- **Presupuesto de Rules:** mínimo 118 / 125 expresiones, igual que producción.
- **Tests:**
  - **Presets:** Líder y Diácono sin Finanzas, directo ni implicado. Pastor, Finanzas y Administración quedan idénticos. El resumen se puede otorgar a mano sin arrastrar detalle. Reaplicar el cargo nunca otorga Finanzas.
  - **Rutas:** un líder sin Finanzas ve el aviso y vuelve a Calendario en `/finanzas/**`. Un líder con resumen autorizado conserva las subrutas, con `DetailGuard` como barrera.
  - **Firestore Rules:** el líder legacy y el v1 con preset no leen nada financiero. Con el resumen otorgado, lee solo `financeMonthlySummaries`. Admin, pastor y finance conservan el resumen y el inactivo sigue bloqueado. El calendario del líder sigue funcionando.

## Producción (ya aplicado, sin código nuevo)
El 16/10/2026 el administrador, desde Configuración › Usuarios, quitó `finance.summary.read` a los 7 perfiles con rol líder que lo tenían (6 diáconos y 1 líder). Se cambió solo `permissions`; cuenta, estado, cargo, áreas, permisos de Calendario y módulo inicial quedaron iguales. Registro privado en `~/cds-ops/fin-policy-20261016/`.

## Despliegue propuesto (cada paso con su GO)
1. **Rules** (rollback `80a69cd5-a2b4-413e-803e-193b5205c3b0`). Hoy no hay perfiles legacy en producción (11 de 11 son v1), así que el efecto es nulo para los usuarios actuales.
2. **Hosting** (rollback `0a6ab8858afd6a23`). Cambia los cargos sugeridos y las altas nuevas.

Interacción con PR #20 (Consolidación): ambos tocan `lib/shared/access.ts`, `functions/shared/access.js` y `firestore.rules` en zonas distintas. Hay que reintegrar el que se mergee segundo.
