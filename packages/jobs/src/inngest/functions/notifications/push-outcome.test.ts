// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { pushDeliveryOutcome } from "./push-outcome";

describe("pushDeliveryOutcome", () => {
  it.each([
    [201, "delivered"],
    [404, "gone"],
    [410, "gone"],
    [413, "fail"],
    [429, "retry"],
    [503, "retry"]
  ] as const)("maps %i to %s", (status, outcome) => {
    expect(pushDeliveryOutcome(status)).toBe(outcome);
  });
});
