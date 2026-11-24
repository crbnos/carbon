// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Rows = Record<string, Record<string, unknown>[]>;

// A Supabase stand-in: every chain resolves to `rows[table]`, or its first row
// after `single`/`maybeSingle`. Each table read is recorded.
function fakeClient(rows: Rows) {
  const tables: string[] = [];
  const query = (table: string) => {
    let single = false;
    const chain: Record<string, unknown> = new Proxy(
      {},
      {
        get(_, key) {
          if (key === "then") {
            const data = rows[table] ?? [];
            return (resolve: (value: unknown) => unknown) =>
              resolve({ data: single ? (data[0] ?? null) : data, error: null });
          }
          if (key === "single" || key === "maybeSingle") single = true;
          return () => chain;
        }
      }
    );
    return chain;
  };
  return {
    tables,
    client: {
      from: (table: string) => {
        tables.push(table);
        return query(table);
      },
      rpc: (name: string) => query(name)
    } as never
  };
}

const serviceRole = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => serviceRole.current
}));

const { buildPreviewProps } = await import("./settings.service");

const taxCode = {
  id: "code-1",
  companyId: "company-1",
  active: true,
  calculationType: "Normal",
  taxesShipping: false,
  invoiceMessage: "Clause",
  taxCodeComponent: [
    ["cmp-a", "State Tax", 0.04, 1],
    ["cmp-b", "City Tax", 0.02, 2]
  ].map(([id, name, taxPercent, sequence]) => ({
    id,
    name,
    taxAuthorityId: null,
    taxPercent,
    recoverablePercent: 0,
    sequence,
    isCompound: false,
    taxReceivedAccountId: null,
    taxPaidAccountId: null,
    effectiveDate: null,
    expirationDate: null
  }))
};

const taxLine = {
  id: "line-1",
  taxCodeId: "code-1",
  taxPercent: 0.06,
  quantity: 1,
  convertedUnitPrice: 100,
  discountPercent: 0,
  convertedShippingCost: 0,
  convertedAddOnCost: 0
};

const callerRows: Rows = {
  company: [{ id: "company-1", countryCode: "US", timezone: "UTC" }],
  salesInvoices: [{ id: "inv-1", status: "Draft", dateIssued: "2026-06-01" }],
  salesInvoiceLines: [{ ...taxLine, invoiceLineType: "Part" }],
  salesOrders: [{ id: "so-1", orderDate: "2026-06-01" }],
  salesOrderLines: [taxLine],
  quotes: [{ id: "q-1" }],
  quoteLines: [taxLine]
};

let tax: ReturnType<typeof fakeClient>;
beforeEach(() => {
  tax = fakeClient({
    taxCode: [taxCode],
    taxRegistration: [
      {
        companyId: "company-1",
        countryCode: "US",
        state: null,
        registrationNumber: "REG-1",
        effectiveDate: null,
        endDate: null
      }
    ]
  });
  serviceRole.current = tax.client;
});

const preview = (documentType: string, id: string) =>
  buildPreviewProps(
    fakeClient(callerRows).client,
    "company-1",
    documentType,
    id,
    "en-US"
  );

describe("buildPreviewProps tax data", () => {
  it("gives a picked sales invoice its tax summary, clauses and seller tax ID", async () => {
    const props = await preview("salesInvoice", "inv-1");
    expect(props?.taxSummary).toEqual([
      expect.objectContaining({ name: "City Tax", rate: 0.02, tax: 2 }),
      expect.objectContaining({ name: "State Tax", rate: 0.04, tax: 4 })
    ]);
    expect(props?.invoiceMessages).toEqual(["Clause"]);
    expect(props?.sellerRegistration).toBe("REG-1");
    expect(tax.tables).toContain("taxLedger");
  });

  it.each([
    ["salesOrder", "so-1"],
    ["quote", "q-1"]
  ])("gives a picked %s the codes its lines name", async (type, id) => {
    const props = await preview(type, id);
    expect(props?.taxCodes).toEqual([taxCode]);
    expect(props?.taxDate).toEqual(expect.any(String));
  });
});
