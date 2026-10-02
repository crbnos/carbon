// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { getErrorMessage } from "./errors";

describe("getErrorMessage", () => {
  it("uses the error's own message", () => {
    expect(getErrorMessage(new Error("Line already picked"), "Failed")).toBe(
      "Line already picked"
    );
    expect(getErrorMessage("Bare message", "Failed")).toBe("Bare message");
  });

  it("falls back for an empty message, a missing one, or no error", () => {
    expect(getErrorMessage({ message: "" }, "Failed")).toBe("Failed");
    expect(getErrorMessage({}, "Failed")).toBe("Failed");
    expect(getErrorMessage(null, "Failed")).toBe("Failed");
  });
});
