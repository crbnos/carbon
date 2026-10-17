// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it, vi } from "vitest";
import type { Xero } from "../../models";
import {
  SalesOrderSyncer,
  type XeroSalesOrder,
  type XeroSalesOrderLine,
  xeroSalesOrderLineTax
} from "../sales-order";

/**
 * A sales order goes to Xero as a Quote. Each line carries Carbon's tax: the
 * line's rate on the amount the line is sent with, at the mapped sales
 * `TaxType` (a legacy line matches its percentage; an untaxed one is NONE).
 */

const XERO_TAX_RATES: Xero.TaxRate[] = [
  {
    TaxType: "OUTPUT2",
    Name: "20% (VAT on Income)",
    EffectiveRate: 20,
    CanApplyToRevenue: true,
    CanApplyToExpenses: false
  },
  {
    TaxType: "RROUTPUT",
    Name: "5% (VAT on Income)",
    EffectiveRate: 5,
    CanApplyToRevenue: true,
    CanApplyToExpenses: false
  },
  { TaxType: "NONE", Name: "No VAT", EffectiveRate: 0 }
];

function makeSalesOrderSyncer(
  taxMappings: Array<{
    entityId: string;
    externalId: string;
    metadata: unknown;
  }> = []
) {
  const query = {
    selectFrom: () => query,
    select: () => query,
    where: () => query,
    // The tax-code mapping read.
    execute: async () => taxMappings
  };
  const syncer = new SalesOrderSyncer({
    database: query as never,
    companyId: "company-1",
    provider: { id: "xero", listTaxRates: async () => XERO_TAX_RATES } as never,
    config: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    entityType: "salesOrder"
  });
  const internals = syncer as unknown as Record<string, unknown>;
  internals.getRemoteId = async () => null;
  internals.ensureDependencySynced = vi.fn(async () => "contact-1");
  return syncer as unknown as {
    mapToRemote(local: XeroSalesOrder): Promise<Xero.Quote>;
    ensureDependencySynced: unknown;
  };
}

const line = (overrides: Partial<XeroSalesOrderLine>): XeroSalesOrderLine => ({
  id: "sol-1",
  salesOrderLineType: "Part",
  itemId: null,
  itemCode: null,
  description: "Bracket",
  quantity: 2,
  unitPrice: 50,
  setupPrice: 0,
  accountNumber: "4000",
  lineAmount: 100,
  taxPercent: 0,
  taxCodeId: null,
  ...overrides
});

const salesOrder = (lines: XeroSalesOrderLine[]): XeroSalesOrder => ({
  id: "so-1",
  salesOrderId: "SO000001",
  companyId: "company-1",
  customerId: "cust-1",
  customerExternalId: null,
  status: "Confirmed",
  orderDate: "2026-10-01",
  currencyCode: "GBP",
  exchangeRate: 1,
  customerReference: null,
  currencyDecimalPlaces: 2,
  lines,
  updatedAt: "2026-10-01T00:00:00.000Z"
});

describe("Xero SalesOrderSyncer.mapToRemote (TaxType and TaxAmount)", () => {
  it("sends the code's mapped sales TaxType with the line's tax", async () => {
    const payload = await makeSalesOrderSyncer([
      {
        entityId: "tc_uk20:sales",
        externalId: "OUTPUT2",
        metadata: { externalName: "20% (VAT on Income)", externalRate: 0.2 }
      }
    ]).mapToRemote(
      salesOrder([line({ taxCodeId: "tc_uk20", taxPercent: 0.2 })])
    );
    expect(payload.LineItems?.[0]).toMatchObject({
      LineAmount: 100,
      TaxType: "OUTPUT2",
      TaxAmount: 20
    });
  });

  it("matches a legacy 5% line by its percentage, and sends NONE untaxed", async () => {
    const payload = await makeSalesOrderSyncer().mapToRemote(
      salesOrder([
        line({ id: "sol-1", taxPercent: 0.05 }),
        line({ id: "sol-2" }),
        line({ id: "sol-3", salesOrderLineType: "Comment" })
      ])
    );
    expect(
      payload.LineItems?.map((item) => [item.TaxType, item.TaxAmount])
    ).toEqual([
      ["RROUTPUT", 5],
      ["NONE", 0]
    ]);
  });

  it("stops an unmapped code with the Warning before the customer is provisioned", async () => {
    const syncer = makeSalesOrderSyncer();
    await expect(
      syncer.mapToRemote(
        salesOrder([line({ taxCodeId: "tc_uk20", taxPercent: 0.2 })])
      )
    ).rejects.toMatchObject({
      failure: { errorCode: "UNMAPPED_TAX_CODES", warning: true }
    });
    expect(syncer.ensureDependencySynced).not.toHaveBeenCalled();
  });
});

describe("xeroSalesOrderLineTax", () => {
  it("rounds the line's tax at the currency's decimals", () => {
    expect(
      xeroSalesOrderLineTax(
        { id: "sol-1", lineAmount: 33.33, taxPercent: 0.2 },
        2
      )
    ).toBe(6.67);
  });

  it("refuses a taxed line whose currency has no decimals", () => {
    expect(() =>
      xeroSalesOrderLineTax(
        { id: "sol-1", lineAmount: 100, taxPercent: 0.2 },
        null
      )
    ).toThrow(/decimal places/);
  });
});
