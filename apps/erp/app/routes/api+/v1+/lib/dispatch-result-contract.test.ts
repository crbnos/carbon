// End-to-end result contract through callOperation (the MCP / agent / workflow
// entry point), pinned against REAL manifest entries: the service's return
// value is read by the manifest's `resultShape`, and a failure reaches the
// caller as an error with the message a person wrote — never as success.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ruleError } from "~/utils/supabase";

const spies = vi.hoisted(() => ({
  translateCompanyPeriodSeries: vi.fn(),
  getBomItemAttributes: vi.fn(),
  upsertPart: vi.fn(),
  autoMatchAssemblyComponents: vi.fn(),
  generateAssemblyStepsFromPlan: vi.fn(),
  updateJobMaterialOrder: vi.fn(),
  unassignPeopleWeek: vi.fn(),
  getSupplierInteraction: vi.fn(),
  cancelSalesOrder: vi.fn(),
  getSalesOrderRelatedItems: vi.fn(),
  FAKE_CLIENT: { __supabase: true }
}));

vi.mock("~/modules/account/account.service", () => ({}));
vi.mock("~/modules/accounting/accounting.service", () => ({
  translateCompanyPeriodSeries: spies.translateCompanyPeriodSeries
}));
vi.mock("~/modules/documents/documents.service", () => ({}));
vi.mock("~/modules/inventory/inventory.service", () => ({}));
vi.mock("~/modules/invoicing/invoicing.service", () => ({}));
vi.mock("~/modules/items/items.service", () => ({
  getBomItemAttributes: spies.getBomItemAttributes,
  upsertPart: spies.upsertPart
}));
vi.mock("~/modules/people/people.service", () => ({}));
vi.mock("~/modules/production/production.mcp.server", () => ({}));
vi.mock("~/modules/production/production.service", () => ({
  autoMatchAssemblyComponents: spies.autoMatchAssemblyComponents,
  generateAssemblyStepsFromPlan: spies.generateAssemblyStepsFromPlan,
  updateJobMaterialOrder: spies.updateJobMaterialOrder,
  unassignPeopleWeek: spies.unassignPeopleWeek
}));
vi.mock("~/modules/purchasing/purchasing.service", () => ({
  getSupplierInteraction: spies.getSupplierInteraction
}));
vi.mock("~/modules/quality/quality.service", () => ({}));
vi.mock("~/modules/resources/resources.service", () => ({}));
vi.mock("~/modules/sales/sales.service", () => ({
  cancelSalesOrder: spies.cancelSalesOrder,
  getSalesOrderRelatedItems: spies.getSalesOrderRelatedItems
}));
vi.mock("~/modules/settings/settings.service", () => ({}));
vi.mock("./sales-rules-gate.server", () => ({
  checkSalesRulesForOperation: vi.fn(async () => null)
}));
vi.mock("~/modules/shared/shared.service", () => ({}));
vi.mock("~/modules/users/users.service", () => ({}));
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: () => ({ __kysely: true })
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  })
}));

import type { AuthedContext } from "./base.server";
import { callOperation } from "./call.server";
import { DATABASE_ERROR_MESSAGES } from "./database-errors";
import { operationsByName } from "./operations.server";

const ctx: AuthedContext = {
  client: spies.FAKE_CLIENT as unknown as AuthedContext["client"],
  companyId: "c1",
  companyGroupId: "g1",
  userId: "u1",
  authKind: "session",
  scopes: {}
};

const shapeOf = (name: string) => operationsByName.get(name)?.resultShape;

beforeEach(() => {
  for (const spy of Object.values(spies)) {
    if (typeof spy === "function") spy.mockReset();
  }
});

describe("the manifest records the result shapes dispatch branches on", () => {
  it.each([
    ["production_autoMatchAssemblyComponents", "envelope"],
    ["production_generateAssemblyStepsFromPlan", "envelope"],
    ["production_syncAssemblyStepMaterialsFromMappings", "envelope"],
    ["sales_cancelSalesOrder", "envelope"],
    ["sales_calculatePricesForQuantities", "envelope"],
    ["accounting_validateDefaultIncomeAccounts", "envelope"],
    ["accounting_translateCompanyPeriodSeries", "envelope"],
    ["inventory_searchStorageUnitsWithAncestors", "envelope"],
    ["production_updateJobMaterialOrder", "envelope-array"],
    ["production_updateJobOperationOrder", "envelope-array"],
    ["sales_updateQuoteMaterialOrder", "envelope-array"],
    ["sales_updateQuoteOperationOrder", "envelope-array"],
    ["items_updateMaterialOrder", "envelope-array"],
    ["shared_updateSavedViewOrder", "envelope-array"],
    ["purchasing_getSupplierReportContacts", "envelope-array"],
    ["quality_getIssueTasks", "envelope-array"],
    ["production_unassignPeopleWeek", "plain"],
    ["items_getBomItemAttributes", "envelope"],
    ["sales_getBaseCatalog", "envelope"]
  ])("%s is %s", (name, shape) => {
    expect(shapeOf(name)).toBe(shape);
  });

  it("documents a { data, count } read as a list", () => {
    const schema = operationsByName.get("sales_getBaseCatalog")?.responseSchema;
    expect(schema?.type).toBe("array");
  });
});

describe("a returned failure reaches the caller as an error", () => {
  it("keeps a service-authored refusal's message (not-found split from no-model)", async () => {
    spies.autoMatchAssemblyComponents.mockResolvedValue({
      data: null,
      error: ruleError("Assembly instruction not found")
    });
    const result = await callOperation(
      "production_autoMatchAssemblyComponents",
      ctx,
      { args: { assemblyInstructionId: "missing" } }
    );
    expect(result).toEqual({
      success: false,
      error: "Assembly instruction not found",
      errorKind: "execution"
    });
  });

  it("reports a partial cancel as an error with its message", async () => {
    spies.cancelSalesOrder.mockResolvedValue({
      data: null,
      error: ruleError(
        "Sales order cancelled, but failed to look up associated jobs to cancel"
      )
    });
    const result = await callOperation("sales_cancelSalesOrder", ctx, {
      args: { id: "SO-1" }
    });
    expect(result).toMatchObject({
      success: false,
      error:
        "Sales order cancelled, but failed to look up associated jobs to cancel"
    });
  });

  it("keeps a string error's message", async () => {
    spies.translateCompanyPeriodSeries.mockResolvedValue({
      data: {},
      error: "No exchange rate for EUR"
    });
    const result = await callOperation(
      "accounting_translateCompanyPeriodSeries",
      ctx,
      { targetCurrency: "EUR", buckets: [], series: [] }
    );
    expect(result).toMatchObject({
      success: false,
      error: "No exchange rate for EUR"
    });
  });

  it("reports a refusal carrying a reason with its message", async () => {
    spies.generateAssemblyStepsFromPlan.mockResolvedValue({
      data: null,
      error: {
        ...ruleError(
          "Steps already exist — delete them before generating from the plan"
        ),
        reason: "steps-exist"
      }
    });
    const result = await callOperation(
      "production_generateAssemblyStepsFromPlan",
      ctx,
      { args: { assemblyInstructionId: "ai1" } }
    );
    expect(result).toMatchObject({
      success: false,
      error: "Steps already exist — delete them before generating from the plan"
    });
  });

  it("reduces a database failure to the public not-found message", async () => {
    spies.cancelSalesOrder.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST116",
        message: "JSON object requested, multiple (or no) rows returned",
        details: "",
        hint: ""
      }
    });
    const result = await callOperation("sales_cancelSalesOrder", ctx, {
      args: { id: "SO-missing" }
    });
    expect(result).toEqual({
      success: false,
      error: DATABASE_ERROR_MESSAGES.notFound,
      errorKind: "database"
    });
  });

  it("fails a reorder when a LATER element failed", async () => {
    spies.updateJobMaterialOrder.mockResolvedValue([
      { data: null, error: null, status: 204, statusText: "No Content" },
      {
        data: null,
        error: { code: "42501", message: "permission denied" },
        status: 403,
        statusText: "Forbidden"
      }
    ]);
    const result = await callOperation(
      "production_updateJobMaterialOrder",
      ctx,
      {
        updates: [
          { id: "jm1", order: 1 },
          { id: "jm2", order: 2 }
        ]
      }
    );
    expect(result).toEqual({
      success: false,
      error: DATABASE_ERROR_MESSAGES.permission,
      errorKind: "database"
    });
  });

  it("falls back to the legacy unwrap for an operation typed any", async () => {
    expect(shapeOf("items_upsertPart")).toBe("unknown");
    spies.upsertPart.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate" }
    });
    const result = await callOperation("items_upsertPart", ctx, {
      _operation: "create",
      id: "P-1",
      name: "Bracket",
      replenishmentSystem: "Buy",
      defaultMethodType: "Pull from Inventory",
      itemTrackingType: "Inventory",
      unitOfMeasureCode: "EA",
      revision: "0"
    });
    expect(result).toMatchObject({
      success: false,
      error: DATABASE_ERROR_MESSAGES.conflict
    });
  });
});

describe("success data is JSON the caller can read", () => {
  it("returns a reorder's per-element data, not raw PostgREST responses", async () => {
    spies.updateJobMaterialOrder.mockResolvedValue([
      { data: null, error: null, status: 204, statusText: "No Content" },
      { data: null, error: null, status: 204, statusText: "No Content" }
    ]);
    const result = await callOperation(
      "production_updateJobMaterialOrder",
      ctx,
      {
        updates: [{ id: "jm1", order: 1 }]
      }
    );
    expect(result).toEqual({ success: true, data: [null, null] });
  });

  it("serializes a Map result as entries instead of {}", async () => {
    spies.getBomItemAttributes.mockResolvedValue({
      data: new Map([["item_1", { readableId: "P-1", leadTime: 3 }]]),
      error: null
    });
    const result = await callOperation("items_getBomItemAttributes", ctx, {
      itemIds: ["item_1"]
    });
    expect(result).toEqual({
      success: true,
      data: [["item_1", { readableId: "P-1", leadTime: 3 }]]
    });
  });

  it("returns a plain object whole", async () => {
    spies.unassignPeopleWeek.mockResolvedValue({ removed: 3 });
    const result = await callOperation("production_unassignPeopleWeek", ctx, {
      args: {
        employeeId: "e1",
        workCenterId: "wc1",
        weekStart: "2026-09-28",
        shiftId: null
      }
    });
    expect(result).toEqual({ success: true, data: { removed: 3 } });
  });
});
