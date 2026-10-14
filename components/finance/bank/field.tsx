"use client";
// Campo de formulario de Banco y caja: etiqueta asociada por id y ayuda por
// aria-describedby (la ayuda no forma parte del nombre accesible).
import { useId, type ReactNode } from "react";
import styles from "./bank-forms.module.css";

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
}

export function Field({
  label,
  help,
  full = false,
  children,
}: {
  label: string;
  help?: string;
  full?: boolean;
  children: (props: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  return (
    <div className={`${styles.field} ${full ? styles.full : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, ...(help ? { "aria-describedby": helpId } : {}) })}
      {help && (
        <span id={helpId} className={styles.help}>
          {help}
        </span>
      )}
    </div>
  );
}
