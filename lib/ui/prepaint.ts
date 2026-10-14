// Script previo al pintado (Design Lock 28 §C3 "Sin parpadeo", §C4 técnica 3).
// Módulo puro (sin React ni APIs del navegador al importarse): app/layout.tsx
// lo inserta como <script> inline en <head>. Lee las preferencias de interfaz
// de este dispositivo y fija data-text-size y data-sidebar en <html> antes del
// primer pintado. Todo va dentro de try/catch: sin localStorage (ventana
// privada, almacenamiento bloqueado) la app queda en sus valores por defecto.
//
// No toca las rutas públicas (calendario público, ofrendar, campañas): esas
// páginas no tienen el control "Aa" y se ven siempre al 100 %.

export const TEXT_SIZE_KEY = "cds.ui.textSize";
export const SIDEBAR_KEY = "cds.ui.sidebar";

export const TEXT_SIZE_VALUES = ["normal", "large", "xlarge"] as const;
export const SIDEBAR_VALUES = ["expanded", "collapsed"] as const;

/** Prefijos de rutas públicas (sin shell ni preferencias de interfaz). */
export const PUBLIC_PATH_PATTERN = /^\/(calendario-publico|ofrendar|campanas|c)(\/|$)/;

export const PREPAINT_SCRIPT = `(function(){try{var d=document.documentElement;if(${PUBLIC_PATH_PATTERN.toString()}.test(location.pathname))return;var t=localStorage.getItem(${JSON.stringify(
  TEXT_SIZE_KEY,
)});if(${JSON.stringify(TEXT_SIZE_VALUES)}.indexOf(t)>=0)d.setAttribute("data-text-size",t);var s=localStorage.getItem(${JSON.stringify(
  SIDEBAR_KEY,
)});if(${JSON.stringify(SIDEBAR_VALUES)}.indexOf(s)>=0)d.setAttribute("data-sidebar",s)}catch(e){}})();`;
