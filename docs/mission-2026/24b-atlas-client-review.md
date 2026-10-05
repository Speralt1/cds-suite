# 24b · ATLAS (segunda pasada): revisión del CLIENTE de Consolidación V1

> **Alcance:** `lib/members/*`, `components/members/*`, `app/(private)/integrantes/**` y su uso de `lib/shared/members.ts`, `lib/access/*`, `components/layout/route-guard.tsx` y `lib/calendar/events-client.ts`.
> **Base:** rama `mission/consolidation-v1-fasttrack` @ `1922d2c` (stacked sobre PR #5 `73b9040`). Contrato: [doc 23](23-consolidation-v1-production-spec.md).
> **Modo:** solo lectura del código; sin servidores, sin proyecto Firebase real. Backend y reglas los revisa el doc 24a (aquí solo se citan cuando afectan al cliente).

## Resumen

| # | Área | Resultado |
|---|---|---|
| 1 | Lecturas (consultas ↔ reglas ↔ índices, listeners, límites) | PASS (MINOR F4) |
| 2 | Acceso en la UI (provider, solo lectura, `/nueva`, deep links) | PASS (NIT F8) |
| 3 | PII (storage, URL, consola, analytics, toasts, duplicados) | PASS |
| 4 | Calendario (títulos solo con `calendar.read`, sin escritura, página pública aislada) | PASS (NIT F6, F7) |
| 5 | Escrituras (callables, sin optimismo, requestId, revisión, sugerencias) | **FIXES_REQUIRED** (F1, F2 MAJOR; F3 MINOR; F9 NIT) |
| 6 | WhatsApp | PASS |
| 7 | Exclusiones y notas | PASS (NIT F10) |
| 8 | XSS / inyección | PASS |
| 9 | Derivaciones vs §7 | PASS (MINOR F5) |
| 10 | Tests, tipos y lint | PASS |

**Veredicto:** dos MAJOR en el flujo de escritura (aceptación parcial de sugerencias y pérdida de actualizaciones al editar datos). Ambos tienen arreglo local y acotado en `components/members/`.

---

## Hallazgos

### F1 · MAJOR · Las sugerencias del seguimiento se vuelven a marcar ante CUALQUIER error
- **Dónde:** `components/members/sheets.tsx:626-633`
- **Evidencia:**
  ```ts
  const res = await write.run(() => createFollowUp(payload));
  if (!res.ok) {
    setChkStatus(true); setChkDnc(true); setChkClose(true);
    return;
  }
  ```
  El reset corre con error de red, de campos, de permiso o de conflicto, no solo con `members/suggestion-mismatch`. Si quien registra desmarcó «Marcar No contactar» o «Cerrar como Sin continuidad» (aceptación parcial, §6) y falla la red, al reintentar se envían ítems que había rechazado de forma explícita. Esto contradice «Nada cambia en silencio» (§6).
  Agravante: el requestId se reutiliza y el servidor responde `replay` sin comparar el payload (`functions/members/service.js:436-447`). Si el primer envío alcanzó a confirmarse, el reintento con casillas distintas no aplica nada, pero el toast (`sheets.tsx:634`) informa «estado: Sin continuidad» con el `applyStatus` local. El aviso no corresponde a lo que guardó el servidor.
- **Arreglo:** re-marcar solo cuando `write.error?.kind === "suggestion_mismatch"`. En cualquier otro error, conservar las casillas tal como están. Para el toast, en `replay`, no mencionar estado o usar `applied` de la respuesta del servidor. Agregar un test: desmarcar «No contactar», simular un error de red y verificar que el reintento no envía `applyDoNotContact`.

### F2 · MAJOR · «Editar datos» puede revertir en silencio el cambio de otra persona (lost update)
- **Dónde:** `components/members/person.tsx:569` (pasa `v.person` **en vivo**) y `components/members/person-form.tsx:454-466` (diff y revisión contra la persona en vivo).
- **Evidencia:** el estado del formulario se inicializa una vez (`useState(person.fullName)`, `formatPhone(person.phoneE164)`…), pero el submit compara contra el `person` **actual**. También envía `expectedRevision: person.revision` del snapshot vigente:
  ```ts
  const req = { personId: person.id, expectedRevision: person.revision };
  if (cleanName !== person.fullName) req.fullName = name;
  const ph = normalizePhone(phone);
  if (!ph.ok || ph.e164 !== person.phoneE164) req.phone = phone;
  ```
  Escenario: A abre «Editar datos». Mientras tanto B corrige el teléfono, o registra una visita (que también sube `revision`, §5.0). A cambia solo el correo y guarda. El teléfono viejo del formulario ya no coincide con el vivo, así que se envía `phone = viejo` con la revisión nueva. El servidor no ve conflicto y **restaura el teléfono anterior sin avisar**. Así se anula la protección de concurrencia de §5 («`expectedRevision` distinto → `members/conflict`»). Además, la auditoría solo guarda nombres de campos (§7b), por lo que el valor sobrescrito no se recupera.
- **Arreglo:** congelar la base al abrir (`const [base] = useState(person)`) y calcular el diff contra `base`. Al guardar: si algún campo de perfil de `person` (vivo) difiere de `base`, mostrar el conflicto («Alguien cambió estos datos. Recarga.») y no enviar. Si no, enviar `expectedRevision: person.revision`. Así se respeta §5.0 (las visitas y los seguimientos no generan conflictos falsos) sin perder actualizaciones. Agregar un test: rerender con otro `phoneE164` mientras el diálogo está abierto y verificar que no se envía `phone`, o que aparece el conflicto.

### F3 · MINOR · Las hojas de acción leen en vivo la intención (`marking`) y la revisión
- **Dónde:** `components/members/sheets.tsx:110` (persona en vivo para todas las hojas); `:1116` y `:1121` (No contactar); `:1048` (Asignar); `:857` (Estado).
- **Evidencia:** `const marking = !person.doNotContact;` se recalcula en cada snapshot. Si B marca «No contactar» mientras A tiene abierto el diálogo «Marcar No contactar», el botón pasa a «Quitar No contactar». Un clic de A en ese instante **quita** la marca, contra su intención y contra el pedido de la persona. En «Asignar» pasa algo parecido: el valor preseleccionado puede estar desactualizado y se sobrescribe con la revisión nueva.
- **Arreglo:** congelar la intención al abrir (`const [marking] = useState(!person.doNotContact)`). Si al guardar el valor vivo ya es el objetivo, cerrar con «Ya estaba marcada». Si cambió de otra forma, mostrar el conflicto. Para «Asignar», advertir cuando `person.followUpOwnerUid` vivo difiere del de apertura.

### F4 · MINOR · Los límites de lectura no se señalizan
- **Dónde:** `lib/members/client.ts:36-37`, `:169-180`, `:208`; `components/members/person.tsx:577-618` y `:245`.
- **Evidencia:** `limit(1000)` en `membersPeople` y `limit(200)` en cada historial, sin ninguna señal en la UI. Con más de 1000 personas, las más antiguas desaparecen de la lista, de los KPIs y de la detección de duplicados del cliente. Además, la ficha (`m.views.get(id)`) muestra «No encontramos esta persona» para un `?id=` válido. En el historial, «Historial (200)» parece completo.
- **Arreglo:** exponer `truncated = snap.size >= PEOPLE_LIMIT` en `MembersState` y mostrar un `InlineNotice` («Se muestran las 1000 personas más recientes»). En la ficha, si no hay vista, hacer un `getDoc(membersPeople/{id})` de respaldo. En el historial, mostrar «Se muestran los últimos 200 registros» cuando algún listener llegue al límite. El volumen de V1 está lejos de estos límites, así que no bloquea el rollout.
- **Correcto (PASS):** las 4 consultas coinciden exactamente con `firestore.indexes.json:92-132` (`personId ASC, createdAt DESC` ×2 y `personId ASC, at DESC`). `orderBy(entryDate desc)` usa un índice automático. Las reglas `firestore.rules:1106-1121` permiten `get, list` con `membersRead()`, y la consulta no tiene filtros que las reglas rechacen. Los listeners se liberan bien: `use-members.ts:58-65` devuelve el `unsubscribe`, `client.ts:217` desuscribe los 3 listeners, `use-members.ts:85-87` usa un flag `alive` y `client.ts:269-271` hace lo mismo.

### F5 · MINOR · El bloque «Volvieron» no aplica la regla completa de §7
- **Dónde:** `lib/members/consolidation.ts:288-291` (también `personBadges`, `:316`).
- **Evidencia:** §7 dice que «Volvieron» son las personas activas que cumplen la regla «Volvió», que incluye «sin seguimiento posterior (`lastFollowUpDate < lastVisitDate`)». El código filtra solo con `hasReturnedRecently` (fecha posterior y ≤ 7 días), así que incluye a quien ya recibió un seguimiento. La UI lo admite («Visitas no primeras…», `dashboard.tsx:94`; «Agradecer» solo si existe la alerta, `dashboard.tsx:104`). El test `tests/members/consolidation.test.ts:127` no distingue los dos casos.
- **Arreglo:** decidir cuál manda. O se filtra con `returnedAlert` en `dashboard()`, o se corrige §7 del doc 23 («Volvieron: activas con una visita posterior a la primera en los últimos 7 días, con o sin seguimiento»). En ambos casos, agregar un test con una persona que volvió y ya tuvo seguimiento.
- **Correcto (PASS):** la alerta «Volvió» exige `lastVisitDate > firstVisitDate` (`consolidation.ts:64-70`; dos visitas el mismo día no cuentan, según `consolidation.test.ts:59-67`) y `lastFollowUpDate < lastVisitDate` (`:151-153`). La validez del responsable se calcula con `ownerOptions` (`:55-58`; si la lista no cargó, no se marcan responsables por un dato ilegible y se avisa en `status.tsx:43-49`). «No contactar» suprime todas las alertas salvo duplicados (`:125`, `:173-187`). Integrante y Sin continuidad quedan excluidos con `isOpen` (`:41-43`). Las fórmulas de KPIs, «Nuevos recientes» y «Pendientes» coinciden con §7.

### F6 · NIT · `ActivityField` oculta un `calendarEventId` que igual se envía
- **Dónde:** `components/members/sheets.tsx:362`, `:414`; `components/members/person-form.tsx:150`.
- **Evidencia:** el `<select>` muestra «Sin actividad» si `value` ya no está entre las ocurrencias (por ejemplo, si la actividad se canceló con el formulario abierto), pero el payload sigue llevando el `eventId` del estado. El servidor responde `calendar-not-found` con un mensaje claro, así que no hay riesgo de datos.
- **Arreglo:** que `ActivityField` llame `onChange("")` cuando el valor deje de estar disponible, o que el padre envíe solo el id visible.

### F7 · NIT · Lectura amplia del calendario en el selector
- **Dónde:** `lib/calendar/events-client.ts:68` (usado en `sheets.tsx:350`).
- **Evidencia:** `where("lastDate", ">=", date)` con una fecha pasada trae todas las actividades desde esa fecha en adelante, solo para listar las de un día. Es correcto y acotado por `calendarRead()` (`firestore.rules:1032`), pero costoso con fechas de hace meses.
- **Arreglo (LATER):** agregar un `where("startDate", "<=", date)` con su índice, o leer solo cuando cambia la fecha y no en cada tecla.

### F8 · NIT · `/nueva` depende solo de RouteGuard
- **Dónde:** `components/members/person-form.tsx:427-434`.
- **Evidencia:** `NewPersonScreen` no comprueba `m.canManage`. Hoy lo cubre `lib/access/routes.ts:56-62`: la regla exacta exige `manage`, y RouteGuard (`route-guard.tsx:54-56`) no monta la ruta. El servidor también rechaza.
- **Arreglo:** como defensa en profundidad, `if (!m.canManage) return <EmptyState …/>`.

### F9 · NIT · «Sin responsable» en la próxima acción no se puede elegir de verdad
- **Dónde:** `components/members/sheets.tsx:616` y `:799`; el servidor hace `input.ownerUid ?? person.followUpOwnerUid`.
- **Evidencia:** si la persona tiene un responsable y en el seguimiento se elige «Sin responsable», se envía `null` y el servidor usa igual el de la persona. La opción promete algo que no ocurre.
- **Arreglo:** cambiar la etiqueta por «El responsable de la persona», o aceptar un valor explícito en el servidor.

### F10 · NIT · «Próxima acción» sin contador
- **Dónde:** `components/members/sheets.tsx:743-752`.
- **Evidencia:** tiene `maxLength={120}` pero no contador. Las notas (`NoteField`, `:243-289`) sí tienen `maxLength`, contador `n/max` y la advertencia de datos sensibles.
- **Arreglo:** reutilizar el contador de `NoteField` para un input de una línea.

---

## Verificaciones que pasan (evidencia)

**2 · Acceso en la UI**
- El provider no lee nada sin permiso: `use-members.ts:59` (`if (!canRead) return;`) y `:78` para `membersOwnerOptions`. `useAccessModel` sin perfil devuelve ∅ (`lib/access/model.ts:74-77`), así que no hay ruido de permission-denied.
- RouteGuard envuelve `app/(private)/layout.tsx:17`. Una ruta prohibida nunca monta `integrantes/layout.tsx`, ni por lo tanto `MembersProvider`. Las reglas están en `lib/access/routes.ts:49-62` (prefijo con `read`; `/nueva` exacto con `manage`). El fallback legacy no otorga `members.*` (`firestore.rules:84-86`, tests en `members-access`).
- Solo lectura sin ninguna acción de escritura: el CTA del layout (`layout.tsx:24`), las hojas de escritura que solo se montan con `manageable` (`sheets.tsx:111-121`), la ficha (`person.tsx:286`, `:371`, `:439`, `:453-494`), la cola (`attention.tsx:37-45` → «Ver ficha»), el dashboard (`dashboard.tsx:104`, `:152`), el menú de fila (`people.tsx:353-372`) y el sheet móvil (`sheets.tsx:1165-1174`). Hay tests en `screens.test.tsx:171`, `:188`, `:234` y `:260`.

**3 · PII**
- No hay `localStorage`, `sessionStorage`, `console.*`, analytics ni `document.title` en el módulo (grep vacío). La búsqueda vive en el estado local (`people.tsx:590`), no en la URL. Los query params son enums más el `uid` del responsable (`people.tsx:84-93`) y `?id=` (`model.ts:13`).
- Los toasts tienen textos fijos sin nombres (`sheets.tsx:425`, `:444`, `:634`, `:870`, `:1051`, `:1123`; `person-form.tsx:176`, `:475`). Los errores se traducen a textos fijos (`api.ts:56-75`). Los responsables se muestran sin correos (`api.ts:303-304`).
- Los avisos de duplicado muestran nombre, ingreso y estado de personas de `membersPeople`, que quien está en la pantalla ya puede leer (`person-form.tsx:70-74`, `:546`; `consolidation.ts:183`).

**4 · Calendario**
- Los títulos se leen solo con `enabled = canReadCalendar` (`client.ts:240-274`; `person.tsx:550`). Sin el permiso aparece «Actividad del calendario» (`person.tsx:156`, `:384`). Test en `screens.test.tsx:268`.
- `ActivityField` solo se monta con `calendar.read` (`person-form.tsx:319`, `sheets.tsx:523`), y el payload omite el id sin ese permiso (`person-form.tsx:150`, `sheets.tsx:414`).
- Members solo importa lecturas del calendario (`useCalendarEvents`, `occurrencesInRange`, utilidades de UI). Ninguna mutación de `events-client` se usa desde members. `app/calendario-publico` no referencia `members*` (grep vacío).

**5 · Escrituras (lo que está bien)**
- Todo pasa por callables (`api.ts:230-281`). El cliente no escribe en Firestore y las reglas dicen `allow create, update, delete: if false`. No hay optimismo: el toast y el cierre ocurren después de que `write.run` resuelve (`sheets.tsx:423-427`, etc.).
- `requestId` se crea con `useState(newRequestId)` una vez por apertura (`person-form.tsx:124`, `sheets.tsx:396`, `:571`) y se reutiliza en los reintentos. Las hojas se remontan con `key={req.seq}`. «Registrar otra persona» remonta con `formKey`. Test en `screens.test.tsx:372`.
- El submit se deshabilita mientras se envía y sin conexión (`sheets.tsx:211`), con un ref anti doble envío (`sheets.tsx:142-145`).
- Conflicto: mensaje en español más «Recargar» (`sheets.tsx:167-178`). Suggestion-mismatch: mensaje y nueva propuesta (con la salvedad de F1). La aceptación parcial envía solo los ítems marcados (`sheets.tsx:604-618`; test en `:388`). «Integrado» se confirma en un diálogo aparte que dice «En esta versión no se puede deshacer.» (`:994-1025`). Reabrir después de una visita usa la `revision` que devuelve el servidor (`:439`) y es un botón que no viene premarcado.

**6 · WhatsApp**
- `whatsappLink` (`lib/shared/members.ts:167-171`) devuelve `null` salvo que `doNotContact === false` (falla seguro si falta el dato) y `isE164`. Arma `https://wa.me/<dígitos>` en local, sin `?text=`. Los enlaces usan `target="_blank" rel="noopener noreferrer"` (`sheets.tsx:316-325`, `people.tsx:374`).

**7 · Exclusiones**
- El grep de birth, nacimiento, cumpleaños, edad, menor, fe, bautismo, initialNotes, foto, archivo, upload y `type="file"` solo encuentra comentarios y el aviso de adultos. El aviso «solo adultos» está en `person-form.tsx:230-232`. `NoteField` usa `maxLength`, contador y `SENSITIVE_NOTE_WARNING` en todas las notas (visita, primera visita, seguimiento y motivo de cierre).

**8 · XSS**
- No hay `dangerouslySetInnerHTML`, `innerHTML` ni `javascript:`. Todos los `href` son rutas internas construidas con `encodeURIComponent` (`model.ts:13`) o `wa.me` validado. El texto del usuario solo aparece como hijo de JSX o en `aria-label`/`title`, que React escapa.

---

## Resultados de ejecución

| Comando | Resultado |
|---|---|
| `npx vitest run tests/members tests/platform/members-isolation.test.ts tests/platform/members-access.test.ts` | **4 archivos, 110 tests, 110 pasan**, 0 fallan (2,75 s) |
| `npx tsc --noEmit -p .` | exit 0, 0 errores |
| `npx eslint lib/members components/members "app/(private)/integrantes" --max-warnings=0` | exit 0, 0 errores, 0 warnings |

**Tests que faltan (recomendados junto con los arreglos):** F1 (casillas desmarcadas que sobreviven a un error de red), F2 (edición concurrente sin revertir) y F5 (volvió con seguimiento).

ATLAS (cliente): FIXES_REQUIRED
