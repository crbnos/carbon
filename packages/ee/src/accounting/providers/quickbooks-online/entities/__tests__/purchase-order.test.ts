// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { buildTaxCodeMappingLookup } from "../../../../core/tax-mapping";
import type { Accounting } from "../../../../core/types";
import type { Qbo } from "../../models";
import type { QboInvoiceTaxCatalog } from "../invoice-tax";
import {
  mapCarbonPoStatusToQbo,
  mapQboPoStatusToCarbon,
  resolveQboPurchaseOrderTax
} from "../purchase-order";
import { buildQboDocNumberFields, buildQboExpenseLines } from "../shared";

describe("QBO purchase order mapping fixture", () => {
  it("maps a PO line set with item + G/L lines through the shared expense-line builder", () => {
    const accountRefs: ReadonlyMap<string, Qbo.Ref> = new Map([
      ["acc-tooling", { value: "88", name: "Tooling Expense" }]
    ]);

    const lines = buildQboExpenseLines({
      lines: [
        {
          itemId: "item-1",
          accountId: null,
          description: "Raw stock",
          quantity: 100,
          unitPrice: 1.25,
          totalAmount: 125
        },
        {
          itemId: null,
          accountId: "acc-tooling",
          description: "Tooling charge",
          quantity: 1,
          unitPrice: 300,
          totalAmount: 300
        }
      ],
      itemRemoteIds: new Map([["item-1", "55"]]),
      accountRefsById: accountRefs,
      documentLabel: "purchase order PO-000042"
    });

    expect(lines[0]?.DetailType).toBe("ItemBasedExpenseLineDetail");
    expect(lines[0]?.ItemBasedExpenseLineDetail?.ItemRef).toEqual({
      value: "55"
    });
    expect(lines[1]?.DetailType).toBe("AccountBasedExpenseLineDetail");
    expect(lines[1]?.AccountBasedExpenseLineDetail?.AccountRef.value).toBe(
      "88"
    );
  });

  it("applies the 21-char DocNumber rule to PO numbers", () => {
    const longPoNumber = "PO-0000000000000000042"; // 22 chars
    const fields = buildQboDocNumberFields(longPoNumber);
    expect(fields.DocNumber).toBeUndefined();
    expect(fields.PrivateNote).toBe(`Carbon ${longPoNumber}`);
    expect(fields.source).toBe("privateNote");
  });
});

describe("PO status mapping", () => {
  it("maps Carbon locked statuses onto QBO POStatus", () => {
    const open: Accounting.PurchaseOrder["status"][] = [
      "To Receive",
      "To Receive and Invoice",
      "To Invoice"
    ];
    for (const status of open) {
      expect(mapCarbonPoStatusToQbo(status)).toBe("Open");
    }
    expect(mapCarbonPoStatusToQbo("Completed")).toBe("Closed");
    expect(mapCarbonPoStatusToQbo("Closed")).toBe("Closed");
  });

  it("maps QBO POStatus back onto Carbon statuses", () => {
    expect(mapQboPoStatusToCarbon("Open")).toBe("To Receive");
    expect(mapQboPoStatusToCarbon("Closed")).toBe("Closed");
    expect(mapQboPoStatusToCarbon(undefined)).toBeUndefined();
  });
});

describe("resolveQboPurchaseOrderTax (outside the US)", () => {
  const code = (Id: string, Name: string, rateId: string): Qbo.TaxCode => ({
    Id,
    Name,
    Active: true,
    PurchaseTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: rateId } }] }
  });
  const catalog: QboInvoiceTaxCatalog = {
    country: "GB",
    taxCodes: [
      code("20S", "20.0% S", "r20p"),
      code("0Z", "0.0% Z", "r0z"),
      code("NOVAT", "No VAT", "r0n")
    ],
    taxRates: [
      { Id: "r20p", RateValue: 20 },
      { Id: "r0z", RateValue: 0 },
      { Id: "r0n", RateValue: 0 }
    ]
  };
  const mappings = buildTaxCodeMappingLookup([
    {
      taxCodeId: "tc_std",
      direction: "purchase",
      externalId: "20S",
      externalName: "20.0% S",
      externalRate: 0.2
    },
    {
      taxCodeId: "tc_zero",
      direction: "purchase",
      externalId: "0Z",
      externalName: "0.0% Z",
      externalRate: 0
    }
  ]);
  const resolve = (
    lines: Parameters<typeof resolveQboPurchaseOrderTax>[0]["lines"]
  ) =>
    resolveQboPurchaseOrderTax({
      documentId: "po_1",
      lines,
      recoverableShares: new Map([
        ["tc_std", 1],
        ["tc_zero", 0],
        ["tc_blocked", 0]
      ]),
      decimalPlaces: 2,
      catalog,
      mappings
    });

  it("sends each line's mapped code, the non-taxable code for untaxed lines, and the tax detail", () => {
    const result = resolve([
      {
        id: "l1",
        taxCodeId: "tc_std",
        taxPercent: 0.2,
        taxAmount: 20,
        totalAmount: 100
      },
      {
        id: "l2",
        taxCodeId: "tc_zero",
        taxPercent: 0,
        taxAmount: 0,
        totalAmount: 40
      },
      {
        // 20% folded into cost: not reclaimable, so not reported as VAT.
        id: "l3",
        taxCodeId: "tc_blocked",
        taxPercent: 0.2,
        taxAmount: 6,
        totalAmount: 30
      },
      {
        id: "l4",
        taxCodeId: null,
        taxPercent: 0,
        taxAmount: 0,
        totalAmount: 50
      }
    ]);
    expect(Object.fromEntries(result.lineTaxCodeRefs)).toEqual({
      l1: { value: "20S" },
      l2: { value: "0Z" },
      l3: { value: "NOVAT" },
      l4: { value: "NOVAT" }
    });
    expect(result.txnTaxDetail).toEqual({
      TotalTax: 20,
      TaxLine: [
        {
          Amount: 20,
          DetailType: "TaxLineDetail",
          TaxLineDetail: {
            TaxRateRef: { value: "r20p" },
            NetAmountTaxable: 100,
            PercentBased: true,
            TaxPercent: 20
          }
        },
        {
          Amount: 0,
          DetailType: "TaxLineDetail",
          TaxLineDetail: {
            TaxRateRef: { value: "r0z" },
            NetAmountTaxable: 40,
            PercentBased: true,
            TaxPercent: 0
          }
        }
      ]
    });
  });

  it("matches a legacy taxed line (no code) by its percentage", () => {
    expect(
      resolve([
        {
          id: "l1",
          taxCodeId: null,
          taxPercent: 0.2,
          taxAmount: 20,
          totalAmount: 100
        }
      ]).lineTaxCodeRefs.get("l1")
    ).toEqual({ value: "20S" });
  });

  it("refuses a code with no purchase mapping", () => {
    expect(() =>
      resolve([
        {
          id: "l1",
          taxCodeId: "tc_unmapped",
          taxPercent: 0,
          taxAmount: 0,
          totalAmount: 100
        }
      ])
    ).toThrow(/UNMAPPED_TAX_CODES/);
  });
});
