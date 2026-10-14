// Posición de fondos (Design Lock 28 §C1 "FundsPosition", decisión 10 del
// Tech Lead). Fase 1: es solo un slot. La sección aparece únicamente cuando
// se le entrega el tile de saldo bancario (lo monta el PR D); sin él no se
// renderiza nada, ni placeholders vacíos. Nunca se suma al resultado y no
// depende del período seleccionado.
import type { ReactNode } from "react";
import "./tokens.css";
import "./summary.css";

export interface FundsPositionProps {
  /**
   * Tile "Saldo bancario estimado" (PR D). Obligatorio para mostrar la
   * sección: sin él FundsPosition devuelve `null`. El tile es responsable de
   * sus 4 estados (configurado, sin configurar, cargando, error) y de mostrar
   * fecha y naturaleza ("estimado") de su cifra.
   */
  bankTile?: ReactNode;
  /**
   * Tiles opcionales que van después del saldo, en este orden: "Efectivo en
   * caja" y "SumUp pendiente de abono" (PR C/D). Cada uno con `key`.
   */
  tiles?: ReactNode[];
  /** false si se está mirando un período que no es el actual. */
  isCurrentPeriod: boolean;
  /** Fecha de hoy para el encabezado: "13 oct". */
  todayLabel: string;
}

const TITLE_ID = "fin-funds-title";

export function FundsPosition({ bankTile, tiles = [], isCurrentPeriod, todayLabel }: FundsPositionProps) {
  if (!bankTile) return null;
  return (
    <section className="fin-funds" aria-labelledby={TITLE_ID}>
      <h3 id={TITLE_ID} className="fin-funds-title">
        {isCurrentPeriod ? "Posición de fondos" : `Posición de fondos · hoy, ${todayLabel}`}
      </h3>
      <p className="fin-funds-sub">
        Dinero en un momento dado. No se suma al resultado.
        {!isCurrentPeriod && " No depende del período seleccionado."}
      </p>
      <div className="fin-funds-grid">
        <div className="fin-funds-slot">{bankTile}</div>
        {tiles.map((tile, index) => (
          <div className="fin-funds-slot" key={index}>
            {tile}
          </div>
        ))}
      </div>
    </section>
  );
}
