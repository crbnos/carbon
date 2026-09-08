import { assertEquals, assertThrows } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { accountDefaults, accounts as seedAccounts } from "../lib/seed.data.ts";
import { resolveShippingDefault } from "./shipping-default.ts";

const parent = {
  id: "revenue", name: "Revenue", companyGroupId: "group", active: true,
  isGroup: true, class: "Revenue" as const, incomeBalance: "Income Statement" as const,
  accountType: "Income" as const, consolidatedRate: "Average" as const, parentId: null
};
const shipping = { ...parent, id: "custom-shipping", name: "Shipping Revenue", isGroup: false, parentId: parent.id };
const resolve = (accounts = [parent, shipping], parentDefaultId: string | null = null) =>
  resolveShippingDefault({ accounts, parentDefaultId, companyGroupId: "group" });

Deno.test("new company seeds a separate Shipping Revenue account under Revenue", () => {
  const account = seedAccounts.find((a) => String(a.name) === "Shipping Revenue");
  assertEquals<unknown>(account, {
    key: "4040", number: "4040", name: "Shipping Revenue", isGroup: false,
    parentKey: "revenue", accountType: "Income", incomeBalance: "Income Statement",
    class: "Revenue", consolidatedRate: "Average", createdBy: "system"
  });
  assertEquals((accountDefaults as Record<string, string>).salesShippingRevenueAccount, "4040");
});

Deno.test("existing company group resolves a semantic leaf without assuming number4040", () => {
  assertEquals(resolve(), "custom-shipping");
});

Deno.test("valid parent mapping wins even with a custom name and another semantic leaf", () => {
  const custom = { ...shipping, id: "parent-choice", name: "Delivery Income" };
  assertEquals(resolve([parent, shipping, custom], custom.id), custom.id);
});

Deno.test("invalid parent mapping falls back only to the unique compatible semantic leaf", () => {
  assertEquals(resolve([parent, shipping], "missing"), shipping.id);
  const foreign = { ...shipping, id: "foreign", companyGroupId: "other" };
  assertEquals(resolve([parent, shipping, foreign], foreign.id), shipping.id);
});

Deno.test("ambiguous or missing semantic defaults fail rather than choosing Sales or number4040", () => {
  assertThrows(() => resolve([parent, { ...shipping, name: "Sales" }]), Error, "Shipping Revenue");
  assertThrows(() => resolve([parent, shipping, { ...shipping, id: "second" }]), Error, "Shipping Revenue");
});

Deno.test("inactive, group, cross-group, and incompatible semantic leaves are rejected", () => {
  for (const invalid of [
    { active: false }, { isGroup: true }, { companyGroupId: "other" },
    { class: "Expense" as const }, { incomeBalance: "Balance Sheet" as const },
    { accountType: "Other Income" as const }, { consolidatedRate: "Current" as const },
    { parentId: "missing" }
  ]) {
    assertThrows(() => resolveShippingDefault({ accounts: [parent, { ...shipping, ...invalid }], parentDefaultId: null, companyGroupId: "group" }), Error, "Shipping Revenue");
  }
});
