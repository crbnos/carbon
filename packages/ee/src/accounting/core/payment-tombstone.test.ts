import { describe, expect, it, vi } from "vitest";
import { findPaymentCompositesByRemoteId } from "./payment-tombstone";

/**
 * Minimal chainable supabase-query mock:
 * `from(...).select(...).eq(...).eq(...).eq(...).like(...)` resolves to
 * `{ data, error }`. `captured` records the terminal query shape for assertions.
 */
function makeClient(
  rows: { externalId: string | null }[] | null,
  error?: { message: string }
) {
  const captured: Record<string, unknown> = {};
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      captured[col] = val;
      return builder;
    },
    like: (col: string, pattern: string) => {
      captured.likeColumn = col;
      captured.likePattern = pattern;
      return Promise.resolve(
        error ? { data: null, error } : { data: rows, error: null }
      );
    }
  };
  const client = {
    from: (table: string) => {
      captured.table = table;
      return builder;
    }
  };
  return { client: client as any, captured };
}

describe("findPaymentCompositesByRemoteId", () => {
  it("resolves the AP composite from a bare payment id via suffix match", async () => {
    const { client, captured } = makeClient([
      { externalId: "bill:bill-9:bp-1" }
    ]);

    const composites = await findPaymentCompositesByRemoteId(client, {
      companyId: "company-1",
      integration: "quickbooks",
      paymentRemoteId: "bp-1"
    });

    expect(composites).toEqual(["bill:bill-9:bp-1"]);
    // Scoped to this company's payment mappings for this integration.
    expect(captured.table).toBe("externalIntegrationMapping");
    expect(captured.companyId).toBe("company-1");
    expect(captured.integration).toBe("quickbooks");
    expect(captured.entityType).toBe("payment");
    expect(captured.likeColumn).toBe("externalId");
    expect(captured.likePattern).toBe("%:bp-1");
  });

  it("resolves the prefix-less AR composite too", async () => {
    const { client } = makeClient([{ externalId: "inv-7:pay-1" }]);

    expect(
      await findPaymentCompositesByRemoteId(client, {
        companyId: "c",
        integration: "quickbooks",
        paymentRemoteId: "pay-1"
      })
    ).toEqual(["inv-7:pay-1"]);
  });

  it("drops coarse LIKE matches that do not exactly end with `:<id>`", async () => {
    // The JS endsWith guard rejects a row whose id merely shares the trailing
    // characters (`:xbp-1` does not end with `:bp-1`) and skips null externalIds.
    const { client } = makeClient([
      { externalId: "bill:bill-9:bp-1" },
      { externalId: "bill:bill-3:xbp-1" },
      { externalId: null }
    ]);

    expect(
      await findPaymentCompositesByRemoteId(client, {
        companyId: "c",
        integration: "quickbooks",
        paymentRemoteId: "bp-1"
      })
    ).toEqual(["bill:bill-9:bp-1"]);
  });

  it("returns [] (logged) on a query error rather than fabricating a void", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { client } = makeClient(null, { message: "boom" });

    expect(
      await findPaymentCompositesByRemoteId(client, {
        companyId: "c",
        integration: "quickbooks",
        paymentRemoteId: "bp-1"
      })
    ).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("returns [] when nothing maps (never synced / not ours)", async () => {
    const { client } = makeClient([]);

    expect(
      await findPaymentCompositesByRemoteId(client, {
        companyId: "c",
        integration: "quickbooks",
        paymentRemoteId: "bp-1"
      })
    ).toEqual([]);
  });
});
