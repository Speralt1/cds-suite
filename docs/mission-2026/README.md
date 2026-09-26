# Misión: Administración CDS · Financial Core, Reconciliation & Operations 2026

Inicio: 2026-09-22. Coordinador con el AI Development Team (Navigator, Atlas, Designer y Builder; Conductor no se usó porque no hizo falta IA).

| Doc | Contenido |
|---|---|
| [00-baseline.md](00-baseline.md) | Qué existe, qué está desplegado, qué está roto, historial operativo SumUp (logs) |
| [01-navigator-financial-model.md](01-navigator-financial-model.md) | Modelo de dominio AS-IS/TO-BE, permisos, Caja, Correcciones, estados de conciliación, Attention Queue |
| [02-atlas-sumup-audit.md](02-atlas-sumup-audit.md) | Auditoría SumUp, causa raíz del 502, truth table, spec del Slice 1 |
| [03-reconciliation-getnet-corrections.md](03-reconciliation-getnet-corrections.md) | Modelo de payouts, decisión Getnet, modelo de correcciones |
| [07-financial-truth-check.md](07-financial-truth-check.md) | Reconciliation report con datos reales |
| [08-designer-ux-audit-design-lock.md](08-designer-ux-audit-design-lock.md) | UX audit, Reference Matrix, Experiencia 2026, Design Lock (borrador) |
| [10-implementation-plan.md](10-implementation-plan.md) | Arquitectura, slices, test matrix, checklist de deploy, checkpoints |
| [11-human-decisions.md](11-human-decisions.md) | Gates y preguntas para decidir |

## Hallazgos clave

1. **El "líquido" SumUp es en realidad el bruto.** La comisión nunca llega del endpoint que se usa. Está confirmado con datos: los 34 pagos de Ofrendas de septiembre son montos redondos y suman exactamente lo que la app llama "líquido".
2. **Causa raíz del 502:** el backfill se ejecutaba dentro del request HTTP (tardó 485 s y 395 s el 09/09), mientras que el proxy de Hosting corta a los 60 s. Hoy el sync manual tarda entre 4 y 7 s.
3. **El sync programado falló durante 21 h sin que nadie se enterara** (10–11/09), y un error 500 de SumUp abortó ambas cuentas (16/09).
4. **El libro es internamente consistente:** Σ movimientos coincide con los resúmenes en septiembre y en todo 2026.
5. **Hay 4 etiquetas que no dicen la verdad:** "líquido", "Conciliado", "Cierre diario" y "Total del día".
6. No existen esperado, depositado, pendiente ni diferencias. Getnet no tiene ninguna referencia en el código.

## Branches

- `mission/financial-core-2026`: esta documentación.
- `mission/slice1-sumup-reliability`: Slice 1, construido sobre los docs.
- `mission/slice1b-truthful-labels`: Slice 1b, construido sobre el Slice 1.

Ninguna rama se desplegó.
