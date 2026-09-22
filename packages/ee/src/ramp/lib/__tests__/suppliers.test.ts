import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveMerchantSupplier } from "../suppliers";

// Mock the Kysely-side mapping service the resolver constructs. The path is the
// one `suppliers.ts` imports (`../../accounting/core/external-mapping`), resolved
// relative to THIS test file.
const getEntityId = vi.fn();
const link = vi.fn();
vi.mock("../../../accounting/core/external-mapping", () => ({
  createMappingService: () => ({ getEntityId, link })
}));

type Result = { data: unknown; error: unknown };

/** Recorded across a run so a test can assert what the resolver did. */
type Recorder = {
  ilikeArgs: unknown[];
  supplierInserts: number;
};

/**
 * A minimal chainable Supabase stub. `route(table, calls)` returns the terminal
 * result for a chain; `select/eq/ilike/insert` are pass-through recorders.
 */
function makeClient(
  route: (table: string, calls: { m: string; a: unknown[] }[]) => Result,
  rec: Recorder
): SupabaseClient {
  const from = vi.fn((table: string) => {
    const calls: { m: string; a: unknown[] }[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    for (const m of ["select", "eq", "insert", "update"]) {
      builder[m] = vi.fn((...a: unknown[]) => {
        calls.push({ m, a });
        if (m === "insert" && table === "supplier") rec.supplierInserts += 1;
        return builder;
      });
    }
    builder.ilike = vi.fn((...a: unknown[]) => {
      calls.push({ m: "ilike", a });
      if (table === "supplier") rec.ilikeArgs.push(a[1]);
      return builder;
    });
    const terminal = (m: string) =>
      vi.fn((...a: unknown[]) => {
        calls.push({ m, a });
        return Promise.resolve(route(table, calls));
      });
    builder.maybeSingle = terminal("maybeSingle");
    builder.single = terminal("single");
    builder.limit = terminal("limit");
    return builder;
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from } as any;
}

type Scenario = {
  mappingHit?: string; // getEntityId returns this id
  nameMatch?: string; // an existing supplier matches by name
  catchAllExisting?: string; // the house "Card Merchant" supplier already exists
  catchAllInsertId?: string; // id returned when the house supplier is created
};

function router(scenario: Scenario, rec: Recorder) {
  return (table: string, calls: { m: string; a: unknown[] }[]): Result => {
    if (table === "supplierType") {
      // ensureSupplierTypeId: the "Card Merchant" type already exists.
      return { data: { id: "st_card" }, error: null };
    }
    if (table === "supplier") {
      const hasInsert = calls.some((c) => c.m === "insert");
      const hasIlike = calls.some((c) => c.m === "ilike");
      if (hasInsert) {
        return {
          data: { id: scenario.catchAllInsertId ?? "sup_new" },
          error: null
        };
      }
      if (hasIlike) {
        return {
          data: scenario.nameMatch ? [{ id: scenario.nameMatch }] : [],
          error: null
        };
      }
      // catch-all find (eq name + eq supplierTypeId + maybeSingle)
      return {
        data: scenario.catchAllExisting
          ? { id: scenario.catchAllExisting }
          : null,
        error: null
      };
    }
    throw new Error(`unexpected table ${table}`);
  };
}

function runResolve(
  scenario: Scenario,
  merchant: { id?: string | null; name: string }
): { promise: Promise<string>; rec: Recorder } {
  const rec: Recorder = { ilikeArgs: [], supplierInserts: 0 };
  getEntityId.mockResolvedValue(scenario.mappingHit ?? null);
  const client = makeClient(router(scenario, rec), rec);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kysely = {} as any;
  return {
    promise: resolveMerchantSupplier(client, kysely, "company-1", merchant),
    rec
  };
}

describe("resolveMerchantSupplier", () => {
  beforeEach(() => {
    getEntityId.mockReset();
    link.mockReset();
  });

  it("returns the mapped supplier when the merchant is already mapped", async () => {
    const { promise, rec } = runResolve(
      { mappingHit: "sup_mapped" },
      { id: "ramp-merchant-1", name: "Shell Oil" }
    );
    expect(await promise).toBe("sup_mapped");
    expect(rec.supplierInserts).toBe(0);
    expect(rec.ilikeArgs).toHaveLength(0); // no name query when mapped
    expect(link).not.toHaveBeenCalled();
  });

  it("links an existing supplier matched by exact name", async () => {
    const { promise, rec } = runResolve(
      { nameMatch: "sup_mcmaster" },
      { id: "ramp-merchant-2", name: "McMaster-Carr" }
    );
    expect(await promise).toBe("sup_mcmaster");
    expect(rec.supplierInserts).toBe(0);
    expect(link).toHaveBeenCalledWith(
      "merchant",
      "sup_mcmaster",
      expect.anything(),
      "ramp-merchant-2",
      expect.objectContaining({ createdBy: "system" })
    );
  });

  it("creates the single house supplier when there is no mapping or name match", async () => {
    const { promise, rec } = runResolve(
      { catchAllInsertId: "sup_catchall" },
      { id: "ramp-merchant-3", name: "Some Gas Station" }
    );
    expect(await promise).toBe("sup_catchall");
    expect(rec.supplierInserts).toBe(1);
    // The catch-all fallback must NOT write a per-merchant mapping.
    expect(link).not.toHaveBeenCalled();
  });

  it("reuses the existing house supplier without a second insert", async () => {
    const { promise, rec } = runResolve(
      { catchAllExisting: "sup_catchall" },
      { id: "ramp-merchant-4", name: "Another One-Off" }
    );
    expect(await promise).toBe("sup_catchall");
    expect(rec.supplierInserts).toBe(0);
    expect(link).not.toHaveBeenCalled();
  });

  it("escapes ilike wildcards in the merchant name", async () => {
    const { promise, rec } = runResolve(
      { catchAllExisting: "sup_catchall" },
      { id: "ramp-merchant-5", name: "50% Off Supply" }
    );
    await promise;
    expect(rec.ilikeArgs).toEqual(["50\\% Off Supply"]);
  });
});
