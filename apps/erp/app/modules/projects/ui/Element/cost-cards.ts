// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PlanLineType } from "./plan-rows";

/** The type filter of the Estimated and Actual cards. */
export type CostTypeFilter = "all" | PlanLineType;

export type EstimatedSort = "plan" | "amount" | "remaining" | "over";

export type ActualSort = "newest" | "oldest" | "amount";

/**
 * The key an expense finds its cost line by: the description, trimmed and in
 * lower case, as `getElementTimeAndMaterials` groups the expenses
 * (`LOWER(BTRIM(description))`).
 */
export function costDescriptionKey(description: string) {
  return description.trim().toLowerCase();
}

/**
 * The ids of the plan lines that own their key: the oldest line (by
 * `createdAt`, then `id`) of each key. `post-project-issue` raises the
 * oldest line's issued quantity for an item, so the oldest line takes the
 * key's whole actual, and a second line with the same key shows none.
 */
export function keyOwners<T extends { id: string; createdAt: string | null }>(
  lines: T[],
  keyOf: (line: T) => string
): Set<string> {
  const oldest = new Map<string, T>();
  for (const line of lines) {
    const key = keyOf(line);
    const current = oldest.get(key);
    if (!current || isOlder(line, current)) oldest.set(key, line);
  }
  return new Set([...oldest.values()].map((line) => line.id));
}

function isOlder(
  a: { id: string; createdAt: string | null },
  b: { id: string; createdAt: string | null }
) {
  if (a.createdAt !== b.createdAt) {
    if (a.createdAt === null) return false;
    if (b.createdAt === null) return true;
    return a.createdAt < b.createdAt;
  }
  return a.id < b.id;
}

/**
 * The card type of a project ledger row: material and its price variance
 * are Material, labor is Labor, and everything else (machine, overhead,
 * outside processing, purchased services, other direct cost, burden) is
 * Cost.
 */
export function ledgerLineType(costType: string): PlanLineType {
  if (costType === "Material" || costType === "Material Variance") {
    return "material";
  }
  if (costType === "Labor") return "labor";
  return "cost";
}

/** True when every word of the query is in one of the texts. */
export function matchesSearch(
  texts: (string | null | undefined)[],
  query: string
) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = texts
    .filter((text): text is string => Boolean(text))
    .join(" ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

type PlanFigures = {
  plannedQuantity: number | null;
  actualQuantity: number | null;
  plannedAmount: number | null;
  actualAmount: number;
};

/**
 * Over the estimate: more charged than planned, in money when the line has
 * a planned amount, else in quantity.
 */
export function isOverBudget(card: PlanFigures) {
  if (card.plannedAmount !== null) {
    return card.actualAmount > card.plannedAmount + 1e-6;
  }
  if (card.plannedQuantity !== null && card.actualQuantity !== null) {
    return card.actualQuantity > card.plannedQuantity + 1e-6;
  }
  return false;
}

/**
 * How far along a line is, 0 to 1: the quantity charged against the
 * quantity planned when both exist (materials, labor), else the money.
 */
export function planProgress(card: PlanFigures) {
  const ratio =
    card.plannedQuantity && card.actualQuantity !== null
      ? card.actualQuantity / card.plannedQuantity
      : card.plannedAmount
        ? card.actualAmount / card.plannedAmount
        : 0;
  return Math.min(1, Math.max(0, ratio));
}

/**
 * The Estimated cards in the chosen order. `plan` keeps the order they come
 * in (the plan's own: materials, labor, costs); `amount` is the largest
 * estimate first; `remaining` the most still to charge first; `over` puts
 * the lines over their estimate first, each group in plan order. Ties keep
 * plan order.
 */
export function sortPlanCards<T extends PlanFigures>(
  cards: T[],
  sort: EstimatedSort
): T[] {
  const indexed = cards.map((card, index) => ({ card, index }));
  const remaining = (card: T) => (card.plannedAmount ?? 0) - card.actualAmount;
  const by = (value: (card: T) => number) =>
    indexed
      .sort((a, b) => value(b.card) - value(a.card) || a.index - b.index)
      .map(({ card }) => card);
  switch (sort) {
    case "plan":
      return cards;
    case "amount":
      return by((card) => card.plannedAmount ?? 0);
    case "remaining":
      return by(remaining);
    case "over":
      return by((card) => (isOverBudget(card) ? 1 : 0));
  }
}

/**
 * The Actual cards in the chosen order: by date (`newest` keeps the order
 * they come in, which is newest first) or the largest amount first.
 */
export function sortActualCards<T extends { date: string; amount: number }>(
  cards: T[],
  sort: ActualSort
): T[] {
  const indexed = cards.map((card, index) => ({ card, index }));
  switch (sort) {
    case "newest":
      return cards;
    case "oldest":
      return indexed
        .sort(
          (a, b) =>
            (a.card.date < b.card.date
              ? -1
              : a.card.date > b.card.date
                ? 1
                : 0) || b.index - a.index
        )
        .map(({ card }) => card);
    case "amount":
      return indexed
        .sort(
          (a, b) =>
            Math.abs(b.card.amount) - Math.abs(a.card.amount) ||
            a.index - b.index
        )
        .map(({ card }) => card);
  }
}

type JobRow = {
  id: string;
  jobId: string | null;
  jobReadableId: string | null;
  amount: number;
  postingDate: string;
};

/** One Actual card: a ledger row, or every row of one job folded together. */
export type FoldedLedgerEntry<T extends JobRow> =
  | { kind: "row"; key: string; row: T }
  | {
      kind: "job";
      key: string;
      jobId: string;
      jobReadableId: string | null;
      /** The sum of the job's rows. */
      amount: number;
      /** The newest row's posting date. */
      date: string;
      rows: T[];
    };

/**
 * The Actual tab's entries: a job is one entry with the sum of its rows, in
 * the place of its newest row (the rows come newest first). Rows with no job
 * stay one entry each. The job holds the detail; the element shows its total.
 */
export function foldJobRows<T extends JobRow>(
  rows: T[]
): FoldedLedgerEntry<T>[] {
  const entries: FoldedLedgerEntry<T>[] = [];
  const jobs = new Map<
    string,
    Extract<FoldedLedgerEntry<T>, { kind: "job" }>
  >();
  for (const row of rows) {
    if (!row.jobId) {
      entries.push({ kind: "row", key: row.id, row });
      continue;
    }
    const job = jobs.get(row.jobId);
    if (job) {
      job.amount += row.amount;
      job.rows.push(row);
      continue;
    }
    const entry = {
      kind: "job" as const,
      key: `job:${row.jobId}`,
      jobId: row.jobId,
      jobReadableId: row.jobReadableId,
      amount: row.amount,
      date: row.postingDate,
      rows: [row]
    };
    jobs.set(row.jobId, entry);
    entries.push(entry);
  }
  return entries;
}
