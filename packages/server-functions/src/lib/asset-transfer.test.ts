// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";

import {
  buildCapitalizationLines,
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
