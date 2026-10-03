// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Dispatch contract tests, pinned against REAL manifest entries.
//
// History: these began as an A/B parity harness against the legacy MCP
// `executeFunction` — every case ran both implementations and compared the captured
// service arguments element-by-element. The executor is deleted now, so the captured
// values stand as golden literals: they ARE executeFunction's behavior, and a change
// here is a behavior change for MCP, the agent, the workflow engine and HTTP at once.

import { ServerFnError } from "@carbon/server-functions/errors";
import { ORPCError } from "@orpc/server";
import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  getAccountLedger: vi.fn(),
  getTrialBalance: vi.fn(),
  upsertAccount: vi.fn(),
  upsertJobMaterial: vi.fn(),
  upsertMethodMaterial: vi.fn(),
  upsertQuoteLinePrices: vi.fn(),
  updateQuoteLineOrder: vi.fn(),
  recalculateQuoteLinePrices: vi.fn(),
  updateQuoteMaterialOrder: vi.fn(),
  cancelSalesOrder: vi.fn(),
  generateInventoryCountLines: vi.fn(),
  upsertNotificationPreference: vi.fn(),
  insertJob: vi.fn(),
  updateJobOperationStatus: vi.fn(),
  getActiveJobOperationsByLocation: vi.fn(),
  getPurchaseLinePivot: vi.fn(),
  deleteCustomer: vi.fn(),
  upsertPurchaseOrderLine: vi.fn(),
  updateSupplierTax: vi.fn(),
  upsertPurchasingRFQSuppliers: vi.fn(),
  insertIssue: vi.fn(),
  getInspectionDocument: vi.fn(),
  insertPurchaseOrder: vi.fn(),
  insertSalesOrder: vi.fn(),
  replaceInvoiceSettlements: vi.fn(),
  applyCreditsToInvoices: vi.fn(),
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
  getPurchaseLinePivot: spies.getPurchaseLinePivot,
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
  updateJobOperationStatus: spies.updateJobOperationStatus,
  getActiveJobOperationsByLocation: spies.getActiveJobOperationsByLocation,
  upsertJobMaterial: spies.upsertJobMaterial
}));
vi.mock("~/modules/purchasing/purchasing.service", () => ({
  insertPurchaseOrder: spies.insertPurchaseOrder,
  upsertPurchaseOrderLine: spies.upsertPurchaseOrderLine,
  updateSupplierTax: spies.updateSupplierTax,
  upsertPurchasingRFQSuppliers: spies.upsertPurchasingRFQSuppliers
}));
vi.mock("~/modules/quality/quality.service", () => ({
  insertIssue: spies.insertIssue,
  getInspectionDocument: spies.getInspectionDocument
}));
vi.mock("~/modules/resources/resources.service", () => ({}));
vi.mock("~/modules/sales/sales.service", () => ({
  upsertQuoteLinePrices: spies.upsertQuoteLinePrices,
  updateQuoteLineOrder: spies.updateQuoteLineOrder,
  recalculateQuoteLinePrices: spies.recalculateQuoteLinePrices,
  updateQuoteMaterialOrder: spies.updateQuoteMaterialOrder,
  cancelSalesOrder: spies.cancelSalesOrder,
  deleteCustomer: spies.deleteCustomer,
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

import { CarbonJsonSchemaConverter } from "@carbon/api/schema";
import { OpenAPIGenerator } from "@orpc/openapi";
import { publishDefaults } from "../../../../../../../scripts/lib/service-metadata";
import { MCP_BLOCKED_TOOL_NAMES } from "../../mcp+/lib/mcp-blocked-tools";
import type { AuthedContext } from "./base.server";
import { callOperation } from "./call.server";
import { DATABASE_ERROR_MESSAGES } from "./database-errors";
import {
  type DispatchResult,
  dispatchOperation,
  enrichWithAuthContext,
  resolveUpsertOperation,
  withSchemaDefaults
} from "./dispatch.server";
import { openApiHandler } from "./handler.server";
import {
  liveOperationAliases,
  OPERATION_ALIASES,
  OPERATIONS,
  operationId,
  operationsByName
} from "./operations.server";
import { router } from "./router.server";
import { specOptions } from "./spec-options.server";

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
  spies.recalculateQuoteLinePrices,
  spies.updateQuoteMaterialOrder,
  spies.cancelSalesOrder,
  spies.generateInventoryCountLines,
  spies.upsertNotificationPreference,
  spies.insertJob,
  spies.updateJobOperationStatus,
  spies.getActiveJobOperationsByLocation,
  spies.upsertPurchasingRFQSuppliers,
  spies.insertIssue,
  spies.getInspectionDocument,
  spies.insertPurchaseOrder,
  spies.insertSalesOrder,
  spies.replaceInvoiceSettlements,
  spies.applyCreditsToInvoices,
  spies.upsertPurchaseOrderLine,
  spies.updateSupplierTax,
  spies.deleteCustomer
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
    expect(payload).toMatchObject({ companyId: "c1", updatedBy: "u1" });
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

  // A service that takes the acting user as its own positional argument. The
  // generator sees the body write it to an audit column and records the slot
  // (`contextParams`); before that the whole body was passed in its place and
  // the write failed on the `updatedBy` foreign key.
  it("a3. fills a positional updatedBy / createdBy from context, never from the body", async () => {
    const status = await runDispatch(
      "production_updateJobOperationStatus",
      spies.updateJobOperationStatus,
      { id: "op1", status: "Done", updatedBy: "forged" }
    );
    expect(status.calls).toEqual([[spies.FAKE_CLIENT, "op1", "Done", "u1"]]);

    const omitted = await runDispatch(
      "production_updateJobOperationStatus",
      spies.updateJobOperationStatus,
      { id: "op1", status: "Done" }
    );
    expect(omitted.calls).toEqual([[spies.FAKE_CLIENT, "op1", "Done", "u1"]]);

    const suppliers = await runDispatch(
      "purchasing_upsertPurchasingRFQSuppliers",
      spies.upsertPurchasingRFQSuppliers,
      { purchasingRfqId: "rfq1", supplierIds: ["s1"] }
    );
    expect(suppliers.calls).toEqual([
      [spies.FAKE_CLIENT, "rfq1", ["s1"], "c1", "u1"]
    ]);
  });

  // Found by the read-tool sweep: the omitted optional list was handed the
  // whole body, and Postgres answered "expected JSON array".
  it("a5. leaves an omitted optional list or object undefined, never the body", async () => {
    const omitted = await runDispatch(
      "production_getActiveJobOperationsByLocation",
      spies.getActiveJobOperationsByLocation,
      { locationId: "loc1" }
    );
    expect(omitted.calls).toEqual([[spies.FAKE_CLIENT, "loc1", undefined]]);

    const sent = await runDispatch(
      "production_getActiveJobOperationsByLocation",
      spies.getActiveJobOperationsByLocation,
      { locationId: "loc1", workCenterIds: ["wc1"] }
    );
    expect(sent.calls).toEqual([[spies.FAKE_CLIENT, "loc1", ["wc1"]]]);
  });

  // Found by the read-tool sweep: `state: {}` is valid by the published schema,
  // and the service crashed reading `state.columnAxis.type`.
  it("a6. a read gets the defaults its schema publishes, and keeps what was sent", async () => {
    const r = await runDispatch(
      "accounting_getPurchaseLinePivot",
      spies.getPurchaseLinePivot,
      {
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        state: { rows: ["d1"] }
      }
    );
    expect(r.calls).toEqual([
      [
        spies.FAKE_CLIENT,
        {
          companyId: "c1",
          startDate: "2026-01-01",
          endDate: "2026-01-31",
          state: {
            rows: ["d1"],
            columnAxis: { type: "period", bucket: "month" },
            measure: "amount",
            percentOfTotal: false,
            sort: null,
            filters: [],
            accountIds: []
          }
        }
      ]
    ]);
  });

  // A default says "leave this out and you get X". That holds for a new row
  // and never for an update, where a field left out keeps what is stored.
  describe("published defaults", () => {
    const line = { purchaseOrderId: "po1", purchaseOrderLineType: "Part" };

    it("a7. an upsert that creates is filled, and stamped as a create", async () => {
      const r = await runDispatch(
        "purchasing_upsertPurchaseOrderLine",
        spies.upsertPurchaseOrderLine,
        line
      );
      expect(r.calls).toEqual([
        [
          spies.FAKE_CLIENT,
          { ...line, taxPercent: 0, companyId: "c1", createdBy: "u1" }
        ]
      ]);
    });

    it("a8. the same upsert updating is not filled, and keeps the row's createdBy", async () => {
      const r = await runDispatch(
        "purchasing_upsertPurchaseOrderLine",
        spies.upsertPurchaseOrderLine,
        { id: "l1", ...line, purchaseQuantity: 3 }
      );
      // No taxPercent: 0 to overwrite the stored rate. No createdBy either —
      // the service spreads the payload into its UPDATE, so before this the
      // row's creator was rewritten to whoever edited it.
      expect(r.calls).toEqual([
        [
          spies.FAKE_CLIENT,
          {
            id: "l1",
            ...line,
            purchaseQuantity: 3,
            companyId: "c1",
            updatedBy: "u1"
          }
        ]
      ]);
    });

    it("a9. what the caller sent wins, null included", async () => {
      const r = await runDispatch(
        "purchasing_upsertPurchaseOrderLine",
        spies.upsertPurchaseOrderLine,
        { ...line, taxPercent: 0.2 }
      );
      expect((r.calls[0]?.[1] as { taxPercent: number }).taxPercent).toBe(0.2);
    });

    it("a10. a wrapped payload is filled inside the wrapper, not beside it", async () => {
      const r = await runDispatch(
        "purchasing_upsertPurchaseOrderLine",
        spies.upsertPurchaseOrderLine,
        { purchaseOrderLine: line }
      );
      expect(r.calls).toEqual([
        [
          spies.FAKE_CLIENT,
          { ...line, taxPercent: 0, companyId: "c1", createdBy: "u1" }
        ]
      ]);
    });

    it("a11. every element of a list is filled", async () => {
      const application = {
        targetSalesInvoiceId: "si1",
        targetExchangeRate: 1,
        sourceExchangeRate: 1,
        appliedDate: "2026-09-09"
      };
      const r = await runDispatch(
        "invoicing_replaceInvoiceSettlements",
        spies.replaceInvoiceSettlements,
        {
          paymentId: "p1",
          applications: [application, { ...application, appliedAmount: 40 }]
        }
      );
      const zeros = { discountAmount: 0, writeOffAmount: 0 };
      expect(
        (r.calls[0]?.[1] as { applications: unknown[] }).applications
      ).toEqual([
        { ...application, appliedAmount: 0, ...zeros },
        { ...application, appliedAmount: 40, ...zeros }
      ]);
    });

    // One schema, asked of both sides: what the generator keeps is exactly what
    // the dispatcher fills.
    const fixture = () => ({
      type: "object",
      properties: {
        plain: { type: "number", default: 1 },
        nested: {
          type: "object",
          properties: { inner: { type: "string", default: "x" } }
        },
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: { amount: { type: "number", default: 0 } }
          }
        },
        // One object alternative: an object value can only be that one.
        paged: {
          anyOf: [
            { type: "string" },
            {
              type: "object",
              properties: { limit: { type: "integer", default: 25 } }
            }
          ]
        },
        // Two: which one the caller meant cannot be told.
        party: {
          anyOf: [
            {
              type: "object",
              properties: { a: { type: "number", default: 1 } }
            },
            {
              type: "object",
              properties: { b: { type: "number", default: 2 } }
            }
          ]
        },
        // A record's values are not reached.
        charges: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: { taxable: { type: "boolean", default: true } }
          }
        },
        // A field that happens to be called `default` is not a keyword.
        flags: {
          type: "object",
          properties: { default: { type: "boolean" } }
        }
      }
    });
    const sent = {
      nested: {},
      rows: [{}, { amount: 5 }],
      paged: {},
      party: {},
      charges: { freight: {} },
      flags: {}
    };

    it("are kept only where the dispatcher reaches them", () => {
      const schema = fixture();
      expect(publishDefaults(schema, "always")).toBe(true);
      expect(schema.properties.plain.default).toBe(1);
      expect(schema.properties.nested.properties.inner.default).toBe("x");
      expect(schema.properties.rows.items.properties.amount.default).toBe(0);
      expect(schema.properties.paged.anyOf[1]?.properties?.limit.default).toBe(
        25
      );
      expect(JSON.stringify(schema.properties.party)).not.toContain("default");
      expect(JSON.stringify(schema.properties.charges)).not.toContain(
        "default"
      );
      expect(schema.properties.flags.properties.default).toEqual({
        type: "boolean"
      });

      expect(withSchemaDefaults(schema, sent)).toEqual({
        plain: 1,
        nested: { inner: "x" },
        rows: [{ amount: 0 }, { amount: 5 }],
        paged: { limit: 25 },
        party: {},
        charges: { freight: {} },
        flags: {}
      });
    });

    it("are all removed when nothing fills them, and marked when only a create does", () => {
      const none = fixture();
      expect(publishDefaults(none, undefined)).toBe(false);
      expect(JSON.stringify(none)).not.toContain('"default":1');
      expect(none.properties.flags.properties.default).toEqual({
        type: "boolean"
      });

      const onCreate = fixture();
      publishDefaults(onCreate, "create");
      expect(
        (onCreate.properties.plain as { description?: string }).description
      ).toContain("Applied when creating");
    });

    // The service pages only when it is handed a limit. A page size filled
    // in for the caller would cut every unpaged list read to that many rows.
    it("a13. a list read is not given a page size, only the offset a limit needs", () => {
      const customers = operationsByName.get("sales_getCustomers");
      const args = (
        customers?.schema as { properties?: Record<string, unknown> }
      ).properties?.args;
      expect(withSchemaDefaults(args, {})).toEqual({ offset: 0 });
      expect(withSchemaDefaults(args, { limit: 10 })).toEqual({
        limit: 10,
        offset: 0
      });
    });

    it("a12. an update tool publishes none and is handed none", async () => {
      const meta = operationsByName.get("purchasing_updateSupplierTax");
      expect(meta?.defaults).toBeUndefined();
      expect(JSON.stringify(meta?.schema)).not.toContain('"default"');
    });
  });

  // A service reports failure in what it returns. Each of these used to reach
  // the caller as a success, because only `{ data, error }` was read.
  describe("a failure in the service's result is an error, whatever its shape", () => {
    const pgError = { code: "23503", message: "violates foreign key" };

    it("a bare { error } with no data", async () => {
      spies.recalculateQuoteLinePrices.mockResolvedValue({ error: pgError });
      const r = await runDispatch(
        "sales_recalculateQuoteLinePrices",
        spies.recalculateQuoteLinePrices,
        { quoteId: "q1", quoteLineId: "ql1" }
      );
      expect(r.dispatch).toBeUndefined();
      expect(r.dispatchError).toMatchObject({
        message: "violates foreign key",
        data: { supabase: pgError }
      });
    });

    it("a bare { error: null } is still the result", async () => {
      spies.recalculateQuoteLinePrices.mockResolvedValue({ error: null });
      const r = await runDispatch(
        "sales_recalculateQuoteLinePrices",
        spies.recalculateQuoteLinePrices,
        { quoteId: "q1", quoteLineId: "ql1" }
      );
      expect(r.dispatchError).toBeUndefined();
      expect(r.dispatch).toEqual({ data: { error: null } });
    });

    it("one failed write in a Promise.all of writes", async () => {
      const ok = { data: null, error: null, status: 204 };
      spies.updateQuoteMaterialOrder.mockResolvedValue([
        ok,
        { data: null, error: pgError, status: 409 }
      ]);
      const failed = await runDispatch(
        "sales_updateQuoteMaterialOrder",
        spies.updateQuoteMaterialOrder,
        { updates: [{ id: "a", order: 1 }] }
      );
      expect(failed.dispatchError).toMatchObject({
        data: { supabase: pgError }
      });

      spies.updateQuoteMaterialOrder.mockResolvedValue([ok, ok]);
      const passed = await runDispatch(
        "sales_updateQuoteMaterialOrder",
        spies.updateQuoteMaterialOrder,
        { updates: [{ id: "a", order: 1 }] }
      );
      expect(passed.dispatch).toEqual({ data: [ok, ok] });
    });

    it("a { success: false } flag", async () => {
      spies.cancelSalesOrder.mockResolvedValue({
        success: false,
        message: "Order has posted shipments",
        cancelledJobIds: []
      });
      const refused = await runDispatch(
        "sales_cancelSalesOrder",
        spies.cancelSalesOrder,
        { salesOrderId: "so1" }
      );
      expect(refused.dispatchError).toMatchObject({
        message: "Order has posted shipments"
      });

      const done = { success: true, message: "Cancelled", cancelledJobIds: [] };
      spies.cancelSalesOrder.mockResolvedValue(done);
      const cancelled = await runDispatch(
        "sales_cancelSalesOrder",
        spies.cancelSalesOrder,
        { salesOrderId: "so1" }
      );
      expect(cancelled.dispatch).toEqual({ data: done });
    });
  });

  it("b. _operation create at top level: stripped, createdBy + companyId stamped, updatedBy NOT stamped (matches the create-variant service type / UI insert path)", async () => {
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
          companyId: "c1",
          companyGroupId: "g1"
        }
      ]
    ]);
    const [, payload] = r.calls[0] as [unknown, Record<string, unknown>];
    expect("updatedBy" in payload).toBe(false);
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
      companyId: "c1",
      companyGroupId: "g1"
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

  // No caller has to say whether an upsert creates or updates. accounting_upsertAccount
  // takes an optional id, so sending one IS the answer.
  it("f. no _operation, no id: a create — createdBy stamped, updatedBy not", async () => {
    const r = await runDispatch(
      "accounting_upsertAccount",
      spies.upsertAccount,
      { account: { name: "x" } }
    );
    const [, payload] = r.calls[0] as [unknown, Record<string, unknown>];
    expect(payload).toMatchObject({ name: "x", createdBy: "u1" });
    expect("updatedBy" in payload).toBe(false);
  });

  it("f2. no _operation, id sent (flat or wrapped): an update — updatedBy stamped, createdBy not", async () => {
    for (const args of [
      { account: { id: "a1", name: "x" } },
      { id: "a1", name: "x" }
    ]) {
      const r = await runDispatch(
        "accounting_upsertAccount",
        spies.upsertAccount,
        args
      );
      const [, payload] = r.calls[0] as [unknown, Record<string, unknown>];
      expect(payload).toMatchObject({ id: "a1", updatedBy: "u1" });
      expect("createdBy" in payload).toBe(false);
    }
  });

  it("f3. an _operation that is neither create nor update is refused", async () => {
    const r = await runDispatch(
      "accounting_upsertAccount",
      spies.upsertAccount,
      { _operation: "replace", account: { name: "x" } }
    );
    expect(r.calls).toEqual([]);
    expect((r.dispatchError as ORPCError<string, unknown>).message).toBe(
      'accounting_upsertAccount: _operation must be "create" or "update" when it is sent. It can be left out.'
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

  it("h. array payload on an update adds nothing, but overwrites caller-supplied identity keys", () => {
    // No manifest op combines `_operation` with an array payload, so this pins the
    // enrichment helper directly.
    const rows = [
      { id: "p1", sortOrder: 1 },
      {
        id: "p2",
        createdBy: "forged",
        updatedBy: "forged",
        companyId: "other-company",
        userId: "employee-7"
      },
      42
    ];
    const out = enrichWithAuthContext(
      rows,
      ctx,
      ["companyId", "createdBy", "updatedBy"],
      "update"
    );
    expect(out).toEqual([
      { id: "p1", sortOrder: 1 },
      {
        id: "p2",
        createdBy: "u1",
        updatedBy: "u1",
        companyId: "c1",
        // A row's userId is data (e.g. the assigned employee), never stamped.
        userId: "employee-7"
      },
      42
    ]);
    // The caller's array is not mutated.
    expect(rows[1]).toMatchObject({ createdBy: "forged" });
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
    // the identity fields never are.
    expect(r.calls).toEqual([
      [
        spies.FAKE_DB,
        "c1",
        "u1",
        "q1",
        [
          { id: "ql1", sortOrder: 2, updatedBy: "u1" },
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
      ["companyId", "updatedBy", "userId"],
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
      ["companyId"],
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
    expect(
      (orpcError.data as { supabase?: unknown } | undefined)?.supabase
    ).toEqual(supabaseError);
  });

  it("k2. an operation's error keeps its status and sanitized message", async () => {
    spies.getAccountLedger.mockReset();
    spies.getAccountLedger.mockResolvedValue({
      data: null,
      error: new ServerFnError("Receipt not found", 404)
    });
    const r = await runDispatch(
      "accounting_getAccountLedger",
      spies.getAccountLedger,
      {}
    );
    const orpcError = r.dispatchError as ORPCError<string, unknown>;
    expect(orpcError.code).toBe("NOT_FOUND");
    expect(orpcError.message).toBe("Receipt not found");
    expect(orpcError.data).toBeUndefined();
  });

  it("k3. a data-layer operation error (empty message) gets a fixed message", async () => {
    spies.getAccountLedger.mockReset();
    spies.getAccountLedger.mockResolvedValue({
      data: null,
      error: new ServerFnError("")
    });
    const r = await runDispatch(
      "accounting_getAccountLedger",
      spies.getAccountLedger,
      {}
    );
    const orpcError = r.dispatchError as ORPCError<string, unknown>;
    expect(orpcError.code).toBe("INTERNAL_SERVER_ERROR");
    expect(orpcError.message).toBe("The operation could not be completed.");
  });

  it("k4. an authored refusal from a 500-default operation is the caller's (BAD_REQUEST)", async () => {
    spies.getAccountLedger.mockReset();
    spies.getAccountLedger.mockResolvedValue({
      data: null,
      error: new ServerFnError("Receipt is already posted")
    });
    const r = await runDispatch(
      "accounting_getAccountLedger",
      spies.getAccountLedger,
      {}
    );
    const orpcError = r.dispatchError as ORPCError<string, unknown>;
    expect(orpcError.code).toBe("BAD_REQUEST");
    expect(orpcError.message).toBe("Receipt is already posted");
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
          companyId: "c1",
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
});

// Where the payload cannot say (the id is required either way, or there is none),
// the manifest names the row to look for and the answer is whether it exists. The
// rules are the REAL ones from the generated manifest; only the database is stood in.
describe("upserts decided by whether the record exists", () => {
  const rule = (name: string) => {
    const upsert = operationsByName.get(name)?.upsert;
    if (!upsert) throw new Error(`${name} has no upsert rule`);
    return upsert;
  };
  // The service's payload parameter — the only object a key may be wrapped in.
  const PARAMS = ["record"];
  const database = (rows: Record<string, Record<string, unknown>[]>) => {
    const asked: [string, Record<string, unknown>][] = [];
    const rowExists = async (
      table: string,
      filter: Record<string, unknown>
    ) => {
      asked.push([table, filter]);
      return (rows[table] ?? []).some((row) =>
        Object.entries(filter).every(([column, value]) => row[column] === value)
      );
    };
    return { asked, rowExists };
  };

  it("q. a job material with a client-chosen id: created when new, updated once it exists", async () => {
    const upsert = rule("production_upsertJobMaterial");
    const args = { id: "jm1", jobId: "j1", quantity: 2 };

    const empty = database({});
    expect(
      await resolveUpsertOperation(upsert, args, PARAMS, empty.rowExists)
    ).toBe("create");
    expect(empty.asked).toEqual([["jobMaterial", { id: "jm1" }]]);

    const stored = database({ jobMaterial: [{ id: "jm1" }] });
    expect(
      await resolveUpsertOperation(upsert, args, PARAMS, stored.rowExists)
    ).toBe("update");
  });

  it("r. a part is found by its item id OR its part number", async () => {
    const upsert = rule("items_upsertPart");
    const items = { item: [{ id: "item_1", readableId: "PN-100" }] };

    for (const id of ["item_1", "PN-100"]) {
      const db = database(items);
      expect(
        await resolveUpsertOperation(upsert, { id }, PARAMS, db.rowExists)
      ).toBe("update");
    }
    const db = database(items);
    expect(
      await resolveUpsertOperation(
        upsert,
        { id: "PN-200" },
        PARAMS,
        db.rowExists
      )
    ).toBe("create");
    expect(db.asked).toEqual([
      ["item", { id: "PN-200" }],
      ["item", { readableId: "PN-200" }]
    ]);
  });

  it("s. a composite key: every column is matched, and a missing one means create without asking", async () => {
    const upsert = rule("items_upsertPickMethod");
    const db = database({
      pickMethod: [{ itemId: "i1", locationId: "l1" }]
    });
    expect(
      await resolveUpsertOperation(
        upsert,
        { itemId: "i1", locationId: "l1" },
        PARAMS,
        db.rowExists
      )
    ).toBe("update");
    expect(
      await resolveUpsertOperation(
        upsert,
        { itemId: "i1", locationId: "l2" },
        PARAMS,
        db.rowExists
      )
    ).toBe("create");

    const untouched = database({});
    expect(
      await resolveUpsertOperation(
        upsert,
        { itemId: "i1" },
        PARAMS,
        untouched.rowExists
      )
    ).toBe("create");
    expect(untouched.asked).toEqual([]);
  });

  it("u. the key is the RECORD's: an id inside some other nested object is not it", async () => {
    const byId = { keys: ["id"] };
    const never = database({}).rowExists;
    const resolve = (args: Record<string, unknown>) =>
      resolveUpsertOperation(byId, args, PARAMS, never);

    // A create whose custom fields happen to hold an `id` used to be sent down
    // the update branch.
    expect(await resolve({ name: "x", customFields: { id: "z" } })).toBe(
      "create"
    );
    // The record's own id, flat or inside its wrapper, still means update.
    expect(await resolve({ id: "a1", name: "x" })).toBe("update");
    expect(await resolve({ record: { id: "a1", name: "x" } })).toBe("update");
    // A lone unnamed wrapper is unwrapped, as the dispatcher does.
    expect(await resolve({ guessed: { id: "a1" } })).toBe("update");
    expect(await resolve({ record: { name: "x" }, other: { id: "z" } })).toBe(
      "create"
    );
  });

  it("t. no operation publishes _operation, and every branching upsert has a rule", () => {
    for (const meta of operationsByName.values()) {
      expect(JSON.stringify(meta.schema)).not.toContain("_operation");
    }
    expect(
      [...operationsByName.values()].filter((meta) => meta.upsert).length
    ).toBeGreaterThan(80);
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

  it("passes an operation's own message through as an execution error", async () => {
    spies.getAccountLedger.mockResolvedValue({
      data: null,
      error: new ServerFnError("Insufficient quantity", 400)
    });
    const result = await callOperation(
      "accounting_getAccountLedger",
      ctx,
      LEDGER_ARGS
    );
    expect(result).toEqual({
      success: false,
      errorKind: "execution",
      error: "Insufficient quantity"
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

describe("renamed operations (deprecated aliases)", () => {
  const OLD = "production_getInspectionDocument";

  it("every alias names a published operation and shadows none", () => {
    const published = new Set(OPERATIONS.map((op) => op.name));
    for (const [alias, target] of Object.entries(OPERATION_ALIASES)) {
      expect(published.has(target), `${alias} → ${target} is missing`).toBe(
        true
      );
      expect(published.has(alias), `${alias} is a real operation`).toBe(false);
    }
    expect(liveOperationAliases).toHaveLength(
      Object.keys(OPERATION_ALIASES).length
    );
  });

  it("resolves an old name to its replacement's entry", () => {
    expect(operationsByName.get(OLD)?.name).toBe(
      "quality_getInspectionDocument"
    );
  });

  it("callOperation runs the replacement under the OLD name", async () => {
    spies.getInspectionDocument.mockResolvedValue({
      data: { id: "isp_1" },
      error: null
    });
    const result = await callOperation(OLD, ctx, { id: "isp_1" });
    expect(result).toEqual({ success: true, data: { id: "isp_1" } });
    expect(spies.getInspectionDocument).toHaveBeenCalledWith(
      spies.FAKE_CLIENT,
      "isp_1",
      "c1"
    );
  });

  it("gates an API-key caller on the NEW permission, not the old one", async () => {
    const productionOnly = await callOperation(
      OLD,
      { ...ctx, authKind: "api-key", scopes: { production_view: ["c1"] } },
      { id: "isp_1" }
    );
    expect(productionOnly).toEqual({
      success: false,
      errorKind: "execution",
      error: "API key lacks the required scope: quality_view"
    });
    expect(spies.getInspectionDocument).not.toHaveBeenCalled();

    const quality = await callOperation(
      OLD,
      { ...ctx, authKind: "api-key", scopes: { quality_view: ["c1"] } },
      { id: "isp_1" }
    );
    expect(quality.success).toBe(true);
  });

  it("serves the old HTTP path through the replacement", async () => {
    spies.getInspectionDocument.mockResolvedValue({
      data: { id: "isp_1" },
      error: null
    });
    const { matched, response } = await openApiHandler.handle(
      new Request("http://localhost/api/v1/production/getInspectionDocument", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "isp_1" })
      }),
      { prefix: "/api/v1", context: ctx }
    );
    expect(matched).toBe(true);
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ id: "isp_1" });
    expect(spies.getInspectionDocument).toHaveBeenCalledWith(
      spies.FAKE_CLIENT,
      "isp_1",
      "c1"
    );
  });

  it("publishes the old path in the spec, marked deprecated", async () => {
    const spec = await new OpenAPIGenerator({
      schemaConverters: [new CarbonJsonSchemaConverter()]
    }).generate(router, specOptions());
    const post = (path: string) =>
      (spec.paths?.[path] as { post?: { deprecated?: boolean } } | undefined)
        ?.post;
    expect(post("/production/getInspectionDocument")?.deprecated).toBe(true);
    // Undefined, so the serialized spec of every real operation is unchanged.
    expect(post("/quality/getInspectionDocument")?.deprecated).toBeUndefined();
  });
});

// One manifest feeds everything a caller can see or reach: the OpenAPI spec,
// MCP's describe_tool, and the procedure both HTTP and MCP calls run. These
// pin that, so the spec and the tools cannot describe different contracts.
describe("the HTTP spec and the MCP tools are one contract", () => {
  it("the spec publishes every operation, with the manifest's own input schema", async () => {
    const spec = await new OpenAPIGenerator({
      schemaConverters: [new CarbonJsonSchemaConverter()]
    }).generate(router, specOptions());
    type Post = {
      requestBody?: { content?: Record<string, { schema?: unknown }> };
    };
    const paths = (spec.paths ?? {}) as Record<string, { post?: Post }>;

    const differing: string[] = [];
    let withBody = 0;
    for (const op of OPERATIONS) {
      const post = paths[`/${op.module}/${operationId(op)}`]?.post;
      const published =
        post?.requestBody?.content?.["application/json"]?.schema;
      if (published !== undefined) withBody++;
      // An operation with no arguments publishes no request body.
      const expected =
        Object.keys((op.schema as { properties?: object }).properties ?? {})
          .length === 0 && published === undefined
          ? undefined
          : op.schema;
      if (JSON.stringify(published) !== JSON.stringify(expected)) {
        differing.push(op.name);
      }
    }
    expect(differing).toEqual([]);
    // Not vacuous: nearly every operation takes arguments.
    expect(withBody).toBeGreaterThan(OPERATIONS.length * 0.9);

    // And nothing else: every path is an operation or a deprecated alias.
    expect(Object.keys(paths).length).toBe(
      OPERATIONS.length + liveOperationAliases.length
    );
  });

  it("an MCP call runs the HTTP procedure, input validation included", async () => {
    // documentType is an enum in the manifest; the same refusal either way.
    const result = await callOperation("settings_getDocumentTemplate", ctx, {
      documentType: "not-a-document"
    });
    expect(result.success).toBe(false);
  });
});

// Services match the row they write by its id, and a signed-in user's client
// reaches every company they belong to. The client the dispatcher hands over
// adds the caller's company to the write.
describe("a write is confined to the caller's company", () => {
  it("a service that deletes by id alone cannot reach another company's row", async () => {
    const queries: URLSearchParams[] = [];
    const client = createClient("http://localhost:54321", "anon-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input) => {
          queries.push(new URL(String(input)).searchParams);
          return new Response("[]", {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
      }
    });
    // The real service, in miniature: `.delete().eq("id", customerId)`.
    spies.deleteCustomer.mockImplementation(
      (handed: typeof client, customerId: string) =>
        handed.from("customer").delete().eq("id", customerId)
    );

    const meta = operationsByName.get("sales_deleteCustomer");
    if (!meta)
      throw new Error("sales_deleteCustomer missing from the manifest");
    await dispatchOperation(
      meta,
      { ...ctx, client: client as unknown as AuthedContext["client"] },
      { customerId: "customer-of-company-b" }
    );

    expect(queries).toHaveLength(1);
    expect(queries[0]?.get("id")).toBe("eq.customer-of-company-b");
    expect(queries[0]?.get("companyId")).toBe("eq.c1");
  });
});
