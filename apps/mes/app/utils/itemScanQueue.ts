// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { round } from "@carbon/utils";

/** Scans of one item that wait to be issued together. */
export type QueuedItemScan = {
  itemId: string;
  /** How many times the sticker was scanned. */
  pieces: number;
  /** A scan was made with the Issue dialog open: close it once issued. */
  closeDialog: boolean;
};

/**
 * Adds a scan to the queue. Scans of an item that already waits are counted
 * on its entry, so they go to the server as one issue of that many pieces.
 */
export function enqueueItemScan(
  queue: QueuedItemScan[],
  scan: { itemId: string; closeDialog: boolean }
): QueuedItemScan[] {
  if (!queue.some((entry) => entry.itemId === scan.itemId)) {
    return [...queue, { ...scan, pieces: 1 }];
  }
  return queue.map((entry) =>
    entry.itemId === scan.itemId
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
