// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

// The service's imports reach the glossary, whose `msg` macro only runs compiled.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })
}));
const { evaluate } = vi.hoisted(() => ({
  // Storage rules: the violations each surface reports.
  evaluate: vi.fn()
}));
vi.mock("@carbon/ee/rules.server", async () => ({
  // The real block / dedupe rules; only the rule reads are stubbed.
  ...(await vi.importActual<typeof import("@carbon/ee/rules.server")>(
    "@carbon/ee/rules.server"
  )),
  evaluateLinesForSurface: evaluate,
  evaluateSalesRuleLines: vi.fn(),
  resolveSalesOrderShipTo: vi.fn()
}));
// The packing slip renders a PDF through module barrels nothing here needs.
vi.mock("../app/modules/inventory/packing-slip.pdf", () => ({
  renderPackingSlip: vi.fn()
}));
vi.mock("../app/modules/sales/sales.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  recordSalesRuleOutcome: vi.fn()
}));
vi.mock("../app/modules/inventory/inventory.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getInventoryCount: vi.fn(),
  // The adjustment posting: its database test is post-inventory-adjustment.
  postInventoryAdjustment: vi.fn(),
  postInventoryCount: vi.fn(),
  // Reads the item's tracking type; the serial cap has its own database test.
  serialQuantityRefusal: vi.fn(async () => null)
}));

import { InvalidInputError, ServerFnError } from "@carbon/api/errors";
import {
  getInventoryCount,
  pickRefusal,
  postInventoryAdjustment,
  postInventoryCount as postCount
} from "../app/modules/inventory/inventory.service";
import {
  adjustInventory,
  postInventoryCount
} from "../app/modules/inventory/inventory.server";
import { createServiceContext } from "@carbon/api/service-fn.server";

const ctx = () =>
  createServiceContext({
    actor: {
      type: "user",
      userId: "user-1",
      permissions: {
        inventory: {
          view: ["company-1"],
          create: ["company-1"],
          update: ["company-1"],
          delete: []
        }
      }
    },
    company: { id: "company-1", groupId: "group-1" },
    caller: {} as any,
    system: () => ({}) as any,
    pg: () => ({}) as any,
    kv: () => ({}) as any
  });

const violation = (severity: "error" | "warn") => ({
  ruleId: `rule-${severity}`,
  severity,
  message: "No",
  lineId: "item-1"
});

beforeEach(() => {
  vi.clearAllMocks();
  evaluate.mockResolvedValue({ violations: [], ruleNames: {} });
  vi.mocked(postInventoryAdjustment).mockResolvedValue({
    success: true,
    itemLedger: { id: "ledger-1" }
  });
});

describe("adjustInventory", () => {
  const scrap = {
    itemId: "item-1",
    adjustmentType: "Scrap" as const,
    quantity: 2,
    locationId: "loc-1",
    storageUnitId: "bin-1",
    scrapReasonId: "reason-1"
  };

  it("is refused by a rule on the bin it takes stock from, and adjusts nothing", async () => {
    // A scrap removes stock: only a `pick` rule applies to it.
    evaluate.mockImplementation(async ({ surface }) => ({
      violations: surface === "pick" ? [violation("error")] : [],
      ruleNames: {}
    }));

    const result = await adjustInventory(ctx(), scrap);

    expect(result.data).toMatchObject({
      violations: [{ ruleId: "rule-error" }]
    });
    expect(postInventoryAdjustment).not.toHaveBeenCalled();
  });

  it("ignores a rule on the bin it does not take stock from", async () => {
    evaluate.mockImplementation(async ({ surface }) => ({
      violations: surface === "place" ? [violation("error")] : [],
      ruleNames: {}
    }));

    const result = await adjustInventory(ctx(), scrap);

    expect(result.data).toEqual({ itemLedgerId: "ledger-1" });
  });

  it("adjusts past an acknowledged warning", async () => {
    evaluate.mockResolvedValue({
      violations: [violation("warn")],
      ruleNames: {}
    });

    const blocked = await adjustInventory(ctx(), scrap);
    const acknowledged = await adjustInventory(ctx(), {
      ...scrap,
      acknowledged: true
    });

    expect(blocked.data).toHaveProperty("violations");
    expect(acknowledged.data).toEqual({ itemLedgerId: "ledger-1" });
  });

  it("needs a scrap reason to scrap, and a location for all but an unscrap", async () => {
    const noReason = await adjustInventory(ctx(), {
      ...scrap,
      scrapReasonId: undefined
    });
    const unscrap = await adjustInventory(ctx(), {
      itemId: "item-1",
      adjustmentType: "Unscrap",
      quantity: 1,
      trackedEntityId: "entity-1"
    });

    expect(noReason.error?.category).toBe("validation");
    expect(unscrap.data).toEqual({ itemLedgerId: "ledger-1" });
  });

  it("passes the posting's own refusal through, and hides any other failure", async () => {
    vi.mocked(postInventoryAdjustment)
      .mockRejectedValueOnce(new InvalidInputError("Lot LOT-7 is on hold"))
      .mockRejectedValueOnce(new Error("duplicate key"));

    const refused = await adjustInventory(ctx(), scrap);
    const failed = await adjustInventory(ctx(), scrap);

    expect(refused.error).toMatchObject({
      category: "validation",
      message: "Lot LOT-7 is on hold"
    });
    expect(failed.error).toMatchObject({
      category: "internal",
      message: "Failed to create manual inventory adjustment"
    });
  });

  it("refuses a negative quantity: the type says which way stock moves", async () => {
    const result = await adjustInventory(ctx(), { ...scrap, quantity: -2 });

    expect(result.error?.category).toBe("validation");
    expect(postInventoryAdjustment).not.toHaveBeenCalled();
  });
});

describe("postInventoryCount", () => {
  it("posts only a confirmed count", async () => {
    vi.mocked(getInventoryCount).mockResolvedValue({
      data: { status: "Draft" }
    } as any);

    const result = await postInventoryCount(ctx(), { inventoryCountId: "c1" });

    expect(result.error).toMatchObject({ category: "rule" });
    expect(postCount).not.toHaveBeenCalled();
  });

  it("returns the lines that cannot post, so the page can mark them", async () => {
    vi.mocked(getInventoryCount).mockResolvedValue({
      data: { status: "Pending" }
    } as any);
    vi.mocked(postCount).mockRejectedValue(
      new ServerFnError("1 serial line(s) must be counted as 0 or 1", 400, {
        invalidLineIds: ["line-1"]
      })
    );

    const result = await postInventoryCount(ctx(), { inventoryCountId: "c1" });

    expect(result.data).toEqual({
      invalidLineIds: ["line-1"],
      message: "1 serial line(s) must be counted as 0 or 1"
    });
  });

  it("keeps the server function's own status for any other refusal", async () => {
    vi.mocked(getInventoryCount).mockResolvedValue({
      data: { status: "Pending" }
    } as any);
    vi.mocked(postCount).mockRejectedValue(
      new ServerFnError("Inventory count not found", 404)
    );

    const result = await postInventoryCount(ctx(), { inventoryCountId: "c1" });

    expect(result.error).toMatchObject({
      category: "notFound",
      message: "Inventory count not found"
    });
  });
});

describe("pickRefusal", () => {
  it("shows a refusal written for the picker", () => {
    expect(
      pickRefusal(ctx(), "This picking list is closed. Reopen it to make changes.")
    ).toMatchObject({
      category: "rule",
      message: "This picking list is closed. Reopen it to make changes."
    });
    expect(
      pickRefusal(ctx(), new ServerFnError("Cannot pick more than 3", 400))
    ).toMatchObject({ category: "validation", message: "Cannot pick more than 3" });
  });

  it("hides a database or server failure behind a generic message", () => {
    const database = {
      code: "23505",
      message: 'duplicate key value violates unique constraint "pickingListLine_pkey"'
    };

    expect(pickRefusal(ctx(), database)).toMatchObject({
      category: "internal",
      message: "Failed to pick line"
    });
    expect(
      pickRefusal(ctx(), new ServerFnError("relation does not exist", 500))
    ).toMatchObject({ category: "internal", message: "Failed to pick line" });
  });
});
