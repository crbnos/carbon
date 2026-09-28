import { beforeEach, describe, expect, it, vi } from "vitest";

// The fixed-asset commands carry what used to be the register / dispose /
// depreciation-post route bodies, and are now also MCP tools. These tests pin
// the refusals a caller can hit before anything is posted — the rules the
// screens enforce — plus the zero-row detection on the no-accounting register
// path. The Supabase client is the HTTP boundary and answers per table; the
// Kysely handle must never be reached on a refused path.

vi.mock("~/modules/settings", () => ({
  getCompanySettings: (client: StubClient, companyId: string) =>
    client.from("companySettings").select("*").eq("id", companyId).single()
}));
// @carbon/glossary evaluates Lingui `msg` macros at module load, which vitest
// does not transform; the accounting module graph pulls it in transitively.
vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));
vi.mock("@carbon/auth/auth.server", () => ({ requirePermissions: vi.fn() }));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn()
}));

import {
  disposeFixedAsset,
  postDepreciationRun,
  registerFixedAsset
} from "./accounting.server";

type Result = { data: unknown; error: unknown };
type StubClient = ReturnType<typeof stubClient>;

/**
 * A Supabase client whose every query on `table` resolves to `results[table]`
 * (or `results["table:update"]` for an update). Filters are accepted and
 * ignored: RLS and filters are the database's job, not the command's.
 */
function stubClient(results: Record<string, Result>) {
  interface Builder extends PromiseLike<Result> {
    select(...args: unknown[]): Builder;
    eq(...args: unknown[]): Builder;
    lte(...args: unknown[]): Builder;
    gte(...args: unknown[]): Builder;
    order(...args: unknown[]): Builder;
    limit(...args: unknown[]): Builder;
    in(...args: unknown[]): Builder;
    is(...args: unknown[]): Builder;
    update(...args: unknown[]): Builder;
    single(): Promise<Result>;
    maybeSingle(): Promise<Result>;
  }
  return {
    from(table: string): Builder {
      let op = "select";
      const answer = (): Result =>
        results[`${table}:${op}`] ??
        results[table] ?? { data: null, error: { message: `no ${table}` } };
      const builder: Builder = {
        select: () => builder,
        eq: () => builder,
        lte: () => builder,
        gte: () => builder,
        order: () => builder,
        limit: () => builder,
        in: () => builder,
        is: () => builder,
        update: () => {
          op = "update";
          return builder;
        },
        single: async () => answer(),
        maybeSingle: async () => answer(),
        then: (onFulfilled, onRejected) =>
          Promise.resolve(answer()).then(onFulfilled, onRejected)
      };
      return builder;
    },
    rpc: async () => ({ data: null, error: { message: "no rpc" } })
  };
}

/** A Kysely handle that fails the test if a refused path reaches it. */
const unreachableDb = new Proxy(
  {},
  {
    get() {
      throw new Error("the Kysely handle must not be used on this path");
    }
  }
) as never;

const context = { companyId: "c1", companyGroupId: "g1", userId: "u1" };

const registration = {
  acquisitionCost: 1000,
  acquisitionDate: "2026-09-01",
  accumulatedDepreciation: 0,
  depreciationStartDate: "2026-09-01"
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registerFixedAsset", () => {
  it("with accounting disabled, refuses an asset that is no longer Draft (zero rows updated)", async () => {
    const client = stubClient({
      companySettings: { data: { accountingEnabled: false }, error: null },
      "fixedAsset:update": { data: [], error: null }
    });
    const result = await registerFixedAsset(client as never, unreachableDb, {
      ...context,
      fixedAssetId: "fa1",
      registration
    });
    expect(result.error?.flash).toBe("Only Draft assets can be registered");
  });

  it("with accounting disabled, a matched Draft row registers without a journal", async () => {
    const client = stubClient({
      companySettings: { data: { accountingEnabled: false }, error: null },
      "fixedAsset:update": { data: [{ id: "fa1" }], error: null }
    });
    const result = await registerFixedAsset(client as never, unreachableDb, {
      ...context,
      fixedAssetId: "fa1",
      registration
    });
    expect(result).toEqual({
      data: { id: "fa1", status: "Active" },
      error: null
    });
  });

  it("with accounting enabled, refuses before posting when the asset class has no GL accounts", async () => {
    const client = stubClient({
      companySettings: { data: { accountingEnabled: true }, error: null },
      fixedAsset: {
        data: {
          fixedAssetId: "FA000001",
          locationId: "loc1",
          fixedAssetClassId: "cls1",
          fixedAssetClass: null
        },
        error: null
      },
      accountDefault: {
        data: { retainedEarningsAccount: "3200" },
        error: null
      },
      dimension: { data: [], error: null },
      accountingPeriod: {
        data: { id: "p1", closeStatus: "Open" },
        error: null
      }
    });
    const result = await registerFixedAsset(client as never, unreachableDb, {
      ...context,
      fixedAssetId: "fa1",
      registration
    });
    expect(result.error?.flash).toMatch(/^Missing GL accounts/);
  });
});

describe("disposeFixedAsset", () => {
  it.each([
    "Draft",
    "Disposed"
  ])("refuses a %s asset before any posting (the dispose screen's rule)", async (status) => {
    const client = stubClient({
      fixedAsset: {
        data: { id: "fa1", fixedAssetId: "FA000001", status },
        error: null
      },
      dimension: { data: [], error: null }
    });
    const result = await disposeFixedAsset(client as never, unreachableDb, {
      ...context,
      fixedAssetId: "fa1",
      disposalDate: "2026-09-30"
    });
    expect(result.error?.message).toBe(
      "Only Active or Fully Depreciated assets can be disposed"
    );
  });
});

describe("postDepreciationRun", () => {
  it("refuses a run that is not Draft", async () => {
    const client = stubClient({
      depreciationRun: {
        data: { id: "dr1", status: "Posted", periodEnd: "2026-08-31" },
        error: null
      }
    });
    const result = await postDepreciationRun(client as never, unreachableDb, {
      ...context,
      depreciationRunId: "dr1"
    });
    expect(result.error?.flash).toBe("Run is not in Draft status");
  });
});
