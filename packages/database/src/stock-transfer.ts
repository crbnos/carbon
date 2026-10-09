// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure stock-transfer helpers shared by the ERP's interactive writer
// (`insertStockTransfer`) and the `kanban-replenish` server function, so both
// build transfer lines and kanban notes the same way.

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
 * split into N lines of quantity 1. A line with a non-integer quantity is
 * dropped, as `insertStockTransfer` always did. Every other line is kept.
 */
export function expandSerialTrackedLines<T extends StockTransferLineDraft>(
  lines: T[]
): T[] {
  return lines.reduce<T[]>((acc, line) => {
    if (line.quantity && !Number.isInteger(line.quantity)) {
      return acc;
    }
    if (line.requiresSerialTracking && line.quantity && line.quantity > 1) {
      acc.push(
        ...Array.from({ length: line.quantity }, () => ({
          ...line,
          quantity: 1
        }))
      );
    } else {
      acc.push(line);
    }
    return acc;
  }, []);
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
