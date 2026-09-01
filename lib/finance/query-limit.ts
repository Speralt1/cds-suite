import { limit, type QueryConstraint } from "firebase/firestore";
import { MAX_PERIOD_RECORDS } from "./constants";

export function capQueryLimit(requested: number) {
  if (!Number.isFinite(requested)) return MAX_PERIOD_RECORDS;
  return Math.max(1, Math.min(MAX_PERIOD_RECORDS, Math.floor(requested)));
}

export function safeLimit(requested: number): QueryConstraint {
  return limit(capQueryLimit(requested));
}
