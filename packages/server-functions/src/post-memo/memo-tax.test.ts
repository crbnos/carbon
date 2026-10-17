// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { planMemoTax } from "./memo-tax";

const code = (recoverablePercent: number) => ({
  id: "vat",
  calculationType: "Normal" as const,
  taxesShipping: false,
  components: [
    {
      id: "c",
      name: "VAT",
      taxAuthorityId: null,
      taxPercent: 0.2,
      recoverablePercent,
      sequence: 1,
      isCompound: false,
      taxReceivedAccountId: null,
      taxPaidAccountId: null,
      effectiveDate: null,
      expirationDate: null
    }
  ]
});

const memo = { amount: 1200, taxAmount: 200, exchangeRate: 1, decimals: 2 };

it("moves all of a customer memo's tax through Tax Received", () => {
  expect(planMemoTax({ ...memo, isAR: true, taxCode: code(0) })).toMatchObject({
    netAmount: 1000,
    taxToAccount: 200
  });
});

it("moves only the recoverable share of a supplier memo's tax through Tax Paid", () => {
  expect(
    planMemoTax({ ...memo, isAR: false, taxCode: code(0.5) })
  ).toMatchObject({ netAmount: 1000, taxToAccount: 100 });
});

it("posts no tax leg for a memo without tax", () => {
  expect(
    planMemoTax({ ...memo, taxAmount: 0, isAR: true, taxCode: undefined })
  ).toMatchObject({ netAmount: 1200, taxToAccount: 0, parts: [] });
});

it("keeps a codeless supplier memo's tax in cost, as a legacy purchase line did", () => {
  expect(
    planMemoTax({ ...memo, isAR: false, taxCode: undefined })
  ).toMatchObject({ netAmount: 1000, taxToAccount: 0, parts: [] });
});
