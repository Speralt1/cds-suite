# 43 · «Ve por los tuyos»: H4 — pantallas reales, importador y página de mesa

Fecha: 03/11/2026. Rama `feature/vplt-h4`, apilada sobre `feature/vplt-backend-h3` (PR #36). **Implementado y probado en emuladores (`demo-cds-suite`); NO desplegado.** Producción sigue mostrando «en preparación» (`OUTREACH_FEATURES.enabled = false`).

## 1. Qué hay

| Pieza | Detalle |
|---|---|
| Coordinación | Panorama con etapas, Importar (versión del consentimiento del sitio → informe previo → aplicar), Revisión (descartar, mantener ambas, marcar duplicada), Mesas (35 encargados, enlace visible una sola vez, revocar), Ausencias (confirmación explícita), Distribución (propuesta por mesa → confirmar; si supera el tope, motivo por persona) |
| Mi lista | Personas del encargado con la consulta exigida por las Rules, ficha de contacto y baja |
| Decisiones | El encargado ve las de su mesa; el permiso pastoral, todas |
| Página de mesa `/mesa` | Pública, sin login; código en el fragmento (`#edición.mesa.token`), se borra de la dirección al leerlo y viaja solo en el cuerpo; búsqueda por nombre; «Está en mi mesa (sin decisión)» para cada persona sentada; «Aceptó a Cristo» / «Quiere conversar» solo tras el «Dijo que sí»; lista «En esta mesa» que se recupera al recargar; reintento sin duplicar; horas exactas fuera de ventana |
| Backend nuevo | `reviewList`, `reviewResolve`, `teamCandidates`, `tablesList`, tope por responsable con contador en la transacción (también entre lotes concurrentes), operaciones de mesa `seat` y `listMine` |
| Importador CSV | Lee la exportación del panel del sitio (asistentes/solicitudes): BOM, `,`/`;`/tab, comillas, prefijo anti-fórmula; errores por número de fila sin datos personales |
| Demostración local | `npm run seed:outreach` (incluido en `dev:platform`): coordinación + 35 encargados + 300 personas ficticias + 35 enlaces impresos en consola |

## 2. Probar en local

```bash
OUTREACH_DEV_NOW=2026-11-28T21:00 NEXT_PUBLIC_CDS_OUTREACH_LIVE=1 npm run dev:platform
```

`OUTREACH_DEV_NOW` fija el reloj **solo dentro del emulador de Functions** (se ignora si no es el emulador) para abrir la ventana de los enlaces. Cuentas ficticias en `scripts/seed-outreach-emulator.mjs`. Al alternar `NEXT_PUBLIC_CDS_OUTREACH_LIVE`, borrar `.next` y `out`.

Verificado a mano en el navegador (capturas en [`screens-r43/`](screens-r43/)): enlace de la mesa 12 en teléfono, marca guardada en el servidor y visible tras recargar; Panorama de coordinación con 300/240/60; propuesta de distribución con datos del emulador.

## 3. Pruebas

| Suite | H3 | H4 |
|---|---|---|
| Unitarias/UI | 1.914 | **2.002** |
| Rules | 325 | **325** |
| Emuladores | 39 | **41** |

Lint, tipos, `build:shared --check`, build y `check:no-preview` en verde; una build con `NEXT_PUBLIC_CDS_OUTREACH_LIVE=1` también compila. La build productiva no contiene código en vivo ni de simulación; el valor de decisión solo aparece en el bloque de `/mesa` (excepción acotada en `check:no-preview`, porque el administrador aprobó marcar en mesa el 03/11).

## 4. Decisiones y pendientes

1. **Consentimiento al importar:** la exportación del sitio no trae columna de autorización. Coordinación declara la versión del texto del sitio y si autoriza el seguimiento; se registra por persona con origen «formulario_web». Sin esa casilla, las personas no se distribuyen. Requiere que el **texto nuevo esté publicado en el sitio** (doc 40 §6b).
2. **Revisión de la exportación:** sin `updatedAt`, la revisión de cada fila sale de su estado (aprobada < usada < anulada); si el sitio agrega esa columna, se usa.
3. **Código de entrada:** no se importa (en el sitio también sirve para entrar); en la mesa se busca por nombre.
4. **Quien está en la mesa:** el encargado toca «Está en mi mesa» para cada persona sentada; así la distribución la asigna a él aunque no exprese una decisión.
5. **Activar en producción:** `OUTREACH_FEATURES.enabled = true` empaqueta las pantallas en vivo; requiere GO por subfase (doc 41 §6) y desplegar las 4 Functions `outreach*` por nombre, Rules e índices.

## 5. Antes del 28/11 (lo que falta fuera del código)

- **Texto de términos aprobado por el administrador (03/11):** casilla «Acepto los términos y condiciones» + página `/terminos-ve-por-los-tuyos`, versión `v2-2026-11`, en el PR borrador #7 del repositorio del sitio (sin fusionar; fusionar publica). Correo de privacidad confirmado (invitacionescds@gmail.com). Falta: lectura legal, fusionar y activar v2 en el panel en la misma ventana. Al importar en CDS, declarar la versión `v2-2026-11` (y `v1-2026-10` para las solicitudes anteriores, que quedan cubiertas por la confirmación en la mesa).
- Cuentas de los 35 encargados verificadas (para Mi lista desde el 29/11).
- GO de publicación por subfases y ensayo con la cuenta piloto (H4/H5 del doc 41).
- Hoja de papel por mesa como respaldo.
