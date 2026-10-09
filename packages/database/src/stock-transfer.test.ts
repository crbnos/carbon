// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  expandSerialTrackedLines,
  isBelowReplenishmentLevel,
  kanbanReplenishmentNote
} from "./stock-transfer.ts";

const line = {
  itemId: "item-1",
  fromStorageUnitId: "su-a",
  toStorageUnitId: "su-b"
};

it("splits a serial-tracked line into one line per serial", () => {
  const lines = expandSerialTrackedLines([
    { ...line, quantity: 3, requiresSerialTracking: true }
  ]);
  expect(lines).toHaveLength(3);
  expect(lines.every((l) => l.quantity === 1)).toBe(true);
});

it("keeps a batch-tracked line whole", () => {
  const lines = expandSerialTrackedLines([
    { ...line, quantity: 3, requiresBatchTracking: true }
  ]);
  expect(lines).toEqual([
    { ...line, quantity: 3, requiresBatchTracking: true }
  ]);
});

it("drops a line with a non-integer quantity", () => {
  expect(expandSerialTrackedLines([{ ...line, quantity: 2.5 }])).toEqual([]);
});

it("fires strictly below the replenishment level", () => {
  expect(isBelowReplenishmentLevel(10, 10)).toBe(false);
  expect(isBelowReplenishmentLevel(9, 10)).toBe(true);
});

const noteText = (note: ReturnType<typeof kanbanReplenishmentNote>) =>
  note.content[0].content[0].text;

it("writes the scan note", () => {
  const note = kanbanReplenishmentNote({
    itemReadableId: "MAT-KAPTON",
    fromStorageUnitName: "A1-L3",
    toStorageUnitName: "CleanRoom",
    quantity: 10,
    unitOfMeasureCode: "EA",
    signal: { type: "scan", userName: "Jane Doe" }
  });
  expect(note.type).toBe("doc");
  expect(noteText(note)).toBe(
    "Kanban replenishment — MAT-KAPTON, A1-L3 → CleanRoom, 10 EA. Signal: scan by Jane Doe."
  );
});

it("writes the level note", () => {
  const note = kanbanReplenishmentNote({
    itemReadableId: "MAT-KAPTON",
    fromStorageUnitName: "A1-L3",
    toStorageUnitName: "CleanRoom",
    quantity: 10,
    unitOfMeasureCode: "EA",
    signal: { type: "level", replenishmentLevel: 4, projectedQuantity: 3 }
  });
  expect(noteText(note)).toBe(
    "Kanban replenishment — MAT-KAPTON, A1-L3 → CleanRoom, 10 EA. Signal: level 4 (projected 3)."
  );
});

it("leaves out the unit when the item has none", () => {
  const note = kanbanReplenishmentNote({
    itemReadableId: "MAT-KAPTON",
    fromStorageUnitName: "A1-L3",
    toStorageUnitName: "CleanRoom",
    quantity: 10,
    unitOfMeasureCode: null,
    signal: { type: "level", replenishmentLevel: 4, projectedQuantity: 3 }
  });
  expect(noteText(note)).toBe(
    "Kanban replenishment — MAT-KAPTON, A1-L3 → CleanRoom, 10. Signal: level 4 (projected 3)."
  );
});
