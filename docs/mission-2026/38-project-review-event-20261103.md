# CDS Suite · estado verificado y preparación de «Ve por los tuyos»

Fecha: 03/11/2026, America/Santiago. Revisión sobre `531e42ec8c4a4988a1efa0cdf05254d7f2c6e8f6`.
Esta revisión actualiza la evidencia de los docs 23, 25 y 32; no reemplaza el rollout por fases del doc 25. **Sin merge, deploy, migración, cambios de permisos ni mensajes reales en esta revisión.**

## 1. Conclusión operativa

Consolidación V1 está implementada y fusionada, pero no desplegada. El obstáculo ya no es esperar pruebas de usuarios: se pueden repetir las verificaciones técnicas con perfiles ficticios. Eso no certifica entrega de correos, titularidad de sesiones, comportamiento de WhatsApp real ni capacidad con 300 dispositivos simultáneos.

La retirada de «Saldo bancario estimado» ya está implementada en `lib/finance/features.ts` (`fundsPosition: false`) e incluida en el merge de Consolidación. Producción aún publica la versión anterior. No eliminar cálculos ni configuración bancaria para ocultar una tarjeta.

## 2. Ramas y PRs: GitHub frente a documentación histórica

Consulta: GitHub API + `git fetch github`, sin modificar ramas existentes.

| Referencia | HEAD | Estado real |
|---|---|---|
| `feature/base-cds-suite` | `084bd4d` | Sigue siendo default; contiene control plane. Tiene 6 commits exclusivos y no contiene 282 de integración. No usar como base funcional ni cambiar default en esta revisión. |
| `feature/preproduccion-mobile-v1` | `531e42e` | Integración actual; merge de PR #20 el 19/10. |
| `integration/consolidation-v1-on-18925d6` | `dc5fbf9` | Ya integrada; solo falta el commit de merge respecto de integración. |
| `mission/consolidation-v1-fasttrack` | `602e93b` | Ancestro de integración; PR #7 sigue abierto Draft, superado por #20. |
| `mission/platform-core-calendar-v1` | `a8d782d` | Ancestro; PR #5 fusionado. |
| `mission/slice3a-sumup-fees` | `6d67de5` | Preservada: 14 commits exclusivos; no fusionada automáticamente. |
| `feature/campaign-reader-prod-v1` | `ec9a424` | PR #9 Draft abierto; 3 commits exclusivos y 197 solo en integración. GitHub lo marca conflictivo (`dirty`). |

Los PR #1, #2, #5, #6, #10–#12 y #20–#32 están fusionados. Abiertos: #3 y #4 (previews), #7 (antecedente de Consolidación), #8 y #9 (lector de campañas). Sus títulos «NO DEPLOY» y textos antiguos no prueban su estado actual. No se cerró ningún PR histórico.

- [Merge de Consolidación, PR #20](https://github.com/Speralt1/cds-suite/pull/20): el cuerpo aún dice Draft/pendiente; metadatos reales: merged, 19/10/2026.
- [Último CI de integración](https://github.com/Speralt1/cds-suite/actions/runs/39199885370): SUCCESS para `531e42e`, ambos jobs (código/build y Rules/emuladores).
- [CI de PR #9](https://github.com/Speralt1/cds-suite/actions/runs/37644079142): SUCCESS histórico del head, no resuelve los conflictos con integración.
- #3/#4/#7/#8: las consultas de runs de PR y statuses no devolvieron verificaciones asociadas al head; no se presentan como CI verde actual.
- El control plane diario está verde al 02/11; monitorea el proyecto, **no** es una prueba funcional de la aplicación ni un monitor de disponibilidad de Firebase.
- GitHub Deployments devolvió lista vacía. Se consultó Firebase directamente en lectura.

## 3. Producción real (consulta de solo lectura del 03/11)

| Recurso | Evidencia vigente |
|---|---|
| Hosting live | `ec3d614eb95dc213`, release `1792125366342000`, 16/10/2026 04:36:06 UTC. Coincide con la versión documentada para PR #32 / `1951f2b`. Firebase no certifica el SHA del código fuente. |
| Firestore Rules | `5df51b09-b460-4515-8fb5-505983c8f1c8`, anterior a Consolidación. |
| Functions | 6 ACTIVE: `sumupSyncScheduled` (southamerica-east1); `sumupSyncNow`, `campaignShare`, `calendarPublicFeed`, `calendarShareLinkManage`, `sumupPayoutsReconciliation` (southamerica-west1). **Ninguna `members*`.** No se invocaron funciones de negocio. |
| Índices | Consulta administrativa: ningún índice compuesto del grupo `members*`. |
| Acceso a Consolidación | 0 perfiles con permiso explícito `members.consolidation.*`; admin tiene acceso implícito en el código nuevo. No se otorgaron permisos. |

Fuente: `firebase hosting:channel:list`, `firebase functions:list`, GET del release de Rules e índices de Firestore. Evidencia de accesos guardada fuera del repositorio público. La discrepancia merge/deploy está confirmada por recursos vivos, no inferida del título del PR.

| Módulo | Qué existe | Brecha |
|---|---|---|
| Finanzas | Publicado: movimientos, caja, diezmos, resumen, reportes, conciliación SumUp. | La tarjeta de saldo sigue perteneciendo al Hosting antiguo. No se auditó la contabilidad actual ni se ejecutó sincronización. |
| Calendario | Publicado: actividades, áreas, permisos, enlace público y reporte. | No confundir áreas con un módulo de turnos/equipos. |
| Consolidación | Código fusionado: personas, visitas, seguimiento, estados, responsables, alertas, auditoría; pruebas automatizadas. | Faltan publicación por fases y funciones/índices/reglas. Modelo actual no admite invitados sin visita, asistencia por evento o decisiones religiosas. |
| Equipos | Áreas y usuarios/permisos como base compartida. | No hay módulo dedicado de equipos, turnos, disponibilidad ni aceptación de asignaciones en el registro de módulos. |

Gmail contiene alertas de SumUp del 22/10 seguidas de correos RESOLVED. Eso es antecedente histórico; no se afirma que haya un incidente abierto hoy ni que el servicio haya estado sano desde entonces.

## 4. Invitaciones y cuentas: qué se puede probar

Se compararon campos mínimos de `users` con Auth `accounts:batchGet` (sin hashes, contraseñas ni tokens de usuarios): 20 perfiles, 20 cuentas, 0 cuentas Auth sin perfil.

- 11 cuentas activas: `lastLoginAt` coincide exactamente con `createdAt`; sin inicio posterior confirmado.
- 8 activas: hay un inicio posterior; no demuestra que lo hiciera el titular.
- 1 perfil inactivo en Firestore, con Auth existente y no deshabilitada.

El alta actual (`lib/settings/users-client.ts`) crea la cuenta, inicia sesión temporalmente con una contraseña aleatoria, crea el perfil y solicita el correo de recuperación. Por eso **la cuenta ya existe antes de que el destinatario abra el correo**, y la sesión del alta no demuestra activación humana. El resultado de envío vive en memoria/UI; no hay un registro persistente por invitación en ese flujo. Las búsquedas de Gmail no encontraron evidencia transaccional de esos correos. No se puede afirmar «correo entregado pero cuenta no creada».

La lista nominal y direcciones están en el expediente local privado entregado al administrador, no aquí. No reenviar, reactivar ni crear cuentas duplicadas como resultado automático de esta revisión. Siguiente mejora de acceso: distinguir cuenta creada, solicitud de correo aceptada/fallida y primer ingreso posterior verificable; nunca guardar el enlace de recuperación.

## 5. Pruebas y alcance del ensayo

Se agregaron cuatro pruebas en `tests/functions/members-event-300.test.ts`, usando **el servicio real** `functions/members/service.js` con store en memoria y reloj fijo:

1. 300 adultos ficticios con primera visita; 15 responsables ficticios, exactamente 20 por responsable; 300 reintentos de alta y 300 de seguimiento sin documentos extra. Resultados de seguimiento: 200 contactados, 60 sin respuesta y 40 bajas confirmadas; las 40 bajas no tienen enlace WhatsApp ni alertas de contacto. Auditoría y proyecciones coherentes; calendario intacto y ninguna colección financiera escrita.
2. Corte antes del commit: ninguna ficha/visita/auditoría parcial; recuperación al reintentar.
3. Revisión obsoleta, responsable inactivo y usuario solo de Finanzas rechazados.
4. Alta sin primera visita y campo de decisión religiosa rechazados: explicita las brechas del modelo, no intenta almacenar esos datos.

**Esto es simulación funcional, no benchmark de Firebase ni prueba de envíos.** La distribución 20/20 es un dato del ensayo, no una función de asignación automática ya construida. La lista cliente tiene límite de 1.000 personas; 300 están dentro de ese límite, pero deben medirse paginación, latencia y costos antes de crecer.

Validación ejecutada en esta revisión:

| Verificación | Resultado |
|---|---|
| Baseline antes de cambios | 1.685/1.685 unit/UI |
| Ensayo nuevo + autenticación | 23/23, incluyendo 4 escenarios del ensayo y control Mostrar/Ocultar |
| Firestore Rules, `demo-cds-suite` | 295/295 |
| Suite final unit/UI | **1.690/1.690**, 92 archivos |
| Auth + Firestore + Functions en emulador | **33/33**, 7 archivos |
| Lint, typecheck, shared generado | OK |
| Build estático + `check:no-preview` | OK; 6 rutas de Integrantes, sin demo/preview/campos excluidos |

No se usan sesiones ajenas. Las pruebas de reglas y emuladores existentes cubren autorización real contra los servicios locales; el store en memoria no demuestra concurrencia transaccional real entre dispositivos.

## 6. Rediseño: implementación contenida y propuesta de continuidad

Implementado en esta rama: acceso con menos decoración, jerarquía tipográfica clara, superficie blanca, líneas discretas, ayuda concreta para primer ingreso y mostrar/ocultar contraseña. CSS Module limitado a `/login`; conserva el provider, el inicio con Firebase y las rutas por permisos. Sin fuentes remotas ni dependencias nuevas. Respeta movimiento reducido; control de contraseña de 44×44 px. Se preserva `fundsPosition: false`, que ya existía.

Capturas con configuración demo local: [escritorio](screens-r38/login-desktop.jpg), [móvil](screens-r38/login-mobile.jpg). No contienen personas reales. Revisión visual a 375, 768 y 1280 px; ancho del documento igual al viewport en los tres casos. En tablet el formulario mide 384 px; controles principales de 50–52 px, mostrar contraseña 44 px. Capturas de escritorio/móvil verificadas; aviso de entorno demo presente solo en esas capturas de desarrollo.

La propuesta para el resto de la suite se aplica por pantalla, conservando los contratos de datos:

| Superficie | Cambio propuesto | Criterio de aceptación |
|---|---|---|
| Navegación | Un módulo activo claro, nombres cortos, misma posición de búsqueda y acción primaria. | Permisos y enlaces profundos iguales; usable con teclado, iPad y 375 px. |
| Consolidación | Lista de trabajo primero: nombre, responsable, próxima acción y estado; ficha con historial por fecha. | Una acción principal por vista, sin más pasos para registrar un seguimiento. |
| Finanzas | Ingresos, gastos y resultado primero; tabla y calendario con jerarquía compartida. | Sin saldo esperado; mismos montos, consultas y permisos financieros. |
| Calendario | Encabezado y botón de nueva actividad estables; fecha y área legibles. | Recurrencia, permisos y publicación conservados. |
| Equipos | Empezar por responsables y carga de trabajo; turnos en una fase posterior. | Sin inventar un módulo operativo que aún no existe. |
| Interacción | Hover/foco de 120–160 ms; movimiento reducido; skeleton solo al cargar. | Sin animaciones que bloqueen acciones, loaders decorativos o `transition-all`. |

No se afirma un rediseño completo implementado ni una mejora de rendimiento medida. El cambio actual permite revisar una dirección visual con riesgo acotado.

## 7. Evento: flujo mínimo (300 personas / 15 responsables)

Escenario confirmado por Salvador en este chat; fecha del evento pendiente. Todo plazo es relativo a D (día del evento).

**Tres pantallas:** Evento (inscripción/asistencia), Mi lista (asignados y vencidos), Ficha (contacto, próxima acción e historial). Un coordinador administra el padrón; 15 responsables acompañan hasta 20 personas cada uno. No agregar un paso de aprobación por cada contacto.

1. **Antes de D:** padrón de invitados/inscritos con identificador estable; nombre y datos mínimos voluntarios, adulto confirmado, origen y autorización de contacto separada. Una inscripción no crea una visita. Deduplicar por teléfono/correo como aviso; teléfono compartido no obliga a fusionar.
2. **En D:** buscar y marcar «Asistió» con un toque. Mantener «Sin confirmar» durante el evento; al cierre, coordinación confirma «No asistió». Llegadas sin inscripción se agregan sin simular invitaciones previas. Sin conexión: mostrar que no se guardó y permitir reintento idempotente; no prometer modo offline que V1 no tiene.
3. **Decisión voluntaria:** eje independiente de asistencia y del estado de Consolidación. «No registrada», «Aceptó a Cristo», «Desea conversar» y «No por ahora», solo como declaración de la persona. No inferir por visita, contacto, asignación, ausencia o silencio. Consentimiento específico y acceso pastoral restringido; nunca guardar la decisión en notas generales o transmitirla a WSP. Los cuatro valores y la conservación deben aprobarse antes de implementarlos. La V1 actual los excluye deliberadamente.
4. **Asignación:** propuesta equilibrada de hasta 20 por responsable activo, ajustable por vínculo previo y disponibilidad; coordinación confirma un lote. No reasignar a quien pidió no contacto. Un responsable inactivo manda sus pendientes a la cola de coordinación. Repetir la confirmación del lote no duplica ni sobreescribe asignaciones ya editadas.
5. **D+1–D+2:** un primer contacto autorizado. Guardar resultado y, si procede, una única próxima acción/fecha. «No responde» no cierra definitivamente; acordar como máximo un segundo intento en D+7. Toda baja cancela los pendientes inmediatamente. D+14/D+30: revisión de acompañamiento por coordinación, no campañas recurrentes indefinidas.

**Métricas con denominadores:** inscritos, asistió, no asistió confirmado, asistencia pendiente; contactables con consentimiento, asignados/sin asignar, primer contacto pendiente, vencidos y bajas. Decisiones solo en vista restringida/agregada, contando «no registrada» aparte. No sumar «integrado» a «aceptó a Cristo»: son ejes distintos.

### Modelo aditivo propuesto, todavía sin código/backend

- Reutilizar `calendarEvents/{eventId}` como evento; sin copiar finanzas.
- `eventRegistrations/{eventId_personId}`: vínculo, asistencia (`unknown|attended|absent`), responsable, revisión, auditoría y evidencia de autorización. Permitir registro sin visita; hay que separar el alta actual de `membersPersonCreate`, que hoy exige fecha de primera visita y crea esa visita atómicamente. No basta cambiar la etiqueta del formulario.
- Preferencias de contacto con propósito, canal, fecha, origen y revocación; `doNotContact=false` **no equivale** a consentimiento.
- Decisión voluntaria en colección aparte, con permiso pastoral específico, no dentro del documento legible por todos los responsables. Acceso y plazo de conservación por decidir; sin textos pastorales libres ni menores en V1.
- Coordinación ve el conjunto. Responsable ve solo sus asignados; recepción ve inscripción/asistencia y no decisiones. **Hoy `members.consolidation.read/manage` permite leer todo el módulo y `manage` editar sus personas; asignar responsable no restringe lecturas.** Este aislamiento debe existir en Rules, backend y consultas antes de repartir acceso a los 15. No es seguro otorgar el permiso actual suponiendo que ya filtra por responsable.
- Importación futura: prevalidación y dry-run de 300 filas, errores por número de fila, confirmación de lote y reintento por clave estable; ningún importador directo en producción en esta revisión.

### Ensayo requerido antes del evento

Además del ensayo ejecutado, preparar un escenario de 300 inscripciones: 240 asistentes, 40 ausentes confirmados y 20 sin confirmar (valores ficticios). Registrar decisiones de prueba solo en memoria restringida, sin inferencias. Probar check-in duplicado, alta sin teléfono, dos recepcionistas simultáneos, reasignación concurrente, baja antes del envío, responsable desactivado, interrupción y reanudación de lote, separación de roles y denegación entre asignados. Publicar el resultado como agregado, nunca exportar datos pastorales.

## 8. Conexión con el motor existente

Se revisó la documentación privada del motor indicado por Salvador. Los detalles y enlaces de esa revisión se entregan al administrador en un expediente local privado; no se copian a este repositorio público.

Propuesta: grupo interno manual de responsables para coordinación y conteos/enlaces autenticados; comunicación individual con participantes solo con consentimiento. Nunca compartir teléfonos, decisiones o fichas pastorales en grupos.

La integración nueva necesita un adaptador backend con organización de destino fijada en servidor, credenciales separadas y mínimo payload (nombre, teléfono, propósito y autorización vigente). El navegador CDS no recibe credenciales administrativas ni escribe directamente en la base del motor. Se revalidan permisos, bajas, conexión, consentimiento y cuota antes del despacho.

Empezar con transporte simulado y destinatarios ficticios. Mantener una clave estable por evento/persona/propósito/consentimiento y estados que distingan pendiente, enviado al proveedor, fallido e incierto; enviado no significa entregado. Un envío incierto no se reintenta a ciegas. Las bajas cancelan pendientes y los callbacks se autentican y deduplican.

No se presume una API pública de integración, creación automática de grupos ni disponibilidad de mensajería real. La habilitación depende de una revisión del motor vivo y aprobación específica de organización, número, texto, destinatarios y canario de prueba. No se modifica el motor en este PR.

## 9. Fases y siguientes acciones

| Fase | Trabajo concreto | Salida / bloqueo |
|---|---|---|
| Ahora, sin producción | Revisar PR de esta rama: acceso visual, simulación, estado actualizado. Ayudar al primer ingreso usando la lista privada. | Revisión del diff y CI verde; no requiere pruebas de titulares para ejecutar pruebas técnicas. |
| Rollout de V1 | Reanudar doc 25 desde C-A0 con baseline vivo y backup; C-A2.5 ya hecho. Después índices C-A3 → Rules C-A4 → seis `members*` por nombre C-A5 → Hosting C-A6 → smokes y piloto admin. | **GO explícito por fase**, nunca redeploy completo de Functions/SumUp. La bandera ocultará saldo al publicarse el Hosting correspondiente. |
| Preparación del evento | Precisar fecha; separar inscripción/visita, asistencia y decisión; reglas de asignados y consentimiento. Implementar en otro PR con pruebas de matriz y concurrencia en emulador. | Sin aislamiento por responsable no abrir acceso masivo a 15 personas. Sin diseño de datos sensibles aprobado no guardar decisiones. |
| Ensayo general | 300 inscripciones/15 responsables, recepción móvil, fallos/reintentos y métricas; transporte WSP falso. | Datos ficticios, cero correos o WhatsApp reales, resultados agregados. |
| Mensajería y operación | Aprobar org/número, texto, destinatarios con consentimiento y canario de prueba; habilitación gradual del motor después. | Requiere autorización independiente de envío y preparación real de WSP. Grupo interno manual como apoyo, app como registro principal. |
| Diseño restante | Portar patrón aprobado a Consolidación, luego Calendario y Finanzas con capturas y pruebas por pantalla; Equipos después del modelo mínimo. | No mezclar cambios de permisos/infraestructura en un PR puramente visual. |

El audit productivo (`npm audit --omit=dev`, 03/11) reportó 9 dependencias afectadas: 7 de severidad alta y 2 crítica (Next y DOMPurify transitivo). Es clasificación del registro, no prueba de explotación ni análisis de exposición del Hosting estático. Se conserva el lockfile. Revisarlos en un PR separado antes de ampliar la exposición, sin `npm audit fix --force` automático. Entorno local Node 24.12; runtime Functions Node 22: CI con Node 22 sigue siendo la comprobación de paridad de runtime.
