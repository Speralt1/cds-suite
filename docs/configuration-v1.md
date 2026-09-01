# Configuración V1 y despliegue seguro

Configuración V1 agrega `appSettings/finance` y administración limitada de los
documentos existentes en `users`. No crea cuentas de Firebase Authentication,
no usa Admin SDK y no modifica movimientos ni resúmenes históricos.

## Esquema

`appSettings/finance` contiene:

| Campo                     | Tipo      | Uso                                        |
| ------------------------- | --------- | ------------------------------------------ |
| `schemaVersion`           | number    | Versión `1` del documento                  |
| `incomeCategoriesAll`     | string[]  | Universo histórico acumulativo de ingresos |
| `incomeCategoriesActive`  | string[]  | Opciones permitidas para nuevas entradas   |
| `expenseCategoriesAll`    | string[]  | Universo histórico acumulativo de gastos   |
| `expenseCategoriesActive` | string[]  | Opciones permitidas para nuevas salidas    |
| `updatedBy`               | string    | UID del administrador                      |
| `updatedAt`               | timestamp | Fecha de actualización del servidor        |

Las listas `*All` son append-only en las reglas. Desactivar una categoría solo
la quita de `*Active`. Para renombrar una categoría utilizada, crea la nueva y
desactiva la anterior.

Si el documento no existe, tanto la aplicación como las reglas usan las
categorías originales más **Cafetería** en ingresos y gastos. Este fallback no
escribe documentos automáticamente.

## Orden de despliegue

1. Respaldar reglas vigentes y confirmar el proyecto con
   `firebase use` o `firebase projects:list`.
2. Ejecutar localmente `npm run lint`, `npm run typecheck`, `npm run test`,
   `npm run build` y, con Java 21+, `npm run test:rules`.
3. Desplegar primero `firestore.rules`. Estas reglas tienen fallback y funcionan
   aunque `appSettings/finance` todavía no exista.
4. Verificar con una cuenta `admin`, `pastor`, `finance` y `leader` que los
   permisos de Finanzas no cambiaron.
5. Desplegar la aplicación web.
6. Entrar como administrador en **Configuración → Finanzas**. Se puede usar
   **Inicializar ahora** o guardar la primera modificación para crear el
   documento con los defaults compatibles.
7. Verificar una entrada y una salida de prueba con Cafetería, revisar el
   resumen mensual y anular los registros de prueba mediante la aplicación.

Este repositorio no ejecuta esos despliegues automáticamente.

## Rollback

La interfaz puede volver al commit web anterior sin borrar
`appSettings/finance`; el documento adicional no afecta esa versión. Si ya se
registraron movimientos con categorías nuevas, no se deben restaurar reglas
antiguas que desconozcan esas categorías: podrían bloquear futuras ediciones o
anulaciones y la actualización de sus resúmenes. En ese caso se conserva la
regla V1 y se revierte únicamente la aplicación mientras se corrige el problema.

Nunca borres `appSettings/finance` como mecanismo de rollback después de usar
categorías nuevas. Nunca edites o recalcules automáticamente
`financeTransactions` ni `financeMonthlySummaries`.

## Usuarios y Authentication

**Configuración → Usuarios y permisos** edita nombre, rol y estado de documentos
ya existentes en `users`. El administrador autenticado no puede desactivarse ni
quitarse su propio rol admin. Las cuentas, contraseñas y recuperación de acceso
siguen administrándose manualmente en Firebase Console → Authentication. Para
autorizar una cuenta nueva también se crea manualmente su documento `users/{uid}`
con el mismo esquema documentado en `firebase-setup.md`.
