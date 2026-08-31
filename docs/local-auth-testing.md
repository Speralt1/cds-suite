# Pruebas locales de autenticación

Opcional: usar Firebase CLI y un emulador de Auth en `127.0.0.1:9099`, con el proyecto ficticio `demo-cds-suite`. Nunca usar credenciales reales en el emulador. Las herramientas del emulador no son dependencias de la aplicación.

Crear un archivo temporal fuera del repositorio, `firebase.json`:

```json
{"emulators":{"auth":{"host":"127.0.0.1","port":9099},"ui":{"enabled":false}}}
```

Ejecutar desde esa carpeta:

```bash
npx firebase-tools emulators:start --only auth --project demo-cds-suite --config firebase.json
```

En la raíz de la aplicación, crear `.env.development.local` (ignorado por git):

```dotenv
NEXT_PUBLIC_FIREBASE_API_KEY=demo-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=demo-cds-suite.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-cds-suite
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=demo-cds-suite.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:demo
NEXT_PUBLIC_USE_AUTH_EMULATOR=true
```

El uso del emulador solo se admite con `NODE_ENV=development` y un ID `demo-`. El build de producción ignora esta opción. Este archivo tiene prioridad sobre `.env.local` durante desarrollo: eliminarlo al terminar las pruebas y reiniciar Next.js para volver al proyecto real.

Crear un usuario ficticio con la API REST del emulador (solo localhost):

```bash
curl -X POST 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key' \
  -H 'Content-Type: application/json' \
  -d '{"email":"prueba@example.test","password":"Cds-local-test-2026!","returnSecureToken":true}'
```

No guardar ni publicar los tokens de la respuesta. Reiniciar `npm run dev`, abrir `http://127.0.0.1:3000` e iniciar sesión con esa cuenta ficticia. Verificar redirecciones, recarga, segunda pestaña, las cuatro secciones de Finanzas y cierre de sesión. Los datos de Auth del emulador se descartan al detenerlo si no se exportan.
