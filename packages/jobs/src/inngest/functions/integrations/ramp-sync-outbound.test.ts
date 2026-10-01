// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { loadRampOutboundCandidates } from "./ramp-sync-outbound";

type Recorded = {
  table: string;
  filters: Array<[string, ...unknown[]]>;
};

/**
 * A PostgREST-shaped recorder. It is not a supabase re-implementation: it
 * records the filter chain and returns a fixed page, which is exactly what this
 * unit's contract is (which table, which window, which statuses).
 */
function recordingClient(rowsByTable: Record<string, Array<{ id: string }>>) {
  const recorded: Recorded[] = [];

  const client = {
    from(table: string) {
      const entry: Recorded = { table, filters: [] };
      recorded.push(entry);
      const builder = {
        select: () => builder,
        eq: (...args: unknown[]) => {
          entry.filters.push(["eq", ...args]);
          return builder;
        },
        gte: (...args: unknown[]) => {
          entry.filters.push(["gte", ...args]);
          return builder;
        },
        in: (...args: unknown[]) => {
          entry.filters.push(["in", ...args]);
          return builder;
        },
        not: (...args: unknown[]) => {
          entry.filters.push(["not", ...args]);
          return builder;
        },
        order: () => builder,
        range: async () => ({
          error: null,
          data: rowsByTable[table] ?? []
        })
      };
      return builder;
    }
  };

  return { client, recorded };
}

const pushed = {
  enabled: true,
  direction: "push-to-accounting" as const,
  owner: "carbon" as const
};
const off = { ...pushed, enabled: false };

const providerWith = (configs: Record<string, typeof pushed | typeof off>) => ({
  getSyncConfig: ((entity: string) => configs[entity] ?? off) as never
});

const TODAY = "2026-09-28";

describe("loadRampOutboundCandidates", () => {
  it("sweeps released purchase orders and posted invoices", async () => {
    // The gap this closes: converging the SYNC subscriptions repairs the NEXT
    // event only. A purchase order released or an invoice posted while the rows
    // were missing produced no event, so no ledger operation exists — and the
    // accounting outbound sweep walks `ProviderID`, so it never reaches Ramp.
    const { client, recorded } = recordingClient({
      purchaseOrder: [{ id: "po-1" }, { id: "po-2" }],
      purchaseInvoice: [{ id: "pi-1" }]
    });

    const result = await loadRampOutboundCandidates({
      client: client as never,
      companyId: "company-1",
      provider: providerWith({ purchaseOrder: pushed, bill: pushed }),
      todayIso: TODAY
    });

    expect(result.refs).toEqual([
      { entityType: "purchaseOrder", entityId: "po-1" },
      { entityType: "purchaseOrder", entityId: "po-2" },
      { entityType: "bill", entityId: "pi-1" }
    ]);
    expect(result.scanned).toEqual({ purchaseOrders: 2, invoices: 1 });
    expect(result.skippedReasons).toEqual([]);
    expect(recorded.map((entry) => entry.table)).toEqual([
      "purchaseOrder",
      "purchaseInvoice"
    ]);
  });

  it("walks the same 7-day window the accounting sweep uses", async () => {
    const { client, recorded } = recordingClient({});

    await loadRampOutboundCandidates({
      client: client as never,
      companyId: "company-1",
      provider: providerWith({ purchaseOrder: pushed, bill: pushed }),
      todayIso: TODAY
    });

    expect(recorded[0]?.filters).toContainEqual([
      "gte",
      "updatedAt",
      "2026-09-21"
    ]);
    // Bills use `postingDate`, matching the accounting sweep's bill walk.
    expect(recorded[1]?.filters).toContainEqual([
      "gte",
      "postingDate",
      "2026-09-21"
    ]);
  });

  it("raises the floor to the entity's syncFromDate", async () => {
    const { client, recorded } = recordingClient({});

    await loadRampOutboundCandidates({
      client: client as never,
      companyId: "company-1",
      provider: providerWith({
        purchaseOrder: { ...pushed, syncFromDate: "2026-09-25" } as never,
        bill: off
      }),
      todayIso: TODAY
    });

    expect(recorded[0]?.filters).toContainEqual([
      "gte",
      "updatedAt",
      "2026-09-25"
    ]);
  });

  it("keeps unreleased purchase orders out of the walk", async () => {
    // `reconcileMasterData` enqueues whenever a row is unmapped — it has no
    // parked-disposition guard — so without this every Draft order would mint a
    // Skipped ledger row on every run.
    const { client, recorded } = recordingClient({});

    await loadRampOutboundCandidates({
      client: client as never,
      companyId: "company-1",
      provider: providerWith({ purchaseOrder: pushed, bill: off }),
      todayIso: TODAY
    });

    const exclusion = recorded[0]?.filters.find(
      (filter) => filter[0] === "not"
    );
    expect(exclusion?.[1]).toBe("status");
    expect(exclusion?.[3]).toContain('"Draft"');
    expect(exclusion?.[3]).toContain('"Rejected"');
  });

  it("honours the provider's own toggles rather than the generic defaults", async () => {
    // `pushInvoices: false` / `pushPurchaseOrders: false` reach us as the
    // provider's resolved per-entity config. Reading them off
    // `metadata.syncConfig` (which a spend platform never writes) would hand
    // back DEFAULT_SYNC_CONFIG, where both entities are enabled.
    const { client, recorded } = recordingClient({
      purchaseOrder: [{ id: "po-1" }],
      purchaseInvoice: [{ id: "pi-1" }]
    });

    const result = await loadRampOutboundCandidates({
      client: client as never,
      companyId: "company-1",
      provider: providerWith({ purchaseOrder: pushed, bill: off }),
      todayIso: TODAY
    });

    expect(recorded.map((entry) => entry.table)).toEqual(["purchaseOrder"]);
    expect(result.refs).toEqual([
      { entityType: "purchaseOrder", entityId: "po-1" }
    ]);
    expect(result.skippedReasons).toEqual(["invoices: push disabled"]);
  });

  it("reads nothing at all when both entities are off", async () => {
    const { client, recorded } = recordingClient({
      purchaseOrder: [{ id: "po-1" }]
    });

    const result = await loadRampOutboundCandidates({
      client: client as never,
      companyId: "company-1",
      provider: providerWith({}),
      todayIso: TODAY
    });

    expect(recorded).toEqual([]);
    expect(result.refs).toEqual([]);
    expect(result.skippedReasons).toEqual([
      "purchase orders: push disabled",
      "invoices: push disabled"
    ]);
  });

  it("scopes every read to the company", async () => {
    const { client, recorded } = recordingClient({});

    await loadRampOutboundCandidates({
      client: client as never,
      companyId: "company-1",
      provider: providerWith({ purchaseOrder: pushed, bill: pushed }),
      todayIso: TODAY
    });

    for (const entry of recorded) {
      expect(entry.filters).toContainEqual(["eq", "companyId", "company-1"]);
    }
  });
});
