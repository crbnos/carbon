// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// The module's imports reach the glossary, whose `msg` macro only runs compiled.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));

import { createServiceContext } from "@carbon/api/service-fn.server";
import {
  createPurchaseInvoiceLine,
  updatePurchaseInvoiceLine
} from "../app/modules/invoicing/invoicing.server";
import { createPurchaseOrderLine } from "../app/modules/purchasing/purchasing.server";
import { type FakeWrite, filteringSupabase } from "./filtering-supabase-fake";

const unreachable = () => {
  throw new Error("must not be reached");
};

const grant = (module: string) => ({
  [module]: {
    view: ["company-1"],
    create: ["company-1"],
    update: ["company-1"],
    delete: ["company-1"]
  }
});

function contextFor(client: unknown, module: string) {
  return createServiceContext({
    actor: { type: "user", userId: "user-1", permissions: grant(module) },
    company: { id: "company-1", groupId: "group-1" },
    caller: client as never,
    // The change-order hold reads with the service role.
    system: (() => client) as never,
    pg: unreachable,
    kv: unreachable
  });
}

const component = (overrides: Record<string, unknown>) => ({
  id: "c-state",
  name: "State",
  taxAuthorityId: "ta-1",
  taxPercent: 0.0625,
  recoverablePercent: 1,
  sequence: 1,
  isCompound: false,
  taxReceivedAccountId: null,
  taxPaidAccountId: null,
  effectiveDate: null,
  expirationDate: null,
  ...overrides
});

// The supplier's tax code: two components, 6.25% + 2%. Its own bare
// percent (5%) must not be what a line takes. Every row names its company:
// a read that drops the companyId filter also finds company-2's rows.
const tables = () => ({
  purchaseInvoice: [
    {
      id: "pi-1",
      companyId: "company-1",
      supplierId: "supplier-1",
      dateIssued: "2026-10-01",
      postingDate: null,
      currencyCode: "USD"
    }
  ],
  purchaseOrder: [
    {
      id: "po-1",
      companyId: "company-1",
      supplierId: "supplier-1",
      orderDate: "2026-10-01",
      currencyCode: "USD",
      status: "Draft"
    }
  ],
  supplier: [{ id: "supplier-1", companyId: "company-1", taxPercent: 0.05 }],
  supplierTax: [
    { supplierId: "supplier-1", companyId: "company-1", taxCodeId: "tc-houston" }
  ],
  item: [
    { id: "item-1", companyId: "company-1", taxable: true },
    { id: "item-free", companyId: "company-1", taxable: false }
  ],
  taxCode: [
    {
      id: "tc-houston",
      companyId: "company-1",
      calculationType: "Normal",
      taxesShipping: false,
      taxCodeComponent: [
        component({}),
        component({ id: "c-city", name: "City", taxPercent: 0.02, sequence: 2 })
      ]
    },
    {
      id: "tc-eu-rc",
      companyId: "company-1",
      calculationType: "Reverse Charge",
      taxesShipping: false,
      taxCodeComponent: [component({ id: "c-vat", taxPercent: 0.2 })]
    },
    {
      id: "tc-expired",
      companyId: "company-1",
      calculationType: "Normal",
      taxesShipping: false,
      taxCodeComponent: [component({ expirationDate: "2025-12-31" })]
    },
    {
      id: "tc-other-company",
      companyId: "company-2",
      calculationType: "Normal",
      taxesShipping: false,
      taxCodeComponent: [component({ taxPercent: 0.3 })]
    }
  ],
  currencies: [
    { code: "USD", companyGroupId: "group-1", decimalPlaces: 2 }
  ],
  purchaseInvoiceLine: [
    {
      id: "pil-1",
      companyId: "company-1",
      itemId: "item-1",
      taxCodeId: "tc-houston",
      supplierUnitPrice: 100,
      quantity: 2,
      supplierShippingCost: 0
    },
    {
      id: "pil-rc",
      companyId: "company-1",
      itemId: "item-1",
      taxCodeId: "tc-eu-rc",
      supplierUnitPrice: 100,
      quantity: 2,
      supplierShippingCost: 0
    },
    {
      id: "pil-free",
      companyId: "company-1",
      itemId: "item-free",
      taxCodeId: "tc-houston",
      supplierUnitPrice: 100,
      quantity: 2,
      supplierShippingCost: 0
    }
  ]
});

const written = (writes: FakeWrite[], table: string) => {
  const write = writes.find((w) => w.table === table);
  return Array.isArray(write?.value) ? write?.value[0] : write?.value;
};

const piLine = {
  invoiceId: "pi-1",
  invoiceLineType: "Part" as const,
  itemId: "item-1",
  quantity: 2,
  supplierUnitPrice: 100
};

describe("createPurchaseInvoiceLine", () => {
  it("gives a line sent with no tax code the supplier's code and its rate", async () => {
    const { client, writes } = filteringSupabase(tables());

    const result = await createPurchaseInvoiceLine(
      contextFor(client, "invoicing"),
      piLine
    );

    expect(result.error).toBeNull();
    expect(written(writes, "purchaseInvoiceLine")).toMatchObject({
      taxCodeId: "tc-houston",
      taxPercent: 0.0825,
      supplierTaxAmount: 16.5
    });
  });

  it("takes a sent code's rate, not a percent that disagrees with it", async () => {
    const { client, writes } = filteringSupabase(tables());

    const result = await createPurchaseInvoiceLine(
      contextFor(client, "invoicing"),
      { ...piLine, taxCodeId: "tc-houston", taxPercent: 0.05 }
    );

    expect(result.error).toBeNull();
    // No amount was sent, so it is restated from the code's rate.
    expect(written(writes, "purchaseInvoiceLine")).toMatchObject({
      taxCodeId: "tc-houston",
      taxPercent: 0.0825,
      supplierTaxAmount: 16.5
    });
  });

  it("keeps the supplier's charged amount sent with a code", async () => {
    const { client, writes } = filteringSupabase(tables());

    await createPurchaseInvoiceLine(contextFor(client, "invoicing"), {
      ...piLine,
      taxCodeId: "tc-houston",
      supplierTaxAmount: 16.51
    });

    expect(written(writes, "purchaseInvoiceLine")).toMatchObject({
      taxPercent: 0.0825,
      supplierTaxAmount: 16.51
    });
  });

  it("refuses a supplier tax amount on a Reverse Charge code", async () => {
    const { client, writes } = filteringSupabase(tables());

    const result = await createPurchaseInvoiceLine(
      contextFor(client, "invoicing"),
      { ...piLine, taxCodeId: "tc-eu-rc", supplierTaxAmount: 40 }
    );

    expect(result.error?.message).toContain("Reverse Charge");
    expect(writes).toHaveLength(0);
  });

  it("stores a Reverse Charge line with no supplier tax at 0%", async () => {
    const { client, writes } = filteringSupabase(tables());

    await createPurchaseInvoiceLine(contextFor(client, "invoicing"), {
      ...piLine,
      taxCodeId: "tc-eu-rc"
    });

    expect(written(writes, "purchaseInvoiceLine")).toMatchObject({
      taxCodeId: "tc-eu-rc",
      taxPercent: 0,
      supplierTaxAmount: 0
    });
  });

  it("refuses a code with no component in force on the invoice date", async () => {
    const { client, writes } = filteringSupabase(tables());

    const result = await createPurchaseInvoiceLine(
      contextFor(client, "invoicing"),
      { ...piLine, taxCodeId: "tc-expired" }
    );

    expect(result.error?.message).toContain("no rate in force on 2026-10-01");
    expect(writes).toHaveLength(0);
  });

  it("refuses another company's tax code", async () => {
    const { client, writes } = filteringSupabase(tables());

    const result = await createPurchaseInvoiceLine(
      contextFor(client, "invoicing"),
      { ...piLine, taxCodeId: "tc-other-company" }
    );

    expect(result.error?.message).toContain("Tax code not found");
    expect(writes).toHaveLength(0);
  });
});

describe("updatePurchaseInvoiceLine", () => {
  it("clears the tax of a line on a non-taxable item, read from the stored line", async () => {
    const { client, writes } = filteringSupabase(tables());

    await updatePurchaseInvoiceLine(contextFor(client, "invoicing"), {
      id: "pil-free",
      invoiceId: "pi-1",
      invoiceLineType: "Part",
      taxPercent: 0.0825
    });

    expect(written(writes, "purchaseInvoiceLine")).toMatchObject({
      taxCodeId: null,
      taxPercent: 0,
      supplierTaxAmount: 0
    });
  });

  it("holds a percent sent alone to the stored code's rate", async () => {
    const { client, writes } = filteringSupabase(tables());

    await updatePurchaseInvoiceLine(contextFor(client, "invoicing"), {
      id: "pil-1",
      invoiceId: "pi-1",
      invoiceLineType: "Part",
      taxPercent: 0.05
    });

    expect(written(writes, "purchaseInvoiceLine")).toMatchObject({
      taxCodeId: "tc-houston",
      taxPercent: 0.0825,
      supplierTaxAmount: 16.5
    });
  });

  it("refuses a tax amount on a line whose stored code is Reverse Charge", async () => {
    const { client, writes } = filteringSupabase(tables());

    const result = await updatePurchaseInvoiceLine(
      contextFor(client, "invoicing"),
      {
        id: "pil-rc",
        invoiceId: "pi-1",
        invoiceLineType: "Part",
        supplierTaxAmount: 40
      }
    );

    expect(result.error?.message).toContain("Reverse Charge");
    expect(writes).toHaveLength(0);
  });

  it("clears the code when the field is sent empty", async () => {
    const { client, writes } = filteringSupabase(tables());

    await updatePurchaseInvoiceLine(contextFor(client, "invoicing"), {
      id: "pil-1",
      invoiceId: "pi-1",
      invoiceLineType: "Part",
      taxCodeId: "",
      taxPercent: 0.03,
      supplierTaxAmount: 6
    });

    expect(written(writes, "purchaseInvoiceLine")).toMatchObject({
      taxCodeId: null,
      taxPercent: 0.03,
      supplierTaxAmount: 6
    });
  });
});

describe("createPurchaseOrderLine", () => {
  it("refuses a supplier tax amount on a Reverse Charge code", async () => {
    const { client, writes } = filteringSupabase(tables());

    const result = await createPurchaseOrderLine(
      contextFor(client, "purchasing"),
      {
        purchaseOrderId: "po-1",
        purchaseOrderLineType: "Part",
        itemId: "item-1",
        purchaseQuantity: 2,
        supplierUnitPrice: 100,
        taxCodeId: "tc-eu-rc",
        supplierTaxAmount: 40
      }
    );

    expect(result.error?.message).toContain("Reverse Charge");
    expect(writes.filter((w) => w.table === "purchaseOrderLine")).toHaveLength(
      0
    );
  });
});
