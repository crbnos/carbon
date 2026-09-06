// Parity harness: pins the legacy MCP executor (`executeFunction`) and the oRPC
// dispatch (`dispatchOperation`) to identical service-call behavior, case by case,
// against REAL manifest entries. This is the contract the direct-executor → oRPC
// migration must not break: every case runs A/B against both implementations and
// compares the captured service arguments element-by-element. A failure here means
// the ported dispatch diverges from executeFunction — fix the dispatch, never the
// expectation.

import { ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  getAccountLedger: vi.fn(),
  getTrialBalance: vi.fn(),
  upsertAccount: vi.fn(),
  upsertQuoteLinePrices: vi.fn(),
  generateInventoryCountLines: vi.fn(),
  upsertNotificationPreference: vi.fn(),
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
  generateInventoryCountLines: spies.generateInventoryCountLines
}));
vi.mock("~/modules/invoicing/invoicing.service", () => ({}));
vi.mock("~/modules/items/items.service", () => ({}));
vi.mock("~/modules/people/people.service", () => ({}));
vi.mock("~/modules/production/production.mcp.server", () => ({}));
vi.mock("~/modules/production/production.service", () => ({}));
vi.mock("~/modules/purchasing/purchasing.service", () => ({}));
vi.mock("~/modules/quality/quality.service", () => ({}));
vi.mock("~/modules/resources/resources.service", () => ({}));
vi.mock("~/modules/sales/sales.service", () => ({
  upsertQuoteLinePrices: spies.upsertQuoteLinePrices
}));
vi.mock("~/modules/settings/settings.service", () => ({}));
vi.mock("~/modules/shared/shared.service", () => ({}));
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

import {
  enrichWithAuthContext,
  executeFunction
} from "../../mcp+/lib/direct-executor";
import { MCP_BLOCKED_TOOL_NAMES } from "../../mcp+/lib/mcp-blocked-tools";
import type { AuthedContext } from "./base.server";
import { type DispatchResult, dispatchOperation } from "./dispatch.server";
import { operationsByName } from "./operations.server";

// Satisfies both the legacy ExecutorContext and AuthedContext, so the same object
// drives both implementations.
const ctx: AuthedContext = {
  client: spies.FAKE_CLIENT as unknown as AuthedContext["client"],
  companyId: "c1",
  companyGroupId: "g1",
  userId: "u1",
  authKind: "session",
  scopes: {}
};

type Spy = ReturnType<typeof vi.fn>;

interface BothResult {
  exec: Awaited<ReturnType<typeof executeFunction>>;
  execCalls: unknown[][];
  dispatch?: DispatchResult;
  dispatchError?: unknown;
  dispatchCalls: unknown[][];
}

/** Run one case against BOTH implementations, capturing the service arguments each
 *  produced. Args are cloned per run so neither implementation can leak a mutation
 *  into the other's input. */
async function runBoth(
  name: string,
  spy: Spy,
  args?: Record<string, unknown>
): Promise<BothResult> {
  const meta = operationsByName.get(name);
  if (!meta) throw new Error(`${name} missing from the generated manifest`);

  const exec = await executeFunction(
    name,
    ctx,
    args === undefined ? undefined : structuredClone(args)
  );
  const execCalls = spy.mock.calls.map((c) => [...c]);
  spy.mockClear();

  let dispatch: DispatchResult | undefined;
  let dispatchError: unknown;
  try {
    dispatch = await dispatchOperation(
      meta,
      ctx,
      args === undefined ? undefined : structuredClone(args)
    );
  } catch (err) {
    dispatchError = err;
  }
  const dispatchCalls = spy.mock.calls.map((c) => [...c]);
  spy.mockClear();

  return { exec, execCalls, dispatch, dispatchError, dispatchCalls };
}

beforeEach(() => {
  for (const spy of [
    spies.getAccountLedger,
    spies.getTrialBalance,
    spies.upsertAccount,
    spies.upsertQuoteLinePrices,
    spies.generateInventoryCountLines,
    spies.upsertNotificationPreference
  ]) {
    spy.mockReset();
    spy.mockResolvedValue({ data: null, error: null });
  }
});

describe("dispatch parity: executeFunction vs dispatchOperation", () => {
  it("a. passes `args` through whole and injects the context client", async () => {
    const r = await runBoth(
      "accounting_getAccountLedger",
      spies.getAccountLedger,
      {
        accountNumber: "1000",
        limit: 5
      }
    );
    expect(r.execCalls).toEqual([
      [spies.FAKE_CLIENT, { accountNumber: "1000", limit: 5 }]
    ]);
    expect(r.dispatchCalls).toEqual(r.execCalls);
  });

  it("a2. fills context positional params (companyGroupId, companyId) from context", async () => {
    const r = await runBoth(
      "accounting_getTrialBalance",
      spies.getTrialBalance,
      {
        startDate: "2026-01-01"
      }
    );
    expect(r.execCalls).toEqual([
      [spies.FAKE_CLIENT, "g1", "c1", { startDate: "2026-01-01" }]
    ]);
    expect(r.dispatchCalls).toEqual(r.execCalls);
  });

  it("b. _operation create at top level: stripped, createdBy/updatedBy/companyId stamped", async () => {
    const r = await runBoth("accounting_upsertAccount", spies.upsertAccount, {
      _operation: "create",
      account: { name: "Cash", number: "1000" }
    });
    expect(r.execCalls).toEqual([
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
    expect(r.dispatchCalls).toEqual(r.execCalls);
  });

  it("c. _operation update nested in the payload: stripped, createdBy suppressed", async () => {
    const r = await runBoth("accounting_upsertAccount", spies.upsertAccount, {
      account: { _operation: "update", id: "a1", name: "Cash" }
    });
    const [, payload] = r.execCalls[0] as [unknown, Record<string, unknown>];
    expect(payload).toEqual({
      id: "a1",
      name: "Cash",
      updatedBy: "u1",
      companyId: "c1"
    });
    expect("createdBy" in payload).toBe(false);
    expect(r.dispatchCalls).toEqual(r.execCalls);
  });

  it("d. caller-supplied createdBy on an update is removed (no forged attribution)", async () => {
    const r = await runBoth("accounting_upsertAccount", spies.upsertAccount, {
      _operation: "update",
      account: { id: "a1", createdBy: "forged" }
    });
    const [, payload] = r.execCalls[0] as [unknown, Record<string, unknown>];
    expect("createdBy" in payload).toBe(false);
    expect(r.dispatchCalls).toEqual(r.execCalls);
  });

  it("e. conflicting _operation values are rejected before the service runs", async () => {
    const r = await runBoth("accounting_upsertAccount", spies.upsertAccount, {
      _operation: "create",
      account: { _operation: "update", name: "x" }
    });
    expect(r.execCalls).toEqual([]);
    expect(r.dispatchCalls).toEqual([]);
    expect(r.exec).toEqual({
      success: false,
      error:
        "accounting_upsertAccount received conflicting _operation values (create, update)."
    });
    expect(r.dispatchError).toBeInstanceOf(ORPCError);
    expect((r.dispatchError as ORPCError<string, unknown>).message).toBe(
      (r.exec as { error: string }).error
    );
  });

  it("f. missing _operation on a tool that requires it is rejected before the service runs", async () => {
    const r = await runBoth("accounting_upsertAccount", spies.upsertAccount, {
      account: { name: "x" }
    });
    expect(r.execCalls).toEqual([]);
    expect(r.dispatchCalls).toEqual([]);
    expect(r.exec).toEqual({
      success: false,
      error:
        'accounting_upsertAccount requires _operation to be "create" (insert a new record) or "update" (modify an existing one).'
    });
    expect(r.dispatchError).toBeInstanceOf(ORPCError);
    expect((r.dispatchError as ORPCError<string, unknown>).message).toBe(
      (r.exec as { error: string }).error
    );
  });

  it("g. array payload on an insert: every object element gets createdBy stamped AFTER the spread; nothing else injected", async () => {
    const r = await runBoth(
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
    expect(r.execCalls).toEqual([
      [
        spies.FAKE_DB,
        "c1",
        "q1",
        "l1",
        [{ quantity: 1, unitPrice: 5, createdBy: "u1" }, 42]
      ]
    ]);
    const rows = (r.execCalls[0] as unknown[])[4] as Record<string, unknown>[];
    expect("companyId" in rows[0]).toBe(false);
    expect("updatedBy" in rows[0]).toBe(false);
    expect(r.dispatchCalls).toEqual(r.execCalls);
  });

  it("h. array payload on an update passes through untouched", () => {
    // No manifest op combines `_operation` with an array payload, so this pins the
    // shared enrichment helper directly — the one both implementations call.
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
    const r = await runBoth(
      "inventory_generateInventoryCountLines",
      spies.generateInventoryCountLines,
      { locationId: "loc1" }
    );
    expect(r.execCalls).toEqual([[spies.FAKE_DB, { locationId: "loc1" }]]);
    expect(r.dispatchCalls).toEqual(r.execCalls);
  });

  it("j. a thenable-but-not-Promise result (Supabase builder) is awaited", async () => {
    spies.getAccountLedger.mockReset();
    spies.getAccountLedger.mockReturnValue({
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: "e1" }], error: null, count: 1 })
    });
    const r = await runBoth(
      "accounting_getAccountLedger",
      spies.getAccountLedger,
      {}
    );
    // executeFunction returns the raw Supabase envelope; server.ts unwraps `.data.data`.
    // dispatchOperation unwraps here. Same rows either way.
    expect(r.exec).toEqual({
      success: true,
      data: { data: [{ id: "e1" }], error: null, count: 1 }
    });
    expect(r.dispatch).toEqual({ data: [{ id: "e1" }], count: 1 });
  });

  it("k. a Supabase error maps to the same failure the MCP formatter prints", async () => {
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
    const r = await runBoth(
      "accounting_getAccountLedger",
      spies.getAccountLedger,
      {}
    );
    // executeFunction "succeeds" and hands the envelope to server.ts, which prints
    // `Database error: ${JSON.stringify(error)}`. dispatchOperation throws instead.
    expect(r.exec).toEqual({
      success: true,
      data: { data: null, error: supabaseError }
    });
    expect(r.dispatchError).toBeInstanceOf(ORPCError);
    const orpcError = r.dispatchError as ORPCError<string, unknown>;
    expect(orpcError.message).toBe("duplicate key value");
    // The raw error rides on the ORPCError (D4) so callOperation can reconstruct
    // MCP's byte-identical `Database error: ${JSON.stringify(error)}` text.
    expect(
      (orpcError.data as { supabase?: unknown } | undefined)?.supabase
    ).toEqual(supabaseError);
  });

  it("l. a single-key payload whose key matches no param is unwrapped positionally", async () => {
    const r = await runBoth(
      "account_upsertNotificationPreference",
      spies.upsertNotificationPreference,
      { args: { channel: "email", enabled: true } }
    );
    expect(r.execCalls).toEqual([
      [spies.FAKE_CLIENT, { channel: "email", enabled: true, companyId: "c1" }]
    ]);
    expect(r.dispatchCalls).toEqual(r.execCalls);
  });

  it("m. a flat-field payload matching no param is passed whole as the positional", async () => {
    const r = await runBoth("accounting_upsertAccount", spies.upsertAccount, {
      _operation: "create",
      name: "Cash",
      number: "1000"
    });
    expect(r.execCalls).toEqual([
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
    expect(r.dispatchCalls).toEqual(r.execCalls);
  });

  it("n. a Supabase { data, count } result keeps its count on the dispatch result", async () => {
    spies.getAccountLedger.mockReset();
    spies.getAccountLedger.mockResolvedValue({
      data: [{ id: "e1" }, { id: "e2" }],
      error: null,
      count: 7
    });
    const r = await runBoth(
      "accounting_getAccountLedger",
      spies.getAccountLedger,
      {}
    );
    expect((r.exec as { data: { count: number } }).data.count).toBe(7);
    expect(r.dispatch).toEqual({
      data: [{ id: "e1" }, { id: "e2" }],
      count: 7
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
});
