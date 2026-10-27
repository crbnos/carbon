// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { typedByScanner } from "../hooks/useKeyboardWedge";

// A kanban URL is 70 characters: 69 gaps between its first and last key.
describe("typedByScanner", () => {
  it("accepts a URL a scanner typed at 8 ms per key", () => {
    expect(typedByScanner(0, 69 * 8, 70)).toBe(true);
  });

  it("accepts a scan with one slow gap when the average is still scanner speed", () => {
    // 68 gaps of 10 ms and one Bluetooth hiccup of 400 ms: 1080 / 69 ≈ 15.7 ms.
    expect(typedByScanner(0, 68 * 10 + 400, 70)).toBe(true);
  });

  it("refuses the same URL typed by a person at 150 ms per key", () => {
    expect(typedByScanner(0, 69 * 150, 70)).toBe(false);
  });

  it("refuses an average of exactly 50 ms per key", () => {
    expect(typedByScanner(0, 69 * 50, 70)).toBe(false);
  });

  it("refuses a single key, which has no speed", () => {
    expect(typedByScanner(100, 100, 1)).toBe(false);
  });
});
