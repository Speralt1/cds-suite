// Marcador de la preview de CDS Suite (Calendario, Integrantes, Reportes,
// Configuración). Lo usa scripts/check-no-preview.mjs para bloquear un deploy
// que contenga la preview. Vive en un módulo propio para que la página pública
// pueda usarlo sin importar las fixtures internas.
export const SX_PREVIEW_SENTINEL = "SX_PREVIEW_SENTINEL_V1_c41e";
