"use client";
import { useState } from "react";
import { usePeriod, useTransactions } from "@/lib/finance/hooks";
import {
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  MAX_PERIOD_RECORDS,
  PAGE_SIZE,
} from "@/lib/finance/constants";
import { periodLabel } from "@/lib/finance/formatters";
import {
  DetailGuard,
  FinancePageHeader,
  PeriodPicker,
  PeriodViewControl,
  Loading,
  Notice,
  Empty,
} from "../shared";
import { TransactionForm } from "../forms/transaction-form";
import { TransactionList } from "./transaction-list";
export function MovementsPage() {
  return (
    <DetailGuard>
      <Movements />
    </DetailGuard>
  );
}
function Movements() {
  const [period, setPeriod] = usePeriod();
  const state = useTransactions(period);
  const [create, setCreate] = useState(false);
  const [success, setSuccess] = useState("");
  const [filters, setFilters] = useState({
    type: "",
    category: "",
    method: "",
    search: "",
  });
  const [count, setCount] = useState(PAGE_SIZE);
  const items = state.data.filter(
    (t) =>
      (!filters.type || t.type === filters.type) &&
      (!filters.category || t.category === filters.category) &&
      (!filters.method || t.paymentMethod === filters.method) &&
      t.description
        .toLocaleLowerCase("es")
        .includes(filters.search.toLocaleLowerCase("es")),
  );
  return (
    <>
      <FinancePageHeader
        title="Movimientos"
        subtitle="Entradas y salidas, con cada registro a la vista."
        view={
          <PeriodViewControl monthlyOnly value={period} onChange={setPeriod} />
        }
        period={
          <PeriodPicker
            monthlyOnly
            value={period}
            onChange={(p) => {
              setPeriod(p);
              setCount(PAGE_SIZE);
            }}
          />
        }
        actions={
          <button className="button-primary" onClick={() => setCreate(true)}>
            + Registrar movimiento
          </button>
        }
      />
      <div className="filters">
        <label>
          Buscar descripción
          <input
            type="search"
            placeholder="Buscar movimiento…"
            value={filters.search}
            onChange={(e) => {
              setFilters({ ...filters, search: e.target.value });
              setCount(PAGE_SIZE);
            }}
          />
        </label>
        {[
          [
            "type",
            "Tipo",
            [
              ["income", "Entrada"],
              ["expense", "Salida"],
            ],
          ],
          [
            "category",
            "Categoría",
            [...INCOME_CATEGORIES, "Diezmos", ...EXPENSE_CATEGORIES].map(
              (c) => [c, c],
            ),
          ],
          ["method", "Método", Object.entries(PAYMENT_METHODS)],
        ].map(([key, label, options]) => (
          <label key={key as string}>
            {label as string}
            <select
              value={filters[key as keyof typeof filters]}
              onChange={(e) => {
                setFilters({ ...filters, [key as string]: e.target.value });
                setCount(PAGE_SIZE);
              }}
            >
              <option value="">Todos</option>
              {(options as string[][]).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <Notice
        error={
          state.error ||
          (state.data.length >= MAX_PERIOD_RECORDS
            ? "El período alcanzó el límite de 10.000 registros. Contacta al administrador antes de continuar; el listado podría estar incompleto."
            : "")
        }
        success={success}
      />
      {state.loading ? (
        <Loading />
      ) : state.error ? null : items.length ? (
        <>
          <TransactionList items={items.slice(0, count)} onSaved={setSuccess} />
          <p className="mt-4 text-sm text-muted">
            {Math.min(count, items.length)} de {items.length} registros del
            período
          </p>
          {count < items.length && (
            <button
              className="button-secondary mt-4"
              onClick={() => setCount(count + PAGE_SIZE)}
            >
              Ver más movimientos
            </button>
          )}
        </>
      ) : (
        <Empty>
          <h3>Aún no hay movimientos para esta selección.</h3>
          <p className="mt-2">
            {periodLabel(period)} · Revisa los filtros o registra el primero.
          </p>
          <button
            className="button-primary mt-5"
            onClick={() => setCreate(true)}
          >
            Registrar primer movimiento
          </button>
        </Empty>
      )}
      {create && (
        <TransactionForm
          onClose={() => setCreate(false)}
          onSaved={setSuccess}
        />
      )}
    </>
  );
}
