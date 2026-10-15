# 33 · Propuesta: "Efectivo confirmado en cero" (R2.5, NO implementado)

**Estado:** propuesta para aprobación. Este PR **no** agrega escrituras, colecciones, Rules ni índices.

## Problema

El calendario de caja marcaba "Falta efectivo" cuando un área (Ofrendas o Cafetería) tenía ventas SumUp y ningún efectivo registrado. Pero las ventas con tarjeta **no prueban** que hubo efectivo.

R2.5 ya cambia el lenguaje y el tono: el estado pasa a "Efectivo pendiente de confirmar", neutro y no de error. Hoy hay tres situaciones posibles por área y día:

| Estado | Cómo se sabe hoy |
|---|---|
| Efectivo registrado | Existe un movimiento `cash` del área ese día (> 0). |
| Efectivo pendiente de confirmar | Hay ventas SumUp del área y no hay efectivo. |
| **Efectivo confirmado en cero** | **No se puede guardar hoy.** |

El tercer estado no se puede persistir: el módulo de efectivo exige monto > 0 (`lib/offerings/cash.ts` y `money(v)` en las Rules). Un movimiento de $0 tampoco sería correcto, porque ensuciaría el libro y los resúmenes.

## Propuesta

### Datos

Nueva colección **fuera del libro**: `cashDayConfirmations/{area}_{YYYY-MM-DD}`.

```
{ area: "offerings" | "cafeteria",
  date: "YYYY-MM-DD",
  status: "confirmed_zero" | "withdrawn",
  note: string (0–300),
  revision: int,
  createdBy, createdAt, updatedBy, updatedAt }
```

- No toca `financeTransactions` ni `financeMonthlySummaries`, así que el resultado contable no cambia.
- Es reversible:
  - `withdrawn` con nueva revisión (no se borra);
  - si después se registra efectivo, ese registro manda: el estado pasa a "Efectivo registrado".

### Rules (borrador)

- **Lectura:** `financeDetailsRead()`.
- **Creación y actualización:** `financeRecordsManage()`, con:
  - auditoría (`auditCreate` / `auditUpdate`);
  - `revision` +1;
  - `date` ≤ hoy local;
  - `status` en el dominio;
  - `hasOnly` de claves.
- **Borrado:** `if false`.
- **Presupuesto:** evaluarlo con el arnés (`tests/rules-budget`). Es una colección aparte, no forma parte de los lotes financieros, así que no debería afectar el margen 118/125. Igual hay que medirlo.

### Interfaz (spec de diseño R2.5, sin construir)

- En la fila "Efectivo pendiente de confirmar" del panel del día aparece un botón secundario "Confirmar sin efectivo", solo con `finance.records.manage`.
- El botón abre un diálogo de confirmación:
  - **Título:** "¿Confirmar que no hubo efectivo en Ofrendas?"
  - **Texto:** "El sábado 3 de octubre quedará como día sin efectivo para esta área. Podrás registrar efectivo después si aparece."
- **Estado resultante:** "Sin efectivo · confirmado", con la línea "Confirmado por {nombre}, {fecha}." La celda queda sin chip, como un día resuelto.

### Monitores

- A5 y A6 deberían leer la colección para no reportar como pendiente un día confirmado.
- A6: detector informativo de confirmaciones que luego tuvieron efectivo.

## Para implementarlo hace falta

- **GO de diseño de datos:** esta propuesta.
- PR con Rules, tests de Rules (incluido budget), cliente, UI y tests.
- Deploy por fases con su propio GO: Rules → Hosting.

## Reglas de redacción (R2.5, vigentes)

**Mismo estado, forma corta y forma larga según el espacio. Nunca "Falta efectivo" ni "Advertencia".**

| Dónde | Texto |
|---|---|
| Celda del calendario (completa / media / compacta) | "Pendiente · Ofrendas" / "Pendiente" / solo ícono |
| Lista de revisión, panel, PDF y alertas de Reportes | "Efectivo pendiente · Ofrendas" (2 áreas: "Efectivo pendiente · 2 áreas") |
| Fila del panel del día | "Efectivo pendiente de confirmar" |
| Tarjeta de Ofrendas y Cafetería | "Efectivo pendiente" |

- **"Depósitos"** = método `transfer` únicamente, también para los diezmos por transferencia.
- **"Otros medios"** = tarjeta no SumUp u "Otro". Solo aparece cuando hay montos de ese tipo.
