// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// CLIN numbers and ACRN funding on a customer contract line (DFARS 204.71).
// Pure, so the funding service, the invoice and their tests agree.
// Spec: `.ai/specs/implemented/2026-10-09-government-contracting.md` (Phase 5a)

import { round } from "@carbon/database/precision";

export type LineItemNumberType = "CLIN" | "Priced SLIN" | "Informational SLIN";

const LINE_ITEM_NUMBER = /^([0-9]{4})([A-Z]{2}|[0-9]{2})?$/;

/**
 * Reads a contract line item number. `0001` is a CLIN, `0001AA` a separately
 * priced SLIN, `000101` an informational SLIN. Any other text gives null.
 */
export function parseLineItemNumber(
  value: string
): { clin: string; suffix: string | null; type: LineItemNumberType } | null {
  const match = LINE_ITEM_NUMBER.exec(value);
  if (!match) return null;
  const clin = match[1]!;
  const suffix = match[2] ?? null;
  if (suffix === null) return { clin, suffix, type: "CLIN" };
  return {
    clin,
    suffix,
    type: /^[0-9]{2}$/.test(suffix) ? "Informational SLIN" : "Priced SLIN"
  };
}

/** A line's funding: Σ funded cost, and Σ (funded cost + funded fee). */
export function sumFunding(rows: { fundedCost: number; fundedFee: number }[]): {
  fundedCost: number;
  fundedAmount: number;
} {
  let fundedCost = 0;
  let fundedAmount = 0;
  for (const row of rows) {
    fundedCost += row.fundedCost;
    fundedAmount += row.fundedCost + row.fundedFee;
  }
  return { fundedCost: round(fundedCost), fundedAmount: round(fundedAmount) };
}

/**
 * Allocates an invoice amount to a line's ACRNs, oldest funds first
 * (PGI 204.7108).
 *
 * - A positive amount fills each ACRN up to its remainder (funded − billed,
 *   at least 0), in order of first funding date, then ACRN.
 * - A negative amount (a credit) comes back from the newest ACRN first, up to
 *   what each has billed.
 *
 * What no ACRN takes is returned as `unallocated`. ACRNs that take nothing
 * are left out of `allocations`.
 */
export function allocateToAcrns(
  amount: number,
  acrns: {
    acrn: string;
    firstFundedDate: string;
    funded: number;
    billed: number;
  }[]
): { allocations: { acrn: string; amount: number }[]; unallocated: number } {
  const oldestFirst = [...acrns].sort(
    (a, b) =>
      a.firstFundedDate.localeCompare(b.firstFundedDate) ||
      a.acrn.localeCompare(b.acrn)
  );
  const allocations: { acrn: string; amount: number }[] = [];

  if (amount > 0) {
    let left = round(amount);
    for (const row of oldestFirst) {
      if (left <= 0) break;
      const take = round(Math.min(Math.max(0, row.funded - row.billed), left));
      if (take <= 0) continue;
      allocations.push({ acrn: row.acrn, amount: take });
      left = round(left - take);
    }
    return { allocations, unallocated: left };
  }

  if (amount < 0) {
    let left = round(-amount);
    for (const row of oldestFirst.reverse()) {
      if (left <= 0) break;
      const take = round(Math.min(Math.max(0, row.billed), left));
      if (take <= 0) continue;
      allocations.push({ acrn: row.acrn, amount: -take });
      left = round(left - take);
    }
    return { allocations, unallocated: left === 0 ? 0 : -left };
  }

  return { allocations, unallocated: 0 };
}
