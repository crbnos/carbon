// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SYNC_CONFIG, ProviderID, validateSyncConfig } from "./models";
import {
  ensureProviderSubscriptions,
  getSyncSubscriptionName,
  REQUIRED_SYNC_SUBSCRIPTIONS
} from "./subscriptions";

/**
 * Minimal mock of the two client surfaces convergence touches: the
 * create/delete subscription RPCs and the `eventSystemSubscription` list
 * read. `existingRows` simulates what is already in the table for the
 * provider's `${id}-sync` name.
 */
function makeClient(existingRows: Array<{ id: string; table: string }>) {
  const rpc = vi.fn(async (fn: string) => {
    if (fn === "create_event_system_subscription") {
      return { data: [{ id: "sub_new" }], error: null };
    }
    return { data: null, error: null };
  });

  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({
        eq: async () => ({ data: existingRows, error: null })
      })
    })
  }));

  return { rpc, from } as any;
}

describe("REQUIRED_SYNC_SUBSCRIPTIONS", () => {
  it("subscribes journal for every provider (posting sync's event source)", () => {
    for (const providerId of Object.values(ProviderID)) {
      const tables = REQUIRED_SYNC_SUBSCRIPTIONS[providerId].map(
        (subscription) => subscription.table
      );
      expect(tables, `${providerId} must subscribe journal`).toContain(
        "journal"
      );
    }
  });

  it("never subscribes address (dead letter — parent bump covers it)", () => {
    for (const providerId of Object.values(ProviderID)) {
      const tables = REQUIRED_SYNC_SUBSCRIPTIONS[providerId].map(
        (subscription) => subscription.table
      );
      expect(tables).not.toContain("address");
    }
  });

  it("never subscribes item — the part catalog is not accounting data", () => {
    // Carbon's item master is parts, materials, tools and consumables: tens of
    // thousands of rows that mean nothing to an accounting system. Subscribing
    // the table pushed every one of them, on every edit, with no filter (no item
    // syncer overrides `shouldSync`) — burying the few real sellable goods in
    // Products & Services and churning the provider on engineering edits.
    //
    // No invoice references a Carbon item any more (AR lines carry a synthetic
    // per-revenue-account product, or are account-coded); the documents that do
    // — sales orders, purchase orders, inventory adjustments — still push
    // exactly the items they name, JIT via `ensureDependencySynced("item", …)`.
    // Re-adding this subscription would silently restore the catalog dump.
    for (const providerId of Object.values(ProviderID)) {
      const tables = REQUIRED_SYNC_SUBSCRIPTIONS[providerId].map(
        (subscription) => subscription.table
      );
      expect(tables, `${providerId} must not subscribe item`).not.toContain(
        "item"
      );
    }
  });

  it("still subscribes the tables a provider genuinely owns", () => {
    // Guards the removal above from over-reaching: dropping `item` must not
    // disturb the master/document tables the push actually depends on.
    for (const providerId of Object.values(ProviderID)) {
      const tables = REQUIRED_SYNC_SUBSCRIPTIONS[providerId].map(
        (subscription) => subscription.table
      );
      for (const table of [
        "customer",
        "supplier",
        "salesInvoice",
        "purchaseInvoice"
      ]) {
        expect(tables, `${providerId} must subscribe ${table}`).toContain(
          table
        );
      }
    }
  });

  it("lets a company sync bills with the item entity turned OFF", () => {
    // `validateSyncConfig` refuses to enable an entity whose declared dependency
    // is disabled. `bill` used to declare `dependsOn: ["vendor", "item"]` —
    // left over from before AP bills became account-costed journal replays — so
    // "bills on, items off" was an invalid config, blocking the one thing a
    // customer would most reasonably want. No bill syncer references an item on
    // the push.
    const config = structuredClone(DEFAULT_SYNC_CONFIG);
    config.entities.item.enabled = false;
    config.entities.bill.enabled = true;
    config.entities.vendor.enabled = true;

    const errors = validateSyncConfig(config);
    expect(errors.filter((e) => e.includes("Bills"))).toEqual([]);
  });

  it("still requires items for the documents that DO reference them", () => {
    // The guard against over-correcting. Purchase/sales ORDERS and inventory
    // adjustments genuinely JIT-sync items (they are non-posting or item-keyed,
    // so item detail is real), and disabling items must still be refused for
    // them rather than silently producing lines with no product.
    for (const entity of [
      "purchaseOrder",
      "salesOrder",
      "inventoryAdjustment"
    ] as const) {
      const config = structuredClone(DEFAULT_SYNC_CONFIG);
      config.entities.item.enabled = false;
      config.entities[entity].enabled = true;
      config.entities.customer.enabled = true;
      config.entities.vendor.enabled = true;

      expect(
        validateSyncConfig(config).some((e) => e.includes("Items")),
        `${entity} must still require items`
      ).toBe(true);
    }
  });

  it("lets a company sync sales invoices with the item entity turned OFF", () => {
    // The point of the change: an AR invoice line carries a synthetic
    // per-revenue-account item (or none, on Xero), never the Carbon item, so
    // the parts catalog never needs to reach the provider.
    const config = structuredClone(DEFAULT_SYNC_CONFIG);
    config.entities.item.enabled = false;
    config.entities.invoice.enabled = true;
    config.entities.customer.enabled = true;

    expect(
      validateSyncConfig(config).filter((e) => e.includes("Sales Invoices"))
    ).toEqual([]);
  });

  it("subscribes payment for every push-capable provider (Xero, QBO, Rillet)", () => {
    const withPayment = Object.values(ProviderID).filter((providerId) =>
      REQUIRED_SYNC_SUBSCRIPTIONS[providerId].some(
        (subscription) => subscription.table === "payment"
      )
    );
    expect(withPayment).toEqual([
      ProviderID.XERO,
      ProviderID.QUICKBOOKS,
      ProviderID.RILLET
    ]);
  });
});

describe("ensureProviderSubscriptions", () => {
  it("upserts every required table under the provider's sync name", async () => {
    const client = makeClient([]);

    const result = await ensureProviderSubscriptions(
      client,
      "company-1",
      ProviderID.RILLET
    );

    const required = REQUIRED_SYNC_SUBSCRIPTIONS[ProviderID.RILLET];
    const createCalls = client.rpc.mock.calls.filter(
      ([fn]: [string]) => fn === "create_event_system_subscription"
    );

    expect(createCalls).toHaveLength(required.length);
    for (const [, params] of createCalls) {
      expect(params.p_name).toBe(getSyncSubscriptionName(ProviderID.RILLET));
      expect(params.p_company_id).toBe("company-1");
      expect(params.p_handler_type).toBe("SYNC");
      expect(params.p_config).toEqual({ provider: ProviderID.RILLET });
      expect(params.p_active).toBe(true);
    }

    expect(result.ensured.sort()).toEqual(
      required.map((subscription) => subscription.table).sort()
    );
    expect(result.removed).toEqual([]);
  });

  it("removes rows whose table is no longer required (e.g. legacy address)", async () => {
    const client = makeClient([
      { id: "sub_addr", table: "address" },
      { id: "sub_journal", table: "journal" }
    ]);

    const result = await ensureProviderSubscriptions(
      client,
      "company-1",
      ProviderID.RILLET
    );

    const deleteCalls = client.rpc.mock.calls.filter(
      ([fn]: [string]) => fn === "delete_event_system_subscription"
    );
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]?.[1]).toEqual({ p_subscription_id: "sub_addr" });
    expect(result.removed).toEqual(["address"]);
  });

  it("is idempotent — a fully-converged install deletes nothing", async () => {
    const required = REQUIRED_SYNC_SUBSCRIPTIONS[ProviderID.XERO];
    const client = makeClient(
      required.map((subscription, index) => ({
        id: `sub_${index}`,
        table: subscription.table
      }))
    );

    const result = await ensureProviderSubscriptions(
      client,
      "company-1",
      ProviderID.XERO
    );

    const deleteCalls = client.rpc.mock.calls.filter(
      ([fn]: [string]) => fn === "delete_event_system_subscription"
    );
    expect(deleteCalls).toHaveLength(0);
    expect(result.removed).toEqual([]);
  });
});
