# 15 · Financial UX 2026 / Preview V2: validación

> **NO DEPLOY · NO PRODUCTION · PREVIEW ONLY.**
> Es una vista previa aislada con datos de demostración. No lee ni escribe Firestore y no forma parte del build que se despliega.

**Fecha:** 2026-10-02
**Rama:** `mission/ux-finanzas-2026-preview`
**Base:** `mission/slice6-usability` @ `e6b2084` (head del PR #1)
**Design Lock:** [14-financial-ux-v2-design-lock.md](14-financial-ux-v2-design-lock.md)

## 1. Estado inicial

| Chequeo | Resultado |
|---|---|
| Checkout | `~/Documents/Proyectos Desarrollo/Proyects/CDS/cds-suite`. La carpeta de trabajo de la sesión (`Proyects/Suite CDS`) estaba vacía. |
| Rama / HEAD | `mission/slice6-usability` @ `e6b2084`, árbol limpio |
| Upstream | `origin/mission/slice6-usability`, 0/0 |
| PR #1 | Abierto, no draft, MERGEABLE, base `feature/preproduccion-mobile-v1`, 39 commits |
| Gates base (antes de tocar nada) | lint ✓ · typecheck ✓ · `npm test` **174/174** ✓ |

**Discrepancias entre PROJECT_CONTEXT y GitHub:**

1. **El PR #2 (Project Control: GitHub → Trello) se mergeó el 2026-09-28** en la default `feature/base-cds-suite`. La rama pasó de `42408d6` a `084bd4d`. PROJECT_CONTEXT (2026-09-27) todavía muestra `42408d6`. Ahora la base tiene 6 commits que no están en slice6, y slice6 tiene 68 que no están en la base.
2. **Existe `origin/chore/project-control-plane-v1`**, la rama del PR #2, que no aparece en PROJECT_CONTEXT.
3. **Existe `mission/slice5-preview-2026`**, un intento anterior de preview con 1 commit. Está 27 commits detrás de slice6, vive bajo `app/(private)`, monta `AccessProvider` (que lee Firestore) y no se integró. Se usó solo como referencia.
4. **HEAD de slice6:** PROJECT_CONTEXT cita `70652bd` como "HEAD previo". El HEAD real es `e6b2084`, el commit que conecta CLAUDE.md con el contexto. Es coherente con lo que el documento describe.
5. **La carpeta `docs/design-references/` no existe** en ninguna rama ni en el disco. La única referencia encontrada es `~/Downloads/IMG_6457.PNG`, una captura del dashboard "PayFlow" (redes sociales). Se usó como referencia principal, pero **no se versionó** porque es una captura de terceros.

**Recordatorio heredado (no es acción de esta misión):** según `11-human-decisions.md`, el canal de preview `slice6` vence el **2026-10-02** (hoy). Su dominio autorizado en Firebase Authentication no se borra solo; hay que quitarlo a mano. Esta misión no tocó Firebase.

## 2. Rama

- Se creó `mission/ux-finanzas-2026-preview` desde `e6b2084`, después de verificar que no existía ni local ni remota.
- No se integra a `feature/preproduccion-mobile-v1`, `mission/slice6-usability` ni `mission/slice3a-sumup-fees`.
- Sin merge, sin rebase, sin force push. No se borraron ramas ni worktrees.

## 3. Commits

| Commit | Qué |
|---|---|
| `2a507fa` | docs: Design Lock V2 (doc 14) |
| `9c13750` | build: excluir el preview del build desplegable (pageExtensions condicional, guardia de deploy) |
| `c7cc4ea` | feat: datos de demostración y selectores puros + tests de invariantes, paridad y aislamiento |
| `8a4c435` | feat: las 11 pantallas en `/preview/finanzas-2026` |
| `cce5275` | fix: ciclo 1 de revisión (Designer + Atlas) |
| `e2f9fd3` | fix: ciclo 2 de revisión (Designer + Atlas) |
| `5b53d98` | fix: ciclo 3 (verificación final de Designer) |
| *(este doc)* | docs: validación y capturas |

## 4. Decisiones de Designer (resumen; el detalle está en doc 14)

- **"Financial OS" sereno:**
  - sidebar oscura verde-tinta de 240 px (rail de 72 px entre 768 y 1279; top bar + bottom bar por debajo de 768);
  - lienzo claro `#f4f5f1` y paneles blancos sin sombra;
  - verde institucional como único color de acción;
  - sin violeta, sin gradientes;
  - variaciones en tono neutro, nunca verde o rojo.
- **Hoy:**
  - exactamente 3 métricas: Ingresos registrados, Gastos registrados y Resultado del período;
  - cada una con su composición, "Cómo se calcula", un link al desglose y una variación contra una base comparable ("vs 1–4 sep" en el mes en curso), marcada "No homogénea" cuando corresponde;
  - después: evolución ingresos/gastos, Atención, ingresos por fuente, estado operativo y actividad.
- **Veracidad:**
  - nunca "Saldo" (solo dentro de la frase "No representa el saldo bancario");
  - todo SumUp es "bruto";
  - no hay "líquido" sin comisión;
  - Ofrendas (donaciones) y Cafetería (ventas) nunca se suman;
  - "SumUp histórico sin separar" va con trama y nunca se atribuye a un área;
  - Diezmos aparece solo como parte de los ingresos;
  - Campañas va "fuera del libro".
- **Lo que hoy no existe en CDS lleva la pill "Propuesta":** caja con conteos, payouts, depósitos, conciliación, historial antes → después y duplicados. Los montos de comisión de ejemplo llevan "Ejemplo".
- **Investigación:**
  - la captura PayFlow (estructura);
  - la demo pública de Mercury, vista en vivo (sidebar y tabla);
  - Parrotfy solo como criterio de simplicidad.
  - Refero no estaba disponible (`NO_SUBSCRIPTION`).

## 5. Pantallas implementadas

Todas están bajo `/preview/finanzas-2026`:

| Ruta | Contenido |
|---|---|
| `/` y `/hoy` | Dashboard: 3 métricas, evolución, Atención compacta, fuentes, estado operativo, actividad |
| `/atencion` | Cola por grupos (Integraciones → Completar registros → Duplicados → Vincular → Diferencias → Devoluciones → Depositar → Aprobar), con simulación y "Deshacer" |
| `/movimientos` | Tabla densa con SumUp agrupado por día, filtros, franja de totales que responde al filtro, detalle lateral (Anular con motivo; SumUp solo Reclasificar o Revisar), vista móvil en lista |
| `/caja` | Por área: conteo ciego doble con denominaciones, motivo obligatorio, efectivo por culto y cierres anteriores (Propuesta) |
| `/conciliacion` | Payouts (bruto − devoluciones − comisión de ejemplo = líquido), efectivo → depósito y depósitos sin origen (Propuesta) |
| `/ofrendas`, `/cafeteria` | Cifra protagonista con su composición, últimos 8 cultos, tabla de cultos; payouts en Cafetería |
| `/diezmos` | Buscador, fichas con estado y "Registrar", diezmos por mes |
| `/campanas` | Campañas fuera del libro, avance y aportes por aprobar |
| `/reportes` | Resumen ejecutivo, alertas, evolución, fuentes, Ofrendas vs Cafetería por culto, por tipo de dinero, gastos y resultado |
| `/configuracion` | Integraciones, días de culto y usuarios (ficticios) |

Estados forzables con `?estado=cargando|vacio|error`. El período va en `?periodo=2026-09` o `?periodo=2026`.

## 6. Tests ejecutados

| Gate | Antes | Después |
|---|---|---|
| `npm run lint` | ✓ | ✓ (0 warnings) |
| `npm run typecheck` | ✓ | ✓ |
| `npm test` | 174/174 | **223/223** (+49 nuevos; ningún test existente se modificó ni se rebajó) |
| `npm run build` (por defecto) | ✓ | ✓, sin ruta `/preview` |
| `node scripts/check-no-preview.mjs` | — | ✓ sobre el build por defecto; **falla (exit 1)** sobre el build con flag, como se espera |
| `npm run build:preview` | — | ✓, 12 rutas de preview |
| `npm run test:rules` | — | **No ejecutado.** Requiere el emulador de Firestore, y esta misión no tocó `firestore.rules` |

**Tests nuevos (`tests/finance-preview/`):**
- **`selectors.test.ts`:** invariantes financieros I1–I17 sobre los selectores puros.
  - Σ por método = Σ por fuente = total.
  - La misma cifra en Hoy, Movimientos y Reportes.
  - Lo anulado no suma.
  - No hay líquido sin comisión.
  - "Conciliado" solo con depósito exacto.
  - Una diferencia exige motivo.
  - SumUp no ofrece Editar ni Anular.
  - Campañas fuera del libro.
  - Comparaciones no homogéneas marcadas.
  - **Paridad con `lib/finance/insights`:** `incomeByMethod`, `dayStatus` y `noRecords`, con aserciones positivas.
- **`components.test.tsx`:** render de shell y pantallas.
  - 3 métricas exactas.
  - "Saldo" solo en la frase fija.
  - Simulaciones con "Deshacer".
  - Detalle de un pago SumUp.
  - Motivo de anulación.
  - Conteo ciego.
  - Esperado no editable.
  - Culto en curso nunca "Falta efectivo".
  - Sin nombres de diezmantes en Reportes.
  - Marcador de preview presente.
- **`isolation.test.ts`:**
  - recorrido **transitivo** de imports: nada alcanzable desde el preview importa Firebase ni `lib/finance|auth|offerings|campaigns|settings`;
  - sin fetch ni storage;
  - estructura de `app/preview` (todo archivo especial es `.preview.tsx`, salvo `layout.tsx`);
  - el walker detecta Firebase cuando existe.
- **`next-config.test.ts`:** `pageExtensions` por fase (build sin flag: sin `preview.tsx`; dev y build con flag: con `preview.tsx`).

## 7. Resultados de la revisión (3 ciclos)

| Ciclo | Designer (visual) | Atlas (código e invariantes) |
|---|---|---|
| 1 | **FAIL**: 1 bloqueante (banda oscura de 72 px sobre todo el móvil), 4 de veracidad (esperado como dato, eventos TO-BE como hechos, copy ambigua, campañas acumuladas como si fueran del período) y 20 más | **PASS WITH FIXES**: 4 Alta (comparaciones no homogéneas, MoneyAmount mudo para lectores, guardia de deploy salteable, sin test de estructura) |
| 2 | **PASS WITH FIXES**: 19/25 resueltos; nuevos: estado de "hoy" con 3 nombres y anotación cortada | **PASS WITH FIXES**: 0 Alta; "hoy" incoherente entre pantallas, vista Año, conteo ciego reabrible, tabs ARIA incompletas |
| 3 | **PASS WITH FIXES**: 2 Alta (tablas más anchas que su panel), cerrados después con métrica automática por contenedor | (sin ciclo 3, por alcance) |

**Métricas automáticas finales:** 37 capturas en 1440, 1280, 1024, 768, 390 y 375. Ver [screens-financial-ux-v2/_metricas.txt](screens-financial-ux-v2/_metricas.txt).
- **Overflow de página = 0** en todas.
- **Overflow dentro de contenedores = 0** en todas (chequeo agregado en el ciclo 3).
- **0 errores de consola.**
- **0 jerga técnica.**
- "Saldo" solo dentro de la frase fija.
- **Targets móviles ≥44 px.** Única excepción: los inputs radio de 20 px del sheet de filtros, que están dentro de labels de 44 px.

## 8. Capturas generadas

En [screens-financial-ux-v2/](screens-financial-ux-v2/): 22 capturas JPEG; las móviles están reducidas a 1x.

| Pedido por la misión | Archivo |
|---|---|
| Dashboard desktop | `a-hoy-desktop-1440.jpg`, `a2-hoy-desktop-1440-full.jpg`, `hoy-1280x800.jpg`, `hoy-1024x768-rail.jpg` |
| Dashboard móvil | `b-hoy-mobile-390.jpg`, `b2-hoy-mobile-390-full.jpg` |
| Movimientos desktop | `c-movimientos-desktop-1440.jpg` (grupo expandido), `c2-movimientos-detalle-1440.jpg` (detalle), `movimientos-anio-1280.jpg` |
| Movimientos móvil | `movimientos-mobile-390.jpg`, `d-movimientos-mobile-390-filtros.jpg` |
| Caja móvil | `e-caja-mobile-375-conteo2.jpg` (conteo 2 con diferencia y motivo exigido) |
| Conciliación desktop | `f-conciliacion-desktop-1440.jpg` (fila expandida), `conciliacion-mobile-390.jpg` |
| Ofrendas | `g-ofrendas-desktop-1440.jpg`, `ofrendas-mobile-390.jpg` |
| Diezmos | `h-diezmos-desktop-1440.jpg` |
| Reportes | `i-reportes-desktop-1440.jpg`, `reportes-mobile-390.jpg` |
| Extra | `caja-desktop-1440.jpg`, `atencion-desktop-1440.jpg`, `campanas-desktop-1440.jpg` |

## 9. Problemas encontrados

| # | Problema | Quién |
|---|---|---|
| P1 | El gate `notFound()` en runtime no garantiza que los chunks del preview no se publiquen en export estático | Atlas |
| P2 | `lib/finance/*` arrastra `firebase/firestore` de forma transitiva (por `formatters.ts`), así que el preview no puede reutilizarlo | Atlas |
| P3 | Con `layout.preview.tsx`, el build fallaba con TS2344 cuando existían tipos del dev server (los route types globales de dev y build no coincidían) | Builder (build real) |
| P4 | El reset `.fx button` anulaba los botones primarios por especificidad | Builder (captura) |
| P5 | Banda oscura de 72 px en todo el móvil, porque el fondo del shell se aplicaba bajo 768 px; las métricas automáticas no lo detectaron | Designer |
| P6 | Verdades financieras: esperado de Cafetería mostrado como dato, eventos de caja como hechos, campaña acumulada como si fuera del período, comparaciones de gastos no homogéneas sin aviso | Designer + Atlas |
| P7 | Test de paridad parcialmente vacuo (día `"04"` vs `"4"`) | Atlas |
| P8 | La guardia npm se podía saltar con un `firebase deploy` directo | Atlas |
| P9 | El culto en curso tenía 3 nombres según la pantalla | Designer + Atlas |
| P10 | Conteo ciego reabrible después de revelar el conteo 1 | Atlas |
| P11 | Tablas más anchas que su panel (Caja; Movimientos en vista Año; Ofrendas móvil); invisibles para la métrica de overflow de página | Designer + métrica nueva |

## 10. Problemas corregidos

Todos los de §9:
- **P1:** `pageExtensions` condicional + `notFound()` + marcador + guardia.
- **P2:** selectores propios con test de paridad.
- **P3:** layout con extensión normal y sin páginas propias.
- **P4:** resets con `:where()`.
- **P5:** shell sin fondo en móvil.
- **P6:** Ejemplo y Propuesta, rótulo "acumulado" y notas por métrica.
- **P7:** normalización y aserciones positivas.
- **P8:** `hosting.predeploy` en `firebase.json`.
- **P9:** `areaCashStatus` + `CashStatusCell` y el estado "Por registrar".
- **P10:** el conteo 2 queda fijo y se pide un tercer conteo.
- **P11:** layout fijo y chequeo automático por contenedor.

Además, los hallazgos Media y Baja de ambos revisores, salvo los de §11.

## 11. Pendientes

- **Baja / decisión humana:**
  - categoría "Donaciones" frente a "Ofrendas": hoy se aclara con la ayuda "Aportes fuera del culto; no son ofrendas", sin renombrar (Navigator o Salvador);
  - regla del conteo ciego y del tercer conteo (Propuesta, por validar con quien cuenta en el culto).
- **Baja:**
  - el badge de Atención en la sidebar no baja al resolver ítems (es una simulación local);
  - el toast de simulación no se agrupa si se disparan varias acciones seguidas.
- **No verificable con capturas:** el foco visible en todos los controles, los tooltips del rail y `prefers-reduced-motion` en un navegador real. Están implementados (CSS `:focus-visible` y `@media (prefers-reduced-motion)`), pero no se revisaron con teclado ni con lector de pantalla.
- **Alcance:**
  - la preview reimplementa reglas de `lib/finance` (cubiertas por paridad);
  - si se adopta la dirección, la implementación real debe reutilizar la lógica de producción;
  - `lib/finance/formatters.ts` debería separar el adaptador de `Timestamp` para que la lógica pura sea reutilizable.
- **Sin ejecutar:** `npm run test:rules` (reglas no modificadas).

## 12. Archivos modificados

**Archivos existentes modificados (3):**
- `next.config.ts`: export como función `(phase) => config` con `pageExtensions` condicional. El resto de la config no cambia.
- `package.json`: scripts `build:preview`, `check:no-preview` y `predeploy:hosting`.
- `firebase.json`: `hosting.predeploy: ["node scripts/check-no-preview.mjs"]`.

**Nuevos:**
- `app/preview/finanzas-2026/**`;
- `components/finance-preview/**`;
- `lib/finance-preview/**`;
- `scripts/check-no-preview.mjs`;
- `tests/finance-preview/**`;
- `docs/mission-2026/14-…`, `15-…` y `screens-financial-ux-v2/`.

**No se tocó:**
- `firestore.rules`, `storage.rules`, `functions/`;
- `lib/finance/**`, `lib/auth/**`;
- `app/(private)/**`, `app/globals.css`;
- ninguna pantalla productiva.

## 13. Riesgos

1. **Build con flag desplegado por error.** `npm run build:preview` escribe en `out/`. Mitigación: `predeploy` en el script npm y en `firebase.json`, que falla si `out/` contiene la ruta o el marcador. Antes de cualquier deploy: `rm -rf out && npm run build`.
2. **`firebase.json` tiene un `predeploy` nuevo.** Cualquier deploy de hosting (manual o CI) correrá `node scripts/check-no-preview.mjs` y fallará si falta `out/`. Es intencional, pero es un cambio de comportamiento del deploy que Salvador debe conocer.
3. **Divergencia de reglas.** Los selectores del preview son una reimplementación. La paridad está testeada en método de pago, falta de efectivo y días sin registros; otras reglas (reportes completos) no.
4. **Datos de ejemplo leídos como reales.** Mitigación:
   - banner permanente;
   - pill "Demo";
   - Propuesta y Ejemplo;
   - fixtures sintéticos (no son los montos reales del truth check);
   - nombres ficticios.
5. **El preview carga el SDK de Firebase Auth del root layout.** No hace lecturas ni escrituras de Firestore (verificado por Atlas). Si hay una sesión guardada puede haber refresh de token, que es tráfico de Auth y no de datos.

## 14. Cómo ejecutar la preview

```bash
cd ~/Documents/Proyectos\ Desarrollo/Proyects/CDS/cds-suite
git switch mission/ux-finanzas-2026-preview
npm run dev
```

Abrir <http://localhost:3000/preview/finanzas-2026>. En `next dev` el preview está habilitado. No hace falta iniciar sesión ni emuladores.

- **Móvil:** usar las herramientas de dispositivo del navegador (390×844).
- **Estados:** `?estado=cargando`, `?estado=vacio`, `?estado=error`.
- **Períodos:** `?periodo=2026-09` (mes cerrado) o `?periodo=2026` (año).
- **Build estático del preview (solo local, nunca desplegar):** `npm run build:preview`. Luego `rm -rf out && npm run build` para volver a un `out/` limpio.

## 15. Qué NO se desplegó

**Nada.**
- Sin `firebase deploy`, sin canal de preview y sin cambios en Hosting, Firestore, Functions, Storage ni Authentication.
- Sin merge y sin cambio de default branch.
- Sin escrituras a datos reales.
- La rama se publica en GitHub solo para revisión, con un Draft PR marcado **NO DEPLOY / NO PRODUCTION / PREVIEW ONLY**.

## Brain

Se registraron en `salva-ai-brain` (commits locales `307ea42` y `6e58a68`, **sin push**) solo aprendizajes con evidencia de esta misión:
- **ATLAS-L-009:** exclusión en compilación de rutas preview en export estático, con el layout en ambos builds.
- **BUILDER-L-007:** resets CSS acotados con `:where()`.
- **BUILDER-L-008:** tests de paridad con normalización y aserción positiva.
- **BUILDER-L-009:** estados que dependen de "hoy" desde un único helper.
- **DESIGNER-L-004:** las métricas de overflow no detectan capas del shell.
- Evidencia nueva para **DESIGNER-L-001** (Refero sin suscripción) y **BUILDER-L-006** (default branch desactualizada tras el PR #2).
