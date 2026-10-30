// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { currentRefusal } from "./settings.utils";

const rule = (over: Partial<Parameters<typeof currentRefusal>[0]>) => ({
  lastFailureReason: "subject_mismatch",
  lastFailureAt: "2026-10-30T10:00:00+00:00",
  lastExchangeAt: null,
  ...over
});

describe("currentRefusal", () => {
  it("shows a refusal with no exchange after it", () => {
    expect(currentRefusal(rule({}))).toBe("subject_mismatch");
    expect(
      currentRefusal(rule({ lastExchangeAt: "2026-10-30T09:00:00+00:00" }))
    ).toBe("subject_mismatch");
  });

  it("hides a refusal that a later exchange superseded", () => {
    expect(
      currentRefusal(rule({ lastExchangeAt: "2026-10-30T10:00:01+00:00" }))
    ).toBeNull();
  });

  it("shows nothing for a rule never refused", () => {
    expect(
      currentRefusal(rule({ lastFailureReason: null, lastFailureAt: null }))
    ).toBeNull();
  });
});
