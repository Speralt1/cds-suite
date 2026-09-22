import { cx, formatCLPSigned, spokenSign, formatCLPAbs } from "./format";

export type MoneyBasis = "bruto" | "líquido" | "efectivo" | "contado" | "esperado";

export interface MoneyAmountProps {
  /** Monto en pesos. Negativo = salida/reembolso/faltante. */
  value: number;
  /**
   * Base explícita del monto (Design Lock §4: "líquido" solo con comisión
   * real, "bruto" cuando la comisión no está disponible, etc). Se muestra
   * como etiqueta visible junto al monto.
   */
  basis?: MoneyBasis;
  /** Oculta la etiqueta de base aunque `basis` esté definido. */
  hideBasis?: boolean;
  className?: string;
  /** Etiqueta accesible completa; si no se pasa, se arma desde el valor. */
  ariaLabel?: string;
}

/**
 * Monto monetario en formato CLP (es-CL), tabular, alineado por el
 * contenedor, con signo "−" real (U+2212) ADEMÁS del color rojo — nunca
 * solo color (Design Lock §4, criterio de aceptación 4 y 9 del Gate §5).
 */
export function MoneyAmount({
  value,
  basis,
  hideBasis,
  className,
  ariaLabel,
}: MoneyAmountProps) {
  const isNegative = Number.isFinite(value) && value < 0;
  const label =
    ariaLabel ??
    `${spokenSign(value)}${formatCLPAbs(value)}${basis ? `, ${basis}` : ""}`;
  return (
    <span
      className={cx("p26-money", isNegative && "p26-money--negative", className)}
      aria-label={label}
    >
      <span className="p26-money__value" aria-hidden="true">
        {formatCLPSigned(value)}
      </span>
      {basis && !hideBasis && (
        <span className="p26-money__basis" aria-hidden="true">
          {basis}
        </span>
      )}
    </span>
  );
}
