// Marca de Alero (doc 39 §3, concepto A): el alero sobresale de la casa y
// cubre la puerta. Retícula 24×24, un solo color (currentColor); legible a 16 px.
export function AleroMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <path d="M2 13 12 4l10 9" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="miter" />
      <path d="M10 14h4a1 1 0 0 1 1 1v6H9v-6a1 1 0 0 1 1-1Z" fill="currentColor" />
    </svg>
  );
}
