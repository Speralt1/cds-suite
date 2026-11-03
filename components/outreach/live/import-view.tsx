"use client";

// Importar inscripciones (coordinación): archivo → informe sin aplicar → confirmar.
// Aplicar solo se habilita tras un informe (dry-run) del MISMO archivo.
import { useState } from "react";
import { CloudDownload } from "lucide-react";
import * as api from "@/lib/outreach/client";
import { parseSiteCsv, type CsvParseResult } from "@/lib/outreach/csv-import";
import { isReadOnly } from "@/lib/outreach/model";
import { Done, ErrorNote, ISSUE_LABEL, Loading, readFileText, useAction } from "./ui";

const REPORT_LABEL: Record<keyof api.ImportReport, string> = {
  created: "Nuevas",
  updated: "Actualizadas",
  cancelled: "Canceladas",
  unchanged: "Sin cambios",
  stale: "Ya estaban al día",
  toReview: "A revisión",
  skippedMinors: "Menores omitidos",
};

export default function ImportView({ edition, onImported }: { edition: api.EditionSummary; onImported?: () => void }) {
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [preview, setPreview] = useState<api.ImportResult | null>(null);
  const [applied, setApplied] = useState<api.ImportResult | null>(null);
  const act = useAction();
  const closed = isReadOnly({ status: edition.status });

  const onFile = async (file: File | undefined) => {
    setPreview(null);
    setApplied(null);
    if (!file) return setParsed(null);
    setParsed(parseSiteCsv(await readFileText(file), { editionYear: edition.year }));
    setFileKey((k) => k + 1);
  };
  const rows = parsed?.rows ?? [];
  const run = async (dryRun: boolean) => {
    const res = await act.run(() => api.importRegistrations(edition.id, rows, dryRun));
    if (!res) return;
    if (dryRun) setPreview(res);
    else {
      setApplied(res);
      setPreview(null);
      onImported?.();
    }
  };

  return (
    <section className="vp-card vp-narrow" aria-labelledby="vp-l-imp">
      <div className="vp-card-head">
        <h3 id="vp-l-imp">Importar inscripciones</h3>
        <p>Archivo CSV exportado del panel del sitio del evento («asistentes» o «solicitudes»).</p>
      </div>
      {closed ? (
        <p className="vp-small">La edición está cerrada: no se pueden importar inscripciones.</p>
      ) : (
        <>
          <label className="vp-as">
            <span>Archivo CSV</span>
            <input key={fileKey} type="file" accept=".csv,text/csv" className="form-input" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          {parsed && (
            <div className="vp-small" role="status">
              {parsed.kind ? `Tipo: ${parsed.kind}. ` : ""}
              {rows.length} filas listas
              {parsed.skipped > 0 && ` · ${parsed.skipped} sin aprobar (se omiten)`}
              {parsed.minors > 0 && ` · ${parsed.minors} menores (no se envían)`}
              {parsed.errors.length > 0 && ` · ${parsed.errors.length} con errores`}.
            </div>
          )}
          {parsed && parsed.errors.length > 0 && (
            <ul className="vp-sheet-list" aria-label="Errores del archivo">
              {parsed.errors.slice(0, 20).map((e, i) => (
                <li key={i}>{e.message}</li>
              ))}
              {parsed.errors.length > 20 && <li>…y {parsed.errors.length - 20} más.</li>}
            </ul>
          )}
          {act.busy && <Loading label="Procesando…" />}
          {act.error && <ErrorNote message={act.error} />}

          {preview && (
            <div>
              <h4 className="vp-small">Informe previo · aún no se guardó nada</h4>
              <dl className="vp-figures is-compact">
                {(Object.keys(REPORT_LABEL) as (keyof api.ImportReport)[]).map((k) => (
                  <div key={k}>
                    <dt>{REPORT_LABEL[k]}</dt>
                    <dd className="tabular">{preview.report[k]}</dd>
                  </div>
                ))}
              </dl>
              {preview.review.length > 0 && (
                <ul className="vp-sheet-list">
                  {preview.review.slice(0, 5).map((r, i) => (
                    <li key={i}>{ISSUE_LABEL[r.issue] ?? "Caso para revisar"}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {applied && (
            <Done>
              Importación aplicada: {applied.report.created} nuevas, {applied.report.updated} actualizadas, {applied.report.cancelled} canceladas
              {applied.reviewTotal > 0 && `, ${applied.reviewTotal} a revisión`}.
            </Done>
          )}

          {rows.length > 0 &&
            !applied &&
            (preview ? (
              <div className="vp-actions">
                <button type="button" className="button-primary vp-cta" disabled={act.busy} onClick={() => void run(false)}>
                  <CloudDownload size={16} aria-hidden="true" /> Aplicar importación
                </button>
                <button type="button" className="button-secondary" onClick={() => setPreview(null)}>
                  Descartar informe
                </button>
              </div>
            ) : (
              <button type="button" className="button-primary vp-cta" disabled={act.busy} onClick={() => void run(true)}>
                Ver informe sin aplicar
              </button>
            ))}
        </>
      )}
    </section>
  );
}
