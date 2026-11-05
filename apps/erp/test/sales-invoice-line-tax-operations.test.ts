// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// The module's imports reach the glossary, whose `msg` macro only runs compiled.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));

import { createServiceContext } from "@carbon/api/service-fn.server";
import { createSalesInvoiceLine } from "../app/modules/invoicing/invoicing.server";

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
    for (const method of ["select", "eq", "in", "neq", "is", "order", "match", "lte", "gte", "or", "limit", "not"]) {
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
    // The sales-rule gate reads with the service role.
    system: (() => client) as never,
    pg: unreachable,
    kv: unreachable
  });
}

const inserted = (writes: Write[], table: string) =>
  writes.find((write) => write.table === table && write.op === "insert")
    ?.value[0];

// A Draft invoice for a customer whose code is TX - Austin at 8.25%.
const invoiceRows = {
  salesInvoice: {
    id: "si-1",
    status: "Draft",
    customerId: "customer-1",
    dateIssued: "2026-10-01",
    currencyCode: "USD",
    exchangeRate: 1
  },
  customer: { taxPercent: 0.05 },
  customerTax: { taxCodeId: "tc-austin", taxExempt: false },
  item: { taxable: true },
  taxCode: [
    {
      id: "tc-austin",
      calculationType: "Normal",
      taxesShipping: false,
      taxCodeComponent: [
        {
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
          expirationDate: null
        }
      ]
    }
  ]
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
    const { client, writes } = database(invoiceRows);

    const result = await createSalesInvoiceLine(
      contextFor(client, "invoicing"),
      { ...line, taxCodeId: "", taxPercent: 0.03 }
    );

    expect(result.error).toBeNull();
    const row = inserted(writes, "salesInvoiceLine");
    expect(row).toMatchObject({ taxPercent: 0.03 });
    expect(row.taxCodeId ?? null).toBeNull();
  });
});
