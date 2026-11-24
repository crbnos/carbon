// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { pageClaims } from "./page-claims";
import { describe, expect, it, vi } from "vitest";

// The module's imports reach the glossary, whose `msg` macro only runs compiled.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));

import { createServiceContext } from "@carbon/api/service-fn.server";
import {
  createSalesInvoiceLine,
  updateSalesInvoiceLine
} from "../app/modules/invoicing/invoicing.server";
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
    actor: {
      type: "user",
      userId: "user-1",
      role: "employee",
      permissions: pageClaims(grant(module))
    },
    company: { id: "company-1", groupId: "group-1" },
    caller: client as never,
    // The sales-rule gate reads with the service role.
    system: (() => client) as never,
    pg: unreachable,
    kv: unreachable
  });
}

const component = (overrides: Record<string, unknown>) => ({
  id: "c-state",
  name: "TX State",
  taxAuthorityId: "ta-1",
  taxPercent: 0.0825,
  recoverablePercent: 0,
  sequence: 1,
  isCompound: false,
  taxReceivedAccountId: null,
  taxPaidAccountId: null,
  effectiveDate: null,
  expirationDate: null,
  ...overrides
});

// A Draft invoice for a customer whose code is TX - Austin at 8.25%. Every
// row names its company, and company-2 twins come first, so a read that
// drops the companyId filter finds them (the fake also refuses it).
const tables = () => ({
  salesInvoice: [
    {
      id: "si-1",
      companyId: "company-2",
      status: "Draft",
      customerId: "customer-2",
      dateIssued: "2026-01-01",
      currencyCode: "USD",
      exchangeRate: 1
    },
    {
      id: "si-1",
      companyId: "company-1",
      status: "Draft",
      customerId: "customer-1",
      dateIssued: "2026-10-01",
      currencyCode: "USD",
      exchangeRate: 1
    }
  ],
  salesInvoices: [
    {
      id: "si-1",
      companyId: "company-1",
      status: "Draft",
      customerId: "customer-1",
      dateIssued: "2026-10-01"
    }
  ],
  customer: [
    { id: "customer-1", companyId: "company-2", taxPercent: 0.5 },
    { id: "customer-1", companyId: "company-1", taxPercent: 0.05 }
  ],
  customerTax: [
    {
      customerId: "customer-1",
      companyId: "company-2",
      taxCodeId: "tc-other-company",
      taxExempt: false
    },
    {
      customerId: "customer-1",
      companyId: "company-1",
      taxCodeId: "tc-austin",
      taxExempt: false
    }
  ],
  item: [
    { id: "item-1", companyId: "company-2", taxable: false },
    { id: "item-1", companyId: "company-1", taxable: true }
  ],
  taxCode: [
    {
      id: "tc-austin",
      companyId: "company-1",
      calculationType: "Normal",
      taxesShipping: false,
      taxCodeComponent: [component({})]
    },
    {
      id: "tc-reduced",
      companyId: "company-1",
      calculationType: "Normal",
      taxesShipping: false,
      taxCodeComponent: [component({ id: "c-reduced", taxPercent: 0.05 })]
    },
    {
      id: "tc-expired",
      companyId: "company-1",
      calculationType: "Normal",
      taxesShipping: false,
      taxCodeComponent: [component({ expirationDate: "2026-06-30" })]
    },
    {
      id: "tc-other-company",
      companyId: "company-2",
      calculationType: "Normal",
      taxesShipping: false,
      taxCodeComponent: [component({ taxPercent: 0.3 })]
    }
  ],
  salesInvoiceLine: [
    {
      id: "sil-1",
      companyId: "company-2",
      invoiceId: "si-1",
      itemId: "item-1",
      taxCodeId: "tc-other-company",
      taxPercent: 0.3
    },
    {
      id: "sil-1",
      companyId: "company-1",
      invoiceId: "si-1",
      itemId: "item-1",
      taxCodeId: "tc-austin",
      taxPercent: 0.0825
    },
    {
      id: "sil-expired",
      companyId: "company-1",
      invoiceId: "si-1",
      itemId: "item-1",
      taxCodeId: "tc-expired",
      taxPercent: 0.0825
    }
  ]
});

// The invoice header is read through the `salesInvoices` view by id, after
// the ownership check (`unlockedSalesInvoice`).
const fake = () =>
  filteringSupabase(tables(), { unscoped: ["salesInvoices"] });

const written = (writes: FakeWrite[], table: string) => {
  const write = writes.find((w) => w.table === table);
  return Array.isArray(write?.value) ? write?.value[0] : write?.value;
};

const line = {
  invoiceId: "si-1",
  invoiceLineType: "Service" as const,
  itemId: "item-1",
  methodType: "Pull from Inventory" as const,
  unitOfMeasureCode: "EA",
  quantity: 1,
  unitPrice: 1000
};

describe("createSalesInvoiceLine", () => {
  it("keeps a typed percent with no code when the form cleared the code", async () => {
    const { client, writes } = fake();

    const result = await createSalesInvoiceLine(
      contextFor(client, "invoicing"),
      { ...line, taxCodeId: "", taxPercent: 0.03 }
    );

    expect(result.error).toBeNull();
    const row = written(writes, "salesInvoiceLine");
    expect(row).toMatchObject({ taxPercent: 0.03 });
    expect(row.taxCodeId ?? null).toBeNull();
  });

  it("gives a line sent with no code the customer's code at its rate", async () => {
    const { client, writes } = fake();

    const result = await createSalesInvoiceLine(
      contextFor(client, "invoicing"),
      { ...line, taxPercent: 0 }
    );

    expect(result.error).toBeNull();
    expect(written(writes, "salesInvoiceLine")).toMatchObject({
      taxCodeId: "tc-austin",
      taxPercent: 0.0825
    });
  });

  it("takes a sent code's rate, not a percent that disagrees with it", async () => {
    const { client, writes } = fake();

    await createSalesInvoiceLine(contextFor(client, "invoicing"), {
      ...line,
      taxCodeId: "tc-reduced",
      taxPercent: 0.2
    });

    expect(written(writes, "salesInvoiceLine")).toMatchObject({
      taxCodeId: "tc-reduced",
      taxPercent: 0.05
    });
  });

  it("refuses another company's tax code", async () => {
    const { client, writes } = fake();

    const result = await createSalesInvoiceLine(
      contextFor(client, "invoicing"),
      { ...line, taxCodeId: "tc-other-company", taxPercent: 0.3 }
    );

    expect(result.error?.message).toContain("Tax code not found");
    expect(writes.filter((w) => w.table === "salesInvoiceLine")).toHaveLength(
      0
    );
  });
});

describe("updateSalesInvoiceLine", () => {
  it("lets an edit that leaves the tax alone through on a code with no rate in force", async () => {
    const { client, writes } = fake();

    const result = await updateSalesInvoiceLine(
      contextFor(client, "invoicing"),
      {
        ...line,
        id: "sil-expired",
        quantity: 3,
        taxCodeId: "tc-expired",
        taxPercent: 0.0825
      }
    );

    expect(result.error).toBeNull();
    expect(written(writes, "salesInvoiceLine")).toMatchObject({
      quantity: 3,
      taxCodeId: "tc-expired",
      taxPercent: 0.0825
    });
  });

  it("refuses a changed percent on a code with no rate in force", async () => {
    const { client, writes } = fake();

    const result = await updateSalesInvoiceLine(
      contextFor(client, "invoicing"),
      {
        ...line,
        id: "sil-expired",
        taxCodeId: "tc-expired",
        taxPercent: 0.1
      }
    );

    expect(result.error?.message).toContain("no rate in force on 2026-10-01");
    expect(writes.filter((w) => w.table === "salesInvoiceLine")).toHaveLength(
      0
    );
  });

  it("holds a percent sent alone to the stored code's rate", async () => {
    const { client, writes } = fake();

    await updateSalesInvoiceLine(contextFor(client, "invoicing"), {
      ...line,
      id: "sil-1",
      taxPercent: 0.2
    });

    expect(written(writes, "salesInvoiceLine")).toMatchObject({
      taxCodeId: "tc-austin",
      taxPercent: 0.0825
    });
  });
});
