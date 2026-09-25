/**
 * scripts/lib/payouts-probe-core.mjs
 *
 * Thin re-export over functions/sumup/payouts-core.js (CommonJS).
 *
 * Slice 3a moved the pure basis/linking/aggregation logic G9 proved against
 * real SumUp data into functions/sumup/payouts-core.js, so the write-path
 * ingestion (functions/sumup/engine.js) and this read-only probe script
 * share exactly one implementation instead of two copies drifting apart.
 * See docs/mission-2026/15-slice3a-sumup-fees-deposits-spec.md §Ingesta
 * "Reutiliza la lógica pura de scripts/lib/payouts-probe-core.mjs [...] hay
 * que moverla a functions/sumup/payouts-core.js en CommonJS, y la sonda la
 * importa desde ahí."
 */

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const payoutsCore = require(resolve(__dirname, "../../functions/sumup/payouts-core.js"));

export const {
  PAYOUT_TYPE,
  AMOUNT_TOLERANCE,
  MIN_VOTES_FOR_BASIS,
  maskApiKey,
  detectBasisVote,
  aggregateBasisVotes,
  buildTransactionIndex,
  linkPayoutRow,
  computeIdUniqueness,
  tallyByField,
  aggregateByDay,
  aggregateByPayout,
  computeAccountTotals,
  buildDepositsList,
} = payoutsCore;
