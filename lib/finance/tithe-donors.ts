import { isoDate } from "./formatters";
import type { FinanceTransaction, TitheAttribution, TitheProfile } from "./types";

export interface TitheDonorRow {
  profile: TitheProfile;
  contributions: number;
  total: number;
  latestDate: TitheAttribution["date"];
}

export interface TitheDonorReport {
  donors: TitheDonorRow[];
  excluded: number;
}

/** Only linked, active tithe movements with an existing person or family count. */
export function titheDonorReport(
  period: string,
  attributions: TitheAttribution[],
  transactions: FinanceTransaction[],
  profiles: TitheProfile[],
): TitheDonorReport {
  const transactionById = new Map(transactions.map((t) => [t.id, t]));
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const rows = new Map<string, TitheDonorRow>();
  const seenTransactions = new Set<string>();
  let excluded = 0;

  for (const attribution of attributions) {
    if (attribution.status !== "active") continue;
    const transaction = transactionById.get(attribution.id);
    const profile = profileById.get(attribution.profileId);
    const date = isoDate(attribution.date);
    const matches =
      !seenTransactions.has(attribution.transactionId) &&
      attribution.transactionId === attribution.id &&
      attribution.period === period &&
      date.startsWith(`${period}-`) &&
      Number.isSafeInteger(attribution.amount) &&
      attribution.amount > 0 &&
      transaction?.source === "tithe" &&
      transaction.type === "income" &&
      transaction.category === "Diezmos" &&
      transaction.status === "active" &&
      transaction.period === period &&
      transaction.amount === attribution.amount &&
      transaction.date?.isEqual?.(attribution.date) === true &&
      (profile?.type === "person" || profile?.type === "family");
    if (!matches || !profile) {
      excluded++;
      continue;
    }
    seenTransactions.add(attribution.transactionId);
    const row = rows.get(profile.id);
    if (row) {
      if (!Number.isSafeInteger(row.total + attribution.amount)) {
        excluded++;
        continue;
      }
      row.contributions++;
      row.total += attribution.amount;
      if (attribution.date.toMillis() > row.latestDate.toMillis())
        row.latestDate = attribution.date;
    } else {
      rows.set(profile.id, {
        profile,
        contributions: 1,
        total: attribution.amount,
        latestDate: attribution.date,
      });
    }
  }
  return {
    donors: [...rows.values()].sort((a, b) =>
      a.profile.displayName.localeCompare(b.profile.displayName, "es-CL"),
    ),
    excluded,
  };
}
