import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  buildCapitalizationLines,
  buildReturnToInventoryLines,
} from "./asset-transfer.ts";

const accounts = {
  assetAccountId: "acct_fixed_asset",
  accumulatedDepreciationAccountId: "acct_accumulated_depreciation",
};

const capitalization = (cost: number) => ({
  cost,
  assetAccountId: accounts.assetAccountId,
  creditAccountId: "acct_finished_goods",
  creditDescription: "Finished Goods",
});

const returnToInventory = (cost: number, accumulatedDepreciation: number) => ({
  cost,
  accumulatedDepreciation,
  inventoryAccountId: "acct_finished_goods",
  inventoryDescription: "Finished Goods",
  accounts,
});

Deno.test("capitalization debits the asset and credits the source at cost", () => {
  const lines = buildCapitalizationLines(capitalization(42_000));
  assertEquals(lines, [
    {
      accountId: "acct_fixed_asset",
      description: "Fixed Asset Acquisition",
      amount: 42_000,
    },
    {
      accountId: "acct_finished_goods",
      description: "Finished Goods",
      amount: -42_000,
    },
  ]);
});

Deno.test("capitalization rounds the cost to the internal scale", () => {
  const lines = buildCapitalizationLines(capitalization(42_000.123456));
  assertEquals(lines.map((line) => line.amount), [42_000.12346, -42_000.12346]);
});

Deno.test("capitalization rejects a zero, negative or non-finite cost", () => {
  assertThrows(
    () => buildCapitalizationLines(capitalization(0)),
    Error,
    "positive",
  );
  assertThrows(
    () => buildCapitalizationLines(capitalization(-1)),
    Error,
    "positive",
  );
  assertThrows(
    () => buildCapitalizationLines(capitalization(Number.NaN)),
    Error,
    "finite",
  );
  assertThrows(
    () => buildCapitalizationLines(capitalization(Number.POSITIVE_INFINITY)),
    Error,
    "finite",
  );
});

Deno.test("return to inventory nets accumulated depreciation off the asset cost", () => {
  const lines = buildReturnToInventoryLines(returnToInventory(42_000, 1_680));
  assertEquals(lines, [
    {
      accountId: "acct_finished_goods",
      description: "Finished Goods",
      amount: 40_320,
    },
    {
      accountId: "acct_accumulated_depreciation",
      description: "Accumulated Depreciation",
      amount: 1_680,
    },
    {
      accountId: "acct_fixed_asset",
      description: "Fixed Asset Cost",
      amount: -42_000,
    },
  ]);
  assertEquals(lines.reduce((sum, line) => sum + line.amount, 0), 0);
});

Deno.test("return to inventory omits the accumulated depreciation line when it is zero", () => {
  const lines = buildReturnToInventoryLines(returnToInventory(42_000, 0));
  assertEquals(lines, [
    {
      accountId: "acct_finished_goods",
      description: "Finished Goods",
      amount: 42_000,
    },
    {
      accountId: "acct_fixed_asset",
      description: "Fixed Asset Cost",
      amount: -42_000,
    },
  ]);
});

Deno.test("return to inventory rejects a zero cost", () => {
  assertThrows(
    () => buildReturnToInventoryLines(returnToInventory(0, 0)),
    Error,
    "positive",
  );
});

Deno.test("return to inventory rejects accumulated depreciation above cost", () => {
  assertThrows(
    () => buildReturnToInventoryLines(returnToInventory(42_000, 42_000.01)),
    Error,
    "exceeds",
  );
});

Deno.test("return to inventory rejects negative or non-finite inputs", () => {
  assertThrows(
    () => buildReturnToInventoryLines(returnToInventory(-42_000, 0)),
    Error,
    "positive",
  );
  assertThrows(
    () => buildReturnToInventoryLines(returnToInventory(42_000, -1)),
    Error,
    "negative",
  );
  assertThrows(
    () => buildReturnToInventoryLines(returnToInventory(Number.NaN, 0)),
    Error,
    "finite",
  );
  assertThrows(
    () =>
      buildReturnToInventoryLines(
        returnToInventory(42_000, Number.NEGATIVE_INFINITY),
      ),
    Error,
    "finite",
  );
});
