// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  memoTaxLedger,
  planMemoTax
} from "~/modules/invoicing/invoicing.service";

const code = (
  recoverablePercent: number,
  calculationType: "Normal" | "Reverse Charge" = "Normal"
) => ({
  id: "vat",
  calculationType,
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
    taxToAccountBase: 200
  });
});

it("moves only the recoverable share of a supplier memo's tax through Tax Paid", () => {
  expect(
    planMemoTax({ ...memo, isAR: false, taxCode: code(0.5) })
  ).toMatchObject({ netAmount: 1000, taxToAccountBase: 100 });
});

it("posts no tax leg for a memo without tax", () => {
  expect(
    planMemoTax({ ...memo, taxAmount: 0, isAR: true, taxCode: undefined })
  ).toMatchObject({ netAmount: 1200, taxToAccountBase: 0, parts: [] });
});

it("keeps a codeless supplier memo's tax in cost, as a legacy purchase line did", () => {
  expect(
    planMemoTax({ ...memo, isAR: false, taxCode: undefined })
  ).toMatchObject({ netAmount: 1000, taxToAccountBase: 0, parts: [] });
});

it("moves exactly the recoverable tax the ledger records through Tax Paid", () => {
  // A third of a 10.00 tax is recoverable: 3.33333 at internal scale, not
  // 3.33 at the currency's decimals, so the GL and the ledger agree.
  const plan = planMemoTax({
    amount: 110,
    taxAmount: 10,
    exchangeRate: 1,
    decimals: 2,
    isAR: false,
    taxCode: code(1 / 3)
  });
  expect(plan.taxToAccountBase).toBe(3.33333);
  expect(plan.taxToAccountBase).toBe(plan.parts[0]!.recoverableAmount);
});

it("self-assesses a Reverse Charge supplier memo's tax, which the memo itself does not charge", () => {
  const plan = planMemoTax({
    amount: 2000,
    taxAmount: 0,
    exchangeRate: 1,
    decimals: 2,
    isAR: false,
    taxCode: code(0.5, "Reverse Charge")
  });
  expect(plan).toMatchObject({
    netAmount: 2000,
    selfAssessed: true,
    selfAssessedBase: 400,
    taxToAccountBase: 200
  });
  const ledger = memoTaxLedger({
    memo: {
      id: "m",
      direction: "Debit",
      currencyCode: "USD",
      taxCodeId: "vat"
    },
    isAR: false,
    partyId: "s",
    exchangeRate: 1,
    taxAmount: 0,
    plan,
    taxCode: code(0.5, "Reverse Charge")
  });
  // A supplier debit reverses what the bill recorded.
  expect(ledger.sign).toBe(-1);
  expect(ledger.lines[0]).toMatchObject({
    selfAssessed: true,
    taxAmount: 400,
    taxableBase: 2000
  });
  expect(ledger.lines[0]!.components[0]).toMatchObject({
    taxAmount: 400,
    recoverableAmount: 200
  });
});

it("charges no self-assessed tax on a Reverse Charge customer memo", () => {
  expect(
    planMemoTax({
      amount: 1000,
      taxAmount: 0,
      exchangeRate: 1,
      decimals: 2,
      isAR: true,
      taxCode: code(0, "Reverse Charge")
    })
  ).toMatchObject({ selfAssessed: false, selfAssessedBase: 0 });
});

it("splits a zero-rated coded memo by component, so its ledger rows name the authority", () => {
  const plan = planMemoTax({
    amount: 500,
    taxAmount: 0,
    exchangeRate: 1,
    decimals: 2,
    isAR: true,
    taxCode: code(0)
  });
  expect(plan.parts).toHaveLength(1);
  expect(plan.parts[0]).toMatchObject({ taxAmount: 0 });
  expect(plan.taxToAccountBase).toBe(0);
});
