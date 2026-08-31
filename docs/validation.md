# Validación — Finanzas V1

Rama `feature/finanzas-v1`, creada desde `origin/feature/base-cds-suite`. Sin merge a main y sin despliegues ni escrituras en Firebase real.

## Resultado final

| Verificación | Resultado |
|---|---|
| `npm install` | Correcto |
| `npm run lint` | Correcto, sin advertencias |
| `npm run typecheck` | Correcto |
| `npm run test` | 40 pruebas aprobadas |
| `npm run test:rules` | 13 pruebas aprobadas en emulador |
| `npm run build` | Correcto, nueve rutas generadas |
| `npm audit --omit=dev` | Sin vulnerabilidades conocidas |

## Cobertura

- Pruebas de aplicación: sesión persistente, errores, cierre de sesión, autorización inicial, cuenta sin documento/inactiva, revocación, navegación por rol, cálculos CLP, fechas, resúmenes, edición, anulación y datos seguros de reportes.
- Reglas verificadas contra Firestore Emulator con `@firebase/rules-unit-testing`, no mediante mocks: entrada/salida, cambio de mes, auditoría, diezmo y atribución, eliminación denegada, roles, notas privadas, consentimiento revocado en el mismo lote, agregados manipulados, importes inválidos mediante cliente directo, doble envío, edición obsoleta y concurrencia.
- El contador de expresiones del emulador admite las reglas y sus transacciones completas, incluidos diezmos y ediciones entre períodos. Los reintentos por contención mantienen todas las validaciones.
- PDF mensual, anual y vacío generados con fixtures: texto extraíble, A4, encabezados, numeración total, tablas paginadas sin dividir filas, monograma de respaldo y gráficos vectoriales. Revisión visual con Poppler; comprobación de privacidad con extracción de texto. Informe anual de prueba: 16 páginas con 180 movimientos, incluidos 10 anulados.
- Revisión de navegador local con cuentas ficticias: ingreso, edición, anulación, búsqueda, registro de diezmo, ficha privada, edición de contacto, reportes mensual/anual y autorización por rol.
- Revisión responsive de Resumen, Movimientos, Diezmos, Perfil y Reportes a 320/375/390/430/1440 px. Se compara `documentElement.scrollWidth` con `clientWidth`; sin desplazamiento horizontal de página. Formularios con controles grandes, teclado numérico, foco inicial y diálogo nativo para Escape/ciclo de foco.

## Comandos

```bash
npm install
npm run lint
npm run typecheck
npm run test
npm run test:rules
npm run build
npm audit --omit=dev
```

La compilación usa Webpack como la base existente. Pruebas de reglas requieren Java 21+. Nunca ejecutar reglas automatizadas contra producción: el script fija `demo-cds-suite` y localhost.

## Límites y operación

- La seguridad depende de **desplegar** `firestore.rules` antes de utilizar Firestore real. No basta con los guards de React.
- La consola Firebase y cuentas administrativas del proyecto omiten estas reglas; no editar movimientos o resúmenes manualmente allí. Mantener acceso a consola limitado y copias de respaldo según la operación de la iglesia.
- La aplicación no ofrece contabilidad formal, conciliación bancaria ni comprobantes/Storage.
- Una consulta de libro/reporte admite hasta 10.000 movimientos del período; si se excede se informa, y el reporte no se genera parcial. Historial y listas se presentan por bloques. Las fichas usan cursor de Firestore, no descarga completa.
- Las fechas del libro son días contables normalizados al mediodía UTC. `createdAt`, `updatedAt` y anulaciones son timestamps del servidor.
- Los reportes no incorporan notas, atributos privados o nombres de diezmantes. El nombre de quien genera el informe sí aparece, como parte de la auditoría solicitada.
- Sin conexión no se confirma ninguna transacción. La autorización se verifica con el servidor antes de mostrar datos.
- Dependencias de producción: auditoría sin vulnerabilidades conocidas al revisar esta entrega. Firebase CLI, solo de desarrollo, conserva avisos moderados transitivos de `@opentelemetry/core` y `uuid` (5 entradas contando paquetes dependientes). `npm audit fix` compatible se aplicó; no se forzó un downgrade mayor de la CLI. No forman parte del código enviado al navegador. Revisar actualizaciones upstream antes de exponer herramientas de desarrollo a redes no confiables.

## Pendiente exclusivamente del administrador

Crear `users/{uid}` para las cuentas reales y publicar reglas/índices con los pasos de [firebase-setup.md](firebase-setup.md). No se efectuó prueba financiera en producción porque el encargo prohíbe insertar datos ficticios y desplegar cambios automáticamente.
