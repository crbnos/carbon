// Dispatch contract tests, pinned against REAL manifest entries.
//
// History: these began as an A/B parity harness against the legacy MCP
// `executeFunction` — every case ran both implementations and compared the captured
// service arguments element-by-element. The executor is deleted now, so the captured
// values stand as golden literals: they ARE executeFunction's behavior, and a change
// here is a behavior change for MCP, the agent, the workflow engine and HTTP at once.

import { ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  getAccountLedger: vi.fn(),
  getTrialBalance: vi.fn(),
  upsertAccount: vi.fn(),
  upsertQuoteLinePrices: vi.fn(),
  generateInventoryCountLines: vi.fn(),
  upsertNotificationPreference: vi.fn(),
  insertJob: vi.fn(),
  insertIssue: vi.fn(),
  insertPurchaseOrder: vi.fn(),
  insertSalesOrder: vi.fn(),
  getDepartments: vi.fn(),
  deleteApiKey: vi.fn(),
  upsertJob: vi.fn(),
  insertNote: vi.fn(),
  upsertStockTransfer: vi.fn(),
  getInventoryItems: vi.fn(),
  updateRevision: vi.fn(),
  FAKE_DB: { __kysely: true },
  FAKE_CLIENT: { __supabase: true }
}));

// The registry imports every module's service namespace; mock them all so the test
// never drags real app code (glossary/lingui/server-only graphs) into vitest. The
// exemplar modules export recording spies; the rest are empty namespaces.
vi.mock("~/modules/account/account.service", () => ({
  upsertNotificationPreference: spies.upsertNotificationPreference
}));
vi.mock("~/modules/accounting/accounting.ee.service", () => ({
  getAccountLedger: spies.getAccountLedger,
  getTrialBalance: spies.getTrialBalance,
  upsertAccount: spies.upsertAccount
}));
vi.mock("~/modules/documents/documents.service", () => ({}));
vi.mock("~/modules/inventory/inventory.service", () => ({
  generateInventoryCountLines: spies.generateInventoryCountLines,
  upsertStockTransfer: spies.upsertStockTransfer,
  getInventoryItems: spies.getInventoryItems
}));
vi.mock("~/modules/invoicing/invoicing.service", () => ({}));
vi.mock("~/modules/items/items.service", () => ({
  updateRevision: spies.updateRevision
}));
vi.mock("~/modules/people/people.service", () => ({
  getDepartments: spies.getDepartments
}));
vi.mock("~/modules/production/production.mcp.server", () => ({}));
vi.mock("~/modules/production/production.service", () => ({
  insertJob: spies.insertJob,
  upsertJob: spies.upsertJob
}));
vi.mock("~/modules/purchasing/purchasing.service", () => ({
  insertPurchaseOrder: spies.insertPurchaseOrder
}));
vi.mock("~/modules/quality/quality.service", () => ({
  insertIssue: spies.insertIssue
}));
vi.mock("~/modules/resources/resources.service", () => ({}));
vi.mock("~/modules/sales/sales.service", () => ({
  upsertQuoteLinePrices: spies.upsertQuoteLinePrices,
  insertSalesOrder: spies.insertSalesOrder
}));
vi.mock("~/modules/settings/settings.service", () => ({
  deleteApiKey: spies.deleteApiKey
}));
vi.mock("~/modules/shared/shared.service", () => ({
  insertNote: spies.insertNote
}));
vi.mock("~/modules/users/users.service", () => ({}));
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: () => spies.FAKE_DB
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  })
}));

import { MCP_BLOCKED_TOOL_NAMES } from "../../mcp+/lib/mcp-blocked-tools";
import type { AuthedContext } from "./base.server";
import { callOperation } from "./call.server";
import {
  type DispatchResult,
  dispatchOperation,
  enrichWithAuthContext
} from "./dispatch.server";
import { operationsByName } from "./operations.server";

const ctx: AuthedContext = {
  client: spies.FAKE_CLIENT as unknown as AuthedContext["client"],
  companyId: "c1",
  companyGroupId: "g1",
  userId: "u1",
  authKind: "session",
  scopes: {}
};

type Spy = ReturnType<typeof vi.fn>;

interface RunResult {
  dispatch?: DispatchResult;
  dispatchError?: unknown;
  calls: unknown[][];
}

async function runDispatch(
  name: string,
  spy: Spy,
  args?: Record<string, unknown>
): Promise<RunResult> {
  const meta = operationsByName.get(name);
  if (!meta) throw new Error(`${name} missing from the generated manifest`);

  let dispatch: DispatchResult | undefined;
  let dispatchError: unknown;
  try {
    dispatch = await dispatchOperation(meta, ctx, args);
  } catch (err) {
    dispatchError = err;
  }
  const calls = spy.mock.calls.map((c) => [...c]);
  spy.mockClear();

  return { dispatch, dispatchError, calls };
}

const allSpies = [
  spies.getAccountLedger,
  spies.getTrialBalance,
  spies.upsertAccount,
  spies.upsertQuoteLinePrices,
  spies.generateInventoryCountLines,
  spies.upsertNotificationPreference,
  spies.insertJob,
  spies.insertIssue,
  spies.insertPurchaseOrder,
  spies.insertSalesOrder,
  spies.getDepartments,
  spies.deleteApiKey,
  spies.upsertJob,
  spies.insertNote,
  spies.upsertStockTransfer,
  spies.getInventoryItems,
  spies.updateRevision
];

beforeEach(() => {
  for (const spy of allSpies) {
    spy.mockReset();
    spy.mockResolvedValue({ data: null, error: null });
  }
});

describe("dispatchOperation service-call contract (golden, ex-executeFunction parity)", () => {
  // The `companyId` in a. and a2. is the fix for the `args` branch skipping
  // enrichWithAuthContext. getAccountLedger's args type REQUIRES companyId; without
  // the stamp it took neither its companyId nor its companyIds branch and the query
  // went out unscoped in application code, leaning entirely on RLS.
  it("a. passes a flat-schema `args` through whole and stamps injectAuth fields", async () => {
    const r = await runDispatch(
      "accounting_getAccountLedger",
      spies.getAccountLedger,
      { accountNumber: "1000", limit: 5 }
    );
    expect(r.calls).toEqual([
      [spies.FAKE_CLIENT, { accountNumber: "1000", limit: 5, companyId: "c1" }]
    ]);
  });

  it("a2. fills context positional params (companyGroupId, companyId) from context", async () => {
    const r = await runDispatch(
      "accounting_getTrialBalance",
      spies.getTrialBalance,
      { startDate: "2026-01-01" }
    );
    expect(r.calls).toEqual([
      [
        spies.FAKE_CLIENT,
        "g1",
        "c1",
        { startDate: "2026-01-01", companyId: "c1" }
      ]
    ]);
  });

  it("b. _operation create at top level: stripped, createdBy/updatedBy/companyId stamped", async () => {
    const r = await runDispatch(
      "accounting_upsertAccount",
      spies.upsertAccount,
      {
        _operation: "create",
        account: { name: "Cash", number: "1000" }
      }
    );
    expect(r.calls).toEqual([
      [
        spies.FAKE_CLIENT,
        {
          name: "Cash",
          number: "1000",
          createdBy: "u1",
          updatedBy: "u1",
          companyId: "c1"
        }
      ]
    ]);
  });

  it("c. _operation update nested in the payload: stripped, createdBy suppressed", async () => {
    const r = await runDispatch(
      "accounting_upsertAccount",
      spies.upsertAccount,
      {
        account: { _operation: "update", id: "a1", name: "Cash" }
      }
    );
    const [, payload] = r.calls[0] as [unknown, Record<string, unknown>];
    expect(payload).toEqual({
      id: "a1",
      name: "Cash",
      updatedBy: "u1",
      companyId: "c1"
    });
    expect("createdBy" in payload).toBe(false);
  });

  it("d. caller-supplied createdBy on an update is removed (no forged attribution)", async () => {
    const r = await runDispatch(
      "accounting_upsertAccount",
      spies.upsertAccount,
      {
        _operation: "update",
        account: { id: "a1", createdBy: "forged" }
      }
    );
    const [, payload] = r.calls[0] as [unknown, Record<string, unknown>];
    expect("createdBy" in payload).toBe(false);
  });

  it("d2. caller-supplied createdBy on a CREATE is overwritten, not honoured", async () => {
    // It used to be stamped only when absent, so a create could be attributed to
    // any other user (verified live: a record stored createdBy "system" rather
    // than the key's own user). The array branch always overwrote; both shapes
    // must agree.
    const r = await runDispatch(
      "accounting_upsertAccount",
      spies.upsertAccount,
      {
        _operation: "create",
        account: { name: "Cash", createdBy: "forged-user" }
      }
    );
    const [, payload] = r.calls[0] as [unknown, Record<string, unknown>];
    expect(payload.createdBy).toBe("u1");
  });

  it("d3. an array payload overwrites a per-element createdBy too", async () => {
    const r = await runDispatch(
      "sales_upsertQuoteLinePrices",
      spies.upsertQuoteLinePrices,
      {
        quoteId: "q1",
        lineId: "l1",
        quoteLinePrices: [{ quantity: 1, createdBy: "forged-user" }]
      }
    );
    const rows = r.calls[0]?.at(-1) as Record<string, unknown>[];
    expect(rows[0].createdBy).toBe("u1");
  });

  it("e. conflicting _operation values are rejected before the service runs", async () => {
    const r = await runDispatch(
      "accounting_upsertAccount",
      spies.upsertAccount,
      {
        _operation: "create",
        account: { _operation: "update", name: "x" }
      }
    );
    expect(r.calls).toEqual([]);
    expect(r.dispatchError).toBeInstanceOf(ORPCError);
    expect((r.dispatchError as ORPCError<string, unknown>).message).toBe(
      "accounting_upsertAccount received conflicting _operation values (create, update)."
    );
  });

  it("f. missing _operation on a tool that requires it is rejected before the service runs", async () => {
    const r = await runDispatch(
      "accounting_upsertAccount",
      spies.upsertAccount,
      {
        account: { name: "x" }
      }
    );
    expect(r.calls).toEqual([]);
    expect(r.dispatchError).toBeInstanceOf(ORPCError);
    expect((r.dispatchError as ORPCError<string, unknown>).message).toBe(
      'accounting_upsertAccount requires _operation to be "create" (insert a new record) or "update" (modify an existing one).'
    );
  });

  it("g. array payload on an insert: every object element gets createdBy stamped AFTER the spread; nothing else injected", async () => {
    const r = await runDispatch(
      "sales_upsertQuoteLinePrices",
      spies.upsertQuoteLinePrices,
      {
        quoteId: "q1",
        lineId: "l1",
        quoteLinePrices: [
          { quantity: 1, unitPrice: 5, createdBy: "forged" },
          42
        ]
      }
    );
    expect(r.calls).toEqual([
      [
        spies.FAKE_DB,
        "c1",
        "q1",
        "l1",
        [{ quantity: 1, unitPrice: 5, createdBy: "u1" }, 42]
      ]
    ]);
    const rows = (r.calls[0] as unknown[])[4] as Record<string, unknown>[];
    expect("companyId" in rows[0]).toBe(false);
    expect("updatedBy" in rows[0]).toBe(false);
  });

  it("h. array payload on an update passes through untouched", () => {
    // No manifest op combines `_operation` with an array payload, so this pins the
    // enrichment helper directly.
    const rows = [{ id: "p1", createdBy: "orig" }];
    const out = enrichWithAuthContext(
      rows,
      ctx,
      ["companyId", "createdBy", "updatedBy"],
      "update"
    );
    expect(out).toBe(rows);
    expect(rows[0]).toEqual({ id: "p1", createdBy: "orig" });
  });

  it("i. a `db` service param receives the Kysely client from getDatabaseClient()", async () => {
    const r = await runDispatch(
      "inventory_generateInventoryCountLines",
      spies.generateInventoryCountLines,
      { locationId: "loc1" }
    );
    expect(r.calls).toEqual([
      [
        spies.FAKE_DB,
        {
          locationId: "loc1",
          companyId: "c1",
          createdBy: "u1",
          updatedBy: "u1"
        }
      ]
    ]);
  });

  it("j. a thenable-but-not-Promise result (Supabase builder) is awaited and unwrapped", async () => {
    spies.getAccountLedger.mockReset();
    spies.getAccountLedger.mockReturnValue({
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: "e1" }], error: null, count: 1 })
    });
    const r = await runDispatch(
      "accounting_getAccountLedger",
      spies.getAccountLedger,
      {}
    );
    expect(r.dispatch).toEqual({ data: [{ id: "e1" }], count: 1 });
  });

  it("k. a Supabase error throws BAD_REQUEST carrying the raw error (D4)", async () => {
    const supabaseError = {
      message: "duplicate key value",
      code: "23505",
      details: "Key (number)=(1000) already exists.",
      hint: null
    };
    spies.getAccountLedger.mockReset();
    spies.getAccountLedger.mockResolvedValue({
      data: null,
      error: supabaseError
    });
    const r = await runDispatch(
      "accounting_getAccountLedger",
      spies.getAccountLedger,
      {}
    );
    expect(r.dispatchError).toBeInstanceOf(ORPCError);
    const orpcError = r.dispatchError as ORPCError<string, unknown>;
    expect(orpcError.message).toBe("duplicate key value");
    // The raw error rides on the ORPCError so callOperation can reconstruct MCP's
    // byte-identical `Database error: ${JSON.stringify(error)}` text.
    expect(
      (orpcError.data as { supabase?: unknown } | undefined)?.supabase
    ).toEqual(supabaseError);
  });

  it("l. a single-key payload whose key matches no param is unwrapped positionally", async () => {
    const r = await runDispatch(
      "account_upsertNotificationPreference",
      spies.upsertNotificationPreference,
      { args: { channel: "email", enabled: true } }
    );
    expect(r.calls).toEqual([
      [spies.FAKE_CLIENT, { channel: "email", enabled: true, companyId: "c1" }]
    ]);
  });

  it("m. a flat-field payload matching no param is passed whole as the positional", async () => {
    const r = await runDispatch(
      "accounting_upsertAccount",
      spies.upsertAccount,
      {
        _operation: "create",
        name: "Cash",
        number: "1000"
      }
    );
    expect(r.calls).toEqual([
      [
        spies.FAKE_CLIENT,
        {
          name: "Cash",
          number: "1000",
          createdBy: "u1",
          updatedBy: "u1",
          companyId: "c1"
        }
      ]
    ]);
  });

  it("n. a Supabase { data, count } result keeps its count on the dispatch result", async () => {
    spies.getAccountLedger.mockReset();
    spies.getAccountLedger.mockResolvedValue({
      data: [{ id: "e1" }, { id: "e2" }],
      error: null,
      count: 7
    });
    const r = await runDispatch(
      "accounting_getAccountLedger",
      spies.getAccountLedger,
      {}
    );
    expect(r.dispatch).toEqual({
      data: [{ id: "e1" }, { id: "e2" }],
      count: 7
    });
  });

  // o-q: the `args` positional. Which of the two wire shapes an operation uses is
  // read off its own schema — a declared `args` object means the body wraps it.
  // Passing the wrapper through unopened left every filter undefined, so searches
  // returned unfiltered lists and getDocuments 400d on `.eq("active", undefined)`.
  it("o. an operation whose schema declares `args` gets the wrapper unwrapped", async () => {
    const r = await runDispatch("people_getDepartments", spies.getDepartments, {
      args: { search: "Engineering", limit: 10 }
    });
    expect(r.calls).toEqual([
      [
        spies.FAKE_CLIENT,
        "c1",
        { search: "Engineering", limit: 10, companyId: "c1" }
      ]
    ]);
  });

  it("p. the same operation still accepts a flat body (18 ops mix `args` with siblings)", async () => {
    const r = await runDispatch("people_getDepartments", spies.getDepartments, {
      search: "Engineering"
    });
    expect(r.calls).toEqual([
      [spies.FAKE_CLIENT, "c1", { search: "Engineering", companyId: "c1" }]
    ]);
  });

  it("q. an `args` wrapper is NOT unwrapped when the schema is flat", async () => {
    const r = await runDispatch(
      "accounting_getAccountLedger",
      spies.getAccountLedger,
      { args: { accountId: "a1" } }
    );
    expect(r.calls).toEqual([
      [spies.FAKE_CLIENT, { args: { accountId: "a1" }, companyId: "c1" }]
    ]);
  });

  // r-s: a declared SCALAR param must never receive an object. deleteApiKey ran
  // `.eq("id", { apiKeyId })`, matched nothing and returned 200 null — a silent
  // no-op on a destructive operation.
  it("r. a scalar param with no matching key is passed as undefined, not an object", async () => {
    const r = await runDispatch("settings_deleteApiKey", spies.deleteApiKey, {
      apiKeyId: "api_1"
    });
    expect(r.calls).toEqual([[spies.FAKE_CLIENT, undefined]]);
  });

  it("r2. the scalar is still used when the caller sends the declared name", async () => {
    const r = await runDispatch("settings_deleteApiKey", spies.deleteApiKey, {
      id: "api_1"
    });
    expect(r.calls).toEqual([[spies.FAKE_CLIENT, "api_1"]]);
  });

  // t-w: a service whose sole payload param is a destructured object can share its
  // name with one of that object's own FIELDS. Reading `body.note` there handed
  // insertNote the note STRING where it wants the whole record, so the insert went
  // in malformed. The schema tells the two apart: a wrapper op declares one property
  // named for the param; an op listing the param's own fields is describing it.
  it("t. a param colliding with one of its object's own fields gets the whole payload", async () => {
    const r = await runDispatch("shared_insertNote", spies.insertNote, {
      note: "the note text",
      documentId: "doc_1"
    });
    expect(r.calls).toEqual([
      [
        spies.FAKE_CLIENT,
        {
          note: "the note text",
          documentId: "doc_1",
          companyId: "c1",
          createdBy: "u1",
          updatedBy: "u1"
        }
      ]
    ]);
  });

  it("u. the same holds for updateRevision, whose `revision` field shares the param name", async () => {
    const r = await runDispatch("items_updateRevision", spies.updateRevision, {
      id: "item_1",
      revision: "B"
    });
    expect(r.calls).toEqual([
      [
        spies.FAKE_CLIENT,
        { id: "item_1", revision: "B", companyId: "c1", updatedBy: "u1" }
      ]
    ]);
  });

  it("v. a genuine wrapper op still has its wrapper unwrapped", async () => {
    // `stockTransfer` IS the schema's only declared property, so a body of
    // { stockTransfer: {...} } addresses the param — extract it, don't nest it.
    const r = await runDispatch(
      "inventory_upsertStockTransfer",
      spies.upsertStockTransfer,
      {
        _operation: "create",
        stockTransfer: { locationId: "loc_1", stockTransferId: "st_1" }
      }
    );
    const [, payload] = r.calls[0] as [unknown, Record<string, unknown>];
    expect(payload).toMatchObject({
      locationId: "loc_1",
      stockTransferId: "st_1",
      companyId: "c1"
    });
    expect("stockTransfer" in payload).toBe(false);
  });

  it("w. a scalar sibling alongside `args` is still read by name", async () => {
    // props are ['locationId','args'] — `args` is handled on its own pass, so
    // locationId remains the sole own property and must still be extracted.
    const r = await runDispatch(
      "inventory_getInventoryItems",
      spies.getInventoryItems,
      { locationId: "loc_1", args: { search: "x" } }
    );
    const [, locationId] = r.calls[0] as [unknown, unknown];
    expect(locationId).toBe("loc_1");
  });

  it("s. an absent OPTIONAL scalar keeps positional arity without swallowing the payload", async () => {
    const r = await runDispatch("production_upsertJob", spies.upsertJob, {
      job: { id: "j1" }
    });
    const [client, job, status] = r.calls[0] as [unknown, unknown, unknown];
    expect(client).toBe(spies.FAKE_CLIENT);
    expect(job).toMatchObject({ id: "j1", companyId: "c1" });
    expect(status).toBeUndefined();
  });
});

// The exact ids the workflow engine's create actions dispatch
// (packages/workflows/src/catalog/actions.ts). Their results must stay readable by
// create.ts's idIn(): an `id` on the returned object, or on an element of a list.
//
// The payloads are the ones runCreateAction actually builds — the catalog's
// required inputs, flat, with nulls dropped. callOperation runs the real oRPC
// procedure, so these also pin that input validation accepts what the workflow
// engine sends. job.create is the load-bearing one: it sends `insertJob`'s inner
// fields at the top level even though that schema declares an `input` wrapper.
const WORKFLOW_CALL_IDS: Array<[string, Spy, Record<string, unknown>]> = [
  ["production_insertJob", spies.insertJob, { itemId: "item_1", quantity: 5 }],
  [
    "quality_insertIssue",
    spies.insertIssue,
    {
      name: "n",
      priority: "High",
      source: "Internal",
      locationId: "loc_1",
      nonConformanceTypeId: "nct_1"
    }
  ],
  [
    "purchasing_insertPurchaseOrder",
    spies.insertPurchaseOrder,
    { supplierId: "sup_1" }
  ],
  ["sales_insertSalesOrder", spies.insertSalesOrder, { customerId: "cust_1" }]
];

/** A schema-valid getAccountLedger payload (every field is required). */
const LEDGER_ARGS = {
  accountId: "acc_1",
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  limit: 5,
  offset: 0
};

function idIn(payload: unknown): string | undefined {
  // Mirror of packages/jobs/src/workflows/actions/create.ts — what the workflow
  // engine actually runs over a dispatch result.
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const id = idIn(entry);
      if (id !== undefined) return id;
    }
    return undefined;
  }
  if (!payload || typeof payload !== "object") return undefined;
  const id = (payload as Record<string, unknown>).id;
  return typeof id === "string" ? id : undefined;
}

describe("callOperation (the MCP/agent/workflow entry point)", () => {
  it.each(
    WORKFLOW_CALL_IDS
  )("%s returns data the workflow create action can read an id out of", async (name, spy, args) => {
    spy.mockResolvedValue({ data: { id: "rec_1" }, error: null });
    const asObject = await callOperation(name, ctx, args);
    expect(asObject).toEqual({ success: true, data: { id: "rec_1" } });
    expect(idIn((asObject as { data: unknown }).data)).toBe("rec_1");

    spy.mockResolvedValue({ data: [{ id: "rec_2" }], error: null });
    const asList = await callOperation(name, ctx, args);
    expect(idIn((asList as { data: unknown }).data)).toBe("rec_2");
  });

  it("maps a Supabase error to the errorKind:database envelope with MCP's exact text", async () => {
    const supabaseError = { message: "boom", code: "XX000" };
    spies.getAccountLedger.mockResolvedValue({
      data: null,
      error: supabaseError
    });
    const result = await callOperation(
      "accounting_getAccountLedger",
      ctx,
      LEDGER_ARGS
    );
    expect(result).toEqual({
      success: false,
      errorKind: "database",
      error: `Database error: ${JSON.stringify(supabaseError)}`
    });
  });

  it("returns the legacy not-found envelope for an unknown name", async () => {
    const result = await callOperation("sales_doesNotExist", ctx, {});
    expect(result).toEqual({
      success: false,
      errorKind: "execution",
      error: "Operation not found: sales_doesNotExist"
    });
  });

  it("rejects unparseable string arguments the way executeFunction did", async () => {
    const result = await callOperation(
      "accounting_getAccountLedger",
      ctx,
      "{nope"
    );
    expect(result).toEqual({
      success: false,
      errorKind: "execution",
      error: "Invalid JSON arguments"
    });
  });
});

describe("blocked tools (D5)", () => {
  it("excludes every blocked tool from the operation catalog", () => {
    for (const name of MCP_BLOCKED_TOOL_NAMES) {
      expect(
        operationsByName.has(name),
        `${name} must not be in OPERATIONS`
      ).toBe(false);
    }
  });

  it("callOperation refuses a blocked tool with the MCP disabled text", async () => {
    const result = await callOperation("settings_seedCompany", ctx, {});
    expect(result).toEqual({
      success: false,
      errorKind: "execution",
      error: "Tool disabled: settings_seedCompany is not available via MCP."
    });
  });
});
