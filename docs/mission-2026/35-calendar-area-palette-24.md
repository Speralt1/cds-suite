# 35 · Calendario: paleta de áreas de 10 a 24 colores (R2.6)

**Estado:** Draft PR, sin merge ni deploy. Cada despliegue requiere su propio GO.

## Qué cambia

- `AREA_COLORS` pasa de 10 a 24. Los 10 originales **no cambian**: mismas claves, mismo orden de almacenamiento, mismos hex y nombres. Los datos guardados siguen siendo válidos y no hay migración.
- Los 14 nuevos se agregan al final del arreglo:

| Clave | Nombre | Swatch | Tinta | Fondo | swatch/blanco | tinta/blanco | tinta/fondo |
|---|---|---|---|---|---|---|---|
| `coral` | Coral | `#d3675b` | `#983c34` | `#fbe9e6` | 3.58 | 6.93 | 5.91 |
| `burdeo` | Burdeo | `#802543` | `#711f3a` | `#fbe8ec` | 9.28 | 10.72 | 9.11 |
| `rosado` | Rosado | `#e25099` | `#a62069` | `#fae8ef` | 3.60 | 6.93 | 5.89 |
| `ciruela` | Ciruela | `#6e446e` | `#623c62` | `#f4eaf3` | 7.73 | 8.97 | 7.65 |
| `violeta` | Violeta | `#6f35a8` | `#632f96` | `#f1eaf7` | 7.63 | 8.83 | 7.51 |
| `lila` | Lila | `#8b7bd2` | `#5b4f9a` | `#eeebf8` | 3.58 | 6.93 | 5.90 |
| `marino` | Marino | `#304480` | `#293b71` | `#ebecf9` | 9.27 | 10.72 | 9.14 |
| `celeste` | Celeste | `#488fb3` | `#16607f` | `#e2eef7` | 3.59 | 6.97 | 5.91 |
| `petroleo` | Petróleo | `#114e5b` | `#0d4450` | `#e2eff3` | 9.27 | 10.72 | 9.12 |
| `esmeralda` | Esmeralda | `#0e7358` | `#0a664e` | `#e0f0ea` | 5.81 | 6.95 | 5.89 |
| `menta` | Menta | `#4a947a` | `#20654f` | `#e1f0ea` | 3.62 | 6.92 | 5.88 |
| `musgo` | Musgo | `#33532c` | `#2c4926` | `#e7efe5` | 8.70 | 10.06 | 8.56 |
| `oliva` | Oliva | `#645b0a` | `#5a5109` | `#f1eddf` | 6.90 | 8.03 | 6.85 |
| `mostaza` | Mostaza | `#a68d26` | `#6a5801` | `#f2ecdf` | 3.25 | 6.98 | 5.93 |

- **Criterios** (los mismos de la paleta original, verificados por un test): swatch ≥ 3:1 sobre blanco; tinta ≥ 4,5:1 sobre blanco y sobre su fondo.
- **Distancia mínima entre swatches (CIEDE2000):** 11,9 (Azul/Índigo, par original). Ningún par nuevo baja de ese mínimo; los más cercanos son Índigo/Lila 12,5 y Frambuesa/Rosado 12,9.
- **Daltonismo:** con 24 tonos hay pares que se confunden, como ya pasaba con los 10 originales (p. ej. Frambuesa/Verde azulado en deuteranopia). **Mitigación vigente:** el color nunca es la única señal; el nombre del área y el nombre del color siempre se muestran.

## Selector (Configuración › Áreas)

- Mismo componente y anatomía (radio + muestra + nombre). Sigue en 3 columnas desde `sm` y 2 en móvil: el diálogo mide 600 px y el diseño pide 4 columnas solo con un contenedor ≥ 560 px.
- **Orden de presentación por tono** (`AREA_COLOR_DISPLAY_ORDER`): Carmín, Burdeo, Rosado, Frambuesa, Ciruela, Violeta, Lila, Índigo, Marino, Azul, Celeste, Petróleo, Verde azulado, Esmeralda, Menta, Verde, Musgo, Oliva, Mostaza, Ámbar, Café, Naranjo, Coral y Pizarra al final (es el color de respaldo). El almacenamiento no cambia de orden.
- Solo se ofrecen los colores libres, como antes. Texto de ayuda nuevo: "Cada área activa tiene un color distinto. Disponibles: N de 24."
- Un área activa por color: ahora caben hasta 24 áreas activas.

## Compatibilidad

| Pieza | Qué hace con los colores nuevos |
|---|---|
| **Firestore Rules** (`validArea`) | La lista cerrada pasa a 24. **Con las Rules vivas (`cbe11685`), guardar un área con un color nuevo se rechaza (permission-denied).** Por eso las Rules van antes que el Hosting. |
| **`calendarPublicFeed` desplegada** (`calendarpublicfeed-00001-huh`) | Su copia de `AREA_COLORS` tiene 10: publica los 14 nuevos como **Pizarra** (gris). No falla. Para que la página pública muestre los colores nuevos hay que redesplegar **solo** `calendarPublicFeed`, por nombre. |
| **Hosting vivo** (`72e014e5861a25ac`) | El cliente normaliza al leer (`areas-client`): un color desconocido se muestra como Pizarra. No se rompe ninguna pantalla. |
| Calendario, Reportes y PDF | Usan `AREA_PALETTE` y los tokens `--area-*`: toman los 24 sin cambios propios. |
| Presupuesto de Rules | La lista vive en `validArea` (escrituras de áreas), fuera de las operaciones financieras medidas. Se mide igual en los gates. |

## Orden de despliegue propuesto (cada paso con su GO)

1. **Rules** (`firestore:rules`): solo amplía la lista de colores; el resto del archivo es idéntico a `cbe11685`. Rollback: `cbe11685-61ce-41d1-a8af-3b26a907f1bc`.
2. **`calendarPublicFeed`**, por nombre (`--only functions:calendarPublicFeed`). Opcional, pero sin él la página pública muestra los nuevos en gris. Nunca `--only functions` sin nombre. Rollback: revisión `calendarpublicfeed-00001-huh`.
3. **Hosting**. Rollback: `72e014e5861a25ac`.

Si se invierte el orden (Hosting antes que Rules), el selector ofrece colores que las Rules rechazan al guardar.

## Rollback con colores nuevos ya en uso

- **Hosting anterior:** las áreas con color nuevo se ven en Pizarra. Si alguien edita esa área con el Hosting anterior, el formulario la guardaría como Pizarra. Recomendación: no editar áreas mientras dure el rollback.
- **Rules anteriores:** las áreas con color nuevo siguen legibles, pero **no se pueden editar** hasta volver a un color original (la validación rechaza el color guardado). Las actividades no guardan color: no se afectan.
- **Ningún rollback borra datos.**

## Pruebas

- **Unit:** 24 colores; los 10 originales intactos (claves, orden y hex); contraste WCAG de los 24; orden de presentación; selector (22 de 24 libres, por tono; "Todos los colores están en uso" con 24 áreas activas); paridad con `functions/shared`; feed público (los 24 pasan y lo desconocido cae en Pizarra); tokens CSS de los 24.
- **Firestore Rules:** se acepta cada uno de los 24 al crear, se puede editar a un color nuevo y volver a uno original, y se rechazan variantes inválidas (`Petroleo`, `petróleo`, `rojo`, vacío, con espacio).
