// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/content/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));

import {
  type ChartedLineAction,
  type OpenPurchaseOrder,
  openOrdersForChart
} from "../app/modules/purchasing/ui/Planning/open-orders-chart";

const line = (overrides: Partial<OpenPurchaseOrder> = {}): OpenPurchaseOrder => ({
  existingId: "po1",
  existingLineId: "pol1",
  existingReadableId: "PO000001",
  existingQuantity: 40,
  existingStatus: "Planned",
  startDate: "2026-11-02",
  dueDate: "2026-11-20",
  quantity: 4,
  loadedQuantity: 4,
  receivedOffset: 0,
  periodId: "w3",
  supplierId: "sup1",
  conversionFactor: 10,
  ...overrides
});

const increase = (
  overrides: Partial<ChartedLineAction> = {}
): ChartedLineAction => ({
  type: "Increase",
  status: "Open",
  periodId: "w3",
  suggestedQuantity: 60,
  purchaseOrderLineId: "pol1",
  ...overrides
});

describe("openOrdersForChart", () => {
  it("charts a line in inventory units, without its drawer-only fields", () => {
    expect(openOrdersForChart([line()], [])).toEqual([
      {
        existingId: "po1",
        existingLineId: "pol1",
        existingReadableId: "PO000001",
        existingQuantity: 40,
        existingStatus: "Planned",
        startDate: "2026-11-02",
        dueDate: "2026-11-20",
        quantity: 40,
        periodId: "w3",
        supplierId: "sup1"
      }
    ]);
  });

  it("leaves out what a line showing its ordered total has received", () => {
    const [charted] = openOrdersForChart(
      [line({ quantity: 6, loadedQuantity: 6, receivedOffset: 2 })],
      []
    );
    expect(charted.quantity).toBe(40);
  });

  it("charts a line at its open Increase", () => {
    const [charted] = openOrdersForChart([line()], [increase()]);
    expect(charted.quantity).toBe(60);
  });

  it("charts a line the planner edited at the edit, not the Increase", () => {
    const [charted] = openOrdersForChart([line({ quantity: 5 })], [increase()]);
    expect(charted.quantity).toBe(50);
  });

  it("ignores an Increase on another line, and a dismissed one", () => {
    const charted = openOrdersForChart(
      [line()],
      [
        increase({ purchaseOrderLineId: "pol2", suggestedQuantity: 90 }),
        increase({ status: "Dismissed", suggestedQuantity: 80 })
      ]
    );
    expect(charted.map((order) => order.quantity)).toEqual([40]);
  });
});
