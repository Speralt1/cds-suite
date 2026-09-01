# CDS Suite · V0.2 — Finanzas V1

CDS Administración para Casa de Salvación. Continúa la base `feature/base-cds-suite`; el desarrollo está en **`feature/finanzas-v1`**, sin merge a main ni despliegue automático a Firebase.

Incluye autorización por roles, movimientos reales en CLP, edición/anulación auditada, resumen mensual/anual, fichas privadas de diezmos, acompañamiento pastoral con consentimiento, configuración administrativa y PDF ejecutivo con texto seleccionable y gráficos vectoriales. Conserva Authentication y la identidad visual de V0.1.

## Empezar

Si ya ejecutabas V0.1, conserva `.env.local`, cambia a esta rama y ejecuta `npm install`. **Antes de registrar dinero, completa [Activar Finanzas en Firebase](docs/firebase-setup.md)**: crear tu documento `users/{uid}` y publicar reglas/índices. No hay una contraseña de producción predeterminada.

Para una instalación nueva, requiere Node 22.12+ de la línea 22 o Node 24+, y npm:

```bash
git clone --branch feature/finanzas-v1 https://github.com/Speralt1/cds-suite.git
cd cds-suite
npm install
cp .env.example .env.local
```

Completa las seis variables públicas Firebase de `.env.local` y sigue la guía de activación. Después:

```bash
npm run dev
```

Abre [CDS Suite](http://localhost:3000). Reinicia el servidor al cambiar variables. No agregues contraseñas, claves privadas, tokens ni service accounts al repositorio.

## Permisos y colecciones

| Colección                           | Contenido                                                  | Lectura                                  |
| ----------------------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| `users/{uid}`                       | Nombre, correo, rol, activo, fecha de creación             | Propio documento o admin                 |
| `financeTransactions/{id}`          | Libro financiero, sin identidad del diezmante              | admin, pastor, finance                   |
| `financeMonthlySummaries/{YYYY-MM}` | Totales, categorías y series diarias; sin datos personales | Cuatro roles activos                     |
| `titheProfiles/{id}`                | Personas/familias, contacto y consentimiento               | admin, pastor, finance                   |
| `titheAttributions/{transactionId}` | Relación privada entre diezmo y ficha                      | admin, pastor, finance                   |
| `pastoralFollowups/{id}`            | Acompañamiento pastoral privado                            | Solo admin y pastor                      |
| `appSettings/finance`               | Categorías financieras conocidas y activas                 | Lectura financiera; escritura solo admin |

Admin/pastor/finance registran, editan y anulan movimientos. Leader solo consulta agregados. Escribir acompañamiento requiere consentimiento vigente. Las reglas deniegan todos los borrados físicos y el acceso de cuentas no autorizadas/inactivas. El guard visual también desmonta los datos al revocar la autorización y exige una verificación de acceso del servidor.

## Integridad y límites deliberados

- Montos enteros positivos en CLP, hasta $1.000.000.000.000 por movimiento; límite mensual de $750.599.937.895.082 por entradas/salidas para que también los 12 meses se sumen sin perder precisión.
- Un movimiento y todos sus resúmenes afectados se confirman en una misma transacción. Los diezmos incluyen su atribución privada en esa transacción. Las reglas validan el impacto exacto en totales, categorías y días mediante `getAfter`; rechazan escrituras incompletas o agregados inventados.
- Ediciones con revisión obsoleta se rechazan. IDs estables y bloqueo de envío evitan duplicados. Ante contención de resúmenes se reintenta de forma acotada solo si una lectura autorizada del servidor prueba que el resumen cambió. No se informa éxito antes de la confirmación.
- Anulación conserva auditoría y motivo, excluye el importe de los totales y deja el registro inmutable. El resultado del período no es saldo bancario.
- Fechas contables almacenadas al mediodía UTC para conservar el día ingresado independientemente de la zona del navegador. Las consultas usan períodos; no se descarga la historia completa para mostrar un mes.
- Libro e informes: máximo 10.000 registros por período, con aviso si se excede; no se generan PDF parciales. Listas se muestran por bloques de 30; fichas usan paginación de Firestore con cursor y búsqueda por inicio del nombre, sin distinguir mayúsculas (conserva acentos).
- Último registro por ficha usa una consulta de un documento. El contador anual de fichas usa agregación `count`, sin descargar todas las fichas. Los listeners se cancelan al abandonar la pantalla.
- Firestore necesita conexión para confirmar transacciones. No se habilita persistencia offline del libro. No hay Functions, Storage, Admin SDK en el navegador ni servicios que requieran Blaze. Spark mantiene sus cuotas; vigila el uso real.
- El PDF general solo admite campos financieros; los diezmos tienen descripción fija «Diezmo». No copia notas, IDs de fichas ni identidades. Los usuarios deben evitar información personal innecesaria en descripciones de movimientos generales.
- Las categorías financieras se administran en **Configuración → Finanzas**. Las listas históricas son acumulativas; desactivar no elimina movimientos ni keys antiguas de los resúmenes. Si el documento de settings no existe se usan los defaults compatibles más Cafetería. Consulta [Configuración V1 y despliegue seguro](docs/configuration-v1.md).

## Archivos principales

- `app/(private)/finanzas/`: rutas Resumen, Movimientos, Diezmos, Perfil y Reportes.
- `app/(private)/configuracion/`: categorías financieras y permisos básicos, solo admin.
- `components/finance/`: pantallas, formularios, gráficos y controles separados por función.
- `lib/auth/access-provider.tsx`: autorización y revocación por `users/{uid}`.
- `lib/finance/transactions.ts`, `profiles.ts`: operaciones confirmadas y auditadas.
- `lib/finance/calculations.ts`, `hooks.ts`, `tithe-hooks.ts`: cálculos y consultas acotadas.
- `lib/finance/reports.ts`, `report-pdf.ts`: datos seguros de reporte y PDF nativo A4.
- `firestore.rules`, `firestore.indexes.json`, `firebase.json`: seguridad, índices y emuladores.
- `tests/`: pruebas de sesión, autorización, navegación, cálculos, reportes y reglas reales.

El logo del PDF es opcional: añade `public/logo-cds.png`. Sin archivo se utiliza el monograma CDS. La vista previa está dentro de Reportes; «Compartir» usa Web Share si admite archivos y descarga el PDF como alternativa.

## Validar y probar sin producción

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

No ejecutes `build` y `dev` simultáneamente sobre el mismo `.next`. Para reglas necesitas Java 21+:

```bash
npm run test:rules
```

Todos los datos automatizados son ficticios y se limitan a `demo-cds-suite`. [Prueba local completa](docs/local-auth-testing.md) · [Resultados de validación](docs/validation.md) · [Activación manual Firebase](docs/firebase-setup.md).

Nuevas dependencias de interfaz: Recharts, jsPDF y jsPDF-AutoTable. Herramientas de desarrollo: Firebase CLI, rules-unit-testing, tsx y Prettier. Mantiene React, Next.js, Firebase modular, Tailwind, Lucide y Vitest. ESLint 9 se conserva por compatibilidad con la configuración Next existente.
