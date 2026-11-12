// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { receiptLotIssueType } from "./quality.utils";

describe("receiptLotIssueType", () => {
  it("prefers a supplier or receiving type over the first", () => {
    expect(
      receiptLotIssueType([
        { id: "1", name: "Customer Complaint" },
        { id: "2", name: "Design Error" },
        { id: "3", name: "Supplier Issue" }
      ])?.id
    ).toBe("3");
  });

  it("falls back to the first type, and to none", () => {
    expect(
      receiptLotIssueType([
        { id: "1", name: "Customer Complaint" },
        { id: "2", name: "Design Error" }
      ])?.id
    ).toBe("1");
    expect(receiptLotIssueType([])).toBeUndefined();
    expect(receiptLotIssueType(null)).toBeUndefined();
  });
});
