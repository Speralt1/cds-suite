# Probar Finanzas sin tocar Firebase real

Este procedimiento usa emuladores. Las cuentas y registros desaparecen al detenerlos; no se publican ni sirven para producción. Requiere dependencias instaladas (`npm install`) y Java 21 o superior para Firestore.

## 1. Encender emuladores

En una Terminal dentro de `cds-suite`:

```bash
npm run emulators
```

Déjala abierta. Inicia exclusivamente `demo-cds-suite`, Authentication en `127.0.0.1:9099` y Firestore en `127.0.0.1:8080`.

## 2. Crear las cuentas ficticias

En otra Terminal, en la misma carpeta:

```bash
CDS_SEED_LOCAL=true FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npx tsx scripts/seed-emulators.ts
```

El script rechaza cualquier host/proyecto de producción. No utiliza Firebase Admin SDK. Crea una familia ficticia, una entrada, una salida y un diezmo, únicamente en el emulador.

| Cuenta local | Permiso |
|---|---|
| `admin@cds.test` | Módulo completo y acompañamiento |
| `pastor@cds.test` | Módulo completo y acompañamiento |
| `finance@cds.test` | Módulo financiero, sin acompañamiento |
| `leader@cds.test` | Solo resumen agregado |
| `inactive@cds.test` | Acceso denegado por cuenta inactiva |
| `missing@cds.test` | Acceso denegado por falta de documento de autorización |

Contraseña ficticia común: **`PruebaCDS2026!`**. Nunca usarla para cuentas reales.

## 3. Conectar la aplicación al emulador

Crea `.env.development.local` con este contenido. **No modifiques tu `.env.local` real**:

```dotenv
NEXT_PUBLIC_FIREBASE_API_KEY=demo-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=demo-cds-suite.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-cds-suite
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=demo-cds-suite.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:localtest
NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true
```

Reinicia `npm run dev` y abre [la aplicación local](http://127.0.0.1:3000). Debe verse el aviso del emulador. Inicia sesión con una cuenta de la tabla. Guarda, edita, anula, crea fichas y genera PDF libremente: todos los datos son de prueba.

Prueba también pantallas a 320, 375, 390 y 430 px y en escritorio, navegación por teclado, Escape para cerrar formularios, cambio mensual/anual, filtros, perfiles, consentimiento, PDF y cierre de sesión.

## 4. Volver a Firebase real

Detén `npm run dev`, elimina solamente `.env.development.local` y vuelve a iniciar `npm run dev`. Conserva `.env.local`. Cierra la sesión ficticia y usa tu cuenta real, ya autorizada según [la guía Firebase](firebase-setup.md). No hay datos ficticios que borrar en producción.

## Pruebas automatizadas

```bash
npm run test
npm run test:rules
```

`test:rules` arranca su propio emulador y limpia la base ficticia entre casos. Detén primero otros emuladores que estén usando el puerto 8080. No lo ejecutes al mismo tiempo que una sesión de prueba visual cuyos datos quieras conservar. Para escribir PDFs de revisión a disco, opcionalmente ejecuta `PDF_QA_DIR=/ruta/temporal npm run test`; nunca usa datos reales.
