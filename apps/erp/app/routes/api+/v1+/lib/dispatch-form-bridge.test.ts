// The API form bridge end to end, against REAL manifest entries: input
// validation (the published schema, compiled exactly as the router compiles
// it) followed by dispatch. The service is the boundary; what it receives is
// what the UI route would have handed it for the same values.

import { jsonSchemaInput } from "@carbon/api/schema";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  upsertMethodOperationStep: vi.fn(),
  upsertMethodOperationStepSlide: vi.fn(),
  updateSalesOrder: vi.fn(),
  upsertStockTransferLines: vi.fn(),
  upsertPurchaseInvoiceLine: vi.fn(),
  updateCustomerTax: vi.fn(),
  updatePricingRule: vi.fn(),
  FAKE_CLIENT: { __supabase: true }
}));

vi.mock("~/modules/account/account.service", () => ({}));
vi.mock("~/modules/accounting/accounting.service", () => ({}));
vi.mock("~/modules/documents/documents.service", () => ({}));
vi.mock("~/modules/inventory/inventory.service", () => ({
  upsertStockTransferLines: spies.upsertStockTransferLines
}));
vi.mock("~/modules/invoicing/invoicing.service", () => ({
  upsertPurchaseInvoiceLine: spies.upsertPurchaseInvoiceLine
}));
vi.mock("~/modules/items/items.service", () => ({
  upsertMethodOperationStep: spies.upsertMethodOperationStep,
  upsertMethodOperationStepSlide: spies.upsertMethodOperationStepSlide
}));
vi.mock("~/modules/people/people.service", () => ({}));
vi.mock("~/modules/production/production.mcp.server", () => ({}));
vi.mock("~/modules/production/production.service", () => ({}));
vi.mock("~/modules/purchasing/purchasing.service", () => ({}));
vi.mock("~/modules/quality/quality.service", () => ({}));
vi.mock("~/modules/resources/resources.service", () => ({}));
vi.mock("~/modules/sales/sales.service", () => ({
  updateCustomerTax: spies.updateCustomerTax,
  updatePricingRule: spies.updatePricingRule,
  updateSalesOrder: spies.updateSalesOrder
}));
vi.mock("~/modules/settings/settings.service", () => ({}));
vi.mock("~/modules/shared/shared.service", () => ({}));
vi.mock("~/modules/users/users.service", () => ({}));
vi.mock("./sales-rules-gate.server", () => ({
  checkSalesRulesForOperation: vi.fn(async () => null)
}));
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: () => ({ __kysely: true })
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })
}));
// Validators reach `@carbon/glossary`, whose `msg` macro compiles only under
// the app's Vite lingui plugin; an inert tag loads them unchanged.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | string) =>
    Array.isArray(strings) ? strings.join("") : strings
}));
vi.mock("@lingui/react/macro", () => ({
  Trans: () => null,
  useLingui: () => ({ t: (s: unknown) => String(s) })
}));

import type { AuthedContext } from "./base.server";
import { dispatchOperation } from "./dispatch.server";
import { modelsLoaders } from "./field-coercers.server";
import { operationsByName } from "./operations.server";

const ctx: AuthedContext = {
  client: spies.FAKE_CLIENT as unknown as AuthedContext["client"],
  companyId: "c1",
  companyGroupId: "g1",
  userId: "u1",
  authKind: "session",
  scopes: {}
};

/** Validate as the router does, then dispatch; return the service payload. */
async function call(
  name: string,
  spy: ReturnType<typeof vi.fn>,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const meta = operationsByName.get(name);
  if (!meta) throw new Error(`${name} missing from the generated manifest`);
  const validated = jsonSchemaInput(meta.schema)["~standard"].validate(input);
  if ("issues" in validated) {
    throw new Error(
      `${name} rejected: ${validated.issues.map((i) => i.message).join("; ")}`
    );
  }
  spy.mockResolvedValue({ data: { id: "x" }, error: null });
  await dispatchOperation(meta, ctx, validated.value);
  const payload = spy.mock.calls[0]?.[1] as Record<string, unknown>;
  return payload;
}

beforeAll(async () => {
  await Promise.all(Object.values(modelsLoaders).map((load) => load()));
}, 60_000);

beforeEach(() => {
  for (const spy of Object.values(spies)) {
    if (typeof spy === "function") spy.mockReset();
  }
});

describe("transforms the UI's form validator runs", () => {
  it("hands the service a tiptap document for a plain-text description", async () => {
    const payload = await call(
      "items_upsertMethodOperationStep",
      spies.upsertMethodOperationStep,
      {
        _operation: "create",
        operationId: "op-1",
        name: "Torque",
        type: "Task",
        description: "Torque to 5 Nm"
      }
    );
    expect(payload.description).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Torque to 5 Nm" }]
        }
      ]
    });
  });

  it("hands the service an array for JSON-string lines", async () => {
    const lines = [{ itemId: "item-1", quantity: 3 }];
    const payload = await call(
      "inventory_upsertStockTransferLines",
      spies.upsertStockTransferLines,
      { stockTransferId: "st-1", lines: JSON.stringify(lines) }
    );
    expect(payload.lines).toEqual(lines);
    expect(payload.stockTransferId).toBe("st-1");
  });

  it("hands the service a tiptap document for notes stored under another column name", async () => {
    const payload = await call(
      "sales_updateSalesOrder",
      spies.updateSalesOrder,
      {
        id: "so-1",
        notes: "Ship with the next pallet"
      }
    );
    expect(payload.notes).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Ship with the next pallet" }]
        }
      ]
    });
  });

  it("accepts slide annotations as an array or as their JSON string", async () => {
    const annotations = [{ id: "pin-1", x: 0.25, y: 0.5, label: "Bolt" }];
    for (const sent of [annotations, JSON.stringify(annotations)]) {
      spies.upsertMethodOperationStepSlide.mockReset();
      const payload = await call(
        "items_upsertMethodOperationStepSlide",
        spies.upsertMethodOperationStepSlide,
        {
          _operation: "update",
          id: "slide-1",
          stepId: "step-1",
          annotations: sent
        }
      );
      expect(payload.annotations).toEqual(annotations);
    }
  });
});

describe("published defaults never overwrite on update", () => {
  it("a partial customer tax update does not send taxExempt", async () => {
    const payload = await call(
      "sales_updateCustomerTax",
      spies.updateCustomerTax,
      { customerId: "cust-1", vatNumber: "DE123" }
    );
    expect("taxExempt" in payload).toBe(false);
  });

  it("a partial pricing rule update does not reset priority or scoping", async () => {
    const meta = operationsByName.get("sales_updatePricingRule");
    const validated = jsonSchemaInput(meta!.schema)["~standard"].validate({
      id: "rule-1",
      data: { active: false }
    });
    expect("issues" in validated).toBe(false);
    const data = (validated as { value: { data: Record<string, unknown> } })
      .value.data;
    expect(data).toEqual({ active: false });
  });

  it("an id-discriminated upsert gets the validator defaults on create only", async () => {
    const created = await call(
      "invoicing_upsertPurchaseInvoiceLine",
      spies.upsertPurchaseInvoiceLine,
      {
        invoiceId: "inv-1",
        invoiceLineType: "Part",
        quantity: 1,
        locationId: "loc-1"
      }
    );
    expect(created.taxPercent).toBe(0);
    expect(created.supplierShippingCost).toBe(0);

    spies.upsertPurchaseInvoiceLine.mockReset();
    const updated = await call(
      "invoicing_upsertPurchaseInvoiceLine",
      spies.upsertPurchaseInvoiceLine,
      {
        id: "line-1",
        invoiceId: "inv-1",
        invoiceLineType: "Part",
        quantity: 2,
        locationId: "loc-1"
      }
    );
    expect("taxPercent" in updated).toBe(false);
    expect("supplierShippingCost" in updated).toBe(false);
  });
});
