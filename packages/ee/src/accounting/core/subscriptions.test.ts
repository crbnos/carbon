import { describe, expect, it, vi } from "vitest";
import { ProviderID } from "./models";
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
