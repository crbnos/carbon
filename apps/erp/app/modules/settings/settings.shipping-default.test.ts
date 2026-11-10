// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  accountDefaults,
  accounts as seedAccounts
} from "@carbon/database/seed-data";
import { expect, it } from "vitest";
import { resolveShippingDefault } from "./settings.service";

const parent = {
  id: "revenue",
  name: "Revenue",
  companyGroupId: "group",
  active: true,
  isGroup: true,
  class: "Revenue" as const,
  incomeBalance: "Income Statement" as const,
  accountType: "Income" as const,
  consolidatedRate: "Average" as const,
  parentId: null
};
const shipping = {
  ...parent,
  id: "custom-shipping",
  name: "Shipping Revenue",
  isGroup: false,
  parentId: parent.id
};
const resolve = (
  accounts: Parameters<typeof resolveShippingDefault>[0]["accounts"] = [
    parent,
    shipping
  ],
  parentDefaultId: string | null = null
) =>
  resolveShippingDefault({
    accounts,
    parentDefaultId,
    companyGroupId: "group"
  });

it("seeds the shipping default as its own Revenue leaf with an unused number", () => {
  // Sharing a number (4040 is Customer Payment Discounts) would merge two defaults.
  const numbers = seedAccounts.flatMap((a) => (a.number ? [a.number] : []));
  expect(new Set(numbers).size).toBe(numbers.length);
  const key = (accountDefaults as Record<string, string>)
    .salesShippingRevenueAccount;
  expect(seedAccounts.find((a) => a.key === key)).toMatchObject({
    name: "Shipping Revenue",
    isGroup: false,
    parentKey: "revenue",
    class: "Revenue"
  });
});

it("existing company group resolves a semantic leaf without assuming number4040", () => {
  expect(resolve()).toEqual("custom-shipping");
});

it("valid parent mapping wins even with a custom name and another semantic leaf", () => {
  const custom = { ...shipping, id: "parent-choice", name: "Delivery Income" };
  expect(resolve([parent, shipping, custom], custom.id)).toEqual(custom.id);
});

it("invalid parent mapping falls back only to the unique compatible semantic leaf", () => {
  expect(resolve([parent, shipping], "missing")).toEqual(shipping.id);
  const foreign = { ...shipping, id: "foreign", companyGroupId: "other" };
  expect(resolve([parent, shipping, foreign], foreign.id)).toEqual(shipping.id);
});

it("ambiguous or missing semantic defaults fail rather than choosing Sales or number4040", () => {
  expect(() => resolve([parent, { ...shipping, name: "Sales" }])).toThrow(
    "Shipping Revenue"
  );
  expect(() =>
    resolve([parent, shipping, { ...shipping, id: "second" }])
  ).toThrow("Shipping Revenue");
});

it.each([
  { active: false },
  { isGroup: true },
  { companyGroupId: "other" },
  { class: "Expense" as const },
  { incomeBalance: "Balance Sheet" as const },
  { accountType: "Other Income" as const },
  { consolidatedRate: "Current" as const },
  { parentId: "missing" }
])("rejects a Shipping Revenue leaf that differs by %o", (invalid) => {
  expect(() => resolve([parent, { ...shipping, ...invalid }])).toThrow(
    "Shipping Revenue"
  );
});
