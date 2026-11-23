// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { Viewport } from "./viewport";
import {
  getViewportHint,
  VIEWPORT_HINT_COOKIE,
  viewportHintCookie
} from "./viewport";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const MAC_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

function request(headers: Record<string, string>) {
  return new Request("https://erp.example.com/x", { headers });
}

describe("getViewportHint", () => {
  it("trusts the cookie over the user agent", () => {
    expect(
      getViewportHint(
        request({
          cookie: `${VIEWPORT_HINT_COOKIE}=tablet`,
          "user-agent": IPHONE_UA
        })
      )
    ).toBe("tablet");
  });

  it("ignores an unknown cookie value", () => {
    expect(
      getViewportHint(
        request({
          cookie: `${VIEWPORT_HINT_COOKIE}=1`,
          "user-agent": IPHONE_UA
        })
      )
    ).toBe("phone");
  });

  it("falls back to the Mobi token for a phone without the cookie", () => {
    expect(getViewportHint(request({ "user-agent": IPHONE_UA }))).toBe("phone");
  });

  it("falls back to desktop for a desktop browser without the cookie", () => {
    expect(getViewportHint(request({ "user-agent": MAC_CHROME_UA }))).toBe(
      "desktop"
    );
  });
});

describe("viewportHintCookie", () => {
  it("writes the value getViewportHint reads back", () => {
    const viewports: Viewport[] = ["phone", "tablet", "desktop"];
    for (const viewport of viewports) {
      const [cookie = ""] = viewportHintCookie(viewport).split(";");
      expect(getViewportHint(request({ cookie }))).toBe(viewport);
    }
  });

  it("lasts a year on every path", () => {
    expect(viewportHintCookie("phone")).toContain("Max-Age=31536000");
    expect(viewportHintCookie("phone")).toContain("Path=/");
  });
});
