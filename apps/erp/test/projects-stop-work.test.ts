// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { stopWorkStatusRefusal } from "~/modules/projects/projects.models";

describe("stopWorkStatusRefusal", () => {
  it("refuses Released while a stop-work order is open", () => {
    expect(stopWorkStatusRefusal("2026-10-01", "Released")).toBe(
      "This project has a stop-work order. Use Resume."
    );
  });

  it("refuses Closed while a stop-work order is open", () => {
    expect(stopWorkStatusRefusal("2026-10-01", "Closed")).not.toBeNull();
  });

  it("allows On Hold while a stop-work order is open", () => {
    expect(stopWorkStatusRefusal("2026-10-01", "On Hold")).toBeNull();
  });

  it("allows any status without a stop-work order", () => {
    expect(stopWorkStatusRefusal(null, "Released")).toBeNull();
  });
});
