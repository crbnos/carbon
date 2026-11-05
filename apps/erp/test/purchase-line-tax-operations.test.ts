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
import {
  createPurchaseOrderLine,
  updatePurchaseOrderLine
} from "../app/modules/purchasing/purchasing.server";

const unreachable = () => {
  throw new Error("must not be reached");
};

type Write = { table: string; op: "insert" | "update"; value: any };

/** Every read answers `rows[table]`; every write is kept and resolves. */
function database(rows: Record<string, unknown>) {
  const writes: Write[] = [];
  const from = (table: string) => {
    const many = () => {
      const found = rows[table];
      if (found === undefined) return [];
      return Array.isArray(found) ? found : [found];
    };
    const chain: Record<string, any> = {};
    for (const method of ["select", "eq", "in", "neq", "is", "order"]) {
      chain[method] = () => chain;
    }
    chain.insert = (value: unknown) => {
      writes.push({ table, op: "insert", value });
      return chain;
    };
    chain.update = (value: unknown) => {
      writes.push({ table, op: "update", value });
      return chain;
    };
    chain.single = chain.maybeSingle = async () => ({
      data: many()[0] ?? { id: `${table}-1` },
      error: null
    });
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: many(), error: null }).then(resolve);
    return chain;
  };
  return { client: { from } as any, writes };
}

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
    system: unreachable,
    pg: unreachable,
    kv: unreachable
  });
}

// The supplier's tax code: two components, 6.25% + 2%, in force at the
// document date. Its own bare percent (5%) must not be what a line takes.
const supplierTaxRows = {
  supplier: { taxPercent: 0.05 },
  supplierTax: { taxCodeId: "tc-houston" },
  taxCode: [
    {
      id: "tc-houston",
      calculationType: "Normal",
      taxesShipping: false,
      taxCodeComponent: [
        {
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
          expirationDate: null
        },
        {
          id: "c-city",
          name: "City",
          taxAuthorityId: "ta-2",
          taxPercent: 0.02,
          recoverablePercent: 1,
          sequence: 2,
          isCompound: false,
          taxReceivedAccountId: null,
          taxPaidAccountId: null,
          effectiveDate: null,
          expirationDate: null
        }
      ]
    }
  ],
  currencies: { code: "USD", decimalPlaces: 2 }
};

const inserted = (writes: Write[], table: string) =>
  writes.find((write) => write.table === table && write.op === "insert")
    ?.value[0];
const updated = (writes: Write[], table: string) =>
  writes.find((write) => write.table === table && write.op === "update")
    ?.value;

describe("createPurchaseOrderLine", () => {
  const order = {
    purchaseOrders: {
      id: "po-1",
      supplierId: "supplier-1",
      orderDate: "2026-10-01",
      currencyCode: "USD"
    }
  };
  // What the API, an MCP tool or a workflow sends: no tax code at all.
  const apiLine = {
    purchaseOrderId: "po-1",
    purchaseOrderLineType: "Part" as const,
    itemId: "item-1",
    purchaseQuantity: 2,
    supplierUnitPrice: 100
  };

  it("gives a line sent with no tax code the supplier's code and its rate", async () => {
    const { client, writes } = database({
      ...order,
      ...supplierTaxRows,
      item: { taxable: true }
    });

    const result = await createPurchaseOrderLine(
      contextFor(client, "purchasing"),
      apiLine
    );

    expect(result.error).toBeNull();
    expect(inserted(writes, "purchaseOrderLine")).toMatchObject({
      taxCodeId: "tc-houston",
      taxPercent: 0.0825,
      supplierTaxAmount: 16.5
    });
  });

  it("keeps the sent percent with no code when the code is cleared", async () => {
    const { client, writes } = database({
      ...order,
      ...supplierTaxRows,
      item: { taxable: true }
    });

    await createPurchaseOrderLine(contextFor(client, "purchasing"), {
      ...apiLine,
      taxCodeId: "",
      taxPercent: 0.03,
      supplierTaxAmount: 6
    });

    const line = inserted(writes, "purchaseOrderLine");
    expect(line).toMatchObject({ taxPercent: 0.03, supplierTaxAmount: 6 });
    expect(line.taxCodeId).toBeUndefined();
  });

  it("stores no tax for a non-taxable item, whatever was sent", async () => {
    const { client, writes } = database({
      ...order,
      ...supplierTaxRows,
      item: { taxable: false }
    });

    await createPurchaseOrderLine(contextFor(client, "purchasing"), {
      ...apiLine,
      taxCodeId: "tc-houston",
      taxPercent: 0.0825,
      supplierTaxAmount: 16.5
    });

    const line = inserted(writes, "purchaseOrderLine");
    expect(line).toMatchObject({ taxPercent: 0, supplierTaxAmount: 0 });
    expect(line.taxCodeId).toBeUndefined();
  });
});

describe("updatePurchaseOrderLine", () => {
  it("clears the tax of a line on a non-taxable item", async () => {
    const { client, writes } = database({ item: { taxable: false } });

    await updatePurchaseOrderLine(contextFor(client, "purchasing"), {
      id: "pol-1",
      purchaseOrderId: "po-1",
      purchaseOrderLineType: "Part",
      itemId: "item-1",
      taxCodeId: "tc-houston",
      taxPercent: 0.0825,
      supplierTaxAmount: 16.5
    });

    expect(updated(writes, "purchaseOrderLine")).toMatchObject({
      taxCodeId: null,
      taxPercent: 0,
      supplierTaxAmount: 0
    });
  });
});

describe("createPurchaseInvoiceLine", () => {
  it("gives a line sent with no tax code the supplier's code and its rate", async () => {
    const { client, writes } = database({
      purchaseInvoices: {
        id: "pi-1",
        supplierId: "supplier-1",
        dateIssued: "2026-10-01",
        currencyCode: "USD"
      },
      ...supplierTaxRows,
      item: { taxable: true }
    });

    const result = await createPurchaseInvoiceLine(
      contextFor(client, "invoicing"),
      {
        invoiceId: "pi-1",
        invoiceLineType: "Part",
        itemId: "item-1",
        quantity: 2,
        supplierUnitPrice: 100
      }
    );

    expect(result.error).toBeNull();
    expect(inserted(writes, "purchaseInvoiceLine")).toMatchObject({
      taxCodeId: "tc-houston",
      taxPercent: 0.0825,
      supplierTaxAmount: 16.5
    });
  });
});

describe("updatePurchaseInvoiceLine", () => {
  it("clears the tax of a line on a non-taxable item, read from the stored line", async () => {
    const { client, writes } = database({
      // The call leaves the item out: the stored line names it.
      purchaseInvoiceLines: { id: "pil-1", itemId: "item-1" },
      item: { taxable: false }
    });

    await updatePurchaseInvoiceLine(contextFor(client, "invoicing"), {
      id: "pil-1",
      invoiceId: "pi-1",
      invoiceLineType: "Part",
      taxPercent: 0.0825
    });

    expect(updated(writes, "purchaseInvoiceLine")).toMatchObject({
      taxCodeId: null,
      taxPercent: 0,
      supplierTaxAmount: 0
    });
  });
});
