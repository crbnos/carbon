// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { classifyIntercompanyPostingLines } from "./intercompany-capture";

it("seller captures every receivable and both sales/shipping revenue with aligned item metadata", () => {
  const lines = [
    { id: "sales-1", accountId: "sales", amount: 100, quantity: 2 },
    { id: "shipping-1", accountId: "shipping", amount: 10, quantity: 2 },
    { id: "tax-1", accountId: "tax", amount: 11, quantity: 2 },
    { id: "ar-1", accountId: "ar", amount: 121, quantity: 2 },
    { id: "cogs-1", accountId: "cogs", amount: 70, quantity: 2 },
    { id: "inventory-1", accountId: "inventory", amount: -70, quantity: 2 },
    { id: "sales-2", accountId: "sales", amount: 50, quantity: 1 },
    { id: "ar-2", accountId: "ar", amount: 50, quantity: 1 }
  ];
  const metadata = lines.map((_line, index) => ({
    itemId: index < 6 ? "item-1" : "item-2"
  }));
  const captures = classifyIntercompanyPostingLines(lines, metadata, {
    controlAccountId: "ar",
    revenueAccountIds: ["sales", "shipping"],
    cogsAccountId: "cogs"
  });
  expect(
    captures.map((row) => [row.journalLineId, row.role, row.itemId])
  ).toEqual([
    ["sales-1", "Revenue", "item-1"],
    ["shipping-1", "Revenue", "item-1"],
    ["ar-1", "Control", "item-1"],
    ["cogs-1", "COGS", "item-1"],
    ["sales-2", "Revenue", "item-2"],
    ["ar-2", "Control", "item-2"]
  ]);
  expect(
    captures
      .filter((row) => row.role === "Control")
      .reduce((sum, row) => sum + row.amount, 0)
  ).toEqual(171);
  expect(captures.find((row) => row.role === "Control")?.journalLineId).toEqual(
    "ar-1"
  );
});

it("buyer captures both payable rows without classifying asset or GRIR rows as control", () => {
  const lines = [
    { id: "asset-1", accountId: "asset", amount: 100, quantity: 2 },
    { id: "ap-1", accountId: "ap", amount: 110, quantity: 2 },
    { id: "grir-2", accountId: "grir", amount: -200, quantity: 4 },
    { id: "ap-2", accountId: "ap", amount: 220, quantity: 4 }
  ];
  const captures = classifyIntercompanyPostingLines(
    lines,
    [
      { itemId: "item-1" },
      { itemId: "item-1" },
      { itemId: "item-2" },
      { itemId: "item-2" }
    ],
    { controlAccountId: "ap" }
  );
  expect(captures).toEqual([
    {
      journalLineId: "ap-1",
      accountId: "ap",
      amount: 110,
      quantity: 2,
      itemId: "item-1",
      role: "Control"
    },
    {
      journalLineId: "ap-2",
      accountId: "ap",
      amount: 220,
      quantity: 4,
      itemId: "item-2",
      role: "Control"
    }
  ]);
  expect(captures[0]?.journalLineId).toEqual("ap-1");
});

it("explicit capitalization accounts preserve existing buyer capture without a class guess", () => {
  expect(
    classifyIntercompanyPostingLines(
      [{ id: "asset-row", accountId: "asset", amount: 100 }],
      [{}],
      { controlAccountId: "ap", capitalizationAccountIds: ["asset"] }
    )
  ).toEqual([
    {
      journalLineId: "asset-row",
      accountId: "asset",
      amount: 100,
      quantity: null,
      itemId: null,
      role: "Capitalization"
    }
  ]);
});

it("capture rejects ambiguous account roles and misaligned returned IDs/metadata", () => {
  expect(() =>
    classifyIntercompanyPostingLines([], [], {
      controlAccountId: "ar",
      revenueAccountIds: ["ar"]
    })
  ).toThrow("Ambiguous");
  expect(() =>
    classifyIntercompanyPostingLines(
      [{ id: "row", accountId: "ar", amount: 1 }],
      [],
      { controlAccountId: "ar" }
    )
  ).toThrow("metadata");
  expect(() =>
    classifyIntercompanyPostingLines(
      [{ id: "", accountId: "ar", amount: 1 }],
      [{}],
      { controlAccountId: "ar" }
    )
  ).toThrow("journal line");
});
