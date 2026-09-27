// Dispatch contract tests, pinned against REAL manifest entries.
//
// History: these began as an A/B parity harness against the legacy MCP
// `executeFunction` — every case ran both implementations and compared the captured
// service arguments element-by-element. The executor is deleted now, so the captured
// values stand as golden literals: they ARE executeFunction's behavior, and a change
// here is a behavior change for MCP, the agent, the workflow engine and HTTP at once.

import type { AuthField, ManifestEntry, PayloadContext } from "@carbon/api";
import { ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  getAccountLedger: vi.fn(),
  getTrialBalance: vi.fn(),
  upsertAccount: vi.fn(),
  upsertJobMaterial: vi.fn(),
  upsertMethodMaterial: vi.fn(),
  upsertQuoteLinePrices: vi.fn(),
  updateQuoteLineOrder: vi.fn(),
  generateInventoryCountLines: vi.fn(),
  upsertNotificationPreference: vi.fn(),
  insertJob: vi.fn(),
  insertIssue: vi.fn(),
  insertPurchaseOrder: vi.fn(),
  insertSalesOrder: vi.fn(),
  replaceInvoiceSettlements: vi.fn(),
  applyCreditsToInvoices: vi.fn(),
  upsertSalesOrderShipment: vi.fn(),
  updateJobOperationStatus: vi.fn(),
  getCapacityReservationsForResources: vi.fn(),
  getAccountsInScope: vi.fn(),
  updateMaterialOrder: vi.fn(),
  activateAssemblyInstructionVersion: vi.fn(),
  clockIn: vi.fn(),
  updateCompany: vi.fn(),
  // Every operation without a named spy above resolves to this one, so the
  // table-driven pass can dispatch the whole manifest.
  anyOperation: vi.fn(),
  FAKE_DB: { __kysely: true },
  FAKE_CLIENT: { __supabase: true }
}));

// The registry imports every module's service namespace; mock them all so the test
// never drags real app code (glossary/lingui/server-only graphs) into vitest. The
// exemplar modules export recording spies; the rest are empty namespaces.
vi.mock("~/modules/account/account.service", () => ({
  upsertNotificationPreference: spies.upsertNotificationPreference
}));
vi.mock("~/modules/accounting/accounting.service", () => ({
  getAccountLedger: spies.getAccountLedger,
  getTrialBalance: spies.getTrialBalance,
  upsertAccount: spies.upsertAccount
}));
vi.mock("~/modules/documents/documents.service", () => ({}));
vi.mock("~/modules/inventory/inventory.service", () => ({
  generateInventoryCountLines: spies.generateInventoryCountLines
}));
vi.mock("~/modules/invoicing/invoicing.service", () => ({
  replaceInvoiceSettlements: spies.replaceInvoiceSettlements,
  applyCreditsToInvoices: spies.applyCreditsToInvoices
}));
vi.mock("~/modules/items/items.service", () => ({
  upsertMethodMaterial: spies.upsertMethodMaterial
}));
vi.mock("~/modules/people/people.service", () => ({}));
vi.mock("~/modules/production/production.mcp.server", () => ({}));
vi.mock("~/modules/production/production.service", () => ({
  insertJob: spies.insertJob,
  upsertJobMaterial: spies.upsertJobMaterial
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
  updateQuoteLineOrder: spies.updateQuoteLineOrder,
  insertSalesOrder: spies.insertSalesOrder
}));
vi.mock("~/modules/settings/settings.service", () => ({}));
// The sales-rule gate imports `~/modules/sales/sales.server` and
// `@carbon/ee/rules.server` — both server-only graphs (glossary/lingui, env
// validation at import). Dispatch behavior under a gate block is not what
// these golden tests pin, so stub it as "no block".
vi.mock("./sales-rules-gate.server", () => ({
  checkSalesRulesForOperation: vi.fn(async () => null)
}));
vi.mock("~/modules/shared/shared.service", () => ({}));
vi.mock("~/modules/users/users.service", () => ({}));
// Resolve every operation to a recording spy: its named spy when there is one,
// else `anyOperation`. The per-module mocks above stay so nothing else that
// imports a module namespace drags real app code in.
vi.mock("./registry.server", () => {
  const byName = spies as unknown as Record<string, unknown>;
  const functions = new Proxy(
    {},
    {
      get: (_target, fn) =>
        typeof fn === "string" && typeof byName[fn] === "function"
          ? byName[fn]
          : spies.anyOperation
    }
  );
  return { functionRegistry: new Proxy({}, { get: () => functions }) };
});
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
import { DATABASE_ERROR_MESSAGES } from "./database-errors";
import {
  type DispatchResult,
  dispatchOperation,
  enrichWithAuthContext
} from "./dispatch.server";
import { OPERATIONS, operationsByName } from "./operations.server";

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
  spies.upsertJobMaterial,
  spies.upsertMethodMaterial,
  spies.upsertQuoteLinePrices,
  spies.updateQuoteLineOrder,
  spies.generateInventoryCountLines,
  spies.upsertNotificationPreference,
  spies.insertJob,
  spies.insertIssue,
  spies.insertPurchaseOrder,
  spies.insertSalesOrder,
  spies.replaceInvoiceSettlements,
  spies.applyCreditsToInvoices,
  spies.upsertSalesOrderShipment,
  spies.updateJobOperationStatus,
  spies.getCapacityReservationsForResources,
  spies.getAccountsInScope,
  spies.updateMaterialOrder,
  spies.activateAssemblyInstructionVersion,
  spies.clockIn,
  spies.updateCompany,
  spies.anyOperation
];

beforeEach(() => {
  for (const spy of allSpies) {
    spy.mockReset();
    spy.mockResolvedValue({ data: null, error: null });
  }
});

describe("dispatchOperation service-call contract (golden, ex-executeFunction parity)", () => {
  // items_upsertMethodMaterial exposes storageUnitIds as a proper object map. The
  // MCP path (unlike the web form) does NOT run the zod transform, so the object
  // must reach the service verbatim — the old required-string-enum schema made a
  // caller send "false", which the service spread into {"0":"f",…}.
  const methodMaterialFields = {
    id: "mm1",
    makeMethodId: "mk1",
    order: 1,
    itemType: "Part",
    methodType: "Pull from Inventory",
    sourcingType: "Specified",
    quantity: 2,
    unitOfMeasureCode: "EA"
  };

  it("passes an object storageUnitIds map straight through on create", async () => {
    const result = await runDispatch(
      "items_upsertMethodMaterial",
      spies.upsertMethodMaterial,
      {
        ...methodMaterialFields,
        storageUnitIds: { loc1: "su1" },
        _operation: "create"
      }
    );
    expect(result.dispatchError).toBeUndefined();
    expect(result.calls).toEqual([
      [
        spies.FAKE_CLIENT,
        {
          ...methodMaterialFields,
          storageUnitIds: { loc1: "su1" },
          companyId: "c1",
          createdBy: "u1"
        }
      ]
    ]);
  });

  it("omits storageUnitIds from the service payload when the caller omits it (update preserves)", async () => {
    const result = await runDispatch(
      "items_upsertMethodMaterial",
      spies.upsertMethodMaterial,
      { ...methodMaterialFields, _operation: "update" }
    );
    expect(result.dispatchError).toBeUndefined();
    const [, payload] = result.calls[0] as [unknown, Record<string, unknown>];
    expect("storageUnitIds" in payload).toBe(false);
    // The update member of upsertMethodMaterial declares updatedBy alone.
    expect(payload).toMatchObject({ updatedBy: "u1" });
    expect("companyId" in payload).toBe(false);
  });

  it("forwards an explicit null storageUnitIds to clear on update", async () => {
    const result = await runDispatch(
      "items_upsertMethodMaterial",
      spies.upsertMethodMaterial,
      { ...methodMaterialFields, storageUnitIds: null, _operation: "update" }
    );
    expect(result.dispatchError).toBeUndefined();
    const [, payload] = result.calls[0] as [unknown, Record<string, unknown>];
    expect(payload.storageUnitIds).toBeNull();
  });

  it.each([
    undefined,
    "forged-user"
  ])("attributes memo applications to the authenticated author (caller author: %s)", async (createdBy) => {
    const input = {
      paymentId: "payment-1",
      appliedDate: "2026-09-09",
      side: "purchase",
      applications: [{ memoId: "memo-1", invoiceId: "invoice-1", amount: 30 }]
    };
    const result = await runDispatch(
      "invoicing_applyCreditsToInvoices",
      spies.applyCreditsToInvoices,
      { ...input, ...(createdBy ? { createdBy } : {}) }
    );
    expect(result.dispatchError).toBeUndefined();
    expect(result.calls).toEqual([
      [spies.FAKE_DB, { ...input, companyId: "c1", createdBy: "u1" }]
    ]);
  });

  it.each([
    undefined,
    "forged-user"
  ])("attributes replacement settlements to the authenticated author (caller author: %s)", async (createdBy) => {
    const applications = [
      {
        targetPurchaseInvoiceId: "invoice-1",
        appliedAmount: 90,
        sourceAmount: 90,
        discountAmount: 5,
        writeOffAmount: 5,
        targetExchangeRate: 1,
        sourceExchangeRate: 1,
        appliedDate: "2026-09-09"
      }
    ];
    const result = await runDispatch(
      "invoicing_replaceInvoiceSettlements",
      spies.replaceInvoiceSettlements,
      {
        paymentId: "payment-1",
        applications,
        ...(createdBy ? { createdBy } : {})
      }
    );
    expect(result.dispatchError).toBeUndefined();
    expect(result.calls).toEqual([
      [
        spies.FAKE_DB,
        {
          paymentId: "payment-1",
          applications,
          companyId: "c1",
          createdBy: "u1"
        }
      ]
    ]);
  });

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

  it("a2. fills context positional params (companyGroupId, companyId) from context, and stamps nothing the args type does not declare", async () => {
    const r = await runDispatch(
      "accounting_getTrialBalance",
      spies.getTrialBalance,
      { startDate: "2026-01-01" }
    );
    expect(r.calls).toEqual([
      [spies.FAKE_CLIENT, "g1", "c1", { startDate: "2026-01-01" }]
    ]);
  });

  // upsertAccount's create member declares companyGroupId + createdBy (accounts
  // are group-scoped; the table has no companyId column) and its update member
  // declares id + updatedBy. The verb rule stamped companyId into both, which
  // failed every write.
  it("b. _operation create at top level: stripped, the create member's companyGroupId + createdBy stamped, nothing else", async () => {
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
          companyGroupId: "g1"
        }
      ]
    ]);
    const [, payload] = r.calls[0] as [unknown, Record<string, unknown>];
    expect("updatedBy" in payload).toBe(false);
    expect("companyId" in payload).toBe(false);
  });

  it("c. _operation update nested in the payload: stripped, only the update member's updatedBy stamped", async () => {
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
      updatedBy: "u1"
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

  it("g. array payload: each object element gets the fields its element type declares (createdBy), set AFTER the spread; undeclared identity keys are dropped", async () => {
    const r = await runDispatch(
      "sales_upsertQuoteLinePrices",
      spies.upsertQuoteLinePrices,
      {
        quoteId: "q1",
        lineId: "l1",
        quoteLinePrices: [
          { quantity: 1, unitPrice: 5, createdBy: "forged" },
          { quantity: 2, unitPrice: 4, companyId: "other-company" },
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
        [
          { quantity: 1, unitPrice: 5, createdBy: "u1" },
          { quantity: 2, unitPrice: 4, createdBy: "u1" },
          42
        ]
      ]
    ]);
  });

  it("h. array payload: declared element fields are ADDED to every row (a reorder's updatedBy); undeclared identity keys are dropped, a row's userId kept", () => {
    // The reorder services (`updateMaterialOrder(client, updates: { id; order;
    // updatedBy }[])`) destructure updatedBy from each element; the route builds
    // every element with `updatedBy: userId`. The old never-add rule left it
    // undefined, so reordering over MCP wiped the column.
    const rows = [
      { id: "p1", order: 1 },
      {
        id: "p2",
        createdBy: "forged",
        updatedBy: "forged",
        companyId: "other-company",
        userId: "employee-7"
      },
      42
    ];
    const out = enrichWithAuthContext(rows, ctx, {
      fields: ["updatedBy"],
      elements: true
    });
    expect(out).toEqual([
      { id: "p1", order: 1, updatedBy: "u1" },
      // A row's userId is data (e.g. the assigned employee), never stamped.
      { id: "p2", updatedBy: "u1", userId: "employee-7" },
      42
    ]);
    // The caller's array is not mutated.
    expect(rows[1]).toMatchObject({ createdBy: "forged" });
  });

  it("h1. an array the contract does not declare (elements: false) only has caller identity keys overwritten", () => {
    const out = enrichWithAuthContext(
      [{ id: "p1" }, { id: "p2", companyId: "other-company" }],
      ctx,
      { fields: ["companyId"] }
    );
    expect(out).toEqual([{ id: "p1" }, { id: "p2", companyId: "c1" }]);
  });

  it("h2. a Kysely reorder gets the AUTHENTICATED companyId/userId positionally, never the body's", async () => {
    // The service's companyId predicate is the only tenant boundary on a Kysely
    // write, so it must come from context even when the body forges one.
    const r = await runDispatch(
      "sales_updateQuoteLineOrder",
      spies.updateQuoteLineOrder,
      {
        companyId: "other-company",
        userId: "forged",
        quoteId: "q1",
        updates: [
          { id: "ql1", sortOrder: 2, updatedBy: "forged" },
          { id: "ql2", sortOrder: 1 }
        ]
      }
    );
    // The parent quote id is the caller's (the service scopes every row to it);
    // the identity fields never are. The element type declares no updatedBy
    // (the service stamps its positional userId), so a forged one is dropped.
    expect(r.calls).toEqual([
      [
        spies.FAKE_DB,
        "c1",
        "u1",
        "q1",
        [
          { id: "ql1", sortOrder: 2 },
          { id: "ql2", sortOrder: 1 }
        ]
      ]
    ]);
  });

  it("h3. a tenant key the caller nested one level down is overwritten, never added", () => {
    // A `db` service may spread a nested object into `.set()`
    // (updateItemMethodAndSourcing spreads `itemUpdate`), so a nested companyId
    // would move the caller's rows into another company.
    const out = enrichWithAuthContext(
      {
        itemIds: ["i1"],
        itemUpdate: { sourcingType: "Buy", companyId: "other-company" },
        cascade: { methodType: "Buy" },
        rows: [{ id: "r1", companyGroupId: "other-group" }, { id: "r2" }]
      },
      ctx,
      { fields: ["companyId", "updatedBy", "userId"] },
      "update"
    );
    expect(out).toEqual({
      itemIds: ["i1"],
      itemUpdate: { sourcingType: "Buy", companyId: "c1" },
      cascade: { methodType: "Buy" },
      rows: [{ id: "r1", companyGroupId: "g1" }, { id: "r2" }],
      companyId: "c1",
      updatedBy: "u1",
      userId: "u1"
    });
  });

  it("h3b. nested audit keys follow the top-level array rule: overwritten when supplied, never added", () => {
    const out = enrichWithAuthContext(
      {
        lines: [
          { id: "l1", createdBy: "forged", updatedBy: "forged" },
          { id: "l2" }
        ],
        header: { updatedBy: "forged", userId: "employee-7" },
        plain: { note: "untouched" }
      },
      ctx,
      { fields: ["companyId"] },
      "update"
    );
    expect(out).toEqual({
      lines: [{ id: "l1", createdBy: "u1", updatedBy: "u1" }, { id: "l2" }],
      // A nested userId is data (e.g. an assignee), exactly as in an array row.
      header: { updatedBy: "u1", userId: "employee-7" },
      plain: { note: "untouched" },
      companyId: "c1"
    });
  });

  it("h4. a READ tool's nested identity keys are overwritten harmlessly — the read can only narrow to the caller's own company", async () => {
    const r = await runDispatch(
      "accounting_getAccountLedger",
      spies.getAccountLedger,
      {
        accountNumber: "1000",
        scope: { companyId: "other-company" },
        filters: [{ column: "accountNumber", operator: "eq", value: "1000" }]
      }
    );
    expect(r.calls).toEqual([
      [
        spies.FAKE_CLIENT,
        {
          accountNumber: "1000",
          scope: { companyId: "c1" },
          // Rows with no identity key pass through unchanged — nothing added.
          filters: [{ column: "accountNumber", operator: "eq", value: "1000" }],
          companyId: "c1"
        }
      ]
    ]);
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
          createdBy: "u1"
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
      [
        spies.FAKE_CLIENT,
        { channel: "email", enabled: true, companyId: "c1", userId: "u1" }
      ]
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
          companyGroupId: "g1"
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

  // The inverted discriminator: upsertJobMaterial branches on `if ("updatedBy" in
  // jobMaterial)` (update-branch first), the mirror image of upsertAccount. A stamped
  // updatedBy would force its UPDATE branch, which matches zero rows for a fresh id and
  // returns PGRST116 — the create silently no-ops. The generator now gives these tools a
  // required `_operation` too, and the dispatch suppresses updatedBy on create so the
  // service falls through to its insert branch.
  it('o. inverted `"updatedBy" in` discriminator, create: updatedBy suppressed, createdBy + companyId stamped, so the service inserts', async () => {
    const r = await runDispatch(
      "production_upsertJobMaterial",
      spies.upsertJobMaterial,
      {
        _operation: "create",
        jobId: "j1",
        itemId: "i1",
        methodType: "Pull from Inventory",
        quantity: 2
      }
    );
    const [, payload] = r.calls[0] as [unknown, Record<string, unknown>];
    expect("updatedBy" in payload).toBe(false);
    expect(payload).toMatchObject({
      createdBy: "u1",
      companyId: "c1",
      jobId: "j1",
      itemId: "i1"
    });
  });

  it('p. inverted `"updatedBy" in` discriminator, update: updatedBy + companyId stamped, createdBy suppressed', async () => {
    const r = await runDispatch(
      "production_upsertJobMaterial",
      spies.upsertJobMaterial,
      { _operation: "update", id: "jm1", quantity: 3 }
    );
    const [, payload] = r.calls[0] as [unknown, Record<string, unknown>];
    expect("createdBy" in payload).toBe(false);
    expect(payload).toMatchObject({
      updatedBy: "u1",
      companyId: "c1",
      id: "jm1"
    });
  });

  it("q. an inverted-discriminator tool requires _operation, same as the createdBy convention", async () => {
    const r = await runDispatch(
      "production_upsertJobMaterial",
      spies.upsertJobMaterial,
      { jobId: "j1", itemId: "i1" }
    );
    expect(r.calls).toEqual([]);
    expect(r.dispatchError).toBeInstanceOf(ORPCError);
    expect((r.dispatchError as ORPCError<string, unknown>).message).toBe(
      'production_upsertJobMaterial requires _operation to be "create" (insert a new record) or "update" (modify an existing one).'
    );
  });

  // --- The declared context contract (contextSlots) -------------------------

  it('r. an `"id" in` upsert with an id is an edit: only the edit member\'s updatedBy is stamped, a caller createdBy is dropped', async () => {
    // salesOrderShipment has updatedBy and no createdBy column: stamping the
    // create member's createdBy into the update failed every call with PGRST204.
    const r = await runDispatch(
      "sales_upsertSalesOrderShipment",
      spies.upsertSalesOrderShipment,
      { id: "so1", trackingNumber: "T-1", createdBy: "forged" }
    );
    expect(r.calls).toEqual([
      [spies.FAKE_CLIENT, { id: "so1", trackingNumber: "T-1", updatedBy: "u1" }]
    ]);
  });

  it("s. a positional updatedBy is the acting user, never the request body", async () => {
    const r = await runDispatch(
      "production_updateJobOperationStatus",
      spies.updateJobOperationStatus,
      { id: "op1", status: "Done" }
    );
    expect(r.calls).toEqual([[spies.FAKE_CLIENT, "op1", "Done", "u1"]]);
  });

  it("t. an omitted optional object or array param gets undefined, not the body meant for its sibling", async () => {
    const window = await runDispatch(
      "production_getCapacityReservationsForResources",
      spies.getCapacityReservationsForResources,
      { locationId: "loc1" }
    );
    expect(window.calls).toEqual([
      [spies.FAKE_CLIENT, "c1", "loc1", undefined]
    ]);

    const scrap = await runDispatch(
      "accounting_getAccountsInScope",
      spies.getAccountsInScope,
      { scope: { source: "scrapAccounts" } }
    );
    expect(scrap.calls).toEqual([
      [spies.FAKE_CLIENT, "g1", { source: "scrapAccounts" }, undefined]
    ]);
  });

  it("t2. the flat body still reaches the sole required object param (insertJob's input), and not its optional options", async () => {
    const r = await runDispatch("production_insertJob", spies.insertJob, {
      itemId: "item_1",
      quantity: 5
    });
    expect(r.calls).toEqual([
      [
        spies.FAKE_CLIENT,
        { itemId: "item_1", quantity: 5, companyId: "c1", createdBy: "u1" },
        undefined
      ]
    ]);
  });

  it("u. reorder rows gain the updatedBy their element type declares", async () => {
    const r = await runDispatch(
      "items_updateMaterialOrder",
      spies.updateMaterialOrder,
      {
        updates: [
          { id: "m1", order: 2 },
          { id: "m2", order: 1 }
        ]
      }
    );
    expect(r.calls).toEqual([
      [
        spies.FAKE_CLIENT,
        [
          { id: "m1", order: 2, updatedBy: "u1" },
          { id: "m2", order: 1, updatedBy: "u1" }
        ]
      ]
    ]);
  });

  it("v. a Kysely `db` declared inside the payload is filled with the server client", async () => {
    const r = await runDispatch(
      "production_activateAssemblyInstructionVersion",
      spies.activateAssemblyInstructionVersion,
      { id: "ai1", db: "forged" }
    );
    expect(r.calls).toEqual([
      [
        spies.FAKE_CLIENT,
        { id: "ai1", companyId: "c1", userId: "u1", db: spies.FAKE_DB }
      ]
    ]);
  });

  it("w. a declared createdBy is stamped whatever the verb (clockIn)", async () => {
    const r = await runDispatch("people_clockIn", spies.clockIn, {
      employeeId: "e1"
    });
    expect(r.calls).toEqual([
      [
        spies.FAKE_CLIENT,
        { employeeId: "e1", companyId: "c1", createdBy: "u1" }
      ]
    ]);
  });

  it("x. an undeclared identity field is never stamped (updateCompany's payload declares updatedBy only)", async () => {
    // `company` has no companyId column; the tenant is the positional companyId.
    const r = await runDispatch("settings_updateCompany", spies.updateCompany, {
      name: "Acme",
      companyId: "other-company",
      createdBy: "forged"
    });
    expect(r.calls).toEqual([
      [spies.FAKE_CLIENT, "c1", { name: "Acme", updatedBy: "u1" }]
    ]);
  });
});

// The exact ids the workflow engine's create actions dispatch
// (packages/ee/src/workflows/catalog/actions.ts). Their results must stay readable by
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

  it("maps a Supabase error to the errorKind:database envelope with a closed-set message", async () => {
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
      error: DATABASE_ERROR_MESSAGES.unknown
    });
    expect(result).not.toMatchObject({
      error: expect.stringContaining("boom")
    });
  });

  it("classifies a recognized failure without echoing the error", async () => {
    spies.getAccountLedger.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "ledger_pkey"'
      }
    });
    const result = await callOperation(
      "accounting_getAccountLedger",
      ctx,
      LEDGER_ARGS
    );
    expect(result).toEqual({
      success: false,
      errorKind: "database",
      error: DATABASE_ERROR_MESSAGES.conflict
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

// --- Every manifest entry -------------------------------------------------

const CONTEXT_VALUE: Record<string, unknown> = {
  client: spies.FAKE_CLIENT,
  eliminationClient: spies.FAKE_CLIENT,
  db: spies.FAKE_DB,
  userId: ctx.userId,
  auditUser: ctx.userId,
  companyId: ctx.companyId,
  companyGroupId: ctx.companyGroupId
};

const FIELD_VALUE: Record<AuthField, string> = {
  companyId: ctx.companyId,
  companyGroupId: ctx.companyGroupId,
  createdBy: ctx.userId,
  updatedBy: ctx.userId,
  userId: ctx.userId
};

/** Every (operation, _operation) pair the dispatcher can run. */
type Run = [ManifestEntry, "create" | "update" | undefined];

function runs(): Run[] {
  return OPERATIONS.flatMap((op): Run[] =>
    (op.schema as { properties?: Record<string, unknown> }).properties
      ?._operation
      ? [
          [op, "create"],
          [op, "update"]
        ]
      : [[op, undefined]]
  );
}

async function dispatchAll(
  op: ManifestEntry,
  body: Record<string, unknown>
): Promise<unknown[]> {
  spies.anyOperation.mockClear();
  const named = allSpies.find(
    (spy) =>
      spy !== spies.anyOperation &&
      spy ===
        (spies as Record<string, unknown>)[op.name.slice(op.module.length + 1)]
  );
  const spy = named ?? spies.anyOperation;
  spy.mockClear();
  await dispatchOperation(op, ctx, body);
  const call = spy.mock.calls[0];
  if (!call) throw new Error(`${op.name} was not dispatched`);
  return [...call];
}

function expectedFields(
  contract: PayloadContext,
  row: Record<string, unknown>,
  operation: "create" | "update" | undefined
): AuthField[] {
  if (contract.byOperation)
    return operation ? contract.byOperation[operation] : [];
  if (contract.discriminator) {
    return contract.discriminator.key in row
      ? contract.discriminator.present
      : contract.discriminator.absent;
  }
  return contract.fields;
}

describe("the declared context contract, over every manifest entry", () => {
  it("fills every positional context slot from the authenticated context", async () => {
    const wrong: string[] = [];
    for (const [op, operation] of runs()) {
      const args = await dispatchAll(op, {
        ...(operation ? { _operation: operation } : {})
      });
      op.contextSlots.params.forEach((slot, i) => {
        if (slot === "payload") return;
        if (args[i] !== CONTEXT_VALUE[slot]) {
          wrong.push(`${op.name} arg ${i} (${slot})`);
        }
      });
    }
    expect(wrong).toEqual([]);
  });

  it("hands an unaddressed body to at most one payload param, and never to a context slot", async () => {
    const probe = "__probe";
    const leaks: string[] = [];
    for (const [op, operation] of runs()) {
      const args = await dispatchAll(op, {
        [probe]: 1,
        ...(operation ? { _operation: operation } : {})
      });
      const receivers = args
        .map((arg, i) => ({ arg, i }))
        .filter(
          ({ arg }) =>
            arg !== null &&
            typeof arg === "object" &&
            !Array.isArray(arg) &&
            probe in (arg as object)
        );
      if (receivers.length > 1) {
        leaks.push(
          `${op.name}: ${receivers.map((r) => op.serviceParams[r.i]).join(", ")}`
        );
      }
      for (const { i } of receivers) {
        if (op.contextSlots.params[i] !== "payload") {
          leaks.push(`${op.name}: context slot ${op.serviceParams[i]}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it("stamps every declared identity field of every payload, and nothing undeclared", async () => {
    const wrong: string[] = [];
    for (const [op, operation] of runs()) {
      for (const [name, contract] of Object.entries(op.contextSlots.payloads)) {
        if (contract.opaque) continue;
        const declared = new Set([
          ...contract.fields,
          ...(contract.discriminator?.present ?? []),
          ...(contract.discriminator?.absent ?? []),
          ...(contract.byOperation?.create ?? []),
          ...(contract.byOperation?.update ?? [])
        ]);
        if (declared.size === 0 && !contract.db?.length) continue;
        const index = op.serviceParams.indexOf(name);
        // A forged value for every identity key, so a stamped field is visible
        // and an undeclared one must be dropped.
        const row: Record<string, unknown> = {
          createdBy: "forged",
          updatedBy: "forged",
          companyId: "forged",
          companyGroupId: "forged"
        };
        const value = contract.elements ? [row] : row;
        const args = await dispatchAll(op, {
          [name]: value,
          ...(operation ? { _operation: operation } : {})
        });
        const received = contract.elements
          ? (args[index] as unknown[] | undefined)?.[0]
          : args[index];
        if (!received || typeof received !== "object") {
          wrong.push(`${op.name}.${name}: payload not received`);
          continue;
        }
        const got = received as Record<string, unknown>;
        // The forged row carries no discriminator key but the identity fields;
        // a discriminator on an identity key is decided by _operation instead.
        const fields = expectedFields(contract, row, operation);
        for (const key of [
          "createdBy",
          "updatedBy",
          "companyId",
          "companyGroupId"
        ] as const) {
          const expected = fields.includes(key) ? FIELD_VALUE[key] : undefined;
          if (got[key] !== expected) {
            wrong.push(`${op.name}.${name}.${key}: ${String(got[key])}`);
          }
        }
        if (fields.includes("userId") && got.userId !== ctx.userId) {
          wrong.push(`${op.name}.${name}.userId`);
        }
        for (const dbField of contract.db ?? []) {
          if (got[dbField] !== spies.FAKE_DB) {
            wrong.push(`${op.name}.${name}.${dbField} (db)`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});
