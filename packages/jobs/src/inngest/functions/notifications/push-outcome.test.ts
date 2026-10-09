// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { parseAbsolute } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import {
  pushDeliveryOutcome,
  pushSessionMaxAgeMs,
  pushSubscriptionCutoff
} from "./push-outcome";

describe("pushDeliveryOutcome", () => {
  it.each([
    // Refused signature: kept and logged, never deleted (Apple's 403 can mean
    // our own token, for every Safari row).
    [401, "rejected"],
    [403, "rejected"],
    [404, "gone"],
    [410, "gone"],
    [413, "fail"],
    [429, "retry"],
    [503, "retry"]
  ] as const)("maps %i to %s", (status, outcome) => {
    expect(pushDeliveryOutcome(status)).toBe(outcome);
  });
});

describe("pushSessionMaxAgeMs", () => {
  const limits = {
    absoluteMaxMs: 12 * 60 * 60 * 1000,
    cookieMaxAgeSeconds: 7 * 24 * 60 * 60
  };

  it("uses the absolute session cap in a controlled environment", () => {
    expect(
      pushSessionMaxAgeMs({ controlledEnvironment: true, ...limits })
    ).toBe(12 * 60 * 60 * 1000);
  });

  it("uses the session cookie's lifetime elsewhere", () => {
    expect(
      pushSessionMaxAgeMs({ controlledEnvironment: false, ...limits })
    ).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("pushSubscriptionCutoff", () => {
  it("is the instant one session lifetime before now", () => {
    const at = parseAbsolute("2026-10-08T12:00:00Z", "UTC");
    expect(pushSubscriptionCutoff(at, 12 * 60 * 60 * 1000)).toBe(
      "2026-10-08T00:00:00.000Z"
    );
  });
});
