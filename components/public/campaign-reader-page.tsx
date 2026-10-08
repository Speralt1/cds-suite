"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  campaignReaderTokenFromLocation,
  fetchCampaignReader,
  isWellFormedCampaignReaderToken,
  type CampaignReaderData,
} from "@/lib/campaigns/reader-client";
import styles from "./campaign-reader.module.css";

type ReaderState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "error" }
  | { status: "ready"; data: CampaignReaderData };

function clp(value: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(value);
}

function compactDate(value: string) {
  const parts = value.split("-");

  if (
    parts.length !== 3 ||
    parts[1].length !== 2 ||
    parts[2].length !== 2
  ) {
    return value;
  }

  return parts[2] + "/" + parts[1];
}

export function CampaignReaderPage() {
  const [state, setState] = useState<ReaderState>({
    status: "loading",
  });
  const [attempt, setAttempt] = useState(0);
  const token = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;

    if (attempt === 0) {
      token.current =
        campaignReaderTokenFromLocation(window.location);
    }

    const currentToken = token.current;

    if (!isWellFormedCampaignReaderToken(currentToken)) {
      setState({ status: "unavailable" });
      return;
    }

    setState({ status: "loading" });

    fetchCampaignReader(currentToken)
      .then((result) => {
        if (!alive) return;

        if (result === "unavailable") {
          setState({ status: "unavailable" });
          return;
        }

        setState({
          status: "ready",
          data: result,
        });
      })
      .catch(() => {
        if (alive) {
          setState({ status: "error" });
        }
      });

    return () => {
      alive = false;
    };
  }, [attempt]);

  useEffect(() => {
    const onHashChange = () => {
      token.current =
        campaignReaderTokenFromLocation(window.location);
      setAttempt((value) => value + 1);
    };

    window.addEventListener("hashchange", onHashChange);

    return () => {
      window.removeEventListener(
        "hashchange",
        onHashChange,
      );
    };
  }, []);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  const quota = useMemo(() => {
    if (
      state.status !== "ready" ||
      state.data.totalInstallments <= 0
    ) {
      return "";
    }

    return (
      "Cuota " +
      state.data.currentInstallment +
      " de " +
      state.data.totalInstallments
    );
  }, [state]);

  if (state.status === "loading") {
    return (
      <main className={styles.shell}>
        <div className={styles.stateCard}>
          Cargando aportes…
        </div>
      </main>
    );
  }

  if (state.status === "unavailable") {
    return (
      <main className={styles.shell}>
        <div className={styles.stateCard}>
          <p className={styles.eyebrow}>
            CASA DE SALVACIÓN
          </p>
          <h1>Enlace no disponible</h1>
          <p>
            El enlace puede haber vencido o haber sido
            reemplazado.
          </p>
        </div>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className={styles.shell}>
        <div className={styles.stateCard}>
          <p className={styles.eyebrow}>
            CASA DE SALVACIÓN
          </p>
          <h1>No pudimos cargar los aportes</h1>
          <button
            type="button"
            className={styles.retry}
            onClick={retry}
          >
            Reintentar
          </button>
        </div>
      </main>
    );
  }

  const data = state.data;
  const pendingAmount = data.items
    .filter((item) => item.status === "pending")
    .reduce((sum, item) => sum + item.amount, 0);
  const progress =
    data.goalAmount > 0
      ? Math.min(
          100,
          Math.max(
            0,
            (data.verifiedAmount / data.goalAmount) * 100,
          ),
        )
      : 0;

  return (
    <main className={styles.shell}>
      <header className={styles.brand}>
        <div className={styles.logo}>CDS</div>
        <div>
          <strong>Casa de Salvación</strong>
          <span>Vista de campaña · solo lectura</span>
        </div>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>
            VISTA LECTOR
          </p>
          <h1>{data.title}</h1>
          {quota && <p className={styles.quota}>{quota}</p>}
        </div>

        <div className={styles.progressBlock}>
          <div className={styles.progressHeading}>
            <div>
              <span>Avance de la campaña</span>
              <strong>
                {progress.toFixed(1).replace(".0", "")}%
              </strong>
            </div>
            <small>
              {clp(data.verifiedAmount)} de {clp(data.goalAmount)}
            </small>
          </div>

          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
          >
            <span style={{ width: progress + "%" }} />
          </div>
        </div>

        <div className={styles.metrics}>
          <div>
            <span>Verificado</span>
            <strong>{clp(data.verifiedAmount)}</strong>
          </div>
          <div>
            <span>Pendiente registrado</span>
            <strong>{clp(pendingAmount)}</strong>
          </div>
          <div>
            <span>Aportes verificados</span>
            <strong>{data.verifiedCount}</strong>
          </div>
          <div>
            <span>Por revisar</span>
            <strong>{data.pendingCount}</strong>
          </div>
        </div>
      </section>

      <section className={styles.listCard}>
        <div className={styles.listHeading}>
          <div>
            <p className={styles.eyebrow}>
              APORTES REGISTRADOS
            </p>
            <h2>Personas y montos</h2>
          </div>
          <span>{data.items.length}</span>
        </div>

        {data.items.length ? (
          <div className={styles.table}>
            <div className={styles.tableHead}>
              <span>Nombre</span>
              <span>Estado</span>
              <span>Fecha</span>
              <span>Monto</span>
            </div>

            {data.items.map((item) => (
              <div className={styles.row} key={item.id}>
                <div className={styles.person}>
                  <strong>{item.name}</strong>
                  <small>{compactDate(item.date)}</small>
                </div>

                <span
                  className={
                    item.status === "verified"
                      ? styles.verified
                      : styles.pending
                  }
                >
                  {item.status === "verified"
                    ? "Verificado"
                    : "Pendiente"}
                </span>

                <span className={styles.date}>
                  {compactDate(item.date)}
                </span>

                <strong className={styles.amount}>
                  {clp(item.amount)}
                </strong>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            Todavía no hay aportes registrados.
          </div>
        )}
      </section>

      <footer className={styles.footer}>
        Este enlace es de solo lectura. No permite registrar,
        editar ni eliminar aportes.
      </footer>
    </main>
  );
}
