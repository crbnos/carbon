// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  expandSerialTrackedLines,
  isBelowReplenishmentLevel,
  kanbanReplenishmentNote,
  levelReplenishmentQuantity
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

it("keeps an untracked or batch line with a fractional quantity", () => {
  expect(expandSerialTrackedLines([{ ...line, quantity: 2.5 }])).toEqual([
    { ...line, quantity: 2.5 }
  ]);
  expect(
    expandSerialTrackedLines([
      { ...line, quantity: 2.25, requiresBatchTracking: true }
    ])
  ).toEqual([{ ...line, quantity: 2.25, requiresBatchTracking: true }]);
});

it("refuses a serial-tracked line with a fractional quantity", () => {
  expect(() =>
    expandSerialTrackedLines([
      { ...line, quantity: 2.5, requiresSerialTracking: true }
    ])
  ).toThrow("A serial-tracked line needs a whole quantity, not 2.5");
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

it("moves the fewest whole kanban quantities that reach the level", () => {
  // level 20, quantity 5, nothing projected: four quantities in one signal
  expect(levelReplenishmentQuantity(0, 20, 5)).toBe(20);
  // 15 projected: one quantity reaches the level exactly
  expect(levelReplenishmentQuantity(15, 20, 5)).toBe(5);
  // 9 projected, level 10: one quantity, even though it overshoots
  expect(levelReplenishmentQuantity(9, 10, 5)).toBe(5);
  // 1 projected, level 30, quantity 10: three quantities
  expect(levelReplenishmentQuantity(1, 30, 10)).toBe(30);
});

it("moves nothing at or above the level", () => {
  expect(levelReplenishmentQuantity(20, 20, 5)).toBe(0);
  expect(levelReplenishmentQuantity(25, 20, 5)).toBe(0);
});

it("ignores float noise in the division", () => {
  expect(levelReplenishmentQuantity(0.1 + 0.2, 10.3, 5)).toBe(10);
});
