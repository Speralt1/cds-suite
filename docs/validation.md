# Validación de CDS Suite V0.1

Fecha: 31 de agosto de 2026. Entorno: macOS, Node.js 24.12.0, npm 11.6.2.

## Comandos

| Comando | Resultado |
| --- | --- |
| `npm install` | Correcto; 0 vulnerabilidades reportadas por npm |
| `npm run lint` | Correcto; sin errores ni advertencias |
| `npm run typecheck` | Correcto; generación de rutas y `tsc --noEmit` |
| `npm run test` | 20 pruebas aprobadas, 2 archivos |
| `npm run build` | Correcto, usando `next build --webpack` |
| `git diff --check` | Sin errores de espacios |
| `git check-ignore .env.local .env.development.local` | Ambos ignorados |

El build genera `/`, `/login`, `/dashboard` y `/finanzas`. El HTML inicial de rutas privadas solo muestra la verificación de sesión. No incluye datos financieros.

## Pruebas automatizadas

Las pruebas de componentes simulan únicamente la frontera del SDK Firebase; ejercitan el proveedor, los guards, el formulario, el shell y las pestañas reales. Verifican: ausencia de contenido privado durante carga y sin sesión; restauración/cierre de sesión; redirecciones desde raíz; fallos de persistencia y del observador; limpieza de suscripción; campos vacíos; llamada a Firebase con correo/contraseña; errores de red y reintento; configuración ausente; fallo del cierre de sesión; errores específicos y mensaje combinado; enlace a Finanzas; módulos futuros no interactivos; navegación por teclado entre pestañas.

## Verificación en navegador

Se usó el SDK real de Firebase con Authentication Emulator, un proyecto `demo-cds-suite` y una cuenta ficticia. No se crearon ni modificaron usuarios en Firebase de producción.

- Ingreso mediante correo/contraseña → dashboard.
- Recarga autenticada → sesión restaurada y dashboard visible.
- Segunda pestaña en `/` → dashboard con la sesión existente.
- Enlace Finanzas → cuatro secciones seleccionables, con placeholders diferentes.
- Diseño revisado en escritorio (1280 px y login a 1440 px) y móvil (390 px), sin desborde horizontal a 390 px.
- Cierre de sesión → login; acceso directo a `/finanzas` después de cerrar sesión → login.
- Login sin registro público; el envío vacío muestra un mensaje claro.

El aviso rojo de “emulator mode” de Firebase aparece solo en las pruebas locales; no forma parte de producción.

## Alcance y límites

- No se realizó inicio de sesión con una cuenta de `cds-administracion`: requiere que el administrador pruebe una cuenta existente. La configuración local real usa los valores suministrados, fuera de Git.
- No se accedió a documentos Firestore ni se modificaron sus reglas; deben revisarse en Firebase Console antes de publicar.
- No se desplegó un sitio ni se modificó `main`. El repositorio estaba vacío al iniciar.
- Turbopack falló por permisos al abrir puertos internos en el entorno. Se corrigió usando Webpack, y el comando final de build terminó sin errores.
- Se probó ESLint 10 y resultó incompatible con los plugins incluidos por Next.js; se fijó ESLint 9.39.5. Esa línea muestra un aviso de deprecación en una instalación limpia; el árbol final es compatible y el lint pasa sin omitir reglas.

## Entrega y publicación

El código y la documentación se entregan en `feature/base-cds-suite`, con autorización explícita del usuario para publicar en `Speralt1/cds-suite`. La credencial Git local rechazó el push; la conexión GitHub permitió la escritura después de actualizar el acceso. No se modifica `main`. El ZIP es una copia opcional de respaldo del código, sin `.env.local`, dependencias instaladas ni artefactos de build. Para quien solo desea usar la aplicación, no es necesario trabajar con ese ZIP: falta configurar un hosting para disponer de una dirección web.

En la revisión final se confirmó también la estructura compacta del formulario móvil y que la segunda pestaña vuelve a login al recargar después del cierre de sesión. No se considera verificada la sincronización inmediata en pestañas en segundo plano.
