# G9 — Probe de payouts SumUp (solo lectura)

Autorizado por Salvador: **G9** es la primera lectura real (SOLO LECTURA) del
endpoint de payouts de SumUp, para responder si `amount` es neto o bruto de
`fee`, y si un `id`/`transaction_code` de payout se puede vincular de forma
confiable a una transacción ya importada. No es Slice 3a: no escribe nada.

## Qué hace

`scripts/sumup-payouts-probe.mjs` corre localmente (no se despliega) y, para
un rango de fechas y una o ambas cuentas SumUp (Ofrendas / Cafetería):

1. Lee las credenciales (`apiKey`, `merchantCode`) de los secrets de Firebase
   `SUMUP_OFFERINGS_CONFIG` / `SUMUP_CAFETERIA_CONFIG`, o de variables de
   entorno del mismo nombre si ya las tenés exportadas.
2. Hace **GET** a `https://api.sumup.com/v1.0/merchants/{merchantCode}/payouts`
   (nunca POST/PUT/DELETE — es el único llamado HTTP que hace el script).
3. Lee (solo lectura) `sumupIntegrations/{offerings|cafeteria}/transactions`
   en Firestore para el mismo rango, usando Application Default Credentials.
4. Vincula cada fila de payout con su transacción importada por
   `transaction_code`, vota si la base es `net` o `gross` (regla de Atlas,
   ver `scripts/lib/payouts-probe-core.mjs`), y arma:
   - conteos por `type`/`status` y unicidad de `id` (no asumida);
   - % de filas vinculadas / no encontradas / de otra cuenta / sin código;
   - una tabla por **día de venta** (bruto, reembolsado, comisión, líquido,
     payout(s) vinculado(s));
   - una tabla por **payout** (reference/date, monto pagado, comisión, n
     transacciones, incluyendo filas de deducción);
   - totales del rango por cuenta (bruto, comisión, líquido, % comisión
     efectiva);
   - una lista final **"para validar contra el banco"** (fecha, reference,
     monto neto) para comparar con la cartola.

## Es solo lectura

- El único llamado HTTP es un `GET` a `/payouts`.
- Firestore se envuelve en un guardia (`readOnly(...)`) que **lanza un error**
  si cualquier código intenta llamar `set`, `update`, `delete`, `add`,
  `create`, `commit`, `runTransaction` o `batch`. El script nunca ejecuta
  ninguno de esos métodos.
- La `apiKey` nunca se imprime ni se escribe en ningún archivo: se enmascara
  siempre (`maskApiKey`) antes de loguearse.

## Prerequisitos

- `firebase login` (para leer los secrets con `firebase functions:secrets:access`,
  salvo que ya tengas `SUMUP_OFFERINGS_CONFIG`/`SUMUP_CAFETERIA_CONFIG` como
  variables de entorno).
- `gcloud auth application-default login` (para que firebase-admin pueda leer
  Firestore del proyecto `cds-administracion` con tus credenciales).
- Node 22, `firebase-admin` ya instalado en `functions/node_modules` (el
  script lo importa de ahí, no agrega dependencias nuevas).

## Comando

```bash
node scripts/sumup-payouts-probe.mjs \
  --start 2026-09-01 --end 2026-09-30 \
  --account both \
  --out docs/mission-2026/g9-probe-report.md
```

- `--account offerings|cafeteria|both` (default `both`).
- `--out <ruta.md>` es opcional; sin ella el reporte solo se imprime en la
  Terminal.
- El script siempre lee las transacciones importadas de **ambas** cuentas
  desde Firestore (aunque pidas solo una con `--account`), para poder
  detectar si un payout de una cuenta referencia por error una transacción de
  la otra (mezcla Ofrendas/Cafetería).

## Cómo interpretar el reporte

- **Base detectada = `net`**: `amount` ya viene neto de `fee` (SumUp restó la
  comisión antes de pagar). Aceptada solo si hubo ≥3 votos de filas `PAYOUT`
  vinculadas y ninguna en desacuerdo (`mismatch`) ni empate `net` vs `gross`.
- **Base detectada = `gross`**: `amount` es el bruto de la venta y `fee` se
  informa aparte.
- **Base detectada = `indeterminada`**: no hay evidencia suficiente todavía
  (menos de 3 votos contables, hay un `mismatch`, o `net` y `gross` empatan).
  No tomar ninguna decisión de modelo de datos hasta que esto se resuelva con
  más rango de fechas o más transacciones vinculadas.
- **Filas "no encontradas" / "de otra cuenta"**: no asumir que son un error
  del script — pueden ser transacciones anteriores al rango importado, o
  evidencia real de una mezcla de cuentas que hay que investigar antes de
  construir nada sobre `transaction_code` como llave.
- **"Pendientes" en la tabla por día**: transacciones de ese día sin ningún
  payout vinculado todavía (normal para los días más recientes del rango, si
  SumUp aún no pagó esa venta).
- **Lista final "para validar contra el banco"**: son los montos que este
  probe cree que deberían aparecer como depósitos. Compararlos manualmente
  contra la cartola es el objetivo de G9 — si no coinciden, es información
  (no un bug del script) y va a Atlas.

## Siguiente paso

Este probe **no autoriza** ningún cambio de modelo de datos ni de escritura.
Si el reporte confirma una base (`net` o `gross`) consistente y una tasa de
vinculación razonable, el siguiente paso es una propuesta de **Slice 3a**
(ingesta de payouts con escritura al libro: comisión real, reconciliación
`transacción → payout → depósito`), que requiere un OK aparte de Salvador
antes de implementarse — no se deriva automáticamente de correr este script.
