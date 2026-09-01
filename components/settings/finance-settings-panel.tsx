"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth/auth-provider";
import { getFirebaseServices } from "@/lib/firebase";
import { errorMessage } from "@/lib/finance/formatters";
import type { TransactionType } from "@/lib/finance/types";
import {
  categoriesForType,
  type FinanceSettings,
} from "@/lib/settings/finance-settings";
import {
  addFinanceCategory,
  initializeFinanceSettings,
  setFinanceCategoryActive,
  useFinanceSettings,
} from "@/lib/settings/finance-settings-client";
import { Notice } from "@/components/finance/shared";

function CategorySection({
  title,
  type,
  settings,
  busy,
  onBusy,
  onError,
  onSuccess,
}: {
  title: string;
  type: TransactionType;
  settings: FinanceSettings;
  busy: string;
  onBusy: (value: string) => void;
  onError: (value: string) => void;
  onSuccess: (value: string) => void;
}) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const all = categoriesForType(settings, type, false);
  const active = categoriesForType(settings, type, true);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!user || busy) return;
    onBusy(`${type}:new`);
    onError("");
    onSuccess("");
    try {
      await addFinanceCategory(getFirebaseServices().db, user.uid, type, name);
      setName("");
      onSuccess("Categoría creada y activada correctamente.");
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      onBusy("");
    }
  }

  async function toggle(category: string, next: boolean) {
    if (!user || busy) return;
    onBusy(`${type}:${category}`);
    onError("");
    onSuccess("");
    try {
      await setFinanceCategoryActive(
        getFirebaseServices().db,
        user.uid,
        type,
        category,
        next,
      );
      onSuccess(
        next
          ? "Categoría activada para nuevos movimientos."
          : "Categoría desactivada. Los movimientos históricos se conservaron.",
      );
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      onBusy("");
    }
  }

  return (
    <section className="settings-section">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <p>
            Desactivar oculta la categoría en registros nuevos y conserva todo
            el historial.
          </p>
        </div>
      </div>
      <div className="settings-list">
        {all.map((category) => {
          const enabled = active.includes(category);
          const actionBusy = busy === `${type}:${category}`;
          return (
            <article className="settings-row" key={category}>
              <div className="min-w-0">
                <h3 className="break-words">{category}</h3>
                <span className={`status-pill mt-2 ${enabled ? "" : "voided"}`}>
                  {enabled ? "Activa" : "Inactiva"}
                </span>
              </div>
              <button
                type="button"
                className="button-secondary"
                disabled={!!busy || (enabled && active.length === 1)}
                onClick={() => void toggle(category, !enabled)}
              >
                {actionBusy ? "Guardando…" : enabled ? "Desactivar" : "Activar"}
              </button>
            </article>
          );
        })}
      </div>
      <form className="settings-add-form" onSubmit={add}>
        <label>
          Nueva categoría
          <input
            value={name}
            maxLength={80}
            placeholder="Ej. Taller comunitario"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button className="button-primary" disabled={!!busy}>
          {busy === `${type}:new` ? "Guardando…" : "+ Nueva categoría"}
        </button>
      </form>
    </section>
  );
}

export function FinanceSettingsPanel() {
  const { user } = useAuth();
  const settings = useFinanceSettings();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function initialize() {
    if (!user || busy) return;
    setBusy("initialize");
    setError("");
    setSuccess("");
    try {
      await initializeFinanceSettings(getFirebaseServices().db, user.uid);
      setSuccess("Configuración financiera inicializada correctamente.");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      {!settings.exists && !settings.loading && (
        <div className="notice settings-fallback-notice">
          <div>
            <strong>Configuración compatible activa.</strong>
            <p>
              Se usan las categorías originales más Cafetería. Todavía no se ha
              creado ningún documento de configuración.
            </p>
          </div>
          <button
            className="button-secondary"
            disabled={!!busy}
            onClick={() => void initialize()}
          >
            {busy === "initialize" ? "Inicializando…" : "Inicializar ahora"}
          </button>
        </div>
      )}
      <Notice error={settings.error || error} success={success} />
      <CategorySection
        title="Categorías de ingresos"
        type="income"
        settings={settings.data}
        busy={busy}
        onBusy={setBusy}
        onError={setError}
        onSuccess={setSuccess}
      />
      <CategorySection
        title="Categorías de gastos"
        type="expense"
        settings={settings.data}
        busy={busy}
        onBusy={setBusy}
        onError={setError}
        onSuccess={setSuccess}
      />
      <section className="panel settings-info-panel">
        <h2>Métodos de pago</h2>
        <p className="mt-2 text-sm text-muted">
          Efectivo · Transferencia · Tarjeta · Otro
        </p>
        <p className="mt-3 text-xs leading-6 text-muted">
          En esta versión se mantienen fijos para preservar compatibilidad. La
          estructura queda preparada para hacerlos configurables más adelante.
        </p>
      </section>
    </>
  );
}
