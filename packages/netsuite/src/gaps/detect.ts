import { GAP_CATALOG } from "./catalog.ts";
import type { DetectedGap } from "./types.ts";

/**
 * What extraction observed about the account, keyed by gap id.
 *
 * Counting is opt-in per gap: extraction runs a cheap `COUNT(*)` for the gaps
 * that are countable (open invoices, work orders, lot-tracked items) and says
 * nothing about the rest.
 */
export type GapSignals = {
  /** Gap id → how many source records it leaves behind. A 0 REMOVES the gap from the report. */
  counts?: Record<string, number>;
  /** Gap id → specifics worth naming, e.g. the item types that were skipped. */
  examples?: Record<string, string[]>;
};

/**
 * The gaps that apply to one account, worst first.
 *
 * A gap is reported unless extraction PROVED it does not apply by counting zero
 * source records for it. Silence is not proof: a gap extraction could not probe
 * (a feature the role cannot read, a record type the account does not expose)
 * has no count and is still shown, because "we could not check" and "there is
 * nothing there" must not look the same to somebody deciding whether to cut over.
 */
export function detectGaps(signals: GapSignals = {}): DetectedGap[] {
  const counts = signals.counts ?? {};
  const examples = signals.examples ?? {};

  const severityRank = { high: 0, medium: 1, low: 2 } as const;

  return GAP_CATALOG.filter((gap) => counts[gap.id] !== 0)
    .map((gap) => ({
      ...gap,
      count: counts[gap.id] ?? null,
      examples: examples[gap.id] ?? []
    }))
    .sort((a, b) => {
      const bySeverity = severityRank[a.severity] - severityRank[b.severity];
      if (bySeverity !== 0) return bySeverity;
      // Within a severity, the ones that cost this customer the most records first;
      // an uncountable gap sorts after countable ones so the report leads with numbers.
      const aCount = a.count ?? -1;
      const bCount = b.count ?? -1;
      if (aCount !== bCount) return bCount - aCount;
      return a.id.localeCompare(b.id);
    });
}

/** A one-line summary for the migration's completion notice. */
export function summarizeGaps(gaps: DetectedGap[]): string {
  const high = gaps.filter((gap) => gap.severity === "high").length;
  if (gaps.length === 0) return "No known gaps apply to this account.";
  if (high === 0)
    return `${gaps.length} things were left behind — see the migration report.`;
  return `${gaps.length} things were left behind, ${high} of them significant — see the migration report.`;
}
