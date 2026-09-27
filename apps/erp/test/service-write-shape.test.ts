import { beforeEach, describe, expect, it, vi } from "vitest";

// What reaches the DATABASE when a service is called the way an API caller
// calls it: without the route's pre-call destructure, without the fields the
// form always posts, without a pre-allocated readable number. The Supabase
// client is the boundary — it records each write and answers every call with
// a row — and each case also pins the UI route's call shape, which must keep
// writing exactly what it wrote before.

// The service graphs reach @carbon/glossary, whose Lingui `msg` macro only
// compiles under the app's Vite plugin; an inert tag loads them unchanged.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | string) =>
    Array.isArray(strings) ? strings.join("") : strings
}));
vi.mock("@lingui/react/macro", () => ({
  Trans: () => null,
  useLingui: () => ({ t: (s: unknown) => String(s) })
}));

type Write = { table: string; op: string; values: unknown };
type Rpc = { fn: string; args: Record<string, unknown> };

let writes: Write[] = [];
let rpcs: Rpc[] = [];

/** A thenable query chain that resolves to one row for anything asked. */
function chain(): Record<string, unknown> {
  const result = { data: { id: "row-1" }, error: null };
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "single", "maybeSingle", "order"]) {
    c[m] = () => c;
  }
  c.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return c;
}

const client = {
  from: (table: string) => ({
    insert: (values: unknown) => {
      writes.push({ table, op: "insert", values });
      return chain();
    },
    update: (values: unknown) => {
      writes.push({ table, op: "update", values });
      return chain();
    },
    upsert: (values: unknown) => {
      writes.push({ table, op: "upsert", values });
      return chain();
    },
    select: () => chain()
  }),
  rpc: async (fn: string, args: Record<string, unknown>) => {
    rpcs.push({ fn, args });
    return { data: "SEQ-000042", error: null };
  }
} as never;

const writesTo = (table: string) => writes.filter((w) => w.table === table);

// Load order matters: the sales models read `currencyCodes` from the
// accounting barrel at module load, and the barrel reaches the sales models
// again through the accounting models. Entering through the sales models
// lets the barrel finish before that read.
await import("~/modules/sales/sales.models");
const { insertCustomerContact, updateCustomerContact, updateCustomerLocation } =
  await import("~/modules/sales/sales.service");
const { updateSupplierContact, updateSupplierLocation } = await import(
  "~/modules/purchasing/purchasing.service"
);
const { updateItem } = await import("~/modules/items/items.service");
const { upsertMemo, upsertPayment } = await import(
  "~/modules/invoicing/invoicing.service"
);

beforeEach(() => {
  writes = [];
  rpcs = [];
});

describe("customer and supplier contacts", () => {
  it("writes the location without custom fields and never writes form keys to contact", async () => {
    await updateCustomerContact(client, {
      contactId: "con-1",
      customerLocationId: "loc-2",
      contact: {
        id: "cc-1",
        contactId: "con-1",
        customerLocationId: "loc-2",
        email: "buyer@example.com",
        firstName: "Ada"
      }
    });
    expect(writesTo("customerContact")).toEqual([
      {
        table: "customerContact",
        op: "update",
        values: { customerLocationId: "loc-2" }
      }
    ]);
    const contact = writesTo("contact")[0]?.values as Record<string, unknown>;
    expect(contact).toEqual({ email: "buyer@example.com", firstName: "Ada" });
  });

  it("keeps the form's write when custom fields and location are both sent", async () => {
    await updateSupplierContact(client, {
      contactId: "con-1",
      supplierLocationId: "loc-3",
      customFields: { tier: "gold" },
      contact: { email: "rep@example.com" }
    });
    expect(writesTo("supplierContact")[0]?.values).toEqual({
      customFields: { tier: "gold" },
      supplierLocationId: "loc-3"
    });
  });

  it("inserts a contact without the customer-contact keys", async () => {
    await insertCustomerContact(client, {
      customerId: "cust-1",
      companyId: "c1",
      customerLocationId: "loc-2",
      contact: {
        id: "cc-9",
        contactId: "con-9",
        customerLocationId: "loc-2",
        email: "new@example.com"
      }
    });
    const [contact] = writesTo("contact")[0]?.values as Record<
      string,
      unknown
    >[];
    expect(contact).toEqual({
      email: "new@example.com",
      isCustomer: true,
      companyId: "c1"
    });
  });
});

describe("customer and supplier locations", () => {
  it("renames a location without custom fields", async () => {
    await updateCustomerLocation(client, {
      addressId: "addr-1",
      name: "North Plant",
      address: { city: "Munich" }
    });
    expect(writesTo("customerLocation")[0]?.values).toEqual({
      name: "North Plant"
    });
    expect(writesTo("address")[0]?.values).toEqual({ city: "Munich" });
  });

  it("writes name and custom fields together as the form does", async () => {
    await updateSupplierLocation(client, {
      addressId: "addr-1",
      name: "Dock 4",
      address: {},
      customFields: {}
    });
    expect(writesTo("supplierLocation")[0]?.values).toEqual({
      name: "Dock 4",
      customFields: {}
    });
  });
});

describe("updateItem", () => {
  it("writes item columns only: never readableId, type, cost or shelf life", async () => {
    await updateItem(client, {
      id: "item-1",
      companyId: "c1",
      type: "Tool",
      name: "Bracket",
      replenishmentSystem: "Buy",
      defaultMethodType: "Purchase to Order",
      itemTrackingType: "Inventory",
      unitOfMeasureCode: "EA",
      // Sent by an API caller; not item columns (or not editable here).
      ...({ readableId: "RENAMED", unitCost: 5, postingGroupId: "pg-1" } as {})
    } as never);
    expect(writesTo("item")[0]?.values).toEqual({
      name: "Bracket",
      replenishmentSystem: "Buy",
      defaultMethodType: "Purchase to Order",
      itemTrackingType: "Inventory",
      unitOfMeasureCode: "EA"
    });
  });

  it("clears a field the form sent blank and leaves an unsent one alone", async () => {
    await updateItem(client, {
      id: "item-1",
      companyId: "c1",
      type: "Part",
      name: "Bracket",
      description: undefined,
      replenishmentSystem: "Buy",
      defaultMethodType: "Purchase to Order",
      itemTrackingType: "Inventory",
      unitOfMeasureCode: "EA"
    });
    const values = writesTo("item")[0]?.values as Record<string, unknown>;
    expect(values.description).toBeNull();
    expect("mpn" in values).toBe(false);
  });
});

describe("readable document numbers", () => {
  const payment = {
    paymentType: "Receipt" as const,
    customerId: "cust-1",
    paymentDate: "2026-09-01",
    currencyCode: "USD",
    exchangeRate: 1,
    totalAmount: 100,
    bankAccount: "1000",
    companyId: "c1",
    createdBy: "u1"
  };

  it("allocates a payment number when none is given", async () => {
    await upsertPayment(client, payment as never);
    expect(rpcs).toEqual([
      {
        fn: "get_next_sequence",
        args: { sequence_name: "payment", company_id: "c1" }
      }
    ]);
    const [row] = writesTo("payment")[0]?.values as Record<string, unknown>[];
    expect(row.paymentId).toBe("SEQ-000042");
  });

  it("keeps a typed payment number", async () => {
    await upsertPayment(client, { ...payment, paymentId: "PAY-X" } as never);
    expect(rpcs).toEqual([]);
    const [row] = writesTo("payment")[0]?.values as Record<string, unknown>[];
    expect(row.paymentId).toBe("PAY-X");
  });

  it("draws a memo number from the sequence of its direction", async () => {
    await upsertMemo(client, {
      direction: "Debit",
      supplierId: "sup-1",
      memoDate: "2026-09-01",
      currencyCode: "USD",
      exchangeRate: 1,
      amount: 10,
      companyId: "c1",
      createdBy: "u1"
    } as never);
    expect(rpcs[0]?.args.sequence_name).toBe("debitMemo");
    const [row] = writesTo("memo")[0]?.values as Record<string, unknown>[];
    expect(row.memoId).toBe("SEQ-000042");
  });

  it("never allocates on update", async () => {
    await upsertMemo(client, {
      id: "memo-1",
      direction: "Credit",
      memoDate: "2026-09-01",
      currencyCode: "USD",
      amount: 10,
      updatedBy: "u1"
    } as never);
    expect(rpcs).toEqual([]);
  });
});
