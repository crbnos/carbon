import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { classifyIntercompanyPostingLines } from "./intercompany-capture.ts";

Deno.test("seller captures every receivable and both sales/shipping revenue with aligned item metadata", () => {
  const lines = [
    { id: "sales-1", accountId: "sales", amount: 100, quantity: 2 },
    { id: "shipping-1", accountId: "shipping", amount: 10, quantity: 2 },
    { id: "tax-1", accountId: "tax", amount: 11, quantity: 2 },
    { id: "ar-1", accountId: "ar", amount: 121, quantity: 2 },
    { id: "cogs-1", accountId: "cogs", amount: 70, quantity: 2 },
    { id: "inventory-1", accountId: "inventory", amount: -70, quantity: 2 },
    { id: "sales-2", accountId: "sales", amount: 50, quantity: 1 },
    { id: "ar-2", accountId: "ar", amount: 50, quantity: 1 },
  ];
  const metadata = lines.map((_line, index) => ({
    itemId: index < 6 ? "item-1" : "item-2",
  }));
  const captures = classifyIntercompanyPostingLines(lines, metadata, {
    controlAccountId: "ar",
    revenueAccountIds: ["sales", "shipping"],
    cogsAccountId: "cogs",
  });
  assertEquals(
    captures.map((row) => [row.journalLineId, row.role, row.itemId]),
    [
      ["sales-1", "Revenue", "item-1"],
      ["shipping-1", "Revenue", "item-1"],
      ["ar-1", "Control", "item-1"],
      ["cogs-1", "COGS", "item-1"],
      ["sales-2", "Revenue", "item-2"],
      ["ar-2", "Control", "item-2"],
    ],
  );
  assertEquals(
    captures.filter((row) => row.role === "Control").reduce(
      (sum, row) => sum + row.amount,
      0,
    ),
    171,
  );
  assertEquals(
    captures.find((row) => row.role === "Control")?.journalLineId,
    "ar-1",
  );
});

Deno.test("buyer captures both payable rows without classifying asset or GRIR rows as control", () => {
  const lines = [
    { id: "asset-1", accountId: "asset", amount: 100, quantity: 2 },
    { id: "ap-1", accountId: "ap", amount: 110, quantity: 2 },
    { id: "grir-2", accountId: "grir", amount: -200, quantity: 4 },
    { id: "ap-2", accountId: "ap", amount: 220, quantity: 4 },
  ];
  const captures = classifyIntercompanyPostingLines(lines, [
    { itemId: "item-1" },
    { itemId: "item-1" },
    { itemId: "item-2" },
    { itemId: "item-2" },
  ], { controlAccountId: "ap" });
  assertEquals(captures, [
    {
      journalLineId: "ap-1",
      accountId: "ap",
      amount: 110,
      quantity: 2,
      itemId: "item-1",
      role: "Control",
    },
    {
      journalLineId: "ap-2",
      accountId: "ap",
      amount: 220,
      quantity: 4,
      itemId: "item-2",
      role: "Control",
    },
  ]);
  assertEquals(captures[0]?.journalLineId, "ap-1");
});

Deno.test("explicit capitalization accounts preserve existing buyer capture without a class guess", () => {
  assertEquals(
    classifyIntercompanyPostingLines(
      [
        { id: "asset-row", accountId: "asset", amount: 100 },
      ],
      [{}],
      { controlAccountId: "ap", capitalizationAccountIds: ["asset"] },
    ),
    [
      {
        journalLineId: "asset-row",
        accountId: "asset",
        amount: 100,
        quantity: null,
        itemId: null,
        role: "Capitalization",
      },
    ],
  );
});

Deno.test("capture rejects ambiguous account roles and misaligned returned IDs/metadata", () => {
  assertThrows(
    () =>
      classifyIntercompanyPostingLines([], [], {
        controlAccountId: "ar",
        revenueAccountIds: ["ar"],
      }),
    Error,
    "Ambiguous",
  );
  assertThrows(
    () =>
      classifyIntercompanyPostingLines(
        [
          { id: "row", accountId: "ar", amount: 1 },
        ],
        [],
        { controlAccountId: "ar" },
      ),
    Error,
    "metadata",
  );
  assertThrows(
    () =>
      classifyIntercompanyPostingLines(
        [
          { id: "", accountId: "ar", amount: 1 },
        ],
        [{}],
        { controlAccountId: "ar" },
      ),
    Error,
    "journal line",
  );
});
