import { describe, expect, it, vi } from "vitest";
import { SERVICE_RULE_ERROR_CODE } from "~/utils/supabase";

// Services that used to report failure as success (`{ error }` alone,
// `{ success: false }`, `{ ok: false }`, `data?.[0]`, a Kysely bigint) now return
// the `{ data, error }` envelope. Each case stubs only the database response the
// branch under test reads, and asserts the envelope the caller receives.

// The service module graphs load @carbon/glossary and Lingui `msg` descriptors
// at module load, which plain vitest does not transform.
vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => [],
  getDefinitionText: () => "",
  getTermText: () => "",
  listEntries: () => []
}));
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | string, ...values: unknown[]) =>
    Array.isArray(strings)
      ? strings.reduce(
          (acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""),
          ""
        )
      : String(strings)
}));

const production = await import("~/modules/production/production.service");
const sales = await import("~/modules/sales/sales.service");
const purchasing = await import("~/modules/purchasing/purchasing.service");

/** A client whose every query chain resolves to `response`. */
function clientResolving(response: unknown) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const method of [
    "select",
    "update",
    "eq",
    "in",
    "order"
  ]) {
    chain[method] = self;
  }
  chain.single = async () => response;
  chain.maybeSingle = async () => response;
  chain.then = (resolve: (value: unknown) => unknown) => resolve(response);
  return {
    from: () => chain,
    rpc: async () => response
  } as never;
}

const noRow = { data: null, error: null };

describe("assembly services split not-found from no-model", () => {
  const args = { assemblyInstructionId: "ai_missing", companyId: "c1", userId: "u1" };

  it("autoMatchAssemblyComponents: an unknown instruction is not found", async () => {
    const result = await production.autoMatchAssemblyComponents(
      clientResolving(noRow),
      args
    );
    expect(result).toEqual({
      data: null,
      error: {
        code: SERVICE_RULE_ERROR_CODE,
        message: "Assembly instruction not found"
      }
    });
  });

  it("autoMatchAssemblyComponents: an instruction without a model says so", async () => {
    const result = await production.autoMatchAssemblyComponents(
      clientResolving({
        data: { id: "ai1", itemId: "item1", modelUploadId: null, modelUpload: null },
        error: null
      }),
      args
    );
    expect(result.error?.message).toBe("This instruction has no model");
  });

  it("generateAssemblyStepsFromPlan: an unknown instruction is not found", async () => {
    const result = await production.generateAssemblyStepsFromPlan(
      clientResolving(noRow),
      args
    );
    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({
      code: SERVICE_RULE_ERROR_CODE,
      reason: "not-found"
    });
  });

  it("syncAssemblyStepMaterialsFromMappings: an unknown instruction is an error, not { created: 0 }", async () => {
    const result = await production.syncAssemblyStepMaterialsFromMappings(
      clientResolving(noRow),
      args
    );
    expect(result).toEqual({
      data: null,
      error: {
        code: SERVICE_RULE_ERROR_CODE,
        message: "Assembly instruction not found"
      }
    });
  });

  it("passes a database failure through unchanged", async () => {
    const dbError = { code: "42501", message: "permission denied" };
    const result = await production.autoMatchAssemblyComponents(
      clientResolving({ data: null, error: dbError }),
      args
    );
    expect(result).toEqual({ data: null, error: dbError });
  });
});

describe("sales order cancel reports an unknown order", () => {
  it("cancelSalesOrder returns the not-found error from the status update", async () => {
    const notFound = {
      code: "PGRST116",
      message: "JSON object requested, multiple (or no) rows returned"
    };
    const result = await sales.cancelSalesOrder(
      clientResolving({ data: null, error: notFound }),
      { id: "SO-missing", userId: "u1" }
    );
    expect(result).toEqual({ data: null, error: notFound });
  });
});

describe("single-record RPC reads report zero rows as not found", () => {
  it("getOpportunity", async () => {
    const result = await sales.getOpportunity(
      clientResolving({ data: [], error: null }),
      "opp_missing"
    );
    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({ code: "PGRST116" });
  });

  it("getSupplierInteraction", async () => {
    const result = await purchasing.getSupplierInteraction(
      clientResolving({ data: [], error: null }),
      "si_missing"
    );
    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({ code: "PGRST116" });
  });

  it("returns the first row when there is one", async () => {
    const row = { id: "opp1", companyId: "c1" };
    const result = await sales.getOpportunity(
      clientResolving({ data: [row], error: null }),
      "opp1"
    );
    expect(result).toMatchObject({ data: row, error: null });
  });

  it("still short-circuits a null id to an empty read", async () => {
    expect(await sales.getOpportunity(clientResolving(noRow), null)).toEqual({
      data: null,
      error: null
    });
  });
});

describe("unassignPeopleWeek", () => {
  it("returns a JSON count instead of Kysely's bigint DeleteResult", async () => {
    const query = {
      where: () => query,
      executeTakeFirst: async () => ({ numDeletedRows: 4n })
    };
    const db = { deleteFrom: () => query } as never;
    const result = await production.unassignPeopleWeek(db, {
      companyId: "c1",
      employeeId: "e1",
      workCenterId: "wc1",
      weekStart: "2026-09-28",
      shiftId: null
    });
    expect(result).toEqual({ removed: 4 });
    expect(JSON.stringify(result)).toBe('{"removed":4}');
  });
});
