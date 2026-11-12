// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { portlessUpdateAction } from "./portless-setup.js";

describe("portlessUpdateAction", () => {
  it("asks once per newer version in a terminal", () => {
    expect(portlessUpdateAction("0.13.0", "0.16.0", null, true)).toBe("ask");
    // Declined 0.16.0: a note, not the same question every boot.
    expect(portlessUpdateAction("0.13.0", "0.16.0", "0.16.0", true)).toBe(
      "warn"
    );
    expect(portlessUpdateAction("0.13.0", "0.16.1", "0.16.0", true)).toBe(
      "ask"
    );
  });

  it("only warns without a terminal, so a script never upgrades it", () => {
    expect(portlessUpdateAction("0.13.0", "0.16.0", null, false)).toBe("warn");
  });

  it("does nothing when current or when npm gave no answer", () => {
    expect(portlessUpdateAction("0.16.0", "0.16.0", null, true)).toBe("none");
    expect(portlessUpdateAction("0.16.1", "0.16.0", null, true)).toBe("none");
    expect(portlessUpdateAction("0.13.0", null, null, true)).toBe("none");
  });
});
