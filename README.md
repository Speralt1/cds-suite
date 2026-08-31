# CDS Suite · V0.1

Base de **CDS Administración**, para Casa de Salvación. Incluye acceso por correo y contraseña, sesión persistente, navegación privada, dashboard y estructura visual de Finanzas. No registra dinero ni consulta datos financieros.

## Ejecutar localmente

Requiere Node.js 22.12 o superior de la línea 22, o Node.js 24 LTS, y npm. El proyecto fija este mínimo para mantener compatibles las herramientas de pruebas y Next.js.

```bash
git clone --branch feature/base-cds-suite https://github.com/Speralt1/cds-suite.git
cd cds-suite
npm install
cp .env.example .env.local
```

Completar las seis variables `NEXT_PUBLIC_FIREBASE_*` de `.env.local` con la configuración de la app web en Firebase Console → Configuración del proyecto. Luego:

```bash
npm run dev
```

Abrir http://localhost:3000. Reiniciar el servidor después de cambiar variables. `.env.local` y cualquier otro `.env*` están ignorados, salvo `.env.example`. No agregar claves privadas, credenciales de usuarios, tokens ni archivos de service account.

## Firebase: preparación manual

1. Verificar que la app web corresponda al proyecto `cds-administracion` y copiar sus seis valores al entorno local o al proveedor de hosting.
2. Authentication → Sign-in method: Email/Password ya debe estar habilitado.
3. Authentication → Users: disponer de una cuenta autorizada creada por el administrador. No existe registro público ni recuperación de contraseña en esta versión.
4. Authentication → Settings → Authorized domains: revisar `localhost` para desarrollo y agregar el dominio final al publicar. Revisar también restricciones de API key si el proyecto las tiene.
5. Firestore: **no dejar reglas de modo de prueba abiertas**. Esta versión no necesita acceso a documentos; puede usar reglas que denieguen lecturas y escrituras. No se han desplegado ni modificado reglas del proyecto existente.
6. Mantener activada la protección contra enumeración de correos. Firebase puede devolver `auth/invalid-credential` tanto para correo inexistente como para contraseña incorrecta. En ese caso se muestra un mensaje combinado; no es un fallo del formulario.

**Límite de seguridad:** omitir un formulario de registro no deshabilita por sí solo el endpoint público de alta de Firebase Email/Password. Esta versión no implementa roles ni autorización de datos. Antes de añadir datos privados, definir reglas Firestore que permitan únicamente a usuarios aprobados (no basta con `request.auth != null` si el alta de cuentas sigue abierta), o una política de altas administrada en el proveedor. No otorgar acceso financiero por el mero hecho de estar autenticado.

## Arquitectura

- `app/layout.tsx`: metadata, idioma español y proveedor global de sesión.
- `app/page.tsx`: espera la sesión y redirige a `/login` o `/dashboard`.
- `app/login/page.tsx`: formulario con validación, estados de carga y errores en español; utiliza `signInWithEmailAndPassword` a través del proveedor.
- `app/(private)/layout.tsx`: agrupa `/dashboard` y `/finanzas` bajo `AuthGuard` y `AppShell`, sin modificar sus URLs.
- `components/layout/`: guard, navegación responsive, identidad visual reutilizable.
- `components/ui/`: estado de carga accesible.
- `components/finance/finance-workspace.tsx`: pestañas Resumen / Movimientos / Diezmos / Reportes con soporte de teclado y contenido placeholder.
- `lib/firebase.ts`: inicialización diferida y reutilización del app Firebase; exporta `getFirebaseServices()` con `app`, `auth` y `db`. No usa Admin SDK ni hace lecturas/escrituras.
- `lib/auth/`: proveedor basado en `onAuthStateChanged`, persistencia local mediante el SDK, inicio/cierre de sesión y traducción de errores.
- `tests/`: pruebas de integración de componentes con el límite Firebase simulado y pruebas de navegación del módulo.

Las páginas privadas no se renderizan hasta que Firebase confirma la sesión, y desaparecen al cerrar sesión o fallar la inicialización. Es protección de interfaz en cliente: el HTML/JavaScript público de Next.js no es una barrera de autorización para datos. No existen Server Actions, endpoints privados ni consultas de datos en V0.1. Cuando se añadan, cada acceso deberá verificar autorización en servidor o con reglas Firestore. Nunca incluir datos confidenciales en Server Components confiando únicamente en este guard.

Para agregar un módulo, crear una ruta dentro de `app/(private)`, componentes específicos y su entrada en la navegación. Para incorporar el logo, añadir `public/logo-cds.png` y pasar `logoSrc="/logo-cds.png"` a `Brand` en el shell y el login; mientras tanto se muestra un monograma CDS.

## Comandos de validación

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run start
```

`typecheck` genera tipos de rutas antes de ejecutar `tsc --noEmit`. Desarrollo y compilación usan Webpack, soportado por Next.js, para evitar un fallo de Turbopack con procesos/puertos internos en el entorno de ejecución. ESLint queda fijado en 9.39.5 porque los plugins React/import/accessibility incluidos por Next.js todavía no admiten ESLint 10. npm avisa que la línea 9 está deprecada: actualizar el conjunto cuando sus peer dependencies soporten ESLint 10. No se ignoraron errores de lint ni de tipos.

El build funciona sin variables Firebase, pero el login queda deshabilitado con un aviso hasta configurarlas. Las variables públicas se incorporan **durante el build**: en hosting deben estar definidas antes de `npm run build`, y requieren recompilar si cambian.

## Cómo probar el login real

1. Con las variables configuradas, abrir `/dashboard` sin sesión: debe terminar en `/login`, sin mostrar contenido privado.
2. Enviar el formulario vacío: debe pedir correo y contraseña.
3. Introducir una cuenta existente en Firebase Authentication y su contraseña. Debe ir a `/dashboard`.
4. Recargar y abrir otra pestaña del mismo origen: la sesión debe conservarse.
5. Pulsar **Ingresar** en Finanzas y recorrer las cuatro secciones.
6. Pulsar **Cerrar sesión**: debe volver a `/login`. Volver atrás o abrir `/finanzas` no debe mostrar la página privada.
7. Repetir a ancho de móvil. Probar datos incorrectos y, desde DevTools, una conexión sin red.

Usar siempre el mismo origen al verificar persistencia: `localhost` y `127.0.0.1` son distintos. En equipos compartidos, cerrar sesión al terminar; no se guardan contraseñas manualmente, pero el SDK sí conserva la sesión elegida.

La cuenta de Firebase de producción no se prueba sin credenciales autorizadas. Ver [validación](docs/validation.md) para resultados y alcance exacto, y [pruebas con emulador](docs/local-auth-testing.md) para verificar el flujo sin tocar el proyecto real.

## Alcance excluido

Sin registro de dinero, estadísticas reales o ficticias, PDF, personas, familias, diezmos operativos ni roles. Servicios, Reuniones, Equipos y Objetivos son tarjetas sin funcionalidad, marcadas “Próximamente”.
