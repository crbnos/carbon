// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { actionOutcome, serviceErrorMessage } from "./action-outcome";

describe("actionOutcome", () => {
  it("is nothing while there is no data", () => {
    expect(actionOutcome(undefined)).toBeNull();
    expect(actionOutcome(null)).toBeNull();
  });

  it("is nothing for a 422 with field errors", () => {
    expect(
      actionOutcome({ fieldErrors: { name: "Required" }, formId: "form" })
    ).toBeNull();
  });

  it("is an error for success: false or an error", () => {
    expect(actionOutcome({ success: false, message: "No" })).toBe("error");
    expect(actionOutcome({ error: { message: "No" } })).toBe("error");
    expect(actionOutcome({ data: null, error: "No" })).toBe("error");
  });

  it("is a success otherwise", () => {
    expect(actionOutcome({ success: true })).toBe("success");
    expect(actionOutcome({ data: { id: "1" }, error: null })).toBe("success");
    expect(actionOutcome({ id: "1" })).toBe("success");
    expect(actionOutcome({})).toBe("success");
  });
});

describe("serviceErrorMessage", () => {
  it("reads the message of a service function's error", () => {
    expect(
      serviceErrorMessage({
        data: null,
        error: { category: "conflict", message: "Job unavailable", status: 409 }
      })
    ).toBe("Job unavailable");
  });

  it("leaves other error shapes to the action's flash", () => {
    expect(serviceErrorMessage({ success: false, message: "Nope" })).toBeNull();
    expect(serviceErrorMessage({ error: "Nope" })).toBeNull();
    expect(serviceErrorMessage(null)).toBeNull();
  });
});
