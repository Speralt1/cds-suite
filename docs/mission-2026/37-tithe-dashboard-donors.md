# 37 · Diezmos: diezmantes del mes y fichas registradas

## Punto de partida (16/10/2026)

- Rama de producción en GitHub: `feature/preproduccion-mobile-v1` @ `638ea1f1ebe2a0bd57bb187e3945f9c64f01c2bf` (PR #31 incluido).
- Hosting live: `https://cds-administracion.web.app`, release `1792122595293000`, versión `2efde71606a551ae`, publicada el 16/10/2026 a las 03:49:55 UTC. Firebase no incluye el SHA de Git en los metadatos de esta versión.
- Firestore Rules live: ruleset `5df51b09-b460-4515-8fb5-505983c8f1c8`; su contenido coincide byte a byte con `firestore.rules` de la rama base.
- PR #20 sigue Draft, sin merge ni deploy; esta rama no incorpora sus cambios.

## Auditoría de producción (solo lectura)

Se leyeron únicamente campos necesarios para comparar atribuciones, fichas, movimientos y resúmenes. No se cambió ningún documento.

| Período | Aportes activos | Fichas distintas | Total atribuido | Total del resumen | Inconsistencias de vínculo |
|---|---:|---:|---:|---:|---:|
| Septiembre 2026 | 41 | 32 | $3.231.197 | $3.231.197 | 0 |
| Octubre 2026 | 27 | 26 | $2.720.750 | $2.720.750 | 0 |

Hay 41 fichas: 34 personas y 7 familias; una está archivada. No hay atribuciones activas sin ficha en estos dos meses. La tarjeta anterior «Personas/familias con registro» ya usaba el mes seleccionado y contaba `profileId` distintos de atribuciones activas, pero el nombre no decía que eran diezmantes. «Nuevas fichas del año» contaba altas por `createdAt`, que no mide actividad de diezmos.

La deduplicación se hace por ID de ficha, no por nombre. Solo 1 de las 41 fichas tiene `identityKey` (la protección es gradual para fichas antiguas). Hay un par de fichas del mismo tipo con nombre normalizado igual, pero en septiembre y octubre solo una ficha de ese par registró diezmos en cada mes, por lo que no infla los conteos auditados. No hay coincidencia de nombre entre persona y familia. No se fusionan fichas ni movimientos históricos automáticamente; el panel de posibles duplicados existente permite revisar el par por separado.

## Cálculo y alcance

El total CLP sigue viniendo de `financeMonthlySummaries.titheTotal`; este cambio no recalcula ni reescribe el libro. Para contar a un diezmante, la atribución debe estar activa y coincidir con un movimiento activo de tipo ingreso, fuente diezmo, mismo ID, importe, fecha y período, y con una ficha existente de tipo persona o familia. Una ficha se cuenta una vez por mes; sus aportes se acumulan en el detalle. Una ficha archivada con aportes históricos válidos conserva su lugar en el período histórico. Aportes sin ficha o con vínculo inconsistente se omiten del conteo y generan un aviso agregado.

El período lo define el campo `period` del movimiento y de la atribución (`AAAA-MM`), guardado desde la fecha civil ingresada. `parseDate` fija las altas normales a las 12:00 UTC; el detalle formatea la fecha en `America/Santiago`, incluso para registros cuyo instante UTC caiga en otro día. El mes actual se indica «en curso» al compararlo con el mes anterior completo. El detalle muestra solo registros autorizados por `finance.details.read` en la página y en Firestore Rules. `finance.summary.read` por sí solo no abre fichas ni movimientos.

No hay migración, índices ni cambios de Rules o Functions. El despliegue previsto es únicamente Hosting. Antes de publicar, registrar la versión live, conservar el release previo para rollback y comparar el árbol del PR con la rama base. El rollback usa el historial de releases de Firebase Hosting para volver a publicar la versión `2efde71606a551ae`; no toca Firestore. Después de publicar, comprobar monto, 26/32 diezmantes, 41 fichas, detalle y bloqueo del detalle para un rol sin `finance.details.read` mediante sesiones propias autorizadas.

## Validación

Validación local: lint y typecheck OK; `build-shared --check` OK; 1.419/1.419 pruebas unitarias y de interfaz; 259/259 pruebas de Rules con emulador; build limpio de producción OK. La prueba de Rules comprueba las lecturas vinculadas (incluido un lote de 30 fichas) y el conteo agregado para Finanzas, y su rechazo para un líder sin detalle. Una prueba del hook cubre 31 aportes, el corte en lotes de 30 y un ID de movimiento largo.

Claude Code revisó el diff y señaló puntos corregidos: validación de IDs, estado de error, fecha chilena, indicación de mes en curso, diseño móvil y etiqueta accesible. Se confirmó en el código base que `useCollection` entrega `synced`, `DetailGuard` envuelve la página antes de montar los hooks y `Modal` limita su altura con scroll; las altas/ediciones de diezmos escriben movimiento y atribución en una transacción. La variación monetaria anterior se sustituye por la variación de diezmantes solicitada.

Pendiente de registrar resultados de CI, revisión de Claude Code y despliegue.
