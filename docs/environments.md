# Entornos Firebase

CDS Suite usa las mismas variables públicas en desarrollo y producción:

```text
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

Son datos de configuración del SDK web, no credenciales de administrador. Aun así, los valores reales no se guardan en GitHub. Las service accounts y claves privadas nunca deben usar variables `NEXT_PUBLIC_*` ni entrar en este repositorio.

## Desarrollo

El proyecto previsto para desarrollo es `cds-administracion-dev`. Créalo y configúralo manualmente en Firebase cuando corresponda; este repositorio no lo crea ni lo despliega automáticamente.

1. Copia `.env.example` como `.env.development.local`.
2. Completa las seis variables con la configuración de la app web de `cds-administracion-dev`.
3. Verifica que `NEXT_PUBLIC_FIREBASE_PROJECT_ID` sea `cds-administracion-dev`.
4. Ejecuta `npm run dev`.

Para probar el sitio exportado, ejecuta `npm run build` y después `npm run preview`. La vista previa sirve la carpeta `out` usando la configuración de Firebase Hosting, sin publicar nada.

## Producción

El proyecto de producción es `cds-administracion`. Antes de compilar para publicar, copia `.env.example` como `.env.production.local` y completa las mismas seis variables con los valores de la app web de producción, o proporciónalas mediante el entorno seguro de CI. Confirma que `NEXT_PUBLIC_FIREBASE_PROJECT_ID` sea exactamente `cds-administracion`. `.env.production.local` está ignorado por Git y nunca debe subirse.

```bash
npm install
npm run lint
npm run typecheck
npm run test
npm run build
npm run deploy:hosting
```

`npm run deploy:hosting` ejecuta `firebase deploy --only hosting --project cds-administracion`. Publica solamente el contenido y la configuración de Hosting desde `out`; no publica reglas ni índices de Firestore. El build de la interfaz tampoco borra datos. Revisa siempre la lista “Antes de publicar” de [data-safety.md](./data-safety.md), especialmente si hubo cambios en reglas, migraciones o scripts administrativos.

No hay un rewrite global hacia `index.html`: Next genera un HTML por ruta y Firebase Hosting aplica `cleanUrls`. Las rutas inexistentes conservan el `404.html` exportado, lo que evita ocultar enlaces incorrectos detrás de una página genérica.
