// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { ServerFnError } from "@carbon/api/errors";
import { createServiceContext } from "@carbon/api/service-fn.server";
import {
  adjustInventory,
  postInventoryCount
} from "../app/modules/inventory/inventory.server";
import {
  adjustmentRuleSurfaces,
  inventoryCountPostingFailure,
  pickRefusal,
  postingFailure
} from "../app/modules/inventory/inventory.service";

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
