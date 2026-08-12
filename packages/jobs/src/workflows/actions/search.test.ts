import type { Database } from "@carbon/database";
import {
  entityValue,
  MAX_LIST_ITEMS,
  nullValue,
  primitiveValue,
  type RuntimeValue,
  type SearchCriterion,
  WORKFLOW_ENTITIES
} from "@carbon/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { runSearch } from "./search";

interface Call {
  method: string;
  args: unknown[];
}

const CHAINED = [
  "select",
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "ilike",
  "is",
  "not",
  "order"
] as const;

/** A Supabase client that records every call and returns the rows it was given. */
function createStub(options?: {
  rows?: Record<string, unknown>[];
  error?: { message: string };
}) {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = {};

  for (const method of CHAINED) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.limit = (...args: unknown[]) => {
    calls.push({ method: "limit", args });
    return Promise.resolve({
      data: options?.error ? null : (options?.rows ?? []),
      error: options?.error ?? null
    });
  };

  const client = {
    from: (table: string) => {
      calls.push({ method: "from", args: [table] });
      return chain;
    }
  };

  return { client: client as unknown as SupabaseClient<Database>, calls };
}

function called(calls: Call[], method: string): Call[] {
  return calls.filter((call) => call.method === method);
}

function search(
  client: SupabaseClient<Database>,
  overrides?: {
    entity?: string;
    returns?: "one" | "list";
    criteria?: SearchCriterion[];
  }
) {
  return runSearch({
    client,
    companyId: "co1",
    entity: overrides?.entity ?? "purchaseOrder",
    returns: overrides?.returns ?? "one",
    criteria: overrides?.criteria ?? []
  });
}

function criterion(
  operator: SearchCriterion["operator"],
  value: RuntimeValue,
  field = "supplierReference"
): SearchCriterion {
  return { field, operator, value };
}

const row = { id: "po1", supplierReference: "ACME-1" };

describe("runSearch operators", () => {
  const text = primitiveValue("string", "acme");
  const amount = primitiveValue("number", 10);

  const cases: Array<[string, SearchCriterion, Call]> = [
    [
      "eq",
      criterion("eq", text),
      { method: "eq", args: ["supplierReference", "acme"] }
    ],
    [
      "neq",
      criterion("neq", text),
      { method: "neq", args: ["supplierReference", "acme"] }
    ],
    [
      "gt",
      criterion("gt", amount, "exchangeRate"),
      { method: "gt", args: ["exchangeRate", 10] }
    ],
    [
      "gte",
      criterion("gte", amount, "exchangeRate"),
      { method: "gte", args: ["exchangeRate", 10] }
    ],
    [
      "lt",
      criterion("lt", amount, "exchangeRate"),
      { method: "lt", args: ["exchangeRate", 10] }
    ],
    [
      "lte",
      criterion("lte", amount, "exchangeRate"),
      { method: "lte", args: ["exchangeRate", 10] }
    ],
    [
      "contains",
      criterion("contains", text),
      { method: "ilike", args: ["supplierReference", "%acme%"] }
    ],
    [
      "startsWith",
      criterion("startsWith", text),
      { method: "ilike", args: ["supplierReference", "acme%"] }
    ],
    [
      "endsWith",
      criterion("endsWith", text),
      { method: "ilike", args: ["supplierReference", "%acme"] }
    ]
  ];

  it.each(
    cases
  )("maps %s to the matching filter", async (_name, rule, expected) => {
    const { client, calls } = createStub({ rows: [row] });
    const outcome = await search(client, { criteria: [rule] });

    expect(outcome.ok).toBe(true);
    expect(calls).toContainEqual(expected);
  });

  it("compares an entity by its id", async () => {
    const { client, calls } = createStub({ rows: [row] });
    await search(client, {
      criteria: [criterion("eq", entityValue("supplier", "s1"), "supplierId")]
    });

    expect(calls).toContainEqual({ method: "eq", args: ["supplierId", "s1"] });
  });

  it("refuses an operator it cannot express", async () => {
    const { client } = createStub({ rows: [row] });
    const outcome = await search(client, {
      criteria: [criterion("isSet", primitiveValue("string", "acme"))]
    });

    expect(outcome).toEqual({
      ok: false,
      error: 'We cannot search by "isSet".'
    });
  });
});

describe("runSearch against nothing", () => {
  it("asks for a null column with is", async () => {
    const { client, calls } = createStub({ rows: [row] });
    await search(client, { criteria: [criterion("eq", nullValue())] });

    expect(calls).toContainEqual({
      method: "is",
      args: ["supplierReference", null]
    });
  });

  it("asks for a set column with not is", async () => {
    const { client, calls } = createStub({ rows: [row] });
    await search(client, { criteria: [criterion("neq", nullValue())] });

    expect(calls).toContainEqual({
      method: "not",
      args: ["supplierReference", "is", null]
    });
  });

  it("matches nothing when nothing is ordered, exactly as compare does", async () => {
    const { client, calls } = createStub({ rows: [row] });
    const outcome = await search(client, {
      criteria: [criterion("gt", nullValue(), "orderDate")]
    });

    expect(outcome).toEqual({
      ok: true,
      value: nullValue(),
      matched: 0,
      dropped: 0
    });
    expect(called(calls, "limit")).toHaveLength(0);
  });
});

describe("runSearch results", () => {
  it("always scopes the read to the company", async () => {
    const { client, calls } = createStub({ rows: [row] });
    await search(client);

    expect(calls).toContainEqual({ method: "from", args: ["purchaseOrder"] });
    expect(calls).toContainEqual({ method: "eq", args: ["companyId", "co1"] });
  });

  it("orders newest first and asks for one more than the cap", async () => {
    const { client, calls } = createStub({ rows: [row] });
    await search(client);

    expect(calls).toContainEqual({
      method: "order",
      args: ["createdAt", { ascending: false }]
    });
    expect(calls).toContainEqual({
      method: "limit",
      args: [MAX_LIST_ITEMS + 1]
    });
  });

  it("hands back the one record with its row attached", async () => {
    const { client } = createStub({ rows: [row] });
    const outcome = await search(client);

    expect(outcome).toEqual({
      ok: true,
      value: entityValue("purchaseOrder", "po1", row),
      matched: 1,
      dropped: 0
    });
  });

  it("reports no match honestly rather than failing", async () => {
    const { client } = createStub({ rows: [] });
    const outcome = await search(client);

    expect(outcome).toEqual({
      ok: true,
      value: nullValue(),
      matched: 0,
      dropped: 0
    });
  });

  it("returns an empty list when a list search matches nothing", async () => {
    const { client } = createStub({ rows: [] });
    const outcome = await search(client, { returns: "list" });

    expect(outcome).toEqual({
      ok: true,
      value: {
        kind: "list",
        of: { kind: "entity", of: "purchaseOrder" },
        items: []
      },
      matched: 0,
      dropped: 0
    });
  });

  it("caps an over-long list and says how many it dropped", async () => {
    const rows = Array.from({ length: MAX_LIST_ITEMS + 1 }, (_, index) => ({
      id: `po${index}`
    }));
    const { client } = createStub({ rows });
    const outcome = await search(client, { returns: "list" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.matched).toBe(MAX_LIST_ITEMS);
    expect(outcome.dropped).toBe(1);
    expect(outcome.value).toMatchObject({ kind: "list" });
  });

  it("surfaces a failed read as a failure", async () => {
    const { client } = createStub({ error: { message: "permission denied" } });
    const outcome = await search(client);

    expect(outcome).toEqual({ ok: false, error: "permission denied" });
  });

  it("refuses an entity that is not in the registry", async () => {
    const { client, calls } = createStub({ rows: [row] });
    const outcome = await search(client, { entity: "unicorn" });

    expect(outcome).toEqual({
      ok: false,
      error: "We no longer know what a unicorn is."
    });
    expect(calls).toHaveLength(0);
  });
});

describe("runSearch column selection", () => {
  it("selects the catalog's declared columns, never *", async () => {
    // select("*") put every column of every match into workflowStepRun.output,
    // retained 30 days — a payload-size and data-minimisation problem.
    const { client, calls } = createStub({ rows: [row] });
    await search(client);

    const selected = called(calls, "select")[0]?.args[0] as string;
    expect(selected).not.toBe("*");
    const columns = selected.split(", ");
    expect(columns).toContain("id");
    expect(columns).toEqual(
      expect.arrayContaining(Object.keys(WORKFLOW_ENTITIES.purchaseOrder ?? {}))
    );
  });

  it("always includes id, since the row is keyed by it", async () => {
    const { client, calls } = createStub({ rows: [row] });
    await search(client, { entity: "supplier" });

    const selected = called(calls, "select")[0]?.args[0] as string;
    expect(selected.split(", ")).toContain("id");
  });

  it("refuses an entity the catalog no longer describes", async () => {
    const { client } = createStub({ rows: [row] });
    const result = await search(client, { entity: "notAThing" });
    expect(result).toEqual({
      ok: false,
      error: "We no longer know what a notAThing is."
    });
  });
});

describe("runSearch field validation", () => {
  it("refuses a field the catalog does not declare", async () => {
    // Defence in depth: the field goes straight into a PostgREST filter, and a
    // definition saved before a catalog change never gets re-validated.
    const { client, calls } = createStub({ rows: [row] });
    const outcome = await search(client, {
      criteria: [criterion("eq", primitiveValue("string", "x"), "password")]
    });

    expect(outcome).toEqual({
      ok: false,
      error: 'We cannot search a purchaseOrder by "password".'
    });
    expect(called(calls, "eq").map((call) => call.args[0])).not.toContain(
      "password"
    );
  });
});
