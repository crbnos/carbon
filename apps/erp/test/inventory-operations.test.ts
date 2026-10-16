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
const { invoke, evaluate } = vi.hoisted(() => ({
  // The server functions.
  invoke: vi.fn(),
  // Storage rules: the violations each surface reports.
  evaluate: vi.fn()
}));
vi.mock("@carbon/server-functions", () => ({
  serverFns: { system: () => ({ invoke }) }
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
  insertManualInventoryAdjustment: vi.fn()
}));

import { ServerFnError } from "@carbon/server-functions/errors";
import {
  getInventoryCount,
  insertManualInventoryAdjustment
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
  vi.mocked(insertManualInventoryAdjustment).mockResolvedValue({
    data: { id: "ledger-1" },
    error: null
  } as any);
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
    expect(insertManualInventoryAdjustment).not.toHaveBeenCalled();
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

  it("names a refusal the user can act on, and hides any other failure", async () => {
    vi.mocked(insertManualInventoryAdjustment)
      .mockResolvedValueOnce({
        data: null,
        error: "Insufficient quantity for negative adjustment"
      } as any)
      .mockResolvedValueOnce({ data: null, error: "duplicate key" } as any);

    const short = await adjustInventory(ctx(), scrap);
    const failed = await adjustInventory(ctx(), scrap);

    expect(short.error).toMatchObject({
      category: "rule",
      message: "Insufficient quantity for negative adjustment"
    });
    expect(failed.error).toMatchObject({
      category: "internal",
      message: "Failed to create manual inventory adjustment"
    });
  });
});

describe("postInventoryCount", () => {
  it("posts only a confirmed count", async () => {
    vi.mocked(getInventoryCount).mockResolvedValue({
      data: { status: "Draft" }
    } as any);

    const result = await postInventoryCount(ctx(), { inventoryCountId: "c1" });

    expect(result.error).toMatchObject({ category: "rule" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns the lines that cannot post, so the page can mark them", async () => {
    vi.mocked(getInventoryCount).mockResolvedValue({
      data: { status: "Pending" }
    } as any);
    invoke.mockResolvedValue({
      data: null,
      error: new ServerFnError("1 serial line(s) must be counted as 0 or 1", 400, {
        invalidLineIds: ["line-1"]
      })
    });

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
    invoke.mockResolvedValue({
      data: null,
      error: new ServerFnError("Inventory count not found", 404)
    });

    const result = await postInventoryCount(ctx(), { inventoryCountId: "c1" });

    expect(result.error).toMatchObject({
      category: "notFound",
      message: "Inventory count not found"
    });
  });
});
