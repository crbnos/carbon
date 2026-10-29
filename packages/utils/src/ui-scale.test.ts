// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  DENSITY_COOKIE,
  getUiScaleFromCookies,
  TEXT_SIZE_COOKIE,
  uiScaleStyle
} from "./ui-scale";

describe("getUiScaleFromCookies", () => {
  it("reads both stored choices", () => {
    expect(
      getUiScaleFromCookies(
        `${TEXT_SIZE_COOKIE}=large; ${DENSITY_COOKIE}=compact`
      )
    ).toEqual({ textSize: "large", density: "compact" });
  });

  it.each([null, "", `${TEXT_SIZE_COOKIE}=huge; ${DENSITY_COOKIE}=tight`])(
    "falls back to default for %s",
    (header) =>
      expect(getUiScaleFromCookies(header)).toEqual({
        textSize: "default",
        density: "default"
      })
  );
});

describe("uiScaleStyle", () => {
  it("leaves the stylesheet in charge at default", () => {
    expect(uiScaleStyle({ textSize: "default", density: "default" })).toEqual(
      {}
    );
  });

  // 20px root × 0.25rem × 0.8 = 4px: the text grows, the spacing does not.
  it("grows the text and holds the spacing at 4px", () => {
    expect(uiScaleStyle({ textSize: "larger", density: "default" })).toEqual({
      fontSize: "125%",
      "--spacing": "calc(0.25rem * 0.8)"
    });
  });

  it("changes only the spacing for a density", () => {
    expect(
      uiScaleStyle({ textSize: "default", density: "comfortable" })
    ).toEqual({ "--spacing": "calc(0.25rem * 1.125)" });
  });

  // 14px root × 0.25rem = 3.5px is already the compact spacing (4px × 0.875).
  it("combines a text size with a density", () => {
    expect(uiScaleStyle({ textSize: "smaller", density: "compact" })).toEqual({
      fontSize: "87.5%"
    });
  });
});
