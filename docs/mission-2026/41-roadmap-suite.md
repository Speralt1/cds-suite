# 41 · Hoja de ruta única de la suite (Alero)

Fecha: 03/11/2026. **Esta es la hoja de ruta vigente**; los planes de los docs 10, 25 y 38 §9 quedan como detalle de ejecución de las fases que aquí se citan. Estado: **P** propuesto · **I** implementado (en rama) · **T** probado · **D** desplegado.

## 1. Estado real por módulo

| Módulo | Funciona | Falta | Estado |
|---|---|---|---|
| Finanzas | Movimientos, caja, diezmos, resumen, conciliación SumUp, reportes | Publicar la retirada del saldo estimado (`fundsPosition: false`); fees SumUp de Slice 3A preservados aparte | D (versión 16/10); retirada I·T |
| Calendario | Actividades, áreas, recurrencia, permisos, enlace público, reporte | Turnos por actividad (lo cubrirá Equipos) | D |
| Integrantes › Consolidación V1 | Personas, visitas, seguimiento, responsables, alertas, auditoría | Despliegue por fases (doc 25); alta sin visita; aislamiento por responsable | I·T, **no D** |
| Integrantes › Ve por los tuyos | Núcleo de dominio y simulación 300/15 | Backend `outreach*`, permisos, endpoint del sitio, API del motor | I·T (lógica), P (backend) |
| Equipos | Áreas y usuarios/permisos como base | Equipos, turnos, disponibilidad, aceptación de asignaciones | P |
| Accesos | Alta de usuarios con permisos | Registro de invitación (cuenta creada / correo aceptado o fallido / primer ingreso verificable) | P |
| Identidad Alero | Tokens, tipografía, logo, login, shell, íconos, simulación del evento | Modo oscuro, «Hoy», portar Consolidación y Finanzas al nuevo lenguaje pantalla por pantalla | I·T, no D |
| Seguridad de dependencias | PR #34: audit productivo 9→0 y Functions 15→0 sin `--force` | Herramientas de desarrollo (54 avisos, requieren mayores) | I·T, no D |

## 2. Fases

| Fase | Contenido | Salida verificable | Aprobación previa |
|---|---|---|---|
| **F0 · Revisión** (ahora) | PR #33 (simulación 300/15), PR #34 (dependencias), PR de esta rama (Alero + núcleo VPLT + docs 39–41) | CI verde; revisión de diseño en capturas y en local | Decidir nombre y logo; confirmar fecha del evento |
| **F1 · Publicar lo ya construido** | Doc 25 desde C-A0: índices → Rules → seis `members*` por nombre → Hosting (incluye retirada del saldo, Alero y PR #34) → smokes y piloto admin | Baseline y backup previos; smokes; rollback probado | **GO por cada subfase**; Functions por nombre, nunca SumUp por efecto colateral |
| **F2 · Base del evento** (antes de D) | Backend `outreach*`: ediciones, equipo, inscripciones sin visita, consentimientos, identidad sin datos, permisos 10→14, Rules con aislamiento, índices; Mi lista real | Matriz de Rules (perfiles × colecciones × consultas sin filtro); presupuesto ≥100; simulación 300/15 contra el servicio | Aprobar modelo y permisos; textos de autorización |
| **F3 · Conexión con el sitio** | Endpoint de lectura en el sitio (rama aparte) + Function programada en CDS + bandeja de revisión | Contrato JSON compartido; pruebas de ambos lados con datos ficticios; corte y reanudación; nada escrito en el sitio | GO del sitio (su push despliega); acuerdo de retención y consentimiento |
| **F4 · Día D y distribución** | Confirmación de ausencias, propuesta y lote, reasignación, liberación de responsables | Ensayo general en emulador con 300/15, dos coordinadores y lotes concurrentes | Abrir acceso a los 15 solo con F2 aprobado |
| **F5 · Mensajería** | API del motor (lado motor) + adaptador CDS + plantillas | Transporte simulado → organización en modo de prueba con números ficticios → canario | Organización, número, titular, textos, destinatarios con autorización, canario |
| **F6 · Decisiones voluntarias** | Colección y permiso pastoral, registro con autorización explícita, agregados | Pruebas de que nunca aparecen en notas, bandeja, auditoría general ni logs | Valores, quién registra, retención, admin implícito, base legal (Ley 21.719) |
| **F7 · Traspaso** | `planHandoff` en backend reutilizando el código de Consolidación | Repetir traspaso = una ficha y una visita; métricas de Consolidación sin inflar | Criterio de quién pasa y cuándo |
| **D1–D3 · Diseño restante** | «Hoy» por rol; Consolidación y Finanzas al lenguaje Alero; modo oscuro | Capturas 375/768/1280, pruebas de pantalla, contraste ≥AA | Revisión visual |
| **E1 · Equipos** | Responsables y carga → turnos y disponibilidad → aceptación | Modelo mínimo aprobado | Alcance |
| **A1 · Accesos** | Registro de invitación y primer ingreso verificable; nunca guardar enlaces de recuperación | Pruebas con cuentas ficticias | Uso de la lista privada; reenvíos autorizados uno a uno |

Si la fecha del 28/11 se confirma, F2–F4 compiten con F1: lo mínimo seguro para D es **F1 + F2 (sin decisiones ni mensajería) + importación CSV con dry-run** en lugar de F3. Mensajería y decisiones no son requisito del día D.

## 3. Dependencias y riesgos

- F2 depende de F1 (Rules y Functions de Consolidación vivas) y de la ampliación del catálogo de permisos.
- F3 depende de un cambio en otro repositorio que despliega con cada push a su rama de producción.
- F5 depende de una API que el motor no tiene, y de resolver el hallazgo de barreras de envío del expediente privado.
- Retención del sitio (90 días) frente a seguimiento en CDS: sin acuerdo, CDS guardaría más de lo aceptado.
- Admin implícito vería decisiones (F6).
- Prueba de 300 dispositivos simultáneos, entrega real de correos y WhatsApp: **no cubiertas** por ninguna simulación.
- Fallo intermitente observado una vez en la suite completa (1/1.690) y no reproducido; vigilar en CI.

## 4. Qué se automatiza y qué decide una persona

| Automatizable (con pruebas) | Decide el administrador o una persona autorizada |
|---|---|
| Gates (lint, tipos, unitarias, Rules, emuladores, build, `check:no-preview`), simulaciones 300/15 | Nombre, logo, cruz o no |
| Lectura periódica del sitio con cursor e idempotencia | Fecha del evento; quién es coordinación y quién responsable |
| Propuesta de distribución, métricas, colas de revisión | Confirmar ausencias; confirmar cada lote; reasignaciones con motivo |
| Cancelar pendientes y mensajes ante una baja | Fusionar o vincular identidades; resolver duplicados y conflictos |
| Revalidar autorización antes de cada envío | Textos de autorización; plantillas; organización y número del motor |
| Bloquear decisiones fuera de su colección | Valores, acceso y retención de decisiones |
| Anonimización y conteos agregados | Traspaso a Consolidación |

## 5. Criterios de aceptación transversales

1. Ningún dato de una edición cerrada aparece como pendiente en la vigente.
2. Un responsable no puede leer, por consulta ni por id adivinado, una persona que no le fue asignada.
3. La distribución y el seguimiento del evento no modifican `membersPeople` ni `membersFollowUps`, salvo por el traspaso explícito.
4. Repetir cualquier operación (lectura del sitio, lote, contacto, traspaso, envío) no duplica.
5. Ninguna decisión, nota pastoral ni dato financiero sale hacia el motor ni hacia el sitio.
6. Toda baja cancela pendientes y mensajes en la misma transacción.
7. La build productiva no contiene simulaciones, datos ficticios ni valores de decisión (`check:no-preview`).
8. Montos, consultas y permisos de Finanzas idénticos antes y después del cambio visual.

## 6. Antes de producción (checklist de GO)

- [ ] Baseline vivo (Hosting, Rules, Functions, índices) y backup.
- [ ] Commit exacto, CI verde con Node 22, rollback escrito y probado en emulador.
- [ ] Rules y Functions desplegadas **por nombre**, nunca como efecto de un cambio visual.
- [ ] Permisos nuevos otorgados persona a persona; ninguno masivo.
- [ ] Textos de autorización y retención aprobados; Ley 21.719 revisada.
- [ ] Sitio: endpoint en rama aparte, revisado, con su propio GO.
- [ ] Motor: organización en modo de prueba, canario con números ficticios autorizados.
- [ ] Ningún correo ni WhatsApp real sin aprobación explícita y por campaña.

## 7. Trabajo preservado

`mission/slice3a-sumup-fees` (14 commits exclusivos) sigue sin fusionar. PRs #3, #4, #7, #8, #9 siguen abiertos como históricos. No se cambió la rama por defecto.
