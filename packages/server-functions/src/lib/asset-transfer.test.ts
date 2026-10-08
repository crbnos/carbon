// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";

import {
  buildCapitalizationLines,
  buildOffsetLines,
  buildReturnToInventoryLines
} from "./asset-transfer.ts";

const accounts = {
  assetAccountId: "acct_fixed_asset",
  accumulatedDepreciationAccountId: "acct_accumulated_depreciation"
};

const capitalization = (cost: number) => ({
  cost,
  assetAccountId: accounts.assetAccountId,
  creditAccountId: "acct_finished_goods",
  creditDescription: "Finished Goods"
});

const returnToInventory = (cost: number, accumulatedDepreciation: number) => ({
  cost,
  accumulatedDepreciation,
  inventoryAccountId: "acct_finished_goods",
  inventoryDescription: "Finished Goods",
  accounts
});

it("capitalization debits the asset and credits the source at cost", () => {
  const lines = buildCapitalizationLines(capitalization(42_000));
  expect(lines).toEqual([
    {
      accountId: "acct_fixed_asset",
      description: "Fixed Asset Acquisition",
      amount: 42_000
    },
    {
      accountId: "acct_finished_goods",
      description: "Finished Goods",
      amount: -42_000
    }
  ]);
});

it("capitalization rounds the cost to the internal scale", () => {
  const lines = buildCapitalizationLines(capitalization(42_000.123456));
  expect(lines.map((line) => line.amount)).toEqual([
    42_000.12346, -42_000.12346
  ]);
});

it("capitalization rejects a zero, negative or non-finite cost", () => {
  expect(() => buildCapitalizationLines(capitalization(0))).toThrow("positive");
  expect(() => buildCapitalizationLines(capitalization(-1))).toThrow(
    "positive"
  );
  expect(() => buildCapitalizationLines(capitalization(Number.NaN))).toThrow(
    "finite"
  );
  expect(() =>
    buildCapitalizationLines(capitalization(Number.POSITIVE_INFINITY))
  ).toThrow("finite");
});

it("return to inventory nets accumulated depreciation off the asset cost", () => {
  const lines = buildReturnToInventoryLines(returnToInventory(42_000, 1_680));
  expect(lines).toEqual([
    {
      accountId: "acct_finished_goods",
      description: "Finished Goods",
      amount: 40_320
    },
    {
      accountId: "acct_accumulated_depreciation",
      description: "Accumulated Depreciation",
      amount: 1_680
    },
    {
      accountId: "acct_fixed_asset",
      description: "Fixed Asset Cost",
      amount: -42_000
    }
  ]);
  expect(lines.reduce((sum, line) => sum + line.amount, 0)).toEqual(0);
});

it("return to inventory omits the accumulated depreciation line when it is zero", () => {
  const lines = buildReturnToInventoryLines(returnToInventory(42_000, 0));
  expect(lines).toEqual([
    {
      accountId: "acct_finished_goods",
      description: "Finished Goods",
      amount: 42_000
    },
    {
      accountId: "acct_fixed_asset",
      description: "Fixed Asset Cost",
      amount: -42_000
    }
  ]);
});

it("return to inventory rejects a zero cost", () => {
  expect(() => buildReturnToInventoryLines(returnToInventory(0, 0))).toThrow(
    "positive"
  );
});

it("return to inventory rejects accumulated depreciation above cost", () => {
  expect(() =>
    buildReturnToInventoryLines(returnToInventory(42_000, 42_000.01))
  ).toThrow("exceeds");
});

it("return to inventory rejects negative or non-finite inputs", () => {
  expect(() =>
    buildReturnToInventoryLines(returnToInventory(-42_000, 0))
  ).toThrow("positive");
  expect(() =>
    buildReturnToInventoryLines(returnToInventory(42_000, -1))
  ).toThrow("negative");
  expect(() =>
    buildReturnToInventoryLines(returnToInventory(Number.NaN, 0))
  ).toThrow("finite");
  expect(() =>
    buildReturnToInventoryLines(
      returnToInventory(42_000, Number.NEGATIVE_INFINITY)
    )
  ).toThrow("finite");
});

it("an entered cost credits an Equity offset as a positive natural balance", () => {
  // Retained Earnings is Equity: a credit there is stored +x, not −x.
  expect(
    buildCapitalizationLines({
      ...capitalization(4200),
      creditAccountId: "acct_retained_earnings",
      creditDescription: "Capitalized Cost",
      creditAccountType: "equity"
    })
  ).toEqual([
    {
      accountId: "acct_fixed_asset",
      description: "Fixed Asset Acquisition",
      amount: 4200
    },
    {
      accountId: "acct_retained_earnings",
      description: "Capitalized Cost",
      amount: 4200
    }
  ]);
});

it("an Expense offset is credited as a negative natural balance", () => {
  const [, offset] = buildCapitalizationLines({
    ...capitalization(4200),
    creditAccountId: "acct_labor",
    creditDescription: "Capitalized Cost",
    creditAccountType: "expense"
  });
  expect(offset?.amount).toEqual(-4200);
});

it("a negative offset amount lowers the asset and debits the offset", () => {
  expect(
    buildOffsetLines({
      amount: -25,
      accountId: "acct_finished_goods",
      description: "Finished Goods",
      offsetAccountId: "acct_retained_earnings",
      offsetDescription: "Recost",
      offsetAccountType: "equity",
      label: "Recost journal"
    }).map((line) => line.amount)
  ).toEqual([-25, -25]);
  expect(() =>
    buildOffsetLines({
      amount: 0,
      accountId: "a",
      description: "a",
      offsetAccountId: "b",
      offsetDescription: "b",
      offsetAccountType: "equity",
      label: "Recost journal"
    })
  ).toThrow("nothing to post");
});
