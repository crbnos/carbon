// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { ServerFnError } from "@carbon/api/errors";
import { type Actor, createServiceContext } from "@carbon/api/service-fn.server";
import {
  adjustInventory,
  postInventoryCount,
  scanKanban
} from "../app/modules/inventory/inventory.server";
import { pageClaims } from "./page-claims";
import {
  adjustmentRuleSurfaces,
  inventoryCountPostingFailure,
  pickRefusal,
  postingFailure
} from "../app/modules/inventory/inventory.service";
import { filteringSupabase } from "./filtering-supabase-fake";

/** The caller's client: each table's one row. */
const clientWith = (rows: Record<string, unknown>) => ({
  from: (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq"]) chain[method] = () => chain;
    chain.single = async () => ({ data: rows[table] ?? null, error: null });
    return chain;
  }
});

const ctx = (rows: Record<string, unknown> = {}) =>
  createServiceContext({
    actor: {
      type: "user",
      role: "employee",
      userId: "user-1",
      permissions: pageClaims({
        inventory: {
          view: ["company-1"],
          create: ["company-1"],
          update: ["company-1"],
          delete: []
        }
      })
    },
    company: { id: "company-1", groupId: "group-1" },
    caller: clientWith(rows) as any,
    system: () => ({}) as any,
    pg: () => ({}) as any,
    kv: () => ({}) as any
  });

describe("adjustmentRuleSurfaces", () => {
  it.each([
    ["Scrap", "pick"],
    ["Negative Adjmt.", "pick"],
    ["Positive Adjmt.", "place"],
    ["Set Quantity", "place"],
    ["Unscrap", "place"]
  ] as const)("checks a %s's bin as a %s", (adjustmentType, surface) => {
    expect(adjustmentRuleSurfaces(adjustmentType, "bin-1")).toEqual([
      "inventoryAdjustment",
      surface
    ]);
  });

  it("checks no bin rule when no bin is named", () => {
    expect(adjustmentRuleSurfaces("Scrap", undefined)).toEqual([
      "inventoryAdjustment"
    ]);
  });
});

describe("adjustInventory input", () => {
  const scrap = {
    itemId: "item-1",
    adjustmentType: "Scrap" as const,
    quantity: 2,
    locationId: "loc-1",
    storageUnitId: "bin-1",
    scrapReasonId: "reason-1"
  };
  const parses = (input: object) => adjustInventory.input.safeParse(input).success;

  it("accepts a scrap with its reason and location", () => {
    expect(parses(scrap)).toBe(true);
  });

  it.each([
    ["a scrap with no reason", { ...scrap, scrapReasonId: undefined }],
    ["an adjustment with no location", { ...scrap, locationId: undefined }],
    // The type says which way stock moves; the quantity is a magnitude.
    ["a negative quantity", { ...scrap, quantity: -2 }]
  ])("refuses %s", (_case, input) => {
    expect(parses(input)).toBe(false);
  });

  it("takes an unscrap without a location: it resolves it from the scrap", () => {
    expect(
      parses({
        itemId: "item-1",
        adjustmentType: "Unscrap",
        quantity: 1,
        trackedEntityId: "entity-1"
      })
    ).toBe(true);
  });
});

describe("postingFailure", () => {
  it("passes a posting's own refusal through", () => {
    expect(
      postingFailure(ctx(), new ServerFnError("Lot LOT-7 is on hold", 400), "Failed")
    ).toMatchObject({ category: "validation", message: "Lot LOT-7 is on hold" });
  });

  it("hides any other failure behind the operation's message", () => {
    expect(
      postingFailure(ctx(), new ServerFnError("duplicate key", 500), "Failed")
    ).toMatchObject({ category: "internal", message: "Failed" });
  });
});

describe("postInventoryCount", () => {
  it("posts only a confirmed count", async () => {
    const result = await postInventoryCount(
      ctx({ inventoryCount: { status: "Draft" } }),
      { inventoryCountId: "c1" }
    );
    expect(result.error?.category).toBe("rule");
  });
});

describe("inventoryCountPostingFailure", () => {
  it("returns the lines that cannot post, so the page can mark them", () => {
    const error = new ServerFnError("1 serial line(s) must be counted as 0 or 1", 400, {
      invalidLineIds: ["line-1"]
    });
    expect(inventoryCountPostingFailure(ctx(), error)).toEqual({
      invalidLineIds: ["line-1"],
      message: "1 serial line(s) must be counted as 0 or 1"
    });
  });

  it("keeps the server function's own status for any other refusal", () => {
    expect(
      inventoryCountPostingFailure(ctx(), new ServerFnError("Inventory count not found", 404))
    ).toMatchObject({ category: "notFound", message: "Inventory count not found" });
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

describe("scanKanban for an API key", () => {
  const noScope = { view: [], create: [], update: [], delete: [] };
  const key = (
    scopes: Record<string, Partial<Record<"view" | "create" | "update" | "delete", string[]>>>
  ): Actor => ({
    type: "apiKey",
    createdBy: "user-1",
    permissions: pageClaims(
      Object.fromEntries(
        Object.entries(scopes).map(([module, actions]) => [
          module,
          { ...noScope, ...actions }
        ])
      )
    )
  });
  // A Make card whose job is still open: the scan only answers "collision".
  const makeCard = (jobReadableId: string | null) => ({
    id: "kb-1",
    companyId: "company-1",
    replenishmentSystem: "Make",
    itemId: "item-1",
    storageUnitId: null,
    jobReadableId
  });
  // The system handles: touching one fails the test.
  const untouched = new Proxy(
    {},
    {
      get(_, key) {
        throw new Error(`Nothing should run as the system (${String(key)})`);
      }
    }
  );
  // A Buy card for a supplier with a Draft order: the scan adds a line to it.
  const buyCard = {
    id: "kb-1",
    companyId: "company-1",
    replenishmentSystem: "Buy",
    itemId: "item-1",
    supplierId: "supplier-1",
    locationId: "location-1",
    storageUnitId: null,
    quantity: 4,
    purchaseUnitOfMeasureCode: "EA",
    conversionFactor: 1
  };
  const draftOrder = {
    purchaseOrder: [
      {
        id: "po-1",
        companyId: "company-1",
        supplierId: "supplier-1",
        status: "Draft",
        currencyCode: "USD",
        exchangeRate: 1
      }
    ],
    item: [
      {
        id: "item-1",
        companyId: "company-1",
        type: "Part",
        unitOfMeasureCode: "EA",
        itemCost: [{ unitCost: 2 }],
        itemReplenishment: { conversionFactor: 1 }
      }
    ],
    company: [{ id: "company-1", baseCurrencyCode: "USD" }]
  };
  const scan = (
    actor: Actor,
    card: Record<string, unknown> = makeCard("J-1"),
    tables: Record<string, unknown[]> = {}
  ) => {
    const caller = filteringSupabase({ kanbans: [card], ...tables });
    const ctx = createServiceContext({
      actor,
      company: { id: "company-1", groupId: "group-1" },
      caller: caller.client,
      system: () => untouched as never,
      pg: () => untouched as never,
      kv: () => ({}) as any
    });
    return { result: scanKanban(ctx, { kanbanId: "kb-1" }), writes: caller.writes };
  };

  it("refuses a key without Edit on inventory.kanbans, before reading the card", async () => {
    const { result, writes } = scan(key({ inventory: { view: ["company-1"] } }));
    expect((await result).error?.category).toBe("forbidden");
    expect(writes).toEqual([]);
  });

  it("refuses a Make card to a key without Create on production.jobs", async () => {
    const { result, writes } = scan(
      key({ inventory: { update: ["company-1"] } }),
      makeCard(null)
    );
    expect((await result).error?.category).toBe("forbidden");
    expect(writes).toEqual([]);
  });

  it("scans a Make card for a key with both", async () => {
    const { result } = scan(
      key({
        inventory: { update: ["company-1"] },
        production: { create: ["company-1"] }
      })
    );
    expect(await result).toEqual({ data: { type: "collision" }, error: null });
  });

  // The release runs as the system and moves the job to Ready, which the
  // app's release needs Edit for.
  it("refuses an auto-release Make card to a key without Edit on production.jobs", async () => {
    const { result, writes } = scan(
      key({
        inventory: { update: ["company-1"] },
        production: { create: ["company-1"] }
      }),
      { ...makeCard(null), autoRelease: true }
    );
    expect((await result).error?.category).toBe("forbidden");
    expect(writes).toEqual([]);
  });

  it("scans an auto-release Make card for a key with Edit on production.jobs", async () => {
    const { result } = scan(
      key({
        inventory: { update: ["company-1"] },
        production: {
          view: ["company-1"],
          create: ["company-1"],
          update: ["company-1"]
        }
      }),
      { ...makeCard("J-1"), autoRelease: true }
    );
    expect(await result).toEqual({ data: { type: "collision" }, error: null });
  });

  it("refuses a Buy card to a key without Create on purchasing.purchaseOrders", async () => {
    const { result, writes } = scan(
      key({
        inventory: { update: ["company-1"] },
        purchasing: { view: ["company-1"] }
      }),
      buyCard,
      draftOrder
    );
    expect((await result).error?.category).toBe("forbidden");
    expect(writes).toEqual([]);
  });

  it("adds a Buy card's line to the supplier's Draft order for a key with Create on purchasing.purchaseOrders", async () => {
    const { result, writes } = scan(
      key({
        inventory: { update: ["company-1"] },
        purchasing: { view: ["company-1"], create: ["company-1"] }
      }),
      buyCard,
      draftOrder
    );
    expect(await result).toEqual({
      data: { type: "purchaseOrder", purchaseOrderId: "po-1" },
      error: null
    });
    expect(
      writes.filter((write) => write.op === "insert").map((write) => write.table)
    ).toEqual(["purchaseOrderLine"]);
  });
});
