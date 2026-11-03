# 40 · «Ve por los tuyos»: submódulo anual, inscripciones y mensajería

Fecha: 03/11/2026. Corrige y amplía doc 38 §7–§8. Estado por pieza: **P** propuesto · **I** implementado en rama · **T** probado · **D** desplegado.

| Pieza | Estado |
|---|---|
| Núcleo de dominio puro `lib/outreach/*` (edición, asistencia, consentimiento, distribución, sincronización, bandeja, métricas, traspaso) | I · T (154 pruebas) |
| Espacio de trabajo simulado (Panorama, Distribución, Mi lista) con 300/15 ficticios | I · T (solo local, excluido de la build) |
| Ruta `/integrantes/ve-por-los-tuyos` en producción | I: muestra «en preparación»; `OUTREACH_FEATURES.enabled = false` |
| Colecciones `outreach*`, Rules, Functions, índices, permisos `members.outreach.*` | P |
| Endpoint de lectura en el sitio del evento | P (no existe) |
| API autenticada del motor de mensajería | P (no existe) |
| Mesas del evento: enlace por mesa, búsqueda, marca con un toque, llegadas sin inscripción, distribución por mesa (`tables.ts`) | I · T (lógica y simulación) |
| Decisiones voluntarias | Dirección aprobada por el administrador (03/11); backend P |

Nada está desplegado. Ningún dato real se leyó ni se escribió.

## 1. Hallazgos que cambian el plan

1. **El sistema de inscripciones ya está en producción.** Vive en el repositorio privado `Speralt1/web-casa-de-salvacion` (no hay un repositorio llamado «veporlostuyos»), publicado en veporlostuyos.com desde el 01/11/2026. Hace mucho más que inscribir: revisión y aprobación de solicitudes, entradas con QR, cola de correo, **acreditación en puerta** probada (doble escaneo = un ingreso), exportación auditada y anonimización automática tras la retención. Detalle técnico en el expediente privado, no aquí.
2. **Fecha del evento: sábado 28/11/2026, 18:00** (configurada en el sitio y **confirmada por el administrador el 03/11**). Capacidad configurada: 300. D = 28/11; el primer contacto vence D+2 (30/11) y el segundo intento D+7 (05/12).
3. El sitio **no** tiene API de salida, webhook, credencial de máquina ni marca de «sincronizado». Hoy solo existe una exportación CSV con sesión humana.
4. El sitio **anonimiza cada edición** al cumplirse la retención (90 días por defecto). Una copia en CDS sobreviviría a lo que la persona aceptó.
5. El consentimiento web vigente es para el evento. **No consta que cubra seguimiento posterior ni el paso a Consolidación.**
6. La autorización de WhatsApp en el sitio es del **solicitante**, no de cada invitado; los menores no tienen datos de contacto.
7. La **Ley 21.719** (protección de datos personales) rige desde el 01/12/2026, tres días después del evento: todo el seguimiento, y en especial cualquier dato sobre convicciones religiosas (dato sensible), ocurre bajo la ley nueva.
8. Consolidación V1 fusiona alta con primera visita y su permiso de lectura abre todo el módulo (doc 38). Atlas confirmó además que el catálogo de permisos está lleno (10/10) y que admin recibe todos los permisos de forma implícita.
9. El motor de mensajería no tiene API para terceros, no crea grupos y su envío a grupos no está validado (§8).

## 2. Responsabilidades: quién hace qué

| Etapa | Sistema responsable | Por qué |
|---|---|---|
| Inscripción pública, aprobación, entradas, correos de entrada | **Sitio del evento** | Ya en producción y probado; reemplazarlo no está justificado |
| Acreditación en puerta (asistencia «Asistió») | **Sitio del evento** | Tiene QR, búsqueda manual y deshacer; CDS no duplica recepción |
| Llegadas sin inscripción el día D | **Sitio del evento** (mesa de ayuda) | Una sola puerta; CDS las recibe por la sincronización |
| Confirmar «No asistió» al cierre | **CDS** (coordinación) | Es una decisión explícita, no se deduce |
| Padrón operativo de la edición, distribución, Mi lista, contactos, bajas, métricas | **CDS** | Es acompañamiento pastoral, no logística |
| Decisión voluntaria | **CDS**, acceso pastoral restringido | Nunca en el sitio público |
| Traspaso a Consolidación habitual | **CDS**, acción explícita | Única puerta entre los dos flujos |
| Envío de mensajes | **Motor de mensajería**, a pedido de CDS | CDS decide a quién y qué; el motor transporta |

Si el sitio cae, CDS sigue con lo ya sincronizado. Si CDS cae, el sitio sigue inscribiendo y acreditando. Si el motor se pausa, nada más se detiene.

## 3. Modelo de datos (propuesto; núcleo implementado en `lib/outreach`)

Revisado por Atlas sobre las Rules y Functions reales. Prefijo `outreach*`, edición con id `vplt-AAAA`.

- `outreachEditions/{vplt-AAAA}`: año, título, fecha, estado (`preparacion → inscripcion → evento → seguimiento → cerrada`), actividad del Calendario reutilizada, tope por responsable (20).
- `…/team/{uid}`: rol **por edición** (coordinación, recepción, responsable), activo, tope propio. El año siguiente se **copia la estructura**, nunca personas ni cargas (`copyTeamStructure`).
- `outreachRegistrations/{id}`: una persona en una edición. Ejes independientes: estado (activa/cancelada/duplicada), asistencia (`sin_confirmar|asistio|no_asistio`), autorizaciones con propósito/fuente/versión/revocación, `doNotContact`, responsable, lote, proyección del seguimiento del evento, campos editados en CDS, enlace a Consolidación tras el traspaso.
  - Subcolecciones append-only: `contacts`, `assignments`, `consents`, `changes` (auditoría solo con nombres de campo).
- `outreachIdentities/{id}`, **sin datos personales**: reconoce a la misma persona entre ediciones. El backend **sugiere** por teléfono/correo; coordinación **confirma**. Nunca fusiona ni sobreescribe.
- `outreachDecisions/{registrationId}`: separado, legible solo con permiso pastoral. **Bloqueado.**
- `outreachInbox` (sincronización entrante) y `outreachOutbox` (mensajería), ambos con claves idempotentes independientes del actor.

**Una sola fuente de verdad por dato.** Antes del traspaso, la inscripción es la única fuente de contacto de esa persona en el evento. Tras el traspaso, `membersPeople` manda y la inscripción queda congelada. La baja es monótona: basta un `doNotContact` (inscripción, identidad o Consolidación) para bloquear; levantarla nunca se propaga sola.

**Separación de Consolidación habitual.** Las asignaciones y contactos del evento viven en sus propias colecciones. La distribución no lee ni escribe `membersPeople.followUpOwnerUid` ni `membersFollowUps` (lo verifican las pruebas). Una edición cerrada es de solo lectura y sus pendientes no aparecen en la vigente.

## 4. Permisos y aislamiento por responsable (propuesto)

| Permiso | Ve | Hace |
|---|---|---|
| `members.outreach.coordinate` | Toda la edición | Equipo, padrón, ausencias, distribución, reasignar, traspaso (con `members.consolidation.manage`), métricas |
| `members.outreach.reception` | Inscripciones con `receptionOpen` (solo en D) | Llegadas de respaldo si la puerta del sitio falla |
| `members.outreach.followup_assigned` | **Solo sus asignadas** en ediciones activas | Registrar contactos y bajas de su lista |
| `members.outreach.decisions` | Decisiones | Registrar una decisión declarada y autorizada |

- Aislamiento en las tres capas: Rules (`assigneeUid == request.auth.uid` y `editionActive`), backend (se revalida dentro de la transacción) y consultas (el cliente debe filtrar igual o la regla rechaza).
- Requiere ampliar el catálogo de 10 a 14 permisos en tipos, Rules, etiquetas y pruebas de paridad, y repetir la prueba de presupuesto de expresiones (doc 26).
- **Decisión del administrador:** admin recibe todos los permisos de forma implícita; con eso vería decisiones. Atlas recomienda mantener la invariante y limitar quién es admin; la alternativa es excluir `decisions` de lo implícito.
- Un responsable **no** recibe `members.consolidation.read`, porque abre todo Consolidación.

## 5. Traspaso a Consolidación habitual (implementado como plan puro)

`planHandoff` exige: coordinación + `members.consolidation.manage`, persona que **asistió**, autorización `traspaso_consolidacion` vigente, sin baja, edición con fecha, motivo escrito. Crea una ficha con la fecha del evento como primera visita y origen «evangelismo», o vincula una ficha existente que coordinación confirmó. Clave idempotente por inscripción: dos traspasos no crean dos fichas. No viajan decisiones, contactos del evento ni notas. El evento conserva su historia.

## 6. Distribución posterior al evento (implementada y probada)

1. Coordinación confirma ausencias (las «sin confirmar» siguen así hasta que alguien decida).
2. `proposeDistribution`: solo activas, que asistieron, con autorización de seguimiento y sin baja; respeta vínculo previo (p. ej. responsable de la edición anterior); equilibra por carga relativa; tope 20; determinista.
3. Ajustes: `moveInProposal`; superar el tope exige motivo.
4. `confirmBatch`: idempotente por lote; si una persona cambió desde la propuesta (otra asignación, baja, revisión), **no se pisa** y se informa como conflicto.
5. Después: `reassign` con motivo y revisión esperada; `releaseOwner` devuelve a la cola de coordinación los pendientes de un responsable desactivado, conservando su historial.
6. Mi lista ordena por foco: Atrasado → Primer contacto → Para hoy → Próximamente → Al día. Primer contacto D+1–D+2; un segundo intento hasta D+7; una baja cancela pendientes y mensajes en el mismo paso.

Ensayo con 300/15: 240 asistentes → 16 por responsable; repetir la confirmación no cambia nada; ver `tests/outreach/`.

## 6b. Mesas y marca de decisiones (decisión del administrador, 03/11)

Habrá **~35 mesas**, cada una con un encargado que **también hace el seguimiento de su mesa** (~8–9 personas). El permiso se pide **una vez, al solicitar la entrada**; en la mesa solo se confirma con un toque.

**Cómo marca el encargado** (implementado en `tables.ts` y en la vista «Mesa» de la simulación):
1. Abre el **enlace de su mesa** en el teléfono: sin usuario ni contraseña, válido de D 16:00 a D+1 02:00, revocable por coordinación. El backend guarda solo el hash del token (mismo patrón que el calendario público).
2. Busca a cada persona de su mesa por **nombre o apellido** (≥3 letras; los códigos de entrada no se importan); nunca ve teléfonos, correos ni el padrón completo.
3. **Un toque por persona: «Está en mi mesa (sin decisión)»**. Queda sentada en esa mesa y con «Asistió»; el permiso de seguimiento viene del sitio. Así **todos los de la mesa** pasan a su encargado aunque no expresen nada. La lista «En esta mesa N» muestra a todos, con su marca o «Sin marca».
4. **Decisión (opcional):** si la persona expresó algo, el encargado toca **«¿Te podemos anotar para acompañarte? · Dijo que sí»** y **«Aceptó a Cristo»** o **«Quiere conversar»**; eso además confirma el permiso en la mesa. Puede deshacer sus propias marcas (la persona sigue sentada) mientras el enlace esté vigente.
5. Si llegó sin inscripción: nombre y teléfono, y queda en la mesa. Los posibles duplicados van a coordinación; nunca se fusionan.
6. Si figura en otra mesa, sentarla o marcarla la trae a esta solo con confirmación explícita.

**Después:** la distribución propone a cada persona con el encargado de su mesa («vínculo previo»); quienes no tengan mesa, o cuyo encargado no esté activo, se reparten por equilibrio. Coordinación ve conteos por mesa sin nombres; cada encargado ve solo a su mesa en Mi lista.

**Por qué un enlace y no cuentas para la noche del evento:** hoy 11 de 20 cuentas no han entrado nunca después del alta. Pedir contraseñas a 35 personas esa noche es el punto más frágil. Las cuentas sí hacen falta desde D+1 para Mi lista (hito H5, doc 41). Respaldo si no hay señal: una hoja por mesa que coordinación ingresa después.

**Texto propuesto para el formulario del sitio** (casilla propia, distinta de las condiciones del evento; versión nueva del consentimiento):

> ☐ Autorizo a Casa de Salvación a usar mis datos y los de las personas que invito **solo para este evento y para acompañarnos después** (una llamada o un mensaje de la iglesia). Si durante el evento alguien expresa una decisión de fe, la iglesia podrá anotarla, con su permiso, para acompañarlo. **Estos datos son solo para la iglesia:** no se comparten ni se venden. En cualquier momento puedes pedir que no te contactemos más.
>
> ☐ Les conté a mis invitados que la iglesia los podrá contactar después del evento.

En la mesa: «¿Te podemos anotar para acompañarte?». El toque cubre a quien no llenó el formulario (invitados y llegadas sin inscripción) y a quien aceptó la versión anterior del texto. Desde el 01/12 rige la Ley 21.719 y una decisión de fe es un dato sensible: conviene que alguien con criterio legal lea este texto una vez antes de publicarlo. El cambio va en el repositorio del sitio, en una rama aparte, porque un push a su rama de producción despliega.

## 7. Integración con el sistema de inscripciones (propuesta)

1. **Responsables:** el sitio es dueño de la inscripción pública y la acreditación; CDS es dueño de la operación posterior (§2).
2. **Qué, en qué dirección, con qué identificadores:** solo **sitio → CDS**, lectura. Unidad = invitado adulto aprobado (o anulado/retirado, para cancelar). Clave = (`vplt-web`, id del invitado en el sitio) + revisión monótona = `updatedAt`. Campos mínimos: nombre, teléfono E.164, correo, estado, entrada anulada, hora de ingreso en puerta, autorización de WhatsApp si el invitado es el solicitante, versión del consentimiento. **Nunca**: notas internas, historial de contacto del sitio, tokens, IP, fecha de nacimiento, menores.
3. **Edición:** se reconoce por el programa y el año de la convocatoria del sitio (`ve-por-los-tuyos` + 2026 → `vplt-2026`). Un registro de otro año va a revisión, no a la edición vigente.
4. **Altas, correcciones, cancelaciones, duplicados, repetidos:** alta = inscripción nueva «sin confirmar»; corrección = actualiza solo campos no editados en CDS (si CDS editó, va a revisión); cancelación = estado «cancelada», nunca borrar (si ya asistió, revisión); duplicado posible = se crea y se marca para revisión, nunca se fusiona; repetido = misma revisión → sin cambios. Ingreso en puerta → «Asistió» por `vplt-web`; un ingreso deshecho en origen va a revisión, no se revierte solo. Menores: se omiten y solo se cuentan.
5. **Recuperación:** CDS **tira** del sitio con un cursor (`updatedAt`). El cursor solo avanza tras aplicar o enviar a revisión cada registro; un corte se reanuda desde el último cursor sin perder ni duplicar (probado con cortes a mitad de lote).
6. **Pendientes y errores:** bandeja de revisión en Panorama (posible duplicado, teléfono inválido, conflicto con edición local, cancelada con asistencia, otra edición, ingreso deshecho), con la hora de la última lectura y conteos. Los errores no bloquean al resto del lote.
7. **Autenticación:** endpoint nuevo en el sitio, solo lectura, con un secreto propio (no el del cron), comparación en tiempo constante, limitado a la edición y a campos mínimos, con bitácora de conteos. La llamada la hace una Function programada de CDS con el secreto en Secret Manager; el navegador nunca lo ve. Alternativa interina: CSV exportado del panel → importación con *dry-run* por el mismo analizador.
8. **Lo que nunca vuelve al sitio público:** responsables, contactos, resultados, próximas acciones, bajas registradas en CDS, decisiones, traspasos, notas, métricas de seguimiento. CDS no escribe en el sitio.
9. **Pruebas sin servicios reales:** `applyInbound` con 300 registros ficticios aplicados dos veces, cortes y reanudación, revisiones viejas, otra edición, inválidos, duplicados, conflictos, cancelaciones, menores e ingresos en puerta (`tests/outreach/sync.test.ts`). Siguiente: contrato JSON compartido + pruebas del endpoint en la rama del sitio contra su base local; jamás contra registros reales.

Preservación del sitio: no se modificó nada. Ojo: en ese repositorio **cada push a su rama de producción despliega**; el endpoint debe ir en una rama aparte, con revisión y GO propio.

## 8. Conexión con el motor de mensajería (propuesta)

Revisado el código vivo del motor (detalle privado, fuera de este repositorio). Hechos relevantes para CDS:

- No hay API para terceros: hoy solo se encola escribiendo en su base como usuario miembro de la organización. No hay clave de idempotencia del llamador ni webhooks de estado.
- Tiene guardias útiles: organización aislada, consentimiento y supresión, palabras de baja, ritmo limitado, ventana horaria, estado «incierto» sin reintento y transporte simulado para pruebas.
- No crea grupos ni administra participantes; publicar en grupos existe solo por programación y **no está validado con WhatsApp real**.
- El sitio del evento también espera una API del motor (canal hoy simulado): conviene **una sola API** del motor para ambos clientes.
- **Riesgo operativo:** hay un hallazgo sobre las barreras de envío del motor en producción, documentado solo en el expediente privado. Regla para CDS: la organización de la iglesia opera en modo de prueba, con números ficticios autorizados, hasta el canario aprobado.

Propuesta:
1. Lado motor (preferido): endpoint autenticado con clave por organización, `idempotencyKey` obligatorio que se usa como id del comando (así aplica todos los guardias existentes), consulta de estado por clave, webhook firmado opcional para estado y bajas.
2. Lado CDS (implementado como lógica pura en `outbox.ts`): CDS decide destinatarios y plantilla aprobada; payload cerrado = nombre de pila, teléfono, plantilla, propósito, clave. Nunca decisiones, notas pastorales ni datos financieros (probado). Revalida baja y autorización justo antes de despachar. «Entregado al motor» ≠ recibido. «Incierto» nunca se reintenta solo. Interruptor `OUTREACH_FEATURES.messaging = false`.
3. Coordinación de responsables: grupo interno manual, creado por una persona, para avisos y conteos; nunca teléfonos, fichas ni decisiones en grupos.
4. Pruebas: `SimulatedTransport` (aceptado, rechazado, sin respuesta, reenvío con la misma clave) en `tests/outreach/outbox.test.ts`; luego, organización del motor en modo de prueba con números ficticios autorizados; nunca destinatarios reales sin aprobación.

## 9. Decisión voluntaria (dirección aprobada; backend propuesto)

Actualizado el 03/11: el administrador aprobó marcar en la mesa «Aceptó a Cristo» y «Quiere conversar», con el permiso pedido al solicitar la entrada (§6b). Siguen pendientes: quién ve los nombres además del encargado de la mesa y coordinación pastoral, cuánto tiempo se conservan, y si admin las ve de forma implícita. `check:no-preview` sigue prohibiendo los valores en la build hasta que exista el backend con su colección y permiso propios.

- Eje independiente de asistencia, asignación y Consolidación; jamás se deduce de asistir, responder o callar.
- Valores propuestos: no registrada (sin documento), «Aceptó a Cristo», «Desea conversar», «No por ahora»; solo `declaredBy: la_persona`, con texto de autorización versionado (`parseDecision`).
- Colección aparte, permiso pastoral propio, agregados sin nombres y celdas con menos de 5 suprimidas.
- La interfaz recuerda «no anotes decisiones de fe aquí» en cada campo de texto del responsable.
- `check:no-preview` prohíbe los valores de decisión en la build hasta la aprobación (Ley 21.719: consentimiento explícito para datos sensibles; definir base legal, retención y quién registra).

## 10. Pruebas y simulaciones disponibles

`npx vitest run tests/outreach` (154): modelo, distribución 300/15, sincronización con cortes, bandeja con transporte simulado, métricas con denominadores, traspaso, ensayo general de punta a punta (310 inscripciones con 10 llegadas sin inscripción, 40 ausencias confirmadas, 20 sin confirmar, 15 responsables, 40 bajas, 5 traspasos) y recorrido de la interfaz simulada. Revisar la interfaz localmente:

```bash
NEXT_PUBLIC_CDS_OUTREACH_SIM=1 npm run dev:platform
```

Abrir `/integrantes/ve-por-los-tuyos` con un usuario del seed que tenga Consolidación. Pendiente (necesita backend): matriz de Rules, concurrencia en emulador (dos recepciones, dos coordinadores, lotes paralelos, webhook duplicado), carga con 300 dispositivos.
