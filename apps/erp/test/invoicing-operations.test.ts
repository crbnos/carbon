// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { pageClaims } from "./page-claims";
import { createServiceContext } from "@carbon/api/service-fn.server";
import { describe, expect, it } from "vitest";
import { fromServerFn } from "../app/modules/shared/shared.service";
import {
  changePurchaseInvoiceLineAccount,
  changeSalesInvoiceLineAccount,
  updatePurchaseInvoiceField,
  updateSalesInvoiceField
} from "../app/modules/invoicing/invoicing.server";
import { tieOutAdjustmentLines } from "../app/modules/invoicing/invoicing.service";
import { filteringSupabase } from "./filtering-supabase-fake";

const unreachable = () => {
  throw new Error("must not be reached");
};

const context = () =>
  createServiceContext({
    actor: { type: "system", onBehalfOf: "user-1" },
    company: { id: "company-1", groupId: "group-1" },
    caller: {} as never,
    system: unreachable,
    pg: unreachable,
    kv: unreachable
  });

describe("a server function's refusal", () => {
  const refusal = (status: number, message: string) =>
    fromServerFn(context(), { status, message }, "Failed to void charge");

  it("keeps the server function's own message, in the category its status names", () => {
    // A generic string left the user looking at a Posted charge with no idea
    // why it stayed posted.
    expect(refusal(422, "Charge is already voided")).toMatchObject({
      category: "rule",
      message: "Charge is already voided"
    });
    expect(refusal(400, "The invoice has no lines").category).toBe(
      "validation"
    );
    expect(refusal(403, "No").category).toBe("forbidden");
    expect(refusal(404, "Gone").category).toBe("notFound");
    expect(refusal(409, "Changed").category).toBe("conflict");
    // A plain throw keeps its message at 500: an authored refusal, mapped as
    // `settle` maps it.
    expect(refusal(500, "Boom")).toMatchObject({
      category: "validation",
      message: "Boom"
    });
  });

  it("falls back to the operation's message when the failure has none", () => {
    // A data-layer failure arrives with an empty message by design.
    expect(refusal(500, "")).toMatchObject({
      category: "internal",
      message: "Failed to void charge"
    });
  });
});

describe("a tie-out adjustment", () => {
  const lines = (side: "receivables" | "payables", variance: number) =>
    tieOutAdjustmentLines({
      side,
      variance,
      controlAccount: "control",
      offsetAccount: "rounding",
      description: "adjustment"
    }).map(({ accountId, debit, credit }) => ({ accountId, debit, credit }));

  it("raises an understated receivables balance with a debit", () => {
    expect(lines("receivables", 12.5)).toEqual([
      { accountId: "control", debit: 12.5, credit: 0 },
      { accountId: "rounding", debit: 0, credit: 12.5 }
    ]);
    expect(lines("receivables", -3)).toEqual([
      { accountId: "control", debit: 0, credit: 3 },
      { accountId: "rounding", debit: 3, credit: 0 }
    ]);
  });

  it("raises an understated payables balance with a credit", () => {
    expect(lines("payables", 12.5)).toEqual([
      { accountId: "control", debit: 0, credit: 12.5 },
      { accountId: "rounding", debit: 12.5, credit: 0 }
    ]);
    expect(lines("payables", -3)).toEqual([
      { accountId: "control", debit: 3, credit: 0 },
      { accountId: "rounding", debit: 0, credit: 3 }
    ]);
  });
});

describe("changing a posted line's account", () => {
  // A user who may post and void invoices, but not change the ledger.
  const invoicingOnly = () =>
    createServiceContext({
      actor: {
        type: "user",
        userId: "user-1",
        role: "employee",
        permissions: pageClaims({
          invoicing: {
            view: ["company-1"],
            create: ["company-1"],
            update: ["company-1"],
            delete: ["company-1"]
          },
          accounting: {
            view: ["company-1"],
            create: [],
            update: [],
            delete: []
          }
        })
      },
      company: { id: "company-1", groupId: "group-1" },
      caller: {} as never,
      system: unreachable,
      pg: unreachable,
      kv: unreachable
    });
  const input = { invoiceId: "inv-1", lineId: "line-1", accountId: "acc-1" };

  it("needs accounting update as well as invoicing update, before any read", async () => {
    for (const change of [
      changeSalesInvoiceLineAccount,
      changePurchaseInvoiceLineAccount
    ]) {
      const result = await change(invoicingOnly(), input);
      expect(result.error).toMatchObject({ category: "forbidden" });
    }
  });
});

describe("setting an invoice header field", () => {
  const actions = (...granted: string[]) => ({
    view: ["company-1"],
    create: granted.includes("create") ? ["company-1"] : [],
    update: granted.includes("update") ? ["company-1"] : [],
    delete: []
  });
  const as = (
    client: unknown,
    permissions: Record<string, ReturnType<typeof actions>>
  ) =>
    createServiceContext({
      actor: {
        type: "user",
        role: "employee",
        userId: "user-1",
        permissions: pageClaims(permissions)
      },
      company: { id: "company-1", groupId: "group-1" },
      caller: client as never,
      system: unreachable,
      pg: unreachable,
      kv: unreachable
    });
  // company-2 holds an invoice with the same id: a write that drops the
  // companyId filter reaches it.
  const invoices = () => {
    const rows = [
      { id: "inv-1", companyId: "company-2", status: "Draft" },
      { id: "inv-1", companyId: "company-1", status: "Draft" },
      { id: "inv-2", companyId: "company-1", status: "Draft" }
    ];
    return { salesInvoice: rows, purchaseInvoice: rows };
  };
  const invoicingUpdate = { invoicing: actions("update") };

  it("needs Edit on the invoice's page, which the invoice tables' RLS asks for, not on sales or purchasing", async () => {
    const { client, writes } = filteringSupabase(invoices());
    const salesAndPurchasing = {
      sales: actions("create", "update"),
      purchasing: actions("create", "update"),
      invoicing: actions()
    };
    const input = {
      ids: ["inv-1"],
      field: "customerReference" as const,
      value: "PO-9"
    };
    expect(
      (await updateSalesInvoiceField(as(client, salesAndPurchasing), input))
        .error
    ).toMatchObject({ category: "forbidden" });
    expect(
      (
        await updatePurchaseInvoiceField(as(client, salesAndPurchasing), {
          ...input,
          field: "supplierReference"
        })
      ).error
    ).toMatchObject({ category: "forbidden" });
    expect(writes).toEqual([]);
  });

  it("answers the invoices the write reached, and refuses when it reached none", async () => {
    const { client } = filteringSupabase(invoices());
    const ctx = as(client, invoicingUpdate);

    const reached = await updateSalesInvoiceField(ctx, {
      ids: ["inv-1", "inv-9"],
      field: "customerReference",
      value: "PO-9"
    });
    expect(reached).toEqual({ data: { ids: ["inv-1"] }, error: null });

    const none = await updatePurchaseInvoiceField(ctx, {
      ids: ["inv-9"],
      field: "supplierReference",
      value: "PO-9"
    });
    expect(none.error).toMatchObject({ category: "notFound" });
  });

  it("sets the issue date or payment term on one invoice at a time, since each due date follows its own", async () => {
    const { client, writes } = filteringSupabase(invoices());
    const ctx = as(client, invoicingUpdate);
    for (const field of ["dateIssued", "paymentTermId"] as const) {
      const result = await updateSalesInvoiceField(ctx, {
        ids: ["inv-1", "inv-2"],
        field,
        value: "2026-11-01"
      });
      expect(result.error).toMatchObject({ category: "validation" });
    }
    expect(writes).toEqual([]);
  });

  it.each([
    ["the customer", "customerId", null],
    ["the invoice customer", "invoiceCustomerId", ""]
  ] as const)("does not clear %s of a sales invoice", async (_, field, value) => {
    const { client, writes } = filteringSupabase(invoices());
    const result = await updateSalesInvoiceField(as(client, invoicingUpdate), {
      ids: ["inv-1"],
      field,
      value
    });
    expect(result.error).toMatchObject({ category: "validation" });
    expect(writes).toEqual([]);
  });

  // The ownership reads run as the system, the writes as the caller.
  const withReferences = () => {
    const tables: Record<string, Record<string, unknown>[]> = invoices();
    for (const table of [
      "customer",
      "customerContact",
      "customerLocation",
      "supplier",
      "supplierContact",
      "supplierLocation",
      "paymentTerm",
      "location"
    ]) {
      tables[table] = [
        { id: "foreign", companyId: "company-2" },
        { id: "own", companyId: "company-1" }
      ];
    }
    const fake = filteringSupabase(tables);
    const ctx = createServiceContext({
      actor: {
        type: "user",
        role: "employee",
        userId: "user-1",
        permissions: pageClaims(invoicingUpdate)
      },
      company: { id: "company-1", groupId: "group-1" },
      caller: fake.client,
      system: () => fake.client,
      pg: unreachable,
      kv: unreachable
    });
    return { ...fake, ctx };
  };

  it.each([
    ["sales", "customerId"],
    ["sales", "invoiceCustomerId"],
    ["sales", "invoiceCustomerContactId"],
    ["sales", "invoiceCustomerLocationId"],
    ["sales", "paymentTermId"],
    ["sales", "locationId"],
    ["purchase", "supplierId"],
    ["purchase", "invoiceSupplierId"],
    ["purchase", "invoiceSupplierContactId"],
    ["purchase", "invoiceSupplierLocationId"],
    ["purchase", "paymentTermId"]
  ] as const)("refuses another company's row for a %s invoice's %s, before any write", async (kind, field) => {
    const { ctx, writes } = withReferences();
    const input = { ids: ["inv-1"], field, value: "foreign" } as never;
    const result =
      kind === "sales"
        ? await updateSalesInvoiceField(ctx, input)
        : await updatePurchaseInvoiceField(ctx, input);
    expect(result.error).toMatchObject({ category: "notFound" });
    expect(writes).toEqual([]);
  });

  it("clears the ship-to and sets the customer when the customer is the company's", async () => {
    const { ctx, writes } = withReferences();
    const result = await updateSalesInvoiceField(ctx, {
      ids: ["inv-1"],
      field: "customerId",
      value: "own"
    });
    expect(result).toEqual({ data: { ids: ["inv-1"] }, error: null });
    expect(writes.map(({ table, op }) => [table, op])).toEqual([
      ["salesInvoiceShipment", "update"],
      ["salesInvoice", "update"]
    ]);
  });
});
