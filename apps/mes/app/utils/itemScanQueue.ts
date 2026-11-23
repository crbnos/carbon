// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { round } from "@carbon/utils";

/** Scans of one item into one unit that wait to be issued together. */
export type QueuedItemScan = {
  itemId: string;
  /** The unit held when the sticker was scanned; the issue goes into it. */
  parentTrackedEntityId: string | null;
  /** How many times the sticker was scanned. */
  pieces: number;
  /** A scan was made with the Issue dialog open: close it once issued. */
  closeDialog: boolean;
};

/**
 * Adds a scan to the queue. Scans of an item that already waits for the same
 * unit are counted on its entry, so they go to the server as one issue of
 * that many pieces.
 */
export function enqueueItemScan(
  queue: QueuedItemScan[],
  scan: {
    itemId: string;
    parentTrackedEntityId: string | null;
    closeDialog: boolean;
  }
): QueuedItemScan[] {
  const same = (entry: QueuedItemScan) =>
    entry.itemId === scan.itemId &&
    entry.parentTrackedEntityId === scan.parentTrackedEntityId;
  if (!queue.some(same)) {
    return [...queue, { ...scan, pieces: 1 }];
  }
  return queue.map((entry) =>
    same(entry)
      ? {
          ...entry,
          pieces: entry.pieces + 1,
          closeDialog: entry.closeDialog || scan.closeDialog
        }
      : entry
  );
}

/**
 * The queue after the server refused an issue. Scans of the refused item go:
 * they would be refused too. A refusal the operator must settle in the Issue
 * dialog (`needsOperator`) empties the queue, so nothing is issued under a
 * dialog the operator has not read. Scans of other items stay.
 */
export function afterItemScanRefusal(
  queue: QueuedItemScan[],
  refused: { itemId: string; needsOperator: boolean }
): QueuedItemScan[] {
  if (refused.needsOperator) return [];
  return queue.filter((entry) => entry.itemId !== refused.itemId);
}

/** How many scanned pieces wait in the queue. */
export function queuedPieces(queue: QueuedItemScan[]): number {
  return round(queue.reduce((sum, entry) => sum + entry.pieces, 0));
}

/**
 * The queue once the held unit changes. Scans made for another unit are
 * dropped, never issued into the new one; `dropped` is how many pieces went.
 */
export function keepScansForUnit(
  queue: QueuedItemScan[],
  heldUnitId: string | null
): { queue: QueuedItemScan[]; dropped: number } {
  const kept = queue.filter(
    (entry) => entry.parentTrackedEntityId === heldUnitId
  );
  return {
    queue: kept,
    dropped: round(queuedPieces(queue) - queuedPieces(kept))
  };
}

/**
 * Whether a refused scan may open the Issue dialog: only while a unit is held
 * where one must be, and only on the unit the scan was made for.
 */
export function canChooseInDialog({
  unitRequired,
  scannedForUnitId,
  heldUnitId
}: {
  /** The operation needs a held unit and has none. */
  unitRequired: boolean;
  scannedForUnitId: string | null;
  heldUnitId: string | null;
}): boolean {
  return !unitRequired && scannedForUnitId === heldUnitId;
}
