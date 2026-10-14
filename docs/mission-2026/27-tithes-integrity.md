# 27 · Integridad de diezmos: fichas duplicadas y diezmos repetidos

**Fecha:** 2026-10-13 · **Rama:** `feature/tithes-integrity-v1` (desde `18925d6`) · **NO DEPLOY** · solo emuladores (`demo-cds-suite`) y datos ficticios.

## 1. Problema

Incidente real (anonimizado):

- Tesorería registró **dos diezmos idénticos** (misma ficha, fecha, monto y método) con 24 s de diferencia.
- Se creó una **ficha de familia con un nombre idéntico** al de otra ya existente.

Restricciones:

- **Repetir diezmos en un mes es normal** (quincenas, aportes separados de cada integrante, etc.). No se bloquea nunca; se avisa.
- Dos personas distintas pueden llamarse igual. Bloquear solo los nombres **indistinguibles**; para un homónimo real se pide distinguir el nombre (segundo apellido o una referencia), lo que cambia la clave.
- Las fichas **no se borran**: se archivan.

## 2. Diseño

### 2.1 Normalización (`lib/shared/names.ts`)

TS puro, compilado a `functions/shared/names.js` (`node scripts/build-shared.mjs`). **No depende de diezmos**: Consolidación (integrantes, PR #7) puede reutilizarlo tal cual para detectar personas duplicadas.

| Función | Qué hace |
|---|---|
| `normalizeName(raw)` | minúsculas → NFKD → quita marcas combinantes (á→a, ñ→n, ü→u) → pliega ß/æ/œ/ø/đ/ł → puntuación (`.,;:'"´`‐-_/()…`) como espacio → colapsa espacios → recorta |
| `identityKey(raw)` | palabras `[a-z0-9]` unidas por `_`, máximo 120. `""` si no queda ninguna (emoji, solo RTL, vacío). Siempre es un id de documento válido: `^[a-z0-9_]{1,120}$`, nunca `.`/`..`, nunca `__x__` (no hay `_` inicial, final ni doble) |
| `nameSimilarity(a,b)` | en [0,1]: máximo entre (1) razón Damerau‑Levenshtein (OSA) del nombre, (2) la misma con palabras ordenadas y sin repetir, (3) 0,85 si las ≥2 palabras del más corto están en el otro. Es 1 solo con la misma clave (si no, tope 0,99) |
| `similarProfiles(c, fichas, umbral=0.8, excluirId)` | coincidencias `exact` (misma clave) o `similar` (≥ umbral), exactas primero |
| `duplicateGroups(fichas, umbral)` | grupos transitivos (unión‑búsqueda) para el panel de duplicados; prefiltro por largo |

Ejemplos: "Juan Pérez", "juan perez", "JUAN PÉREZ", "Juan  Pérez", " Juan Pérez ", "Juán Pérez", "Juan Pérez." → `juan_perez`. "Juan Pérez" vs "Juana Pérez" → similar (0,91), no exacto. "Ana Soto" vs "Pedro Rojas" → 0,18.

`NAME_KEY_VERSION = 1`: cambiar el algoritmo cambia las claves ya guardadas. Exige migrar el registro.

**Alfabetos mixtos:** la clave solo conserva `[a-z0-9]` tras plegar tildes. Las letras de otros alfabetos (griego, cirílico, árabe, hebreo, CJK) y los emoji se descartan, así que «Juan Иван» y «Juan» tienen la misma clave (`juan`). Además, las homoglifas (la «а» cirílica frente a la «a» latina) no se unifican: «Аna» con A cirílica da `na`. Hoy no afecta a los nombres de la iglesia (español). Si algún día importa, hay que transliterar antes de normalizar, lo que obliga a subir `NAME_KEY_VERSION`.

### 2.2 Registro de identidad (backend, transaccional)

Colección nueva `titheProfileKeys/{identityKey}` = `{ profileId, createdAt, createdBy }`. Es inmutable. La ficha guarda `identityKey` (opcional en Fase 1).

`saveProfile` (cliente) escribe ficha + registro en **una** `runTransaction`:

| Caso | Efecto |
|---|---|
| Alta, clave libre | crea registro + ficha con `identityKey` |
| Alta, clave de otra ficha | `DuplicateProfileError(profileId)` → la UI ofrece «Usar ficha existente» |
| Reintento de un alta confirmada (mismo id) | no hace nada (idempotente) |
| Edición sin cambio de clave (también archivar/reactivar) | no toca el registro |
| Cambio de nombre | registra la clave nueva y borra la anterior en el mismo commit; si la nueva es de otra ficha → `DuplicateProfileError` |
| Ficha antigua sin clave, **activa** | registra su clave si está libre (o si ya apunta a ella). Si la tiene una **gemela archivada** con el mismo nombre, esa gemela la **cede** (commit aparte: se le quita `identityKey` y se borra el registro) y la activa la toma. Si la tiene otra ficha **activa**, guarda **sin** clave y devuelve `possibleDuplicateOf` → aviso «Posible ficha duplicada». **Nunca bloquea editar un registro antiguo** |
| Ficha antigua sin clave, **archivada** (o que se archiva ahora) | **no toma** la clave aunque esté libre, para que la gemela activa pueda tomarla en su próxima edición |
| Ficha guardada sin clave con registros «huérfanos» | antes de la transacción consulta `titheProfileKeys where profileId == id` (≤ 10). Dentro de la transacción vuelve a leer cada uno y borra los que siguen apuntando a ella y no son la clave que conserva. Esos huérfanos los deja el cliente anterior cuando cambia el nombre y reescribe la ficha sin `identityKey` |
| Nombre sin letras latinas | se guarda sin clave |

Una ficha **con clave** que se archiva **sigue reservando su nombre**: al crear otra igual se ofrece «Revisar y reactivar», salvo que exista una ficha activa con ese nombre, en cuyo caso se ofrece «Usar ficha existente» (las coincidencias exactas se ordenan activas primero). La reserva cede solo ante una gemela antigua **activa** con el mismo nombre (tabla anterior).

### 2.3 Reglas (texto exacto agregado)

```
function validProfile(d) { … hasOnly([… 'searchName','identityKey', …]) …
  && (!('identityKey' in d) || validIdentityKey(d.identityKey)); }
function validIdentityKey(k) { return k is string && k.matches('^[a-z0-9_]{1,120}$'); }
function profileKeyPath(k) { return /databases/$(database)/documents/titheProfileKeys/$(k); }
function profileDocPath(id) { return /databases/$(database)/documents/titheProfiles/$(id); }
function profileKeyHeld(d, id) { return getAfter(profileKeyPath(d.identityKey)).data.profileId == id; }
function profileKeyTransition(n, o, id) {
  let nk = n.get('identityKey', '');
  let ok = o.get('identityKey', '');
  return nk == ok || nk == ''
    || (profileKeyHeld(n, id) && (ok == '' || !existsAfter(profileKeyPath(ok))));
}
match /titheProfiles/{id} {
  allow read: if financeDetailsRead();
  allow create: if financeRecordsManage() && validProfile(request.resource.data) && auditCreate(request.resource.data)
    && (!('identityKey' in request.resource.data) || profileKeyHeld(request.resource.data, id));
  allow update: if financeRecordsManage() && validProfile(request.resource.data) && auditUpdate(request.resource.data,resource.data)
    && profileKeyTransition(request.resource.data, resource.data, id);
  allow delete: if false;
}
match /titheProfileKeys/{key} {
  allow read: if financeDetailsRead();
  allow create: if financeRecordsManage() && validIdentityKey(key)
    && request.resource.data.keys().hasOnly(['profileId','createdAt','createdBy'])
    && text(request.resource.data.profileId,1,128)
    && request.resource.data.createdBy == request.auth.uid && request.resource.data.createdAt == request.time
    && getAfter(profileDocPath(request.resource.data.profileId)).data.get('identityKey', '') == key
    && getAfter(profileDocPath(request.resource.data.profileId)).data.updatedAt == request.time;
  allow update: if false;
  allow delete: if financeRecordsManage()
    && getAfter(profileDocPath(resource.data.profileId)).data.get('identityKey', '') != key
    && getAfter(profileDocPath(resource.data.profileId)).data.updatedAt == request.time;
}
```

Por qué es seguro ante concurrencia: escribir sobre una clave existente es un **update** y está denegado. Dos altas simultáneas con el mismo nombre no pueden terminar ambas. El test lo comprueba con dos clientes a la vez: gana exactamente uno.

**Sin cambios** en `titheAttributions`, `financeTransactions`, `financeMonthlySummaries` ni en los helpers financieros optimizados (doc 26). `budget.test.ts` pasa con `REQUIRED_MARGIN = 100` sin tocarlo. Las reglas nuevas solo se evalúan en escrituras de fichas, que no forman parte de los commits financieros medidos. Por eso no se repitió la medición del doc 26.

### 2.4 Fase 1 / Fase 2

- **Fase 1 (esta rama):** `identityKey` es **opcional**. El cliente hoy desplegado (que no la envía) sigue creando y editando fichas.
  - Si ese cliente reescribe una ficha con clave **sin cambiar el nombre**, la deja sin el campo; las reglas lo permiten (`nk == ''`). El registro **sigue existiendo**, así que el nombre sigue bloqueado, y el cliente nuevo lo vuelve a enlazar en la siguiente edición.
  - Si ese cliente **cambia el nombre**, el registro del nombre anterior queda huérfano: sigue apuntando a la ficha y bloqueando ese nombre. El cliente nuevo lo borra en la siguiente edición de esa ficha (§2.2). Mientras nadie la edite, el nombre anterior sigue reservado.
- **Límites conocidos de Fase 1** (solo un usuario con `finance.records.manage`, rol de confianza; los cierra la Fase 2):
  - **P2 · toma de clave en dos commits:** quitar `identityKey` a una ficha (permitido en Fase 1) y borrar su registro en el mismo commit libera el nombre; en un segundo commit otra ficha puede tomarlo. Es el mismo mecanismo que usa la cesión desde una gemela archivada.
  - **P4 · acumulación de registros huérfanos:** cada cambio de nombre hecho con el cliente anterior deja un registro huérfano hasta la próxima edición con el cliente nuevo.
- **Fase 2 (cambio futuro, aparte):** cuando todo el tráfico use el cliente nuevo, se puede exigir `identityKey` al crear y prohibir quitarla, salvo para nombres sin letras latinas, que hoy no tienen clave. Antes conviene un script (solo lectura + informe) que liste las fichas antiguas sin clave y sus colisiones.

## 3. UX

### 3.1 Ficha (crear / editar)

- Al abrir el formulario se hace **una** lectura acotada: `titheProfiles orderBy searchName limit 501`, que incluye las archivadas. Sobre ella se calculan las coincidencias en el cliente, con *debounce* de 250 ms. Nunca se consulta por cada tecla. Si hay más de 500 fichas, se avisa «Se compararon las primeras 500 fichas». El registro del servidor sigue protegiendo los nombres exactos.
- **Nombre exacto** (misma clave) en un alta o un cambio de nombre: bloquea con «Ya existe una ficha con este nombre». Ofrece:
  - «Usar ficha existente», que en el flujo de diezmo la selecciona;
  - «Revisar coincidencias»;
  - si la ficha está archivada, «Revisar y reactivar», que abre esa ficha con «Ficha activa» marcado.

  El texto pide distinguir el nombre si es otra persona. Guardar con la coincidencia visible no envía nada y lleva el foco al aviso. La comprobación usa el nombre actual, no el del *debounce*.
- **Nombre similar:** aviso informativo «Ya encontramos una persona con un nombre similar». Se puede continuar.
- **Editar una ficha antigua** con nombre duplicado: aviso «Posible ficha duplicada». No bloquea.
- **Desmarcar «Ficha activa»** muestra: «La ficha se archiva: conserva su historial, deja de aparecer al registrar diezmos. No se elimina.»

### 3.2 Registrar diezmo

- **Búsqueda:** sobre la misma lista acotada, coincidencia normalizada por palabras. «perez» encuentra «Pérez» y «perez juan» encuentra «Juan Pérez». Solo muestra fichas activas, hasta 30. Con más de 500 fichas se suma la búsqueda por prefijo del servidor, que es el comportamiento anterior.
- **Aviso de diezmo repetido:** aparece solo en un alta con ficha, no al editar. Consulta `titheAttributions where profileId == X, status == "active", date >= inicioMes, date < inicioMesSiguiente, orderBy date desc, limit 20`. Usa el **índice existente** `(profileId ASC, status ASC, date DESC)`; **no se agregó ningún índice**. Es un listener que se vuelve a suscribir solo cuando cambia el mes de la fecha.
  - Texto: «Aviso: esta persona o familia ya registra 2 diezmos durante octubre de 2026 (total $195.000). Último: 02-10-2026 · $145.000.»
  - «Revisar aportes» despliega fecha, monto, método y referencia. El método sale de un `documentId in` de ≤ 30 movimientos, **solo al expandir**.
  - «Registrar otro diezmo» confirma el aviso y se continúa.
  - Nunca bloquea.
- **Coincidencia exacta** (misma ficha, fecha, monto y método, activa; la búsqueda es por **fecha exacta**, no por el mes): al guardar aparece un paso de confirmación con semántica `alertdialog`: «Encontramos un aporte con los mismos datos. Comprueba que no estés registrándolo dos veces.»
  - Muestra el aporte existente con «Registrado el dd-mm-aaaa hh:mm» y su referencia.
  - «Volver y revisar» recibe el foco, y Escape equivale a esa opción. «Sí, es otro aporte» guarda.
  - La comprobación consulta `titheAttributions where profileId == X, status == "active", date == fecha` (≤ 30, mismo índice). No reutiliza la consulta del mes (tope 20), así no se pierden duplicados en meses con muchos aportes. Solo si hay candidatos del mismo monto lee su método. Si la consulta falla, no bloquea.
- **Doble clic / doble envío / reintento:**
  - id estable por formulario y bloqueo síncrono (`useRef`) mientras se guarda;
  - `saveTransaction` lee el id dentro de la transacción y rechaza un segundo alta («Este movimiento ya fue registrado»).
  - Test: tres envíos concurrentes con el mismo id dan **1 movimiento, 1 atribución, resumen contado una vez**.

### 3.3 Fichas archivadas y duplicados (Diezmos)

- **Lista de fichas:**
  - oculta las archivadas por defecto;
  - botón «Mostrar archivadas (N)», donde N es un conteo por agregación (`active == false`) que no lee documentos;
  - el estado se muestra como «Archivada».
- **Panel «Posibles fichas duplicadas»:**
  - visible con `finance.records.manage`, el mismo permiso que gestiona fichas;
  - plegado: solo al abrirlo lee la lista acotada;
  - grupos por misma clave o similitud ≥ 0,8 (los mismos pares que marca el formulario, incluidos los de subconjunto de palabras como «Ana Soto» ⊂ «Ana María Soto»). Cada ficha muestra su estado, fecha de creación y conteo de diezmos activos (agregación), con las activas primero;
  - un grupo con **como máximo una ficha activa** queda «Resuelto» y se oculta por defecto («Mostrar resueltos (N)»);
  - acciones: «Abrir ficha» y «Archivar». «Archivar» pide confirmación y usa `saveProfile`, la ruta normal con auditoría.
  - **Sin fusionar, sin borrar, sin cambios automáticos.**

### 3.4 Trazabilidad de movimientos (pedido de Tesorería)

- **«Ver» de un movimiento:**
  - «Creado el», «Modificado el» y «Anulado el» muestran **fecha y hora** de Chile (`America/Santiago`, `dateTimeLabel`, p. ej. «08-10-2026 14:58»), con el mismo separador que el resto de la app;
  - fila nueva «Referencia» con los últimos 6 caracteres del id, en monoespaciado (p. ej. «…5UFRhF»).
- **Historial de la ficha:** muestra la misma referencia bajo la fecha, en texto secundario. Así Tesorería puede identificar sin ambigüedad qué diezmo editar.

## 4. Accesibilidad

- Avisos con `role="status"` + `aria-live="polite"`. El mensaje está en el texto («Aviso:», «Ya existe…»), no depende del color, y el ícono es `aria-hidden`.
- El paso de confirmación usa `role="alertdialog"`, `aria-modal`, `aria-labelledby` y `aria-describedby`. El foco va a la opción segura y vuelve al monto al regresar.
- Los botones «Revisar…» exponen `aria-expanded`/`aria-controls`.
- Todos los botones nuevos usan `button-secondary`/`button-primary` con `min-height: 44px` (táctil, iPad). Los enlaces «Abrir ficha» de la lista de coincidencias también miden 44 px.
- Contraste:
  - textos del aviso: #6b4a12 sobre #fbf1de;
  - bloqueo: #922f2e sobre #fff0ed;
  - referencia: #5f6d65 sobre blanco (≥ 4,5:1).

## 5. Costo de consultas

| Acción | Lecturas |
|---|---|
| Abrir formulario de ficha / registrar diezmo | 1 consulta, ≤ 501 docs (compartida entre el buscador y el formulario de alta) |
| Escribir en el nombre | 0 (cliente) |
| Aviso de diezmo repetido | 1 listener, ≤ 20 docs, solo al cambiar de mes |
| Guardar diezmo nuevo | +1 consulta por fecha exacta (≤ 30) y, solo si hay mismo monto, +1 `in` (≤ 30) |
| Guardar ficha antigua sin clave | +1 consulta `titheProfileKeys where profileId` (≤ 10), para limpiar huérfanos |
| «Revisar aportes» | +1 `in` (≤ 30) |
| Lista de fichas | +1 agregación (conteo de archivadas) |
| Panel de duplicados (solo al abrir) | ≤ 501 docs + 1 agregación por ficha en grupo |
| Guardar ficha | +1 lectura del registro (dentro de la transacción) |

## 6. Seguridad

- El registro tiene la misma sensibilidad que las fichas (el nombre normalizado está en la clave). Su lectura es idéntica a la de `titheProfiles` (`financeDetailsRead`) y la escritura exige `financeRecordsManage`.
- Líder, usuario inactivo, sin perfil y anónimo: denegados (con test).
- No se puede crear un registro sin que la ficha lo tome en el mismo commit, ni borrarlo mientras la ficha lo usa, ni modificarlo.
- Límite conocido: las reglas no pueden recalcular la normalización Unicode. Un usuario con `finance.records.manage` podría enviar una clave arbitraria con formato válido. El objetivo es evitar errores honestos de Tesorería, no un atacante interno; ese rol ya puede escribir el libro.
- Las fichas siguen sin poder borrarse (`allow delete: if false`).

## 7. Pruebas

| Suite | Qué cubre |
|---|---|
| `tests/platform/shared-names.test.ts` | normalización (13 variantes de «Juan Pérez»), ñ/ß/ø, emoji/RTL/vacío/no-string, id válido ≤ 120, similitud, ranking (exactas activas primero), grupos (activas primero, «resuelto»), subconjunto de palabras con largo muy distinto, **acuerdo `duplicateGroups` ↔ `similarProfiles`**, rendimiento con 500, paridad TS ↔ CJS |
| `tests/tithes-integrity-ui.test.tsx` | bloqueo por nombre exacto (UI) y «Usar ficha existente»; similar no bloquea; archivada → «Revisar y reactivar»; reactivar; texto de archivo; ficha antigua no se bloquea; cambio de nombre a uno usado se bloquea; `DuplicateProfileError` del servidor (lee la ficha dueña y muestra su estado real); con gemela archivada y activa ofrece «Usar ficha existente» sobre la activa; panel de duplicados (oculta resueltos, «Mostrar resueltos», conteos, «Archivar» con doble toque → un solo guardado); búsqueda «perez»; aviso con cantidad, total y último; re-consulta solo al cambiar de mes; confirmación exacta (alertdialog, foco, Escape, confirmar guarda una vez); doble envío → un guardado; `dateTimeLabel`/`shortReference` |
| `tests/rules/tithes-integrity.test.ts` | alta con clave; duplicado (cliente y reglas); altas concurrentes → una gana; nombres parecidos no se bloquean; registro sin ficha / formato inválido / auditoría falsa → denegado; cambio de nombre mueve la clave; cambio de nombre sin borrar la anterior → denegado; cambio de nombre a una clave ocupada → denegado; registro inmutable; ficha antigua sin clave (registra o avisa); **gemelas antiguas**: archivar una no le entrega la clave y la activa la toma en su próxima edición; si la archivada ya tenía la clave, la cede a la activa; **registro huérfano** de un cambio de nombre del cliente anterior se borra en la siguiente edición; **coincidencia exacta por fecha** con más de 20 diezmos en el mes; Fase 1 con el cliente desplegado; archivar/reactivar; reintento idempotente; nombre sin letras; permisos de lectura y escritura; diezmos idénticos con distinto id permitidos; doble envío concurrente → 1 movimiento, 1 atribución, resumen una vez; no se atribuye a una ficha archivada |
| `tests/emulator/tithe-edit-month.e2e.test.ts` | flujo **Editar** real: diezmo de octubre movido a septiembre. Septiembre suma el monto y +1, octubre resta el monto y −1, `titheTotal` se mueve, la atribución cambia de período y fecha, ambos siguen activos, revisión 2 y no se crea ningún documento nuevo |

## 8. Plan de despliegue (requiere aprobación humana en cada paso)

1. **Reglas primero, y solo junto con C‑A1.2 o después.** Esta rama parte de las reglas de `18925d6` (C‑A1.2, doc 26), pero producción sigue con el ruleset `2d9939ab`. Estas reglas no se despliegan solas: salen con el rollout de C‑A1.2 o después de él.
   - Tras integrar con las ramas de Consolidación (miembros) y de bancos/payouts, volver a correr `npm run test:rules`, incluido `budget.test.ts`, y la medición del doc 26 con `PAD_AT=summary`.
   - Las reglas de Fase 1 aceptan al cliente desplegado sin cambios.
   - `scripts/build-shared.mjs` (`SHARED_FILES`) tendrá un conflicto trivial con las ramas de miembros y de payouts de SumUp: **conservar todas las entradas**.
2. **Hosting después**, con el cliente nuevo.
3. **Índices:** ninguno nuevo.
4. **Functions:** no se despliegan. `functions/shared/names.js` solo se agrega como código compartido y no lo usa ninguna Function todavía.
5. **Fase 2**, más adelante y por separado: exigir `identityKey` al crear.

## 9. Rollback

- **Hosting:** volver a la versión anterior. Los registros creados quedan, pero el cliente viejo los ignora, y las reglas de Fase 1 siguen aceptando sus escrituras. Cada cambio de nombre que haga el cliente viejo durante el rollback deja un registro huérfano que sigue reservando el nombre anterior; el cliente nuevo los limpia al volver a editar esas fichas.
- **Reglas:** volver al ruleset anterior.
  - El `validProfile` anterior no admite `identityKey`. Con las reglas viejas:
    - el cliente viejo sigue funcionando, porque reescribe la ficha completa sin el campo;
    - el cliente nuevo y las actualizaciones parciales de fichas con clave quedarían denegadas.
  - Por eso se revierte **Hosting antes que las reglas**. Si hace falta, se quita el campo con un script de administración (solo con autorización).
  - La colección `titheProfileKeys` queda sin acceso de clientes (cae en `/{document=**}`) y no afecta al libro.

## 10. Operaciones de Tesorería

### a) Mover un diezmo al mes correcto

1. Abre **Finanzas › Movimientos**, en el mes donde quedó mal registrado. También puedes buscar la referencia en el historial de la ficha.
2. Pulsa **Ver** y comprueba la **Referencia** y la fecha y hora de creación. Luego pulsa **Editar**.
3. Cambia la **Fecha** al día correcto y guarda.

Qué cambia:
- el movimiento y su atribución pasan al mes nuevo;
- el resumen del mes anterior resta el monto y un registro, y el del mes nuevo los suma (también el total de diezmos).

Qué se conserva:
- el mismo documento (mismo id);
- `createdBy`/`createdAt` originales;
- `updatedBy`/`updatedAt` del cambio, y la revisión sube a 2;
- la nota privada.

No se crea ni se borra nada. Verificado con el emulador (§7).

### b) Archivar una ficha duplicada

Ruta: **Diezmos › Posibles fichas duplicadas › Revisar posibles duplicados**.

1. Compara las fichas: estado, fecha de creación y diezmos activos. Ábrelas si hace falta.
2. En la que sobra, pulsa **Archivar** y luego **Confirmar archivo**.

La ficha archivada:
- conserva todo su historial y sigue en los reportes;
- deja de aparecer al registrar diezmos;
- no le quita el nombre a la gemela activa. Si la archivada era antigua (sin clave), no toma la clave. Si ya la tenía, la cede cuando se edita la activa, y la próxima edición de la activa registra su clave;
- el grupo pasa a «Resuelto» en el panel.

Se puede reactivar en **Editar ficha** marcando «Ficha activa».

Los diezmos que ya están en la ficha archivada **no se mueven**. No hay fusión automática. Si hay que reasignarlos, es una corrección contable aparte: anular y volver a registrar en la ficha correcta, con motivo.

### c) Por qué no se ofrece borrar

- Un diezmo y su ficha son parte del libro y de la relación pastoral. Borrar rompería la trazabilidad (quién registró qué y cuándo), los totales históricos y la auditoría.
- Las reglas lo prohíben: `allow delete: if false` para fichas, movimientos y atribuciones.
- Archivar logra el objetivo operativo (que no aparezca) sin perder información. Anular un movimiento deja constancia del motivo.

## 11. Riesgos abiertos

- Más de 500 fichas: las coincidencias similares en el cliente son parciales. Los nombres exactos siguen protegidos en el servidor para las fichas con clave.
- Las fichas antiguas sin clave no bloquean altas nuevas con su nombre hasta que alguien las edite. La UI igual avisa si están dentro de las 500 cargadas. Un backfill del registro sería un cambio aparte, con revisión.
- **Cliente viejo cacheado en un navegador** (o tras un rollback de Hosting):
  - si edita una ficha con clave sin cambiar el nombre, deja el registro sin enlazar; el cliente nuevo lo vuelve a enlazar;
  - si cambia el nombre, el nombre anterior queda reservado por un registro huérfano hasta la próxima edición con el cliente nuevo, que lo borra.

  Son los límites P2 y P4 de Fase 1 (§2.4), y los cierra la Fase 2.
