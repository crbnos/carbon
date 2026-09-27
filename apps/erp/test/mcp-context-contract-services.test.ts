// End to end over the REAL service functions: the dispatcher builds the call
// from the manifest's declared context contract, the service builds its write,
// and a recording Supabase client — the one external boundary — shows what
// would have been sent to PostgREST. Each case is a reported bug class:
// an identity column the table does not have, an author rewritten on update,
// a declared createdBy never stamped, a positional updatedBy handed the whole
// body, a reorder row missing its updatedBy, an omitted optional param handed
// the body meant for its sibling.

import { describe, expect, it, vi } from "vitest";

// Lingui macros are compiled away in the app build, not under Vitest.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") }),
  t: (strings: TemplateStringsArray) => strings.join("")
}));
vi.mock("@carbon/glossary", () => ({
  getDefinitionText: () => "",
  getEntry: () => undefined,
  getTermText: () => "",
  glossaryEntries: () => [],
  hasEntry: () => false,
  listEntries: () => [],
  lookupEntry: () => undefined,
  termSlug: (term: string) => term,
  terms: {}
}));
// Only the modules under test, as the real registry spreads them.
vi.mock("~/routes/api+/v1+/lib/registry.server", async () => ({
  functionRegistry: {
    accounting: await import("~/modules/accounting/accounting.service"),
    items: await import("~/modules/items/items.service"),
    people: await import("~/modules/people/people.service"),
    production: await import("~/modules/production/production.service"),
    sales: await import("~/modules/sales/sales.service"),
    settings: await import("~/modules/settings/settings.service"),
    users: await import("~/modules/users/users.service")
  }
}));
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: () => ({ __kysely: true })
}));
// Server-only rule evaluation, irrelevant to the argument contract.
vi.mock("~/routes/api+/v1+/lib/sales-rules-gate.server", () => ({
  checkSalesRulesForOperation: vi.fn(async () => null)
}));

import type { AuthedContext } from "~/routes/api+/v1+/lib/base.server";
import { dispatchOperation } from "~/routes/api+/v1+/lib/dispatch.server";
import { operationsByName } from "~/routes/api+/v1+/lib/operations.server";

interface Write {
  table: string;
  method: string;
  payload: unknown;
}

interface Filter {
  table: string;
  method: string;
  args: unknown[];
}

/** A Supabase client that records every write and filter and answers every
 *  query with `{ data: null, error: null }`. */
function recordingClient() {
  const writes: Write[] = [];
  const filters: Filter[] = [];
  const builder = (table: string): unknown => {
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (value: unknown) => void) =>
              resolve({ data: null, error: null });
          }
          return (...args: unknown[]) => {
            const method = String(prop);
            if (["insert", "update", "upsert"].includes(method)) {
              writes.push({ table, method, payload: args[0] });
            } else if (["eq", "in", "is", "or", "not"].includes(method)) {
              filters.push({ table, method, args });
            }
            return proxy;
          };
        }
      }
    );
    return proxy;
  };
  const client = { from: (table: string) => builder(table) };
  return { client, writes, filters };
}

function context(client: unknown): AuthedContext {
  return {
    client: client as AuthedContext["client"],
    companyId: "c1",
    companyGroupId: "g1",
    userId: "u1",
    authKind: "session",
    scopes: {}
  };
}

async function run(name: string, input: Record<string, unknown>) {
  const meta = operationsByName.get(name);
  if (!meta) throw new Error(`${name} is not in the manifest`);
  const recorder = recordingClient();
  await dispatchOperation(meta, context(recorder.client), input);
  return recorder;
}

describe("the declared context contract, through the real services", () => {
  it("an edit of a row whose table has no createdBy column carries updatedBy only", async () => {
    const { writes } = await run("sales_upsertSalesOrderShipment", {
      id: "sos1",
      trackingNumber: "T-100",
      createdBy: "forged"
    });
    expect(writes).toEqual([
      {
        table: "salesOrderShipment",
        method: "update",
        payload: { id: "sos1", trackingNumber: "T-100", updatedBy: "u1" }
      }
    ]);
  });

  it("an update-only upsert no longer rewrites the author", async () => {
    const { writes } = await run("items_upsertItemCost", {
      itemId: "item1",
      costingMethod: "Standard",
      unitCost: 4
    });
    expect(writes).toHaveLength(1);
    expect(writes[0].table).toBe("itemCost");
    expect(writes[0].payload).toMatchObject({ updatedBy: "u1", unitCost: 4 });
    expect(writes[0].payload).not.toHaveProperty("createdBy");
    expect(writes[0].payload).not.toHaveProperty("companyId");
  });

  it("a declared createdBy is stamped whatever the function verb", async () => {
    const { writes } = await run("people_clockIn", { employeeId: "e1" });
    expect(writes).toEqual([
      {
        table: "timeCardEntry",
        method: "insert",
        payload: { employeeId: "e1", companyId: "c1", createdBy: "u1" }
      }
    ]);
  });

  it("a positional updatedBy is the acting user", async () => {
    const { writes } = await run("production_updateJobOperationStatus", {
      id: "op1",
      status: "Done"
    });
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toMatchObject({ status: "Done", updatedBy: "u1" });
  });

  it("reorder rows are written with the acting user", async () => {
    const { writes } = await run("items_updateMaterialOrder", {
      updates: [
        { id: "m1", order: 2 },
        { id: "m2", order: 1 }
      ]
    });
    expect(writes).toEqual([
      { table: "methodMaterial", method: "update", payload: { order: 2, updatedBy: "u1" } },
      { table: "methodMaterial", method: "update", payload: { order: 1, updatedBy: "u1" } }
    ]);
  });

  it("a table with companyId only gets companyId only", async () => {
    const { writes } = await run("users_insertGroup", { name: "Planners" });
    expect(writes).toEqual([
      {
        table: "group",
        method: "insert",
        payload: { name: "Planners", companyId: "c1" }
      }
    ]);
  });

  it("a group-scoped create gets companyGroupId, not companyId", async () => {
    const { writes } = await run("accounting_upsertAccount", {
      _operation: "create",
      name: "Cash",
      number: "1000"
    });
    expect(writes).toHaveLength(1);
    expect(writes[0].table).toBe("account");
    const [row] = writes[0].payload as Record<string, unknown>[];
    expect(row).toMatchObject({ companyGroupId: "g1", createdBy: "u1" });
    expect(row).not.toHaveProperty("companyId");
  });

  it("the company row is updated without identity fields it has no column for", async () => {
    const { writes, filters } = await run("settings_updateCompany", {
      name: "Acme",
      companyId: "other-company"
    });
    expect(writes).toEqual([
      {
        table: "company",
        method: "update",
        payload: { name: "Acme", updatedBy: "u1" }
      }
    ]);
    // The tenant is the positional companyId, from context.
    expect(filters).toContainEqual({
      table: "company",
      method: "eq",
      args: ["id", "c1"]
    });
  });

  it("an identity-named FORM field is the caller's data, as in the form (the quantity's Employee)", async () => {
    const { writes } = await run("production_updateProductionQuantity", {
      id: "pq1",
      jobOperationId: "op1",
      type: "Production",
      quantity: 3,
      createdBy: "employee-7"
    });
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toMatchObject({
      createdBy: "employee-7",
      updatedBy: "u1",
      quantity: 3
    });
  });

  it("an omitted optional id list reaches the service as undefined", async () => {
    const { filters } = await run("accounting_getAccountsInScope", {
      scope: { source: "scrapAccounts" }
    });
    expect(filters).toContainEqual({
      table: "account",
      method: "in",
      args: ["id", []]
    });
  });
});
