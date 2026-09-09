"use client";

import { useState } from "react";
import { Banknote, Copy, CreditCard, ExternalLink } from "lucide-react";
import { useGivingSettings } from "@/lib/offerings/client";

export function GivingPage() {
  const settings = useGivingSettings();
  const [copied, setCopied] = useState(false);

  if (settings.loading) return <main className="giving-public-shell"><p>Cargando…</p></main>;
  const data = settings.data;

  async function copyTransfer() {
    if (!data?.transferInstructions) return;
    await navigator.clipboard.writeText(data.transferInstructions);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <main className="giving-public-shell">
      <header className="public-campaign-brand">
        <div className="public-campaign-logo">CDS</div>
        <div><strong>Casa de Salvación</strong><span>Ofrendas</span></div>
      </header>

      <section className="giving-public-hero">
        <p className="eyebrow">APORTAR</p>
        <h1>{data?.title || "Ofrendar"}</h1>
        <p>{data?.intro || "Tu aporte nos ayuda a seguir desarrollando la obra de Casa de Salvación."}</p>
      </section>

      <div className="giving-methods">
        {(data?.transferEnabled ?? true) && (
          <section className="giving-method-card">
            <div className="giving-method-icon"><Banknote size={22} /></div>
            <div className="giving-method-copy">
              <span className="eyebrow">SIN COMISIÓN DE PASARELA</span>
              <h2>Transferencia bancaria</h2>
              <p>Si quieres que el aporte llegue íntegro, esta es la opción recomendada.</p>
            </div>
            {data?.transferInstructions ? (
              <>
                <pre className="transfer-data">{data.transferInstructions}</pre>
                <button className="button-secondary giving-copy-button" type="button" onClick={() => void copyTransfer()}><Copy size={16} />{copied ? "Datos copiados" : "Copiar datos"}</button>
              </>
            ) : <p className="notice">Los datos bancarios están siendo configurados.</p>}
          </section>
        )}

        {data?.onlineEnabled && data.onlineUrl && (
          <section className="giving-method-card giving-card-online">
            <div className="giving-method-icon"><CreditCard size={22} /></div>
            <div className="giving-method-copy">
              <span className="eyebrow">PAGO ONLINE</span>
              <h2>{data.onlineLabel || "Pagar online"}</h2>
              <p>Usa esta opción si prefieres completar tu aporte mediante una pasarela de pago.</p>
            </div>
            <a className="button-primary giving-copy-button" href={data.onlineUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />{data.onlineLabel || "Pagar online"}</a>
          </section>
        )}
      </div>

      <footer className="public-campaign-footer">Casa de Salvación · Ofrendas</footer>
    </main>
  );
}
