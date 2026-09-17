import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { classifyAccountingPostingRole } from "./accounting-posting.ts";

Deno.test("original invoice posting roles include intercompany controls and exclude void reversals", () => {
  for (const description of ["Accounts Receivable", "IC Receivables"]) {
    assertEquals(classifyAccountingPostingRole(description), "Receivables");
  }
  for (const description of ["Accounts Payable", "IC Payables"]) {
    assertEquals(classifyAccountingPostingRole(description), "Payables");
  }
  assertEquals(classifyAccountingPostingRole("Shipping Revenue"), "ShippingRevenue");
  assertEquals(classifyAccountingPostingRole("Sales Account"), "SalesRevenue");
  for (const description of [null, "Revenue", "VOID: Accounts Receivable", "VOID: IC Payables", "Tax", "Shipping expense"]) {
    assertEquals(classifyAccountingPostingRole(description), null);
  }
});
