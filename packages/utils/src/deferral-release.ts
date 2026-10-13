// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Which Planned deferral rows a credit releases. A contract cancellation credit
// memo takes back revenue that has not been earned yet, so it removes the
// latest Planned rows first (the cancelled days are at the end of the period)
// and only what no Planned row still holds comes out of Sales — that part was
// already recognized. Pure, so the memo posting and its tests agree.
// Plan: `.ai/plans/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part III (decision 4, Task 14)

import { equals, round } from "@carbon/database/precision";

export type DeferralRow = {
  id: string;
  periodStart: string;
  amount: number;
  status: "Planned" | "Posted";
};

export type DeferralRelease = {
  /** Planned rows released in full. */
  deleteIds: string[];
  /** Planned rows released in part, with the amount each keeps. */
  reduce: { id: string; amount: number }[];
  /** What no Planned row held: already recognized, so it reverses Sales. */
  fromRevenue: number;
};

/**
 * Releases `amount` (base currency) from the Planned rows, latest
 * `periodStart` first. A row is deleted while it fits in what remains, the
 * next one is reduced by the rest, and whatever the Planned rows cannot cover
 * is `fromRevenue`. Posted rows are never touched — their revenue is already
 * recognized. Dates are `YYYY-MM-DD`, so string order is chronological.
 */
export function releaseDeferral(
  rows: DeferralRow[],
  amount: number
): DeferralRelease {
  const planned = rows
    .filter((row) => row.status === "Planned" && row.amount > 0)
    .sort((a, b) =>
      a.periodStart === b.periodStart
        ? b.id.localeCompare(a.id)
        : b.periodStart.localeCompare(a.periodStart)
    );

  const deleteIds: string[] = [];
  const reduce: { id: string; amount: number }[] = [];
  let remaining = Math.max(0, round(amount));

  for (const row of planned) {
    if (remaining <= 0 || equals(remaining, 0)) break;
    if (row.amount < remaining || equals(row.amount, remaining)) {
      deleteIds.push(row.id);
      remaining = round(remaining - row.amount);
    } else {
      reduce.push({ id: row.id, amount: round(row.amount - remaining) });
      remaining = 0;
    }
  }

  return {
    deleteIds,
    reduce,
    fromRevenue: remaining > 0 && !equals(remaining, 0) ? remaining : 0
  };
}
