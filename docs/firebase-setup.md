# Activar Finanzas V1 en Firebase

Esta preparación se hace una sola vez. **No necesitas abrir un ZIP ni volver a instalar si ya tienes el proyecto funcionando.** Usa la rama `feature/finanzas-v1` y conserva tu `.env.local` actual.

No se han desplegado reglas, índices ni datos en Firebase real. No registres movimientos reales hasta completar estos pasos. Las cuentas `@cds.test` pertenecen solo al emulador y no sirven en producción.

## 1. Obtener tu UID y darte acceso

1. Abre [Firebase Console](https://console.firebase.google.com/) y selecciona **cds-administracion**.
2. En **Authentication → Users / Usuarios**, busca el correo con el que entras a CDS Suite. Si todavía no existe, créalo allí con **Add user / Agregar usuario**; conserva la contraseña de forma privada.
3. Copia el **UID** de esa cuenta. Es el identificador largo de Firebase; no es el correo.
4. Abre **Firestore Database → Datos**. Si todavía no tienes base de datos, crea la base **predeterminada / (default)**, edición Standard, eligiendo una ubicación adecuada; no uses reglas abiertas de prueba.
5. Crea una colección llamada exactamente `users`.
6. Como **ID del documento**, pega tu UID. No uses ID automático.
7. Agrega estos campos y pulsa **Guardar**:

| Campo | Tipo en la consola | Valor |
|---|---|---|
| `displayName` | string | Tu nombre |
| `email` | string | El correo de tu cuenta Authentication |
| `role` | string | `admin` |
| `active` | boolean | `true` (sin comillas) |
| `createdAt` | timestamp | Fecha y hora actuales |

La consola permite crear el primer administrador aunque las reglas impidan que un usuario se autorice a sí mismo. Para otras personas, repite con su propio UID y el rol adecuado. Cambiar `active` a `false` revoca el acceso de la aplicación; no borra sus movimientos.

## 2. Publicar reglas e índices

Abre Terminal **en la carpeta `cds-suite`**, la que contiene `package.json`. Ejecuta estos comandos, uno por uno:

```bash
npm install
npx firebase login
npx firebase deploy --only firestore:rules,firestore:indexes --project cds-administracion
```

El segundo comando abre Google para identificarte con una cuenta que administre ese proyecto. El tercero publica únicamente los archivos `firestore.rules` y `firestore.indexes.json`; no publica la web, no habilita Functions ni Storage y no crea movimientos.

**Antes del tercer comando, revisa si ya existen reglas para otras aplicaciones en este mismo proyecto.** El archivo de esta rama protege las seis colecciones de CDS y deniega las demás. Si el proyecto comparte otras aplicaciones, integra sus reglas antes de desplegar para no interrumpirlas. Exporta o conserva las reglas e índices anteriores como respaldo. No aceptes borrar índices ajenos que la CLI sugiera.

Espera hasta que **Firestore → Índices** muestre los nuevos índices como habilitados. Las consultas pueden fallar mientras se construyen.

Alternativa para reglas, si prefieres la consola: **Firestore → Reglas**, copia todo `firestore.rules` y pulsa **Publicar**. Los índices se pueden desplegar por separado con:

```bash
npx firebase deploy --only firestore:indexes --project cds-administracion
```

No edites directamente los movimientos ni sus resúmenes desde la consola: la consola administrativa omite las reglas y podría desajustar los totales.

## 3. Variables y arranque

Si V0.1 ya funcionaba, conserva las seis variables `NEXT_PUBLIC_FIREBASE_*` de `.env.local`. No hay nuevas claves obligatorias ni service accounts. `.env.example` enumera los nombres, y los valores están en **Configuración del proyecto → Tus apps → App web**.

Para usar Firebase real, no debe existir una configuración local de demostración que lo reemplace. Elimina únicamente `.env.development.local` si la creaste para probar emuladores, o mueve ese archivo fuera del proyecto. No elimines `.env.local`.

```bash
npm run dev
```

Abre [CDS Suite local](http://localhost:3000), cierra cualquier sesión anterior y entra con **tu correo y contraseña reales de Authentication**. No existe un usuario/contraseña de producción predeterminado. Reinicia `npm run dev` al cambiar variables. En producción, el modo emulador está deshabilitado.

## 4. Comprobar el flujo

Haz primero el ensayo completo en los emuladores, siguiendo [pruebas locales](local-auth-testing.md). En Firebase real registra únicamente operaciones reales:

1. Entrar como admin: deben aparecer Resumen, Movimientos, Diezmos y Reportes.
2. Registrar una entrada y una salida: revisar que el resultado sea ingresos menos gastos.
3. Editar un registro y revisar los totales. Anular uno con motivo: permanece visible y deja de sumar.
4. Crear una ficha y registrar un diezmo: aparece como ingreso «Diezmo» sin el nombre en el libro general.
5. Abrir la ficha: ver historial, total anual y último registro; las notas privadas solo están allí.
6. Registrar acompañamiento como pastor/admin solo cuando exista consentimiento.
7. Descargar reporte mensual y anual: revisar totales, páginas y ausencia de datos personales de diezmos.
8. Entrar con una cuenta `leader`: solo resumen y gráficos. Una cuenta `finance` no verá acompañamiento pastoral. Una cuenta sin documento `users/{uid}` o inactiva verá el aviso de acceso no autorizado.

## Roles

| Rol | Resumen | Movimientos, diezmos, PDF | Acompañamiento pastoral |
|---|---|---|---|
| `admin` | Sí | Sí | Sí, con consentimiento para escribir |
| `pastor` | Sí | Sí | Sí, con consentimiento para escribir |
| `finance` | Sí | Sí | No puede leer ni escribir |
| `leader` | Solo agregados | No puede leer ni escribir | No puede leer ni escribir |

Solo admin puede administrar documentos de autorización mediante un cliente autorizado; esta versión prepara las reglas pero no incorpora una pantalla de administración de usuarios. El primer admin se crea en la consola. Ningún rol puede borrar físicamente movimientos desde la aplicación.
