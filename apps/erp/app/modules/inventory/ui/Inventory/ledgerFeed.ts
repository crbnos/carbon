// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { round } from "@carbon/utils";
import type { ItemLedger } from "../../types";

export type RunningBalance = {
  /** On-hand before this entry; null when the feed has no anchor for it. */
  balanceBefore: number | null;
  /** On-hand after this entry; null when the feed has no anchor for it. */
  balanceAfter: number | null;
};

export type BalanceAnchor = {
  /** The entry the balance was measured right after. */
  entryNumber: number;
  balanceAfter: number;
};

type LedgerRow = {
  entryNumber: number;
  quantity: number;
  trackedEntityStatus?: string | null;
};

/**
 * What a ledger row moves the On Hand column by. A row whose tracked entity is
 * Rejected counts as zero, as it does in get_inventory_quantities.
 */
export function onHandDelta(row: LedgerRow) {
  return row.trackedEntityStatus === "Rejected" ? 0 : row.quantity;
}

/**
 * Stamp every row with the on-hand before and after it.
 *
 * `rows` is the feed's accumulated list — newest→oldest and contiguous by
 * `entryNumber`, which the keyset paging guarantees — and `anchor` is the one
 * balance the server measured (get_item_ledger_balance). Walking out from the
 * anchor in both directions prices every loaded page, so paging older or newer
 * never needs another query.
 *
 * Run this on the RAW rows, before collapsing transfer pairs or dropping Batch
 * Split rows: those hidden rows still move the balance one at a time.
 */
export function withRunningBalance<T extends LedgerRow>(
  rows: T[],
  anchor: BalanceAnchor | null
): (T & RunningBalance)[] {
  const anchorIndex = anchor
    ? rows.findIndex((row) => row.entryNumber === anchor.entryNumber)
    : -1;

  if (!anchor || anchorIndex === -1) {
    return rows.map((row) => ({
      ...row,
      balanceBefore: null,
      balanceAfter: null
    }));
  }

  const after = new Array<number>(rows.length);
  after[anchorIndex] = anchor.balanceAfter;
  // Older rows sit below: each one ends where the newer row above it began.
  for (let i = anchorIndex + 1; i < rows.length; i++) {
    after[i] = round(after[i - 1] - onHandDelta(rows[i - 1]));
  }
  // Newer rows sit above: each one ends its own quantity past the row below.
  for (let i = anchorIndex - 1; i >= 0; i--) {
    after[i] = round(after[i + 1] + onHandDelta(rows[i]));
  }

  return rows.map((row, i) => ({
    ...row,
    balanceBefore: round(after[i] - onHandDelta(row)),
    balanceAfter: after[i]
  }));
}

// A Direct Transfer writes two ledger rows in one transaction — the negative
// out of the source bin and the positive into the destination — so the feed
// renders the same move twice. Collapse each pair into the inbound row and hang
// the source bin off it.
//
// The pair is identified by document + item + tracked entity + `createdAt`:
// Postgres NOW() is transaction time, so both rows share it exactly. Keying on
// the timestamp keeps repeat picks of the same line as separate entries, and
// makes the merge idempotent, so it's safe to re-run over the accumulated list
// as infinite scroll appends pages.
//
// Rows carrying a running balance keep it across the merge: the collapsed entry
// spans both halves, from the older half's balance before to the newer half's
// balance after — so a move between two bins of one location reads as no change.
export type CollapsedItemLedger = ItemLedger &
  Partial<RunningBalance> & {
    transferFromStorageUnitName?: string | null;
  };

export function collapseTransferPairs<
  T extends ItemLedger & Partial<RunningBalance>
>(rows: T[]): (T & CollapsedItemLedger)[] {
  // Batch Split rows are internal net-zero bookkeeping — the Transfer/
  // Consumption rows tell the real story, so they never reach the feed.
  rows = rows.filter((row) => row.documentType !== "Batch Split");

  const pairKey = (row: ItemLedger) =>
    [row.documentId, row.itemId, row.trackedEntityId ?? "", row.createdAt].join(
      "|"
    );

  const outboundByKey = new Map<string, T>();
  for (const row of rows) {
    if (row.documentType !== "Direct Transfer" || row.quantity >= 0) continue;
    outboundByKey.set(pairKey(row), row);
  }

  return rows.reduce<(T & CollapsedItemLedger)[]>((acc, row) => {
    if (row.documentType !== "Direct Transfer") return [...acc, row];
    const outbound = outboundByKey.get(pairKey(row));
    // Drop the outbound half only when its inbound partner is present to
    // absorb it — otherwise (destination page not loaded yet) keep it, so a
    // transfer never vanishes from the feed.
    if (row.quantity < 0) {
      const hasInbound = rows.some(
        (r) =>
          r.documentType === "Direct Transfer" &&
          r.quantity > 0 &&
          pairKey(r) === pairKey(row)
      );
      return hasInbound ? acc : [...acc, row];
    }
    const [older, newer] =
      outbound && outbound.entryNumber > row.entryNumber
        ? [row, outbound]
        : [outbound ?? row, row];
    return [
      ...acc,
      {
        ...row,
        transferFromStorageUnitName: outbound?.storageUnit?.name ?? null,
        balanceBefore: older.balanceBefore,
        balanceAfter: newer.balanceAfter
      }
    ];
  }, []);
}
