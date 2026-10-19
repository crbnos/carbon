// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { classifyAccountingPostingRole } from "./accounting-posting.ts";

it("original invoice posting roles include intercompany controls and exclude void reversals", () => {
  for (const description of ["Accounts Receivable", "IC Receivables"]) {
    expect(classifyAccountingPostingRole(description)).toEqual("Receivables");
  }
  for (const description of ["Accounts Payable", "IC Payables"]) {
    expect(classifyAccountingPostingRole(description)).toEqual("Payables");
  }
  expect(classifyAccountingPostingRole("Shipping Revenue")).toEqual(
    "ShippingRevenue"
  );
  expect(classifyAccountingPostingRole("Sales Account")).toEqual(
    "SalesRevenue"
  );
  for (const description of [
    null,
    "Revenue",
    "VOID: Accounts Receivable",
    "VOID: IC Payables",
    "Tax",
    "Shipping expense"
  ]) {
    expect(classifyAccountingPostingRole(description)).toEqual(null);
  }
});
