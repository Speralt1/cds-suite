export function getAuthErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";

  switch (code) {
    case "auth/wrong-password":
      return "La contraseña es incorrecta. Inténtalo nuevamente.";
    case "auth/user-not-found":
      return "No encontramos un usuario con ese correo. Contacta al administrador.";
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
      return "El correo o la contraseña son incorrectos. Revisa tus datos.";
    case "auth/invalid-email":
      return "Ingresa un correo electrónico válido.";
    case "auth/missing-password":
      return "Ingresa tu contraseña.";
    case "auth/network-request-failed":
      return "No pudimos conectarnos. Revisa tu conexión a internet e inténtalo nuevamente.";
    case "auth/too-many-requests":
      return "Hubo demasiados intentos. Espera unos minutos antes de volver a ingresar.";
    case "auth/user-disabled":
      return "Esta cuenta está deshabilitada. Contacta al administrador.";
    case "auth/web-storage-unsupported":
      return "Tu navegador no permite guardar la sesión. Habilita el almacenamiento del sitio.";
    default:
      return "No pudimos completar la operación. Inténtalo nuevamente o contacta al administrador.";
  }
}
