// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MissingAccountDefaultError } from "@carbon/database/journal-posting-status";
import { describe, expect, it } from "vitest";
import { InvalidInputError, toServerFnError } from "../errors";
import { classifyRepairFailure } from "./companies";

describe("classifyRepairFailure", () => {
  it("skips a company whose own data refuses the repair", () => {
    expect(
      classifyRepairFailure(
        "company-1",
        new InvalidInputError(
          "The period October 2026 is closed. Reopen it, then write the missing journals."
        )
      )
    ).toEqual({
      companyId: "company-1",
      status: "skipped",
      reason:
        "The period October 2026 is closed. Reopen it, then write the missing journals."
    });
    // An empty account default carries status 400 through the server function.
    expect(
      classifyRepairFailure(
        "company-1",
        toServerFnError(
          "journal-legacy-documents",
          new MissingAccountDefaultError("deferredRevenueAccount")
        )
      ).status
    ).toBe("skipped");
  });

  it("fails a company on a code bug, so the next deploy retries it", () => {
    const bug = new TypeError(
      "Cannot read properties of undefined (reading 'id')"
    );
    expect(
      classifyRepairFailure(
        "company-1",
        toServerFnError("journal-legacy-documents", bug)
      )
    ).toEqual({
      companyId: "company-1",
      status: "failed",
      error: expect.stringContaining("Cannot read properties of undefined")
    });
  });

  it("fails a company the data layer refused with no message", () => {
    expect(
      classifyRepairFailure("company-1", { status: 500, message: "" })
    ).toEqual({
      companyId: "company-1",
      status: "failed",
      error: "The server failed with no message."
    });
  });
});
