// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { darkModeMedia, getEmailDarkModeCSS } from "./Theme";

describe("darkModeMedia", () => {
  it("scopes each selector's first class away from Outlook's x_ classes", () => {
    const css = darkModeMedia(`
      .a, .b > table > tbody > tr > td { color: red !important; }
      .c .d { border-color: blue; }
    `);
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain('.a:not([class^="x_"])');
    expect(css).toContain('.b:not([class^="x_"]) > table > tbody > tr > td');
    expect(css).toContain('.c:not([class^="x_"]) .d');
    expect(css).toContain("color: red !important;");
  });

  it("refuses a selector with no class, which Outlook would still run", () => {
    expect(() => darkModeMedia("td { color: red; }")).toThrow(/has no class/);
  });

  it("leaves no dark rule in the theme unscoped", () => {
    const media = getEmailDarkModeCSS().split("@media").slice(1).join("@media");
    for (const [, selectors] of media.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      for (const selector of (selectors ?? "").split(",")) {
        expect(selector).toContain(':not([class^="x_"])');
      }
    }
  });
});
