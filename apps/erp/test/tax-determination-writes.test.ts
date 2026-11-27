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
import { deleteTaxCode } from "../app/modules/accounting/accounting.service";
import { createRentalAgreementCharge } from "../app/modules/sales/sales.server";
import {
  insertContractLines,
  recalculateSalesDocumentTaxes,
  updateContractLine
} from "../app/modules/sales/sales.service";
import { serviceInvoiceLineTaxes } from "../app/modules/service/service.service";
import { filteringSupabase } from "./filtering-supabase-fake";

const component = (overrides: Record<string, unknown>) => ({
  id: "c-vat",
  name: "UK VAT",
  taxAuthorityId: "ta-hmrc",
  taxPercent: 0.2,
  recoverablePercent: 1,
  sequence: 1,
  isCompound: false,
  taxReceivedAccountId: null,
  taxPaidAccountId: null,
  effectiveDate: null,
  expirationDate: null,
  ...overrides
});

// A customer on UK VAT 20%. Every row names its company: a read that drops
// the companyId filter also finds company-2's rows.
const taxTables = () => ({
  customer: [
    { id: "customer-1", companyId: "company-1", taxPercent: 0 },
    { id: "customer-1", companyId: "company-2", taxPercent: 0.5 }
  ],
  customerTax: [
    {
      customerId: "customer-1",
      companyId: "company-1",
      taxCodeId: "tc-vat",
      taxExempt: false
    },
    {
      customerId: "customer-1",
      companyId: "company-2",
      taxCodeId: "tc-foreign",
      taxExempt: false
    }
  ],
  taxCode: [
    {
      id: "tc-vat",
      companyId: "company-1",
      calculationType: "Normal",
      taxesShipping: true,
      taxCodeComponent: [component({})]
    },
    {
      id: "tc-foreign",
      companyId: "company-2",
      calculationType: "Normal",
      taxesShipping: true,
      taxCodeComponent: [component({ taxPercent: 0.5 })]
    }
  ],
  item: [
    { id: "svc-1", companyId: "company-1", type: "Service", taxable: true },
    { id: "svc-free", companyId: "company-1", type: "Service", taxable: false }
  ]
});

/** A Kysely stand-in: `first` answers each read, updates are recorded. */
function fakeDb(first: (table: string) => unknown) {
  const updates: { table: string; values: any }[] = [];
  const builder = (table: string, kind: "select" | "update") => {
    let values: unknown;
    const chain: Record<string, any> = {};
    for (const method of ["select", "where", "forUpdate", "returning"]) {
      chain[method] = () => chain;
    }
    chain.set = (next: unknown) => {
      values = next;
      return chain;
    };
    chain.executeTakeFirst = async () => {
      if (kind === "update") updates.push({ table, values });
      return first(table);
    };
    chain.executeTakeFirstOrThrow = async () => first(table);
    chain.execute = async () => {
      if (kind === "update") updates.push({ table, values });
      return [];
    };
    return chain;
  };
  const db: any = {
    selectFrom: (table: string) => builder(table, "select"),
    updateTable: (table: string) => builder(table, "update"),
    transaction: () => ({ execute: (run: (trx: unknown) => unknown) => run(db) })
  };
  return { db, updates };
}

describe("recalculateSalesDocumentTaxes", () => {
  const invoiceTables = () => ({
    ...taxTables(),
    salesInvoice: [
      {
        id: "si-1",
        companyId: "company-1",
        customerId: "customer-1",
        dateIssued: "2026-10-01"
      }
    ],
    salesInvoiceLine: [
      // A code the user cleared: recalculating gives it back.
      {
        id: "line-cleared",
        companyId: "company-1",
        invoiceId: "si-1",
        itemId: "svc-1",
        taxCodeId: null,
        taxPercent: 0.03
      },
      // Already right: not written.
      {
        id: "line-right",
        companyId: "company-1",
        invoiceId: "si-1",
        itemId: "svc-1",
        taxCodeId: "tc-vat",
        taxPercent: 0.2
      }
    ]
  });
  const args = {
    companyId: "company-1",
    userId: "user-1",
    document: "salesInvoice" as const,
    documentId: "si-1"
  };

  it("overwrites a cleared code and writes only the lines that change", async () => {
    const { client } = filteringSupabase(invoiceTables());
    const { db, updates } = fakeDb(() => ({ status: "Draft" }));

    const result = await recalculateSalesDocumentTaxes(client, db, args);

    expect(result).toEqual({ data: { updated: 1 }, error: null });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.values).toMatchObject({
      taxCodeId: "tc-vat",
      taxPercent: 0.2
    });
  });

  it("re-checks the lock inside its transaction and writes nothing once posted", async () => {
    const { client } = filteringSupabase(invoiceTables());
    const { db, updates } = fakeDb(() => ({ status: "Posted" }));

    const result = await recalculateSalesDocumentTaxes(client, db, args);

    expect(result.refused).toBe(true);
    expect(result.error).toContain("locked");
    expect(updates).toHaveLength(0);
  });

  it("refuses a code with no rate in force on the invoice date", async () => {
    const tables = invoiceTables();
    tables.taxCode[0]!.taxCodeComponent = [
      component({ effectiveDate: "2027-01-01" })
    ];
    const { client } = filteringSupabase(tables);
    const { db, updates } = fakeDb(() => ({ status: "Draft" }));

    const result = await recalculateSalesDocumentTaxes(client, db, args);

    expect(result.refused).toBe(true);
    expect(result.error).toContain("no rate in force on 2026-10-01");
    expect(updates).toHaveLength(0);
  });
});

describe("insertContractLines", () => {
  it("gives each added service the customer's code, and none to a non-taxable one", async () => {
    const { client, writes } = filteringSupabase({
      ...taxTables(),
      customerContract: [
        {
          id: "contract-1",
          companyId: "company-1",
          status: "Draft",
          billingBasis: "Subscription",
          customerId: "customer-1",
          shipToCustomerLocationId: null
        }
      ]
    });

    const result = await insertContractLines(client, {
      customerContractId: "contract-1",
      companyId: "company-1",
      createdBy: "user-1",
      itemIds: ["svc-1", "svc-free"],
      revenueType: "Recurring",
      rateUnit: "Month",
      startDate: "2026-10-01",
      projectId: null
    });

    expect(result.error).toBeNull();
    const rows = writes.find((w) => w.table === "customerContractLine")?.value;
    expect(rows).toMatchObject([
      { itemId: "svc-1", taxCodeId: "tc-vat", taxPercent: 0.2 },
      { itemId: "svc-free", taxCodeId: null, taxPercent: 0 }
    ]);
  });

  it("adds non-taxable services although the customer's code has no rate in force", async () => {
    const tables = taxTables();
    tables.taxCode[0]!.taxCodeComponent = [
      component({ effectiveDate: "2027-01-01" })
    ];
    const contract = {
      id: "contract-1",
      companyId: "company-1",
      status: "Draft",
      billingBasis: "Subscription",
      customerId: "customer-1",
      shipToCustomerLocationId: null
    };
    const args = {
      customerContractId: "contract-1",
      companyId: "company-1",
      createdBy: "user-1",
      revenueType: "Recurring" as const,
      rateUnit: "Month" as const,
      startDate: "2026-10-01",
      projectId: null
    };

    const free = filteringSupabase({ ...tables, customerContract: [contract] });
    const added = await insertContractLines(free.client, {
      ...args,
      itemIds: ["svc-free"]
    });
    expect(added.error).toBeNull();

    const taxed = filteringSupabase({
      ...tables,
      customerContract: [contract]
    });
    const refused = await insertContractLines(taxed.client, {
      ...args,
      itemIds: ["svc-free", "svc-1"]
    });
    expect(refused.error?.message).toContain("no rate in force");
  });
});

describe("updateContractLine", () => {
  const contractTables = () => ({
    ...taxTables(),
    customerContract: [
      {
        id: "contract-1",
        companyId: "company-1",
        status: "Draft",
        billingBasis: "Subscription",
        customerId: "customer-1",
        shipToCustomerLocationId: null
      }
    ],
    customerContractLine: [
      {
        id: "ccl-1",
        companyId: "company-1",
        customerContractId: "contract-1",
        taxCodeId: "tc-vat",
        taxPercent: 0.2
      },
      {
        id: "ccl-expired",
        companyId: "company-1",
        customerContractId: "contract-1",
        taxCodeId: "tc-expired",
        taxPercent: 0.2
      }
    ],
    companySettings: [{ id: "company-1", timekeepingControls: null }]
  });
  const withExpired = () => {
    const tables = contractTables();
    tables.taxCode.push({
      id: "tc-expired",
      companyId: "company-1",
      calculationType: "Normal",
      taxesShipping: true,
      taxCodeComponent: [component({ expirationDate: "2026-06-30" })]
    });
    return tables;
  };
  const update = {
    customerContractId: "contract-1",
    revenueType: "Recurring" as const,
    itemId: "svc-1",
    quantity: 1,
    rate: 100,
    rateUnit: "Month" as const,
    discountPercent: 0,
    startDate: "2026-10-01",
    billingMethod: "Fixed" as const,
    revenueMethod: "Daily" as const,
    updatedBy: "user-1",
    expectedUpdatedAt: null
  };
  // The line is read by its id to learn its company (RLS scopes it).
  const unscoped = ["customerContractLine"];
  // The write runs under the contract's lock, a Draft.
  const lineDb = () =>
    fakeDb((table) =>
      table === "customerContract" ? { status: "Draft" } : { id: "ccl-1" }
    );
  const lineWrite = (updates: { table: string; values: any }[]) =>
    updates.find((u) => u.table === "customerContractLine")?.values;

  it("holds a percent sent with no code to the stored code's rate", async () => {
    const { client } = filteringSupabase(contractTables(), {
      unscoped
    });
    const { db, updates } = lineDb();

    const result = await updateContractLine(client, db, {
      ...update,
      id: "ccl-1",
      taxPercent: 5
    } as never);

    expect(result.error).toBeNull();
    expect(lineWrite(updates)).toMatchObject({ taxPercent: 0.2 });
  });

  it("lets an edit that leaves the tax alone through on a code with no rate in force", async () => {
    const { client } = filteringSupabase(withExpired(), { unscoped });
    const { db, updates } = lineDb();

    const result = await updateContractLine(client, db, {
      ...update,
      id: "ccl-expired",
      description: "Renamed",
      taxCodeId: "tc-expired",
      taxPercent: 20
    } as never);

    expect(result.error).toBeNull();
    expect(lineWrite(updates)).toMatchObject({
      description: "Renamed",
      taxPercent: 0.2
    });
  });

  it("refuses a changed percent on a code with no rate in force", async () => {
    const { client, writes } = filteringSupabase(withExpired(), { unscoped });
    const { db, updates } = lineDb();

    const result = await updateContractLine(client, db, {
      ...update,
      id: "ccl-expired",
      taxPercent: 10
    } as never);

    expect(result.error?.message).toContain("no rate in force on 2026-10-01");
    expect(writes).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});

describe("createRentalAgreementCharge", () => {
  const grant = {
    sales: {
      view: ["company-1"],
      create: ["company-1"],
      update: ["company-1"],
      delete: ["company-1"]
    }
  };
  const contextFor = (client: unknown) =>
    createServiceContext({
      actor: {
        type: "user",
        userId: "user-1",
        role: "employee",
        permissions: pageClaims(grant)
      },
      company: { id: "company-1", groupId: "group-1" },
      caller: client as never,
      system: (() => client) as never,
      pg: (() => {
        throw new Error("must not be reached");
      }) as never,
      kv: (() => {
        throw new Error("must not be reached");
      }) as never
    });
  const rentalTables = () => ({
    ...taxTables(),
    rentalAgreementLine: [
      {
        id: "ral-1",
        companyId: "company-2",
        rentalAgreementId: "ra-2",
        rentalAgreement: { taxCodeId: "tc-foreign", status: "Active" }
      },
      {
        id: "ral-1",
        companyId: "company-1",
        rentalAgreementId: "ra-1",
        rentalAgreement: { taxCodeId: "tc-vat", status: "Active" }
      }
    ]
  });
  const charge = {
    rentalAgreementLineId: "ral-1",
    chargeDate: "2026-10-01",
    description: "Damage",
    amount: 100,
    taxPercent: 0.05
  };

  it("gives a charge sent with no code the agreement's code at its rate on the charge date", async () => {
    const { client, writes } = filteringSupabase(rentalTables());

    const result = await createRentalAgreementCharge(
      contextFor(client),
      charge
    );

    expect(result.error).toBeNull();
    expect(
      writes.find((w) => w.table === "rentalAgreementCharge")?.value[0]
    ).toMatchObject({ taxCodeId: "tc-vat", taxPercent: 0.2 });
  });

  it("keeps the sent percent with no code for an empty code", async () => {
    const { client, writes } = filteringSupabase(rentalTables());

    await createRentalAgreementCharge(contextFor(client), {
      ...charge,
      taxCodeId: ""
    });

    expect(
      writes.find((w) => w.table === "rentalAgreementCharge")?.value[0]
    ).toMatchObject({ taxCodeId: null, taxPercent: 0.05 });
  });
});

describe("serviceInvoiceLineTaxes", () => {
  // A Kysely stand-in that applies `=` and `in` filters, and refuses a read
  // with no companyId filter of a table whose rows carry one.
  const filteringTrx = (tables: Record<string, Record<string, unknown>[]>) => ({
    selectFrom: (table: string) => {
      const filters: [string, string, unknown][] = [];
      const rows = () => {
        if (
          !filters.some(([column]) => column === "companyId") &&
          (tables[table] ?? []).some((row) => "companyId" in row)
        ) {
          throw new Error(`${table} was queried without a companyId filter`);
        }
        return (tables[table] ?? []).filter((row) =>
          filters.every(([column, op, value]) =>
            op === "in"
              ? (value as unknown[]).includes(row[column])
              : row[column] === value
          )
        );
      };
      const chain: any = {
        select: () => chain,
        where: (column: string, op: string, value: unknown) => {
          filters.push([column, op, value]);
          return chain;
        },
        execute: async () => rows(),
        executeTakeFirst: async () => rows()[0]
      };
      return chain;
    }
  });

  it("taxes a service job's lines at the customer's code on the invoice date", async () => {
    const { taxCode, ...rest } = taxTables();
    const trx: any = filteringTrx({
      ...rest,
      taxCode: taxCode.map(({ taxCodeComponent: _, ...code }) => code),
      taxCodeComponent: taxCode.flatMap((code) =>
        code.taxCodeComponent.map((c) => ({
          ...c,
          id: `${code.id}-${c.id}`,
          taxCodeId: code.id,
          companyId: code.companyId
        }))
      )
    });
    const ctx: any = { company: { id: "company-1" } };

    const taxOf = await serviceInvoiceLineTaxes(ctx, trx, {
      customerId: "customer-1",
      customerLocationId: null,
      date: "2026-10-01",
      itemIds: [null, "svc-1", "svc-free"]
    });

    // A labor line has no item: taxed as any line.
    expect(taxOf(null)).toEqual({ taxCodeId: "tc-vat", taxPercent: 0.2 });
    expect(taxOf("svc-1")).toEqual({ taxCodeId: "tc-vat", taxPercent: 0.2 });
    expect(taxOf("svc-free")).toEqual({ taxCodeId: null, taxPercent: 0 });
  });
});

describe("deleteTaxCode", () => {
  const ids = { taxCodeId: "tc-vat", companyId: "company-1", userId: "user-1" };

  it("refuses a code customers still name, with the counts", async () => {
    const { client, writes } = filteringSupabase(taxTables());
    const { db } = fakeDb((table) => ({
      count: table === "customerTax" ? "2" : "0"
    }));

    const result = await deleteTaxCode(client, db, ids);

    expect(result.error).toBe(
      "This tax code is still assigned to 2 customers. Give them another code first, then retire it."
    );
    expect(writes).toHaveLength(0);
  });

  it("retires an unused code and stamps who did it", async () => {
    const { client, writes } = filteringSupabase(taxTables());
    const { db } = fakeDb(() => ({ count: "0" }));

    const result = await deleteTaxCode(client, db, ids);

    expect(result.error).toBeNull();
    expect(writes[0]).toMatchObject({
      table: "taxCode",
      op: "update",
      value: { active: false, updatedBy: "user-1" }
    });
    expect(writes[0]!.filters).toContainEqual(["companyId", "company-1"]);
  });

  it("reports a retire the caller's access let through to no row", async () => {
    const { client } = filteringSupabase({ taxCode: [] });
    const { db } = fakeDb(() => ({ count: "0" }));

    const result = await deleteTaxCode(client, db, ids);

    expect(result.error).toContain("cannot change it");
  });
});
