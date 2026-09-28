# Phase 0: Baseline verificado

Fecha: 2026-09-22 · Coordinador de la misión · Evidencia: repo local, Cloud Run/Logging (consola, solo lectura) y la app en producción (sesión admin, solo lectura).

## Repositorio

| Ítem | Estado real |
|---|---|
| Repo | `Speralt1/cds-suite` |
| Branch local activa | `feature/preproduccion-mobile-v1` @ `648afd1` "fix: complete SumUp liquid calculation" (2026-09-11). Working tree limpio. |
| Otras branches | `feature/base-cds-suite` (default en origin; es la que sincroniza el Project), `feature/finanzas-v1` (1 commit divergente: `46476ac`) |
| `main` | **No existe** en local ni en origin. La base de trabajo real es `feature/preproduccion-mobile-v1`. |
| Versión | `package.json` 0.2.0 ("CDS Suite V0.2" en la UI) |
| Stack | Next 16 (export estático a `out/`) + React 19 + Tailwind 4 + Firebase 12. Functions en Node 22, CommonJS (`firebase-functions` ^7). |
| Tests | 8 archivos y 60 tests, todos verdes. Lint y typecheck OK. **No hay tests de `functions/`.** Los tests de reglas requieren el emulador. |
| `npm ci` | **Fallaba**: el package-lock estaba desincronizado (faltaban `@emnapi/*`). Se corrigió en el Slice 1 (`5486d31`). |
| Docs | README, `docs/{configuration-v1, data-safety, environments, firebase-setup, local-auth-testing, validation}.md` |

## Deploy (producción `cds-administracion`)

| Pieza | Evidencia | Estado |
|---|---|---|
| Hosting | `.firebase/hosting.*.cache` con fecha 2026-09-11 13:00 | Desplegado ≈ HEAD `648afd1` |
| `sumupsyncnow` (Cloud Run, southamerica-west1) | Consola Cloud Run: "actualizado hace 11 días" | Desplegado ≈ HEAD |
| `sumupsyncscheduled` (southamerica-east1) | ídem | Desplegado ≈ HEAD. Corre cada hora; la última sync visible en la app fue el 22-09 a las 16:21 |
| `campaignshare` | "hace 13 días" | Desplegado |
| Secrets | `SUMUP_OFFERINGS_CONFIG`, `SUMUP_CAFETERIA_CONFIG` (JSON apiKey + merchantCode) | Referenciados. Los valores no se inspeccionaron (por diseño). |

## Qué existe, qué está parcial, roto o solo planeado

| Estado | Ítems |
|---|---|
| **EXISTE y funciona** | Auth + roles (admin, pastor, finance, leader); Resumen; Movimientos (crear, editar, anular con motivo); Diezmos (fichas, comprobantes, pastoral); Campañas (públicas, aportes, revisión); Reportes PDF (se construyen desde Σ movimientos y **validan contra los resúmenes**); Configuración (categorías, usuarios); PWA; página pública /ofrendar; import SumUp de 2 cuentas; separación Ofrendas/Cafetería desde el 09-09-2026. |
| **PARCIAL** | "Caja del día": es un monto de efectivo editable por área y día; no tiene apertura, esperado, conteo ni cierre. Sync SumUp: 1 página, sin cursor, sin runs, sin aislamiento entre cuentas. Comisiones: el campo existe pero la API usada nunca lo entrega. |
| **ROTO o engañoso** | Etiqueta "Tarjeta SumUp · líquido": muestra el **bruto** (confirmado con datos). Pill "Conciliado" sin lógica detrás. "Total del día" mezcla bases distintas. Los movimientos SumUp se pueden editar desde la UI y el sync los revierte. Una caja de efectivo anulada no se puede volver a registrar (F1). |
| **SOLO PLANEADO / NO EXISTE** | Payouts, depósitos, conciliación, diferencias, auditoría (antes→después), **Getnet (0 referencias en el código)**, cierre diario real, Attention Queue. |

## Historial operativo de SumUp (logs de Cloud Run y Logging)

- **09-09:** el sync manual tardó **485 s** y **395 s** (el backfill completo corría dentro del request HTTP). Detrás del proxy de Hosting (tope de 60 s), eso produce **502/504**. Esta es la causa raíz del 502 histórico. Desde el 09-10 el manual tarda **4–7 s** y responde 200 (8 requests en 30 días).
- **Del 09-10 12:22 al 09-11 09:22:** `sumupsyncscheduled` falló **cada hora (22 veces)** con `ReferenceError: net is not defined`, un bug de código que se corrigió en `648afd1`. **Nadie recibió alerta.**
- **09-16 01:04:** la API de SumUp respondió 500, y ese error abortó **toda** la ejecución, incluidas ambas cuentas (riesgo R7 confirmado en producción). Se recuperó sola en la hora siguiente.
- Sin errores de `sumupsyncnow` con status ≥ 400 en 30 días.

## Límites de esta verificación

- La verdad del proveedor (dashboard de SumUp) requiere iniciar sesión en SumUp. Está pendiente (ver el truth check).
- Las reglas de Firestore no se pudieron ejecutar en el sandbox (el emulador no se puede descargar). Hay que correrlas en la Mac: `npm run test:rules`.
