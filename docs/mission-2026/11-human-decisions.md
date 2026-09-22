# Decisiones humanas pendientes (gates)

Lista ordenada por lo que desbloquea. Cada respuesta se registra en este documento, con fecha.

## A. Autorizaciones (acciones)

| # | Qué | Desbloquea |
|---|---|---|
| A1 | **Deploy de Slice 1 + 1b** a producción, siguiendo el checklist de 10 §4 | Sync confiable, etiquetas correctas y fin del 502 estructural |
| A2 | **G9**: una llamada real de solo lectura a `/v1.0/merchants/{mc}/payouts` y al detalle de 1 transacción, usando la credencial actual de cada cuenta | Comisión real, payouts y Slice 3 |
| A3 | Crear una **alerta de Cloud Monitoring** para fallos del sync programado. Puede tener costo mínimo o nulo | Evitar otro corte de 21 h sin aviso |
| A4 | Iniciar sesión en **SumUp** (las 2 cuentas) en el navegador integrado o exportar CSV de septiembre | Completar el Financial Truth Check contra el proveedor |

## B. Reglas financieras

| # | Pregunta | Recomendación |
|---|---|---|
| G1 | ¿La tarjeta se registra en bruto, con la comisión como egreso vinculado, o en líquido? ¿Por qué se había migrado a "líquido"? | **Bruto + comisión como egreso vinculado** (01 §5) |
| G2 | ¿En qué mes se reconoce un reembolso o contracargo de una venta de un mes anterior? | En el mes del evento (reversa fechada), si el mes original está cerrado |
| G3 | ¿Bloqueamos en las reglas de Firestore que un usuario edite movimientos de SumUp? (La UI ya los muestra como solo lectura) | **Sí** |
| G4 | ¿Existen pagos online o ECOM por SumUp? ¿A qué área van? | Por confirmar |
| G5 | ¿Qué hacemos con contracargos y pagos CANCELLED/FAILED en el libro? | Excepción en revisión y luego reversa aprobada |
| G6 | ¿Normalizamos la fecha de los movimientos SumUp (implica migración)? | Sí, en el Slice 2, con reporte antes y después |
| G7 | ¿Las propinas de Cafetería cuentan como ingreso de Cafetería? | Por confirmar |
| G8 | ¿Importamos el historial de Cafetería anterior al 09/09? | No. Se mantiene como "histórico sin separar" |

## C. Operación (Navigator, preguntas 2 a 10)

2. ¿Quién cuenta la ofrenda? ¿Cuántas personas? ¿Se cuenta por culto o por día?
3. ¿El efectivo se deposita? ¿En qué cuenta, cada cuánto y quién lo hace?
4. ¿A qué cuenta bancaria paga cada SumUp y con qué frecuencia?
5. Getnet: ¿se usa? ¿Para qué? ¿Hay contrato, portal o API? Si existe, compartir un export de ejemplo.
6. ¿Las campañas entran al libro general?
7. ¿Qué tolerancia aceptamos en diferencias de caja y de payouts?
8. ¿Desde qué monto se exige evidencia o un segundo aprobador? ¿Existe el "mes cerrado"?
9. ¿El pastor debe poder escribir en finanzas? ¿Creamos el rol "cajero"?
10. ¿Cafetería paga insumos con efectivo de la caja? ¿Tiene fondo inicial?

## D. Diseño

- Revisar el **Design Lock** borrador (08 §4) antes de construir el preview (Slice 5).
