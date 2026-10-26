// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { signInCodeValidator } from "./validators";

describe("signInCodeValidator", () => {
  it("takes an email and the six digits from the sign-in email", () => {
    expect(
      signInCodeValidator.safeParse({ email: "a@b.co", code: "042913" }).success
    ).toBe(true);
  });

  it("refuses anything but exactly six digits, before Auth is asked", () => {
    for (const code of ["", "12345", "1234567", "12345a", " 123456"]) {
      expect(
        signInCodeValidator.safeParse({ email: "a@b.co", code }).success
      ).toBe(false);
    }
    expect(
      signInCodeValidator.safeParse({ email: "not-an-email", code: "123456" })
        .success
    ).toBe(false);
  });
});
