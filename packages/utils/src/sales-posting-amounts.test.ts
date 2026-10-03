// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { round } from "@carbon/database/precision";
import {
  allocateSalesHeaderShipping,
  type BuildSalesPostingLinesInput,
  buildSalesPostingLines,
  calculateSalesIntercompanyAmount,
  calculateSalesPostingAmounts,
  type SalesPostingAccount
} from "@carbon/database/sales-posting-amounts";
import { expect, it } from "vitest";
import { classifyIntercompanyPostingLines } from "./intercompany-capture";

const account = (id: string, accountClass: string): SalesPostingAccount => ({
  id,
  class: accountClass,
  active: true,
  isGroup: false,
  companyGroupId: "group"
});
const fixture = (): BuildSalesPostingLinesInput => ({
  line: {
    invoiceLineType: "Service",
    quantity: 1,
    unitPrice: 100,
    shippingCost: 10,
    addOnCost: 20,
    nonTaxableAddOnCost: 3,
    taxPercent: 0.1,
    allocatedHeaderShipping: 5
  },
  context: {
    companyId: "company",
    companyGroupId: "group",
    documentId: "invoice",
    externalDocumentId: "customer-reference",
    documentLineReference: "sales-invoice:source-line",
    journalLineReference: "journal-reference",
    intercompanyPartnerId: "partner"
  },
  accounts: {
    receivables: account("ar", "Asset"),
    sales: account("sales", "Revenue"),
    shipping: account("shipping", "Revenue"),
    tax: account("tax", "Liability")
  },
  metadata: {
    customerTypeId: "customer-type",
    itemPostingGroupId: "item-group",
    itemId: "item",
    locationId: "location",
    costCenterId: "cost-center",
    fixedAssetClassId: null
  }
});

const byAccount = (result: ReturnType<typeof buildSalesPostingLines>) =>
  Object.fromEntries(result.lines.map((line) => [line.accountId, line.amount]));

it("151 gross separates sales123, shipping15 and tax13 without invoice FX conversion", () => {
  expect(calculateSalesPostingAmounts(fixture().line)).toEqual({
    salesRevenueBase: 123,
    shippingRevenueBase: 15,
    salesTaxBase: 13,
    grossReceivableBase: 151
  });
  const result = buildSalesPostingLines(fixture());
  expect(byAccount(result)).toEqual({
    sales: 123,
    shipping: 15,
    tax: 13,
    ar: 151
  });
  expect(result.signedDebitTotal).toEqual(0);
  expect(round(result.amounts.grossReceivableBase * 0.8, 2)).toEqual(120.8);
});

it("all supported item line types use the actual charge builder and preserve metadata/references", () => {
  for (const invoiceLineType of [
    "Part",
    "Service",
    "Consumable",
    "Fixture",
    "Material",
    "Tool"
  ]) {
    const input = fixture();
    input.line.invoiceLineType = invoiceLineType;
    const result = buildSalesPostingLines(input);
    expect(byAccount(result)).toEqual({
      sales: 123,
      shipping: 15,
      tax: 13,
      ar: 151
    });
    expect(result.metadata.length).toEqual(result.lines.length);
    for (const [index, line] of result.lines.entries()) {
      expect(result.metadata[index]).toEqual(input.metadata);
      expect(line.documentId).toEqual("invoice");
      expect(line.documentLineReference).toEqual("sales-invoice:source-line");
      expect(line.journalLineReference).toEqual("journal-reference");
      expect(line.externalDocumentId).toEqual("customer-reference");
      expect(line.companyId).toEqual("company");
      expect(line.documentType).toEqual("Invoice");
    }
    expect(
      result.lines.find((line) => line.accountId === "ar")
        ?.intercompanyPartnerId
    ).toEqual("partner");
  }
});

it("zero tax/shipping need no mappings and no empty rows are emitted", () => {
  const input = fixture();
  input.line = { invoiceLineType: "Service", quantity: 1, unitPrice: 100 };
  input.accounts.shipping = null;
  input.accounts.tax = null;
  const result = buildSalesPostingLines(input);
  expect(byAccount(result)).toEqual({ sales: 100, ar: 100 });
  input.line.quantity = 0;
  input.accounts = {};
  expect(buildSalesPostingLines(input).lines).toEqual([]);
});

it("header-only and comment lines do not invent merchandise revenue", () => {
  const input = fixture();
  input.line = {
    invoiceLineType: "Service",
    quantity: 0,
    allocatedHeaderShipping: 5
  };
  input.accounts.sales = null;
  input.accounts.tax = null;
  expect(byAccount(buildSalesPostingLines(input))).toEqual({
    shipping: 5,
    ar: 5
  });
  input.line.invoiceLineType = "Comment";
  expect(buildSalesPostingLines(input).lines).toEqual([]);
  input.line.invoiceLineType = "G/L Account";
  expect(() => buildSalesPostingLines(input)).toThrow("Unsupported");
});

it("header allocation preserves current pretax weights, excludes comments and assigns residual deterministically", () => {
  const lines = [
    {
      id: "b",
      invoiceLineType: "Service",
      quantity: 1,
      unitPrice: 10,
      nonTaxableAddOnCost: 1000
    },
    { id: "comment", invoiceLineType: "Comment", quantity: 1, unitPrice: 999 },
    {
      id: "a",
      invoiceLineType: "Part",
      quantity: 1,
      unitPrice: 5,
      shippingCost: 2,
      addOnCost: 3
    },
    { id: "c", invoiceLineType: "Tool", quantity: 1, unitPrice: 10 }
  ];
  const allocations = allocateSalesHeaderShipping(lines, 1);
  expect([...allocations]).toEqual([
    ["a", 0.33333],
    ["b", 0.33333],
    ["c", 0.33334]
  ]);
  expect([...allocateSalesHeaderShipping([...lines].reverse(), 1)]).toEqual([
    ...allocations
  ]);
  expect(
    round([...allocations.values()].reduce((sum, value) => sum + value, 0))
  ).toEqual(1);
  const zeros = lines
    .filter((line) => line.invoiceLineType !== "Comment")
    .map((line) => ({ ...line, quantity: 0, shippingCost: 0, addOnCost: 0 }));
  expect([...allocateSalesHeaderShipping(zeros, 1)]).toEqual([...allocations]);
  expect(() => allocateSalesHeaderShipping([], 1)).toThrow("shipping");
});

it("fractional values retain raw tax bases and reconcile only internal rounding residue", () => {
  const input = fixture();
  input.line = {
    invoiceLineType: "Service",
    quantity: 0.5,
    unitPrice: 0.00001,
    shippingCost: 0.000006,
    taxPercent: 0.1
  };
  const raw = calculateSalesPostingAmounts(input.line);
  expect(raw.salesRevenueBase).toEqual(0.000005);
  expect(raw.shippingRevenueBase).toEqual(0.000006);
  expect(round(raw.salesTaxBase, 10)).toEqual(0.0000011);
  const result = buildSalesPostingLines(input);
  expect(result.lines.find((line) => line.accountId === "ar")?.amount).toEqual(
    round(raw.grossReceivableBase)
  );
  expect(result.signedDebitTotal).toEqual(0);
  expect(result.lines.every((line) => line.amount !== 0)).toEqual(true);
  expect(
    round(
      result.lines
        .filter((line) => line.accountId !== "ar")
        .reduce((sum, line) => sum + line.amount, 0)
    )
  ).toEqual(round(raw.grossReceivableBase));
});

for (const mode of ["direct", "shipment"] as const) {
  it(`${mode} asset sale keeps proceeds100, shipping10, tax11 and gain30 with gross AR121`, () => {
    const input = fixture();
    input.line = {
      invoiceLineType: "Fixed Asset",
      quantity: 1,
      unitPrice: 100,
      shippingCost: 10,
      taxPercent: 0.1
    };
    input.accounts.sales = null;
    input.metadata.itemId = null;
    input.metadata.fixedAssetClassId = "asset-class";
    const disposalAccounts = {
      gainAccount: account("gain", "Revenue"),
      lossAccount: account("loss", "Expense")
    };
    input.disposal =
      mode === "direct"
        ? {
            mode,
            acquisitionCost: 100,
            accumulatedDepreciation: 30,
            assetAccount: account("asset", "Asset"),
            accumulatedDepreciationAccount: account("depreciation", "Asset"),
            ...disposalAccounts
          }
        : {
            mode,
            netBookValue: 70,
            clearingAccount: account("clearing", "Expense"),
            ...disposalAccounts
          };
    const result = buildSalesPostingLines(input);
    expect(result.saleProceeds).toEqual(100);
    expect(result.netBookValue).toEqual(70);
    expect(result.gainLoss).toEqual(30);
    expect(byAccount(result)).toEqual(
      mode === "direct"
        ? {
            shipping: 10,
            tax: 11,
            ar: 121,
            depreciation: 30,
            asset: -100,
            gain: 30
          }
        : { shipping: 10, tax: 11, ar: 121, clearing: -70, gain: 30 }
    );
    expect(result.signedDebitTotal).toEqual(0);
    expect(
      result.metadata.every(
        (meta) =>
          meta.fixedAssetClassId === "asset-class" && meta.itemId === null
      )
    ).toEqual(true);
  });
}

it("direct disposal retains one-asset quantities independently of invoice quantity", () => {
  const input = fixture();
  input.line = {
    invoiceLineType: "Fixed Asset",
    quantity: 2,
    unitPrice: 50,
    shippingCost: 10,
    taxPercent: 0.1
  };
  input.disposal = {
    mode: "direct",
    acquisitionCost: 90,
    accumulatedDepreciation: 20,
    assetAccount: account("asset", "Asset"),
    accumulatedDepreciationAccount: account("depreciation", "Asset"),
    gainAccount: account("gain", "Revenue")
  };
  const result = buildSalesPostingLines(input);
  expect(
    Object.fromEntries(
      result.lines.map((line) => [line.accountId, line.quantity])
    )
  ).toEqual({
    shipping: 2,
    tax: 2,
    ar: 2,
    depreciation: 1,
    asset: 1,
    gain: 1
  });
});

it("asset disposal loss uses the expense account and zero gain requires neither gain/loss mapping", () => {
  const input = fixture();
  input.line = { invoiceLineType: "Fixed Asset", quantity: 1, unitPrice: 50 };
  input.disposal = {
    mode: "shipment",
    netBookValue: 70,
    clearingAccount: account("clearing", "Expense"),
    lossAccount: account("loss", "Expense")
  };
  const loss = buildSalesPostingLines(input);
  expect(byAccount(loss)).toEqual({ ar: 50, clearing: -70, loss: 20 });
  expect(loss.gainLoss).toEqual(-20);
  input.line.unitPrice = 70;
  input.disposal.lossAccount = null;
  expect(byAccount(buildSalesPostingLines(input))).toEqual({
    ar: 70,
    clearing: -70
  });
});

it("nonzero required accounts must be valid active leaves in the company group with the correct class", () => {
  for (const key of ["sales", "shipping", "tax", "receivables"] as const) {
    const input = fixture();
    input.accounts[key] = null;
    expect(() => buildSalesPostingLines(input)).toThrow("account");
    for (const changes of [
      { class: "Equity" },
      { active: false },
      {
        isGroup: true
      },
      { companyGroupId: "other-group" }
    ]) {
      const invalid = fixture();
      invalid.accounts[key] = { ...invalid.accounts[key]!, ...changes };
      expect(() => buildSalesPostingLines(invalid)).toThrow("account");
    }
  }
  const sameSalesShipping = fixture();
  sameSalesShipping.accounts.shipping = sameSalesShipping.accounts.sales;
  expect(() => buildSalesPostingLines(sameSalesShipping)).toThrow("distinct");
});

it("seller matching basis converts raw base once and continues excluding add-ons, tax and header shipping", () => {
  const lines = [
    fixture().line,
    {
      invoiceLineType: "Comment",
      quantity: 100,
      unitPrice: 100
    }
  ];
  expect(calculateSalesIntercompanyAmount(lines, 0.8)).toEqual(88);
  expect(calculateSalesIntercompanyAmount(lines, 1.1)).toEqual(121);
});

it("seller matching basis rounds at SCALE so it can equal the buyer's half exactly", () => {
  // generate_intercompany_matches pairs the two halves on `src.amount =
  // tgt.amount` with no tolerance, and the buyer records its half with
  // round() at internal SCALE. A document amount carrying sub-cent digits
  // (100.005 x 3) must therefore survive here undisturbed — rounding it at
  // settlement precision would store 300.02 against the buyer's 300.015 and
  // leave the trade permanently Unmatched.
  const lines = [
    {
      invoiceLineType: "Service",
      quantity: 3,
      unitPrice: 100.005
    }
  ];
  const seller = calculateSalesIntercompanyAmount(lines, 1);
  expect(seller).toEqual(300.015);
  // The buyer's half, as post-purchase-invoice computes it.
  expect(seller).toEqual(round(3 * 100.005));
});

it("actual multiline charge rows feed complete IC control and shipping revenue capture", () => {
  const first = buildSalesPostingLines(fixture());
  const secondInput = fixture();
  secondInput.line = { invoiceLineType: "Part", quantity: 1, unitPrice: 50 };
  secondInput.metadata.itemId = "second-item";
  const second = buildSalesPostingLines(secondInput);
  const captures = classifyIntercompanyPostingLines(
    [...first.lines, ...second.lines].map((line, index) => ({
      ...line,
      id: `posted-${index}`
    })),
    [...first.metadata, ...second.metadata],
    { controlAccountId: "ar", revenueAccountIds: ["sales", "shipping"] }
  );
  expect(
    captures
      .filter((row) => row.role === "Control")
      .map((row) => [row.amount, row.itemId])
  ).toEqual([
    [151, "item"],
    [50, "second-item"]
  ]);
  expect(
    captures
      .filter((row) => row.role === "Revenue")
      .reduce((sum, row) => sum + row.amount, 0)
  ).toEqual(188);
  expect(captures.some((row) => row.accountId === "tax")).toEqual(false);
});

it("nonfinite component arithmetic is refused before any charge rows can be posted", () => {
  for (const key of [
    "quantity",
    "unitPrice",
    "shippingCost",
    "addOnCost",
    "nonTaxableAddOnCost",
    "taxPercent",
    "allocatedHeaderShipping"
  ] as const) {
    expect(() =>
      calculateSalesPostingAmounts({ ...fixture().line, [key]: Number.NaN })
    ).toThrow();
  }
  expect(() =>
    calculateSalesPostingAmounts({
      quantity: Number.MAX_VALUE,
      unitPrice: Number.MAX_VALUE
    })
  ).toThrow();
});
