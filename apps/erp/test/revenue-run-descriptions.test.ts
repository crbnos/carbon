// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { revenueRowDescriptions } from "../app/modules/accounting/accounting.utils";

describe("revenueRowDescriptions", () => {
  it("names a contract Accrual row as a contract asset", () => {
    expect(
      revenueRowDescriptions({ type: "Accrual", customerContractLineId: "ccl1" })
    ).toEqual({ debit: "Contract asset accrued", credit: "Revenue recognized" });
  });

  it("names a Cost Relief row", () => {
    expect(
      revenueRowDescriptions({
        type: "Cost Relief",
        customerContractLineId: "ccl1"
      })
    ).toEqual({
      debit: "Contract cost recognized",
      credit: "Project WIP relieved"
    });
  });

  it("names a Loss Provision row", () => {
    expect(
      revenueRowDescriptions({
        type: "Loss Provision",
        customerContractLineId: "ccl1"
      })
    ).toEqual({
      debit: "Contract loss provided",
      credit: "Contract loss provision"
    });
  });
});
