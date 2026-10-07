// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  COMPACT_HINT_COOKIE,
  compactHintCookie,
  getCompactHint
} from "./viewport";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const MAC_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

function request(headers: Record<string, string>) {
  return new Request("https://erp.example.com/x", { headers });
}

describe("getCompactHint", () => {
  it("is compact when the cookie says 1", () => {
    expect(
      getCompactHint(
        request({
          cookie: `${COMPACT_HINT_COOKIE}=1`,
          "user-agent": MAC_CHROME_UA
        })
      )
    ).toBe(true);
  });

  it("is not compact when the cookie says 0", () => {
    expect(
      getCompactHint(
        request({ cookie: `${COMPACT_HINT_COOKIE}=0`, "user-agent": IPHONE_UA })
      )
    ).toBe(false);
  });

  it("falls back to the Mobi token for a phone without the cookie", () => {
    expect(getCompactHint(request({ "user-agent": IPHONE_UA }))).toBe(true);
  });

  it("falls back to desktop for a desktop browser without the cookie", () => {
    expect(getCompactHint(request({ "user-agent": MAC_CHROME_UA }))).toBe(
      false
    );
  });
});

describe("compactHintCookie", () => {
  it("writes the value getCompactHint reads back", () => {
    for (const isCompact of [true, false]) {
      const [cookie = ""] = compactHintCookie(isCompact).split(";");
      expect(getCompactHint(request({ cookie }))).toBe(isCompact);
    }
  });

  it("lasts a year on every path", () => {
    expect(compactHintCookie(true)).toContain("Max-Age=31536000");
    expect(compactHintCookie(true)).toContain("Path=/");
  });
});
