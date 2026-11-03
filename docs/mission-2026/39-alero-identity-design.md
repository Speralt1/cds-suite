# 39 · Alero: identidad, nombre y sistema visual de la suite

Fecha: 03/11/2026. Rama `design/suite-redesign-vplt-20261103` (desde PR #33 @ `ea7ae20`). **Propuesto e implementado en rama; probado con pruebas y emuladores; NO desplegado.** Reemplaza la propuesta de login del PR #33, que no era una dirección aprobada.

## 1. Cómo se usa realmente la suite (base de las decisiones)

| Quién | Dónde | Frecuencia | Qué necesita |
|---|---|---|---|
| Administración / tesorería | Escritorio, iPad | Domingo y semana | Montos exactos, conciliación, nada ambiguo |
| Pastores y líderes | Teléfono, iPad | Semanal | Ver su área y su agenda sin ruido |
| 15 responsables del evento | Teléfono | Ráfagas tras el evento | Su lista, llamar, anotar resultado, próxima acción |
| Coordinación del evento | Escritorio | Antes, durante y después | Padrón, asistencia, reparto, pendientes |

Uso episódico, con personas que no son técnicas: menos pantallas, una acción principal por vista, estados con palabra + ícono, y que lo pendiente aparezca primero.

## 2. Referencias investigadas

- Planning Center Workflows: conteos «mis tarjetas / listas / atrasadas / sin asignar», paso de asignación de recién llegados, reasignación en lote → base de Distribución y Mi lista.
- Planning Center Check-Ins: modos de estación por rol (atendida, autoservicio, lista) → modos por rol del evento.
- Mercury: montos alineados a la derecha con cifras tabulares; estado fallido tachado y con palabra, no solo color → Finanzas.
- Linear «My Issues»: agrupación por foco (urgente → bloqueado → activo) y grupos vacíos ocultos → orden de Mi lista.
- Things 3: navegación por tiempo (Hoy, Próximo) → futura pantalla «Hoy».
- ChurchSuite (rediseño 2026): visibilidad de notas pastorales por grupo → restricción de decisiones.
- Breeze: se valora lo poco que hay que capacitar; se critica el seguimiento débil → simplicidad, y seguimiento como diferenciador.

No se obtuvieron capturas reales de recepción móvil (Refero sin suscripción). La recepción queda en el sitio del evento (doc 40 §2), que ya tiene puerta probada.

## 3. Nombre

| Candidato | Lectura | Riesgo |
|---|---|---|
| **Alero** | Alero de la casa; en Chile «al alero de» = bajo el cuidado de alguien. Conversa con «Casa de Salvación». | Existe una app comercial menor con ese nombre (El Salvador); no es de software para iglesias. |
| Atrio | Patio de entrada del templo | Genérico; usado por aseguradoras e inmobiliarias. |
| Zaguán | Entrada de las casas latinas | Tilde; poco conocido por jóvenes. |
| Umbral | Cruzar hacia adentro | Abstracto; «umbral» técnico. |
| Tejido | Comunidad entrelazada | Evoca textiles. |
| Mesa, Raíz, Cobijo | Comunión, crecimiento, refugio | Muy genéricos o con otros sentidos regionales. |

**Recomendación: Alero.** Dos sílabas, sin tilde, significado local de cuidado, y entrega su propio logo y color (la **teja** del alero). Uso: «Alero · Casa de Salvación». No es una búsqueda de marca registrada: antes de usarlo fuera de la iglesia, el administrador debe pedir una búsqueda formal en INAPI.

Lo que **no** cambia con la marca: proyecto Firebase, colecciones, Functions, rutas, permisos, `homeModule`, dominios. Solo cambian textos visibles, metadatos, manifiesto e íconos.

## 4. Logo

Archivos en [`brand-39/`](brand-39/). Retícula 24×24, un color (`currentColor`).

- **A · Alero (recomendado e implementado):** chevrón abierto (2,13)→(12,4)→(22,13), trazo 2,75 con puntas redondas, más ancho que la casa (el alero sobresale) y una puerta sólida debajo. Se lee a 16 px. [marca](brand-39/alero-a-mark.svg) · [ícono de app](brand-39/alero-a-app-icon.svg) · [logotipo](brand-39/alero-a-lockup.svg).
- **B · Puerta abierta:** arco con la hoja de la puerta en teja. A 16 px la hoja se pierde: solo ≥32 px. [svg](brand-39/concept-b-puerta.svg)
- **C · Mesa / comunidad:** retícula 3×3 con un cuadro en teja («una persona recibida»). Muy robusto, menos significativo. [svg](brand-39/concept-c-mesa.svg)

Decisión pendiente de los pastores: incluir o no una cruz. Ningún concepto la incluye por defecto.

## 5. Color (implementado como tokens)

Neutros cálidos (cal y papel), tinta para la acción principal, **teja** solo para identidad, foco y el Evento. Contrastes calculados (WCAG 2.x):

| Token | Valor | Contraste |
|---|---|---|
| canvas / surface / sunken | `#f6f3ee` / `#fffdf9` / `#eee9e1` | — |
| ink (texto y botón principal) | `#1f1b17` | 15,5:1 sobre canvas; blanco sobre botón 17,1:1 |
| muted | `#6b6158` | 5,5:1 canvas · 6,0:1 blanco |
| brand (teja) | `#a8432a` | 6,0:1 blanco · 5,4:1 canvas |
| borde de campo | `#8f8478` | 3,7:1 (≥3:1 no textual) |
| peligro (carmín, distinto de la teja) | `#b4234a` | 6,4:1 blanco · 5,4:1 sobre su tinte |
| advertencia (texto) | `#6e4800` | 7,2:1 sobre `#fbf0d9` |
| ingreso / gasto | `#1e7a4c` / `#9e3b55` | 4,6:1 / 5,5:1 sobre su tinte |
| barra lateral | `#1c1916`, texto `#e8e1d7`, acento `#e58b6b` | 13,5:1 · 6,9:1 |

Acentos de módulo (marcan **dónde estás**, nunca un estado): Finanzas petróleo `#0f6b6b`, Calendario añil `#3a4fa8`, Personas ciruela `#8a3b7a`, Equipos musgo `#56661c`, Evento teja. La paleta de áreas del Calendario (doc 35) **no se tocó**.

Aplicación: 213 colores fijos remapeados de forma sistemática en `app/globals.css` y los CSS de módulos (tabla en el commit); ningún cálculo, monto ni consulta cambió. Modo oscuro: valores propuestos por diseño, **no implementado** (requiere retirar colores fijos restantes; fase D2 del doc 41).

## 6. Tipografía (implementada)

- **Fraunces** (variable, eje SOFT) solo para títulos ≥22 px: título de módulo, login, encabezado del evento.
- **Inter** para toda la interfaz; `tabular-nums` en montos y conteos (`.tabular`, KPIs, contadores).
- Ambas vía `next/font/google`: se descargan en la build y se sirven desde el mismo origen. Verificado: `out/` no contiene `fonts.googleapis`/`fonts.gstatic`. Requiere red en la build (CI la tiene).

## 7. Navegación y arquitectura de información

Implementado: misma estructura de shell ya probada (rail/sidebar, barra inferior ≤5 módulos, subnav por módulo), con la nueva identidad. Se conservaron sus contratos de accesibilidad (orden de foco, nombres accesibles, 44 px).

Propuesto para fases siguientes (doc 41):
1. **Hoy** como inicio por rol: una lista en orden de foco (Atrasado → Hoy → Esta semana), no tarjetas de KPI.
2. Barra inferior con «Hoy» + 3 módulos + «Más» cuando haya más de 5.
3. Durante el evento, «Evento» fijo como segunda pestaña para quien tenga rol en la edición.
4. Personas (Integrantes) con Consolidación y Ve por los tuyos como secciones hermanas.

## 8. Design Lock (reglas)

1. Neutros cálidos; tinta para la acción principal; teja solo para identidad, foco y Evento.
2. Color de módulo = ubicación; estado = ícono + palabra + color.
3. Montos: cifras tabulares, alineados a la derecha, `$125.000`, signo menos real.
4. Fraunces solo en títulos ≥22 px; nunca en tablas ni montos.
5. Listas y tablas antes que tarjetas; una acción principal por pantalla.
6. Teléfono: objetivos ≥44 px, campos de 16 px, acción principal al alcance del pulgar.
7. Toda escritura cubre pendiente, error, sin conexión y deshacer.
8. Movimiento solo para retroalimentación (120–240 ms); `prefers-reduced-motion` lo anula.
9. Tuteo, mayúscula inicial, sin anglicismos («Llegada», no «check-in»).
10. No guardar decisiones de fe en notas: la interfaz lo recuerda donde se escribe.

## 9. Evidencia visual

Capturas con datos ficticios del emulador y la simulación local en [`screens-r39/`](screens-r39/): login escritorio y móvil, Finanzas, Calendario, Ve por los tuyos (panorama, propuesta de distribución, Mi lista móvil, registro de contacto móvil, marca en la mesa móvil).
