import { beforeEach, describe, expect, it, vi } from "vitest";

// API input validation passes unknown keys through, so a caller can still
// send a key a service's type leaves out. Services that spread their payload
// into a row must drop the keys their table has no column for, or PostgREST
// refuses the whole write (PGRST204). These cases send each such key the way
// an API caller would and check what reaches the database. The type-level
// guard (service-write-columns.test.ts) covers what the types declare; this
// covers what arrives at runtime.

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
let writes: Write[] = [];

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
  })
} as never;

/** The keys of every row written to `table`. */
const keysWritten = (table: string) =>
  writes
    .filter((w) => w.table === table)
    .flatMap((w) => (Array.isArray(w.values) ? w.values : [w.values]))
    .flatMap((row) => Object.keys(row as object));

// Entering through the sales models lets the accounting barrel finish loading
// before the sales models read `currencyCodes` from it.
await import("~/modules/sales/sales.models");
const sales = await import("~/modules/sales/sales.service");
const purchasing = await import("~/modules/purchasing/purchasing.service");
const invoicing = await import("~/modules/invoicing/invoicing.service");
const inventory = await import("~/modules/inventory/inventory.service");
const items = await import("~/modules/items/items.service");
const resources = await import("~/modules/resources/resources.service");
const production = await import("~/modules/production/production.service");
const documents = await import("~/modules/documents/documents.service");

/** Sends extra keys the way an API caller can, past the service's type. */
const withExtra = <T>(payload: T, extra: Record<string, unknown>) =>
  ({ ...payload, ...extra }) as T;

beforeEach(() => {
  writes = [];
});

describe("update-only upserts never write createdBy (their tables have none)", () => {
  it.each([
    ["quotePayment", () => sales.upsertQuotePayment],
    ["quoteShipment", () => sales.upsertQuoteShipment],
    ["salesOrderShipment", () => sales.upsertSalesOrderShipment],
    ["salesOrderPayment", () => sales.upsertSalesOrderPayment],
    ["purchaseOrderDelivery", () => purchasing.upsertPurchaseOrderDelivery],
    ["purchaseOrderPayment", () => purchasing.upsertPurchaseOrderPayment],
    [
      "purchaseInvoiceDelivery",
      () => invoicing.upsertPurchaseInvoiceDelivery
    ]
  ] as const)("%s", async (table, fn) => {
    // An upsert tool is stamped with both audit fields when the caller names
    // no operation; the row's id sends it down the update branch.
    await (fn() as (c: never, p: unknown) => Promise<unknown>)(client, {
      id: "doc-1",
      createdBy: "user-1",
      updatedBy: "user-1"
    });
    expect(keysWritten(table)).not.toContain("createdBy");
    expect(keysWritten(table)).toContain("updatedBy");
  });
});

describe("keys a service's form carries but its table lacks are dropped", () => {
  it("sales order payment: currencyCode", async () => {
    await sales.upsertSalesOrderPayment(
      client,
      withExtra(
        {
          id: "so-1",
          paymentComplete: false,
          updatedBy: "user-1"
        },
        { currencyCode: "EUR" }
      )
    );
    expect(keysWritten("salesOrderPayment")).not.toContain("currencyCode");
  });

  it("sales order line: serviceId", async () => {
    await sales.upsertSalesOrderLine(
      client,
      withExtra(
        {
          id: "line-1",
          salesOrderId: "so-1",
          salesOrderLineType: "Part",
          locationId: "loc-1",
          updatedBy: "user-1"
        } as Parameters<typeof sales.upsertSalesOrderLine>[1],
        { serviceId: "svc-1" }
      )
    );
    expect(keysWritten("salesOrderLine")).not.toContain("serviceId");
  });

  it("customer and supplier contacts: the form's link-row keys", async () => {
    const person = { firstName: "A", lastName: "B", email: "a@example.com" };
    const customerFormKeys = {
      id: "link-1",
      contactId: "contact-1",
      customerLocationId: "cl-1"
    };
    const supplierFormKeys = {
      id: "link-1",
      contactId: "contact-1",
      supplierLocationId: "sl-1"
    };

    await sales.insertCustomerContact(client, {
      customerId: "c-1",
      companyId: "co-1",
      contact: withExtra(person, customerFormKeys)
    } as Parameters<typeof sales.insertCustomerContact>[1]);
    await sales.updateCustomerContact(client, {
      contactId: "contact-1",
      contact: withExtra(person, customerFormKeys)
    } as Parameters<typeof sales.updateCustomerContact>[1]);
    const customerSide = keysWritten("contact");
    for (const key of Object.keys(customerFormKeys)) {
      expect(customerSide).not.toContain(key);
    }
    expect(customerSide).toContain("firstName");

    writes = [];
    await purchasing.insertSupplierContact(client, {
      supplierId: "s-1",
      companyId: "co-1",
      contact: withExtra(person, supplierFormKeys)
    } as Parameters<typeof purchasing.insertSupplierContact>[1]);
    await purchasing.updateSupplierContact(client, {
      contactId: "contact-1",
      contact: withExtra(person, supplierFormKeys)
    } as Parameters<typeof purchasing.updateSupplierContact>[1]);
    const supplierSide = keysWritten("contact");
    for (const key of Object.keys(supplierFormKeys)) {
      expect(supplierSide).not.toContain(key);
    }
    expect(supplierSide).toContain("firstName");
  });

  it("invoices: supplierShippingCost and purchase order ids", async () => {
    await invoicing.upsertSalesInvoiceLine(
      client,
      withExtra(
        {
          id: "line-1",
          invoiceId: "inv-1",
          invoiceLineType: "Part",
          updatedBy: "user-1"
        } as Parameters<typeof invoicing.upsertSalesInvoiceLine>[1],
        { purchaseOrderId: "po-1", purchaseOrderLineId: "pol-1" }
      )
    );
    expect(keysWritten("salesInvoiceLine")).not.toContain("purchaseOrderId");
    expect(keysWritten("salesInvoiceLine")).not.toContain(
      "purchaseOrderLineId"
    );
  });

  it("kanban, failure modes and change notice types: customFields", async () => {
    await inventory.upsertKanban(
      client,
      withExtra(
        { id: "k-1", updatedBy: "user-1" } as Parameters<
          typeof inventory.upsertKanban
        >[1],
        { customFields: { a: 1 } }
      )
    );
    await production.upsertFailureMode(
      client,
      withExtra(
        { id: "fm-1", name: "Wear", type: "Maintenance", updatedBy: "user-1" },
        { customFields: { a: 1 } }
      ) as Parameters<typeof production.upsertFailureMode>[1]
    );
    await resources.upsertFailureMode(
      client,
      withExtra(
        { id: "fm-1", name: "Wear", type: "Maintenance", updatedBy: "user-1" },
        { customFields: { a: 1 } }
      ) as Parameters<typeof resources.upsertFailureMode>[1]
    );
    await items.upsertChangeNoticeType(
      client,
      withExtra(
        { id: "t-1", name: "ECO", companyId: "co-1", updatedBy: "user-1" },
        { customFields: { a: 1 } }
      )
    );
    for (const table of [
      "kanban",
      "maintenanceFailureMode",
      "changeOrderType"
    ]) {
      expect(keysWritten(table), table).not.toContain("customFields");
    }
  });

  it("batch properties: configurationParameterGroupId", async () => {
    await inventory.upsertBatchProperty(
      client,
      withExtra(
        {
          itemId: "item-1",
          label: "Heat",
          dataType: "text",
          companyId: "co-1",
          userId: "user-1"
        } as Parameters<typeof inventory.upsertBatchProperty>[1],
        { configurationParameterGroupId: "g-1" }
      )
    );
    expect(keysWritten("batchProperty")).not.toContain(
      "configurationParameterGroupId"
    );
  });

  it("items: fields stored in other tables", async () => {
    await items.updateItem(
      client,
      withExtra(
        {
          id: "item-1",
          name: "Bracket",
          replenishmentSystem: "Buy",
          defaultMethodType: "Purchase to Order",
          itemTrackingType: "Inventory",
          unitOfMeasureCode: "EA",
          companyId: "co-1",
          type: "Part"
        } as Parameters<typeof items.updateItem>[1],
        { unitCost: 4, postingGroupId: "pg-1", shelfLifeMode: "Fixed Duration" }
      )
    );
    const itemKeys = keysWritten("item");
    expect(itemKeys).toContain("name");
    for (const key of ["unitCost", "postingGroupId", "shelfLifeMode"]) {
      expect(itemKeys).not.toContain(key);
    }
  });

  it("abilities: only the recertification cadence", async () => {
    await resources.updateAbility(
      client,
      "ability-1",
      withExtra({ recertifyEveryDays: 365 }, { name: "Welding" })
    );
    expect(keysWritten("ability")).toEqual(["recertifyEveryDays"]);
  });

  it("documents: labels", async () => {
    await documents.upsertDocument(
      client,
      withExtra(
        {
          id: "doc-1",
          name: "drawing.pdf",
          readGroups: ["g-1"],
          writeGroups: ["g-1"],
          updatedBy: "user-1"
        },
        { labels: ["urgent"] }
      )
    );
    expect(keysWritten("document")).not.toContain("labels");
  });

  it("jobs: parentJobId", async () => {
    await production.updateJob(
      client,
      withExtra(
        { id: "job-1", updatedBy: "user-1", quantity: 2 },
        { parentJobId: "job-0" }
      )
    );
    expect(keysWritten("job")).not.toContain("parentJobId");
  });
});
