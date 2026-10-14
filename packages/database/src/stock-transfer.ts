// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure stock-transfer helpers shared by the ERP's interactive writer
// (`insertStockTransfer`) and the `kanban-replenish` server function, so both
// build transfer lines and kanban notes the same way.

import { RoundingMode, round } from "./precision.ts";

export type StockTransferLineDraft = {
  itemId: string;
  fromStorageUnitId?: string | null;
  toStorageUnitId?: string | null;
  quantity?: number;
  requiresSerialTracking?: boolean;
  requiresBatchTracking?: boolean;
};

/**
 * A serial-tracked line moves one serial per line, so a line of quantity N is
 * split into N lines of quantity 1. A serial cannot be split, so a
 * serial-tracked line with a fractional quantity is refused with an error.
 * Every other line is kept as it is, fractional quantities included (a batch
 * or untracked item can move 2.5 kg).
 */
export function expandSerialTrackedLines<T extends StockTransferLineDraft>(
  lines: T[]
): T[] {
  return lines.flatMap((line) => {
    if (!line.requiresSerialTracking || !line.quantity) return [line];
    if (!Number.isInteger(line.quantity)) {
      throw new Error(
        `A serial-tracked line needs a whole quantity, not ${String(line.quantity)}`
      );
    }
    if (line.quantity === 1) return [line];
    return Array.from({ length: line.quantity }, () => ({
      ...line,
      quantity: 1
    }));
  });
}

/**
 * The level signal fires strictly below the level: a To storage unit that
 * holds exactly the level is full enough.
 */
export function isBelowReplenishmentLevel(
  projectedQuantity: number,
  replenishmentLevel: number
): boolean {
  return projectedQuantity < replenishmentLevel;
}

/**
 * How much one level signal moves: the fewest whole kanban quantities that
 * bring the projected quantity back to the level. A level of 20 with a
 * quantity of 5 and nothing projected moves 20 in one transfer, not 5 now and
 * 5 more on each later signal. Returns 0 when nothing is below the level.
 */
export function levelReplenishmentQuantity(
  projectedQuantity: number,
  replenishmentLevel: number,
  quantity: number
): number {
  if (quantity <= 0) return 0;
  if (!isBelowReplenishmentLevel(projectedQuantity, replenishmentLevel)) {
    return 0;
  }
  // Round to the internal scale first, so float noise in the division
  // (5.000000001) does not add a whole extra kanban quantity.
  const quantities = round(
    round((replenishmentLevel - projectedQuantity) / quantity),
    0,
    RoundingMode.Up
  );
  return quantities * quantity;
}

export const KANBAN_REPLENISHMENT_NOTE_PREFIX = "Kanban replenishment";

export type KanbanReplenishmentNoteInput = {
  itemReadableId: string;
  fromStorageUnitName: string;
  toStorageUnitName: string;
  quantity: number;
  unitOfMeasureCode: string | null;
  signal:
    | { type: "scan"; userName: string }
    | {
        type: "level";
        replenishmentLevel: number;
        projectedQuantity: number;
      };
};

export type KanbanReplenishmentNote = {
  type: "doc";
  content: [
    {
      type: "paragraph";
      content: [{ type: "text"; text: string }];
    }
  ];
};

/**
 * The Tiptap document written to `stockTransfer.notes`. It tells a reader
 * where the transfer came from; the durable origin is `stockTransfer.kanbanId`.
 */
export function kanbanReplenishmentNote(
  input: KanbanReplenishmentNoteInput
): KanbanReplenishmentNote {
  const unit = input.unitOfMeasureCode ? ` ${input.unitOfMeasureCode}` : "";
  const signal =
    input.signal.type === "scan"
      ? `scan by ${input.signal.userName}`
      : `level ${String(input.signal.replenishmentLevel)} (projected ${String(input.signal.projectedQuantity)})`;
  const text = `${KANBAN_REPLENISHMENT_NOTE_PREFIX} — ${input.itemReadableId}, ${input.fromStorageUnitName} → ${input.toStorageUnitName}, ${String(input.quantity)}${unit}. Signal: ${signal}.`;

  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }]
  };
}
