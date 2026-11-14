// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { isDevBypassEmail } from "./dev-bypass";

describe("isDevBypassEmail", () => {
  const bypass = "test@carbon.ms";

  it("accepts the bypass email, in any case", () => {
    expect(isDevBypassEmail("test@carbon.ms", bypass)).toBe(true);
    expect(isDevBypassEmail(" Test@Carbon.MS ", bypass)).toBe(true);
  });

  it("accepts a plus-addressed alias of it", () => {
    expect(isDevBypassEmail("test+admin2@carbon.ms", bypass)).toBe(true);
  });

  it("refuses another local part that only starts the same", () => {
    expect(isDevBypassEmail("tester@carbon.ms", bypass)).toBe(false);
    expect(isDevBypassEmail("test.admin@carbon.ms", bypass)).toBe(false);
  });

  it("refuses the same local part at another domain", () => {
    expect(isDevBypassEmail("test+admin2@example.com", bypass)).toBe(false);
    expect(isDevBypassEmail("test@carbon.ms.example.com", bypass)).toBe(false);
  });

  it("refuses everything when no bypass email is set", () => {
    expect(isDevBypassEmail("test@carbon.ms", undefined)).toBe(false);
    expect(isDevBypassEmail("test@carbon.ms", "")).toBe(false);
  });

  it("refuses malformed emails", () => {
    expect(isDevBypassEmail("@carbon.ms", bypass)).toBe(false);
    expect(isDevBypassEmail("test@", bypass)).toBe(false);
    expect(isDevBypassEmail("test+admin2@carbon.ms", "not-an-email")).toBe(
      false
    );
  });
});
