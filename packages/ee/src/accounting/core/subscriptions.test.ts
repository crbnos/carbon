// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { DEFAULT_SYNC_CONFIG, ProviderID, validateSyncConfig } from "./models";
import {
  ensureProviderSubscriptions,
  REQUIRED_SYNC_SUBSCRIPTIONS
} from "./subscriptions";

type Row = {
  id: string;
  companyId: string;
  name: string;
  table: string;
  handlerType?: string;
  config?: unknown;
  active?: boolean;
};

/**
 * An in-memory `eventSystemSubscription` table behind the create (upsert on
 * companyId + name + table) and delete RPCs and the list read.
 */
function makeStore(initial: Row[] = []) {
  const rows = [...initial];
  let nextId = 0;
  const client = {
    async rpc(fn: string, params: Record<string, any>) {
      if (fn === "create_event_system_subscription") {
        const row: Row = {
          id: `new_${nextId++}`,
          companyId: params.p_company_id,
          name: params.p_name,
          table: params.p_table,
          handlerType: params.p_handler_type,
          config: params.p_config,
          active: params.p_active
        };
        const index = rows.findIndex(
          (r) =>
            r.companyId === row.companyId &&
            r.name === row.name &&
            r.table === row.table
        );
        if (index === -1) rows.push(row);
        else rows[index] = { ...row, id: rows[index]!.id };
        return { data: [{ id: row.id }], error: null };
      }
      if (fn === "delete_event_system_subscription") {
        const index = rows.findIndex((r) => r.id === params.p_subscription_id);
        if (index !== -1) rows.splice(index, 1);
        return { data: null, error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    from: () => ({
      select: () => ({
        eq: (_c1: string, companyId: string) => ({
          eq: async (_c2: string, name: string) => ({
            data: rows.filter(
              (r) => r.companyId === companyId && r.name === name
            ),
            error: null
          })
        })
      })
    })
  };
  return { client: client as any, rows };
}

const tablesOf = (providerId: (typeof ProviderID)[keyof typeof ProviderID]) =>
  REQUIRED_SYNC_SUBSCRIPTIONS[providerId].map((s) => s.table);

describe("REQUIRED_SYNC_SUBSCRIPTIONS", () => {
  it.each(Object.values(ProviderID))(
    "%s subscribes journal and the master/document tables it owns",
    (providerId) => {
      expect(tablesOf(providerId)).toEqual(
        expect.arrayContaining([
          "journal",
          "customer",
          "supplier",
          "salesInvoice",
          "purchaseInvoice"
        ])
      );
    }
  );

  // address is covered by its parent's bump; item would push the whole parts
  // catalog — documents that need an item sync it on demand.
  it.each(Object.values(ProviderID))(
    "%s never subscribes address or item",
    (providerId) => {
      expect(tablesOf(providerId)).not.toContain("address");
      expect(tablesOf(providerId)).not.toContain("item");
    }
  );

  it("subscribes payment only for the push-capable providers", () => {
    expect(
      Object.values(ProviderID).filter((providerId) =>
        tablesOf(providerId).includes("payment")
      )
    ).toEqual([ProviderID.XERO, ProviderID.QUICKBOOKS, ProviderID.RILLET]);
  });
});

describe("validateSyncConfig item dependency", () => {
  const withItemsOff = (...entities: string[]) => {
    const config = structuredClone(DEFAULT_SYNC_CONFIG);
    config.entities.item.enabled = false;
    for (const entity of entities) {
      config.entities[entity as keyof typeof config.entities].enabled = true;
    }
    return validateSyncConfig(config);
  };

  // Bills and AR invoices are account-coded; no line names a Carbon item.
  it.each([
    ["bill", "vendor", "Bills"],
    ["invoice", "customer", "Sales Invoices"]
  ])("allows %s sync with items off", (entity, party, label) => {
    expect(
      withItemsOff(entity, party).filter((e) => e.includes(label))
    ).toEqual([]);
  });

  it.each(["purchaseOrder", "salesOrder", "inventoryAdjustment"])(
    "still requires items for %s, whose lines name them",
    (entity) => {
      expect(
        withItemsOff(entity, "customer", "vendor").some((e) =>
          e.includes("Items")
        )
      ).toBe(true);
    }
  );
});

describe("ensureProviderSubscriptions", () => {
  it("creates every required table as an active SYNC subscription under the provider's name", async () => {
    const { client, rows } = makeStore();
    const result = await ensureProviderSubscriptions(
      client,
      "company-1",
      ProviderID.RILLET
    );

    expect(rows.map((r) => r.table).sort()).toEqual(
      tablesOf(ProviderID.RILLET).sort()
    );
    for (const row of rows) {
      expect(row).toMatchObject({
        companyId: "company-1",
        name: "rillet-sync",
        handlerType: "SYNC",
        config: { provider: ProviderID.RILLET },
        active: true
      });
    }
    expect(result.removed).toEqual([]);
  });

  it("removes this company's rows for tables no longer required, and nobody else's", async () => {
    const { client, rows } = makeStore([
      {
        id: "addr",
        companyId: "company-1",
        name: "rillet-sync",
        table: "address"
      },
      {
        id: "other-name",
        companyId: "company-1",
        name: "webhook",
        table: "address"
      },
      {
        id: "other-company",
        companyId: "company-2",
        name: "rillet-sync",
        table: "address"
      }
    ]);
    const result = await ensureProviderSubscriptions(
      client,
      "company-1",
      ProviderID.RILLET
    );

    expect(result.removed).toEqual(["address"]);
    expect(rows.filter((r) => r.table === "address").map((r) => r.id)).toEqual([
      "other-name",
      "other-company"
    ]);
  });

  it("keeps the existing rows of a fully converged install", async () => {
    const existing = tablesOf(ProviderID.XERO).map((table, index) => ({
      id: `sub_${index}`,
      companyId: "company-1",
      name: "xero-sync",
      table
    }));
    const { client, rows } = makeStore(existing);
    const result = await ensureProviderSubscriptions(
      client,
      "company-1",
      ProviderID.XERO
    );

    expect(result.removed).toEqual([]);
    expect(rows.map((r) => r.id)).toEqual(existing.map((r) => r.id));
  });
});
