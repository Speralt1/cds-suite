# 42 · «Ve por los tuyos»: backend H3 (permisos, Rules, Functions, mesas)

Fecha: 03/11/2026. Rama `feature/vplt-backend-h3`, apilada sobre `design/suite-redesign-vplt-20261103` (PR #35). Hito H3 del doc 41. **Implementado y probado en emuladores (`demo-cds-suite`); NO desplegado.** Nada de producción, datos reales, correos ni WhatsApp.

## 1. Qué se construyó

| Pieza | Detalle |
|---|---|
| Dominio compartido | `lib/shared/outreach-*.ts` → `functions/shared/*.js`: cliente y Functions usan el mismo código. `lib/outreach/*` re-exporta. |
| Permisos 10→14 | `members.outreach.coordinate` (implica `reception`), `reception`, `followup_assigned`, `decisions`. Ningún rol antiguo los recibe; la migración no los agrega. Admin los tiene de forma implícita (decisión pendiente, doc 40 §4). |
| Navegación | Integrantes visible con Consolidación **o** con un permiso del evento; `/integrantes/consolidacion` sigue exigiendo `members.consolidation.read`; quien solo tiene permisos del evento entra directo a Ve por los tuyos. |
| Rules | Todas las escrituras de cliente en `false`. Coordinación lee todo; recepción solo `receptionOpen`; el responsable solo `assigneeUid == su uid` en edición activa, y la consulta debe filtrar así o se rechaza. Decisiones: permiso pastoral, admin, o el encargado **de esa mesa** (decisión del 03/11). Bandeja cruda del sitio y secretos de enlaces: sin acceso de cliente. |
| Índices | 4 compuestos sobre `outreachRegistrations` y 1 sobre `outreachDecisions`, según el contrato de consultas. |
| Functions | `outreachCoordinatorOp`, `outreachFollowupOp`, `outreachTableOp` (sin login; con token), `outreachDecisionOp`. Formato `{op, payload}`; cada operación es un método del servicio con prueba propia. Misma región y opciones que `members*`. |
| Mesas | Token de 256 bits que se muestra una sola vez; se guarda solo su sha256 en `tableSecrets`; ventana D 16:00 → D+1 02:00; revocable; 120 operaciones cada 10 min por mesa; auditoría `outreachTableMarks` sin el token. La marca escribe la inscripción y la decisión en la misma transacción. |
| Importación | `importRegistrations` con `dryRun` (informe sin escribir) y aplicación idempotente en lotes de 100 con cursor: re-importar no cambia nada. |
| Distribución | Propuesta por mesa (`tableAffinity`), confirmación idempotente por lote, conflictos sin pisar, reasignar y liberar con motivo; el responsable desnormalizado en inscripción y decisión dentro de la misma transacción. |

## 2. Pruebas

| Suite | Antes | Después |
|---|---|---|
| Unitarias/UI (`npx vitest run`) | 1.870 | **1.914** (+35 servicio, +9 cableado) |
| Rules (`npm run test:rules`) | 321 | **325** |
| Emuladores (`npm run test:emulator`) | 33 | **39** |

Simulación completa 300/35 con el servicio real: edición, equipo, 35 mesas con enlace, importación (prueba, aplicación y re-aplicación sin cambios), 240 marcas en mesa, 10 llegadas sin inscripción, 40 ausencias confirmadas, distribución por mesa (nadie supera 20; cada persona con el encargado de su mesa), 250 primeros contactos, 40 bajas. Se verifica: cero escrituras en `members*` y Finanzas, decisiones solo en `outreachDecisions`, token nunca guardado ni registrado en claro.

En emulador, concurrencia real: dos mesas marcando a la misma persona (una decisión y un rechazo «otra mesa»), dos coordinadores confirmando el mismo lote (sin doble asignación), contacto durante una reasignación, importación concurrente (300 exactas), y lecturas de un encargado con el SDK de cliente (lo suyo sí, lo ajeno y sin filtro no).

Lint, tipos, `build:shared --check`, build y `check:no-preview` en verde. Archivos de SumUp, Consolidación, Calendario y Finanzas sin cambios.

## 3. Decisiones de implementación a revisar

1. El enlace de mesa lleva `editionId`, número de mesa y token (busca por ruta, sin índice por hash). El enlace de H4 debe incluir los tres; el token va en el fragmento (`#`) y se envía por POST, como el calendario público.
2. Se agregó `editionUpdate` (fecha, título, tope) además de lo especificado.
3. Los ítems por revisar de la importación y los posibles duplicados de mesa viven en `outreachInbox` (sin acceso de cliente); `stats` los cuenta. Falta una operación para listarlos (H4).
4. Importación: hasta 1.000 filas y 600 KB por llamada; timeout de 20 s probado solo en emulador.
5. Reemitir un enlace invalida el anterior (no es idempotente por diseño).
6. La búsqueda de mesa muestra la marca solo si es de esa mesa; lee la edición completa por llamada (bien para ~300–1.000).
7. La asistencia viene de la puerta del sitio (importación), de una marca en mesa o de una llegada sin inscripción; no hay operación de recepción en CDS.

## 4. Riesgos conocidos

- El tope por responsable se controla por lote: dos lotes **distintos** confirmados al mismo tiempo podrían superarlo. Mitigación operativa: una sola persona confirma la distribución; mitigación técnica en H4 (contador por responsable en la transacción).
- No hay freno a intentos de token inválidos (un token de 256 bits no se puede adivinar; la cuota rige tras un token válido).
- Estadísticas, propuesta y búsqueda cargan la edición completa en memoria (tope 5.000).

## 5. Preguntas para el administrador

1. ¿Coordinación sin permiso pastoral puede ver cuántas personas hay por mesa? Hoy sí; los conteos de decisiones solo con permiso pastoral o admin, y por mesa se ocultan las celdas con menos de 5.
2. ¿Los totales de decisiones (sin desglose por mesa) pueden mostrarse sin ocultar valores bajos?
3. ¿Admin debe ver decisiones de forma implícita?

## 6. Siguiente (H4, doc 41)

Pantallas reales conectadas a estas Functions (coordinación, Mi lista, Mesa por enlace), lista de revisión, importador CSV desde la exportación del sitio con prueba previa, contador de tope por responsable, y publicación con GO por subfase (índices → Rules → cuatro Functions por nombre → Hosting).
