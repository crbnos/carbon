import { describe, expect, it, vi } from "vitest";
import type { Accounting } from "../../../../core/types";
import type { Xero } from "../../models";
import { ItemSyncer } from "../item";

/**
 * Xero items are pushed NON-TRACKED so the provider never books inventory
 * (bills) or COGS (invoices) — per-SKU valuation stays in Carbon. On create
 * we force `IsTrackedAsInventory: false`; on update we OMIT it (Xero rejects
 * untracking an item with stock/transactions) and warn if the remote is still
 * tracked.
 */

const item = (overrides: Partial<Accounting.Item> = {}): Accounting.Item =>
  ({
    id: "item-1",
    code: "WIDGET-1",
    name: "Widget",
    description: "A widget",
    companyId: "company-1",
    type: "Part",
    unitOfMeasureCode: "EA",
    unitCost: 10,
    unitSalePrice: 25,
    isPurchased: true,
    isSold: true,
    isTrackedAsInventory: true,
    updatedAt: "2026-08-04T00:00:00.000Z",
    ...overrides
  }) as unknown as Accounting.Item;

function makeItemSyncer(
  remoteId: string | null,
  remote?: Partial<Xero.Item> | null
) {
  const syncer = new ItemSyncer({
    database: {} as never,
    companyId: "company-1",
    provider: { id: "xero" } as never,
    config: { enabled: true, direction: "two-way", owner: "carbon" },
    entityType: "item"
  });
  (syncer as unknown as Record<string, unknown>).getRemoteId = async () =>
    remoteId;
  (syncer as unknown as Record<string, unknown>).fetchRemote = async () =>
    remote ?? null;
  return syncer as unknown as {
    mapToRemote(local: Accounting.Item): Promise<Xero.Item>;
  };
}

describe("Xero ItemSyncer.mapToRemote (non-tracked representation)", () => {
  it("forces IsTrackedAsInventory: false on create", async () => {
    const payload = await makeItemSyncer(null).mapToRemote(item());
    expect(payload.IsTrackedAsInventory).toBe(false);
    expect(payload.Code).toBe("WIDGET-1");
  });

  it("omits IsTrackedAsInventory on update (non-tracked remote)", async () => {
    const payload = await makeItemSyncer("xero-item-1", {
      ItemID: "xero-item-1",
      IsTrackedAsInventory: false
    }).mapToRemote(item());
    expect("IsTrackedAsInventory" in payload).toBe(false);
  });

  it("warns (and still omits the field) when the remote item is still tracked", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const payload = await makeItemSyncer("xero-item-1", {
      ItemID: "xero-item-1",
      IsTrackedAsInventory: true
    }).mapToRemote(item());

    expect("IsTrackedAsInventory" in payload).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("still tracked as inventory")
    );
    warnSpy.mockRestore();
  });
});
