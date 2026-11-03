// Sustituto de la simulación en builds sin NEXT_PUBLIC_CDS_OUTREACH_SIM=1
// (next.config.ts): así el código y los datos ficticios no se emiten.
export default function SimDisabled() {
  return null;
}
