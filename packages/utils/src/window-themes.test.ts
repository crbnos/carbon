// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  DEFAULT_WINDOW_THEME,
  getWindowThemeFromCookies,
  normalizeHex,
  parseWindowTheme,
  randomWindowTheme,
  serializeWindowTheme,
  WINDOW_THEME_COOKIE,
  WINDOW_THEMES,
  windowThemeStyle,
  windowThemeTextColors,
  windowThemeValidator
} from "./window-themes";

// WCAG AA for normal text.
const AA = 4.5;

describe("parseWindowTheme", () => {
  it("reads a preset by name", () => {
    expect(parseWindowTheme("plum")).toEqual({
      base: "3f0e40",
      highlight: "1264a3",
      gradient: false
    });
  });

  it("reads a custom value", () => {
    expect(parseWindowTheme("custom:dc540c:f89b6c:g")).toEqual({
      base: "dc540c",
      highlight: "f89b6c",
      gradient: true
    });
    expect(parseWindowTheme("custom:dc540c:f89b6c:s")?.gradient).toBe(false);
  });

  // The value reaches a style attribute, so anything that is not exactly a
  // preset name or a custom value must read as the default.
  it.each([
    null,
    undefined,
    "",
    "default",
    "Plum",
    "custom:DC540C:F89B6C:g",
    "custom:dc540c:f89b6c",
    "custom:dc540c:f89b6c:x",
    "custom:dc540:f89b6c:g",
    "custom:dc540c:f89b6c:g;background:url(x)",
    "custom:red:blue:g",
    "red; --x: 1"
  ])("refuses %j", (value) => {
    expect(parseWindowTheme(value)).toBeNull();
  });

  it("round-trips a custom theme", () => {
    const theme = { base: "123abc", highlight: "fedcba", gradient: true };
    expect(parseWindowTheme(serializeWindowTheme(theme))).toEqual(theme);
  });
});

describe("normalizeHex", () => {
  it("accepts a picker's value in any case, with or without #", () => {
    expect(normalizeHex("#DC540C")).toBe("dc540c");
    expect(normalizeHex(" dc540c ")).toBe("dc540c");
  });

  it("refuses short and named colors", () => {
    expect(normalizeHex("#fff")).toBeNull();
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex(undefined)).toBeNull();
  });
});

describe("windowThemeValidator", () => {
  it("accepts default, a preset and a custom value", () => {
    for (const windowTheme of [
      DEFAULT_WINDOW_THEME,
      "forge",
      "custom:dc540c:f89b6c:g"
    ]) {
      expect(windowThemeValidator.safeParse({ windowTheme }).success).toBe(
        true
      );
    }
  });

  it("refuses anything else", () => {
    expect(
      windowThemeValidator.safeParse({ windowTheme: "custom:zzz" }).success
    ).toBe(false);
  });
});

describe("getWindowThemeFromCookies", () => {
  it("reads the cookie, and treats a bad value as no theme", () => {
    expect(getWindowThemeFromCookies(`${WINDOW_THEME_COOKIE}=jade`)).toBe(
      "jade"
    );
    expect(
      getWindowThemeFromCookies(`${WINDOW_THEME_COOKIE}=removed-preset`)
    ).toBeNull();
    expect(getWindowThemeFromCookies(null)).toBeNull();
  });
});

describe("WINDOW_THEMES", () => {
  it("has unique, cookie-safe names", () => {
    const names = WINDOW_THEMES.map((theme) => theme.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z]+$/);
      expect(name).not.toBe(DEFAULT_WINDOW_THEME);
    }
  });

  it.each(WINDOW_THEMES.map((theme) => [theme.name, theme] as const))(
    "%s reads at WCAG AA in the rail",
    (_, theme) => {
      const { text, activeText, frame, railTiles } =
        windowThemeTextColors(theme);
      // The rail's text on the frame and on its selected tile.
      for (const background of [...frame, ...railTiles]) {
        expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(AA);
      }
      expect(contrastRatio(activeText, theme.highlight)).toBeGreaterThanOrEqual(
        AA
      );
    }
  );
});

describe("windowThemeTextColors", () => {
  it("puts dark text on a light frame and light text on a dark one", () => {
    expect(
      windowThemeTextColors({
        base: "ece5d8",
        highlight: "cbb994",
        gradient: false
      }).text
    ).toBe("18181b");
    expect(
      windowThemeTextColors({
        base: "3f0e40",
        highlight: "1264a3",
        gradient: false
      }).text
    ).toBe("ffffff");
  });

  it("checks both ends of a gradient", () => {
    expect(
      windowThemeTextColors({
        base: "dc540c",
        highlight: "f89b6c",
        gradient: true
      }).frame
    ).toHaveLength(2);
  });
});

describe("windowThemeStyle", () => {
  it("paints a solid frame with the base color", () => {
    const { frame, rail } = windowThemeStyle({
      base: "3f0e40",
      highlight: "1264a3",
      gradient: false
    });
    expect(frame.background).toBe("rgb(63 14 64)");
    expect(rail.background).toBe("transparent");
    expect(rail["--foreground"]).toBe("0 0% 100%");
  });

  it("paints a gradient frame from the base color", () => {
    const { frame } = windowThemeStyle({
      base: "dc540c",
      highlight: "f89b6c",
      gradient: true
    });
    expect(frame.background).toMatch(
      /^linear-gradient\(165deg, rgb\(220 84 12\) 15%, rgb\(/
    );
  });

  it("sets every rail variable as an HSL triplet", () => {
    const { rail } = windowThemeStyle({
      base: "0b3352",
      highlight: "1580c4",
      gradient: true
    });
    for (const [key, value] of Object.entries(rail)) {
      if (!key.startsWith("--")) continue;
      // `--active` is a translucent tile: a triplet with an alpha.
      expect(value).toMatch(/^[\d.]+ [\d.]+% [\d.]+%( \/ [\d.]+)?$/);
    }
  });
});

// Reads an `H S% L%` triplet back to hex, by the CSS hsl() definition.
function tripletToHex(value: string) {
  const [h, s, l] = value.split(" ").map((part) => Number.parseFloat(part));
  const sat = s! / 100;
  const light = l! / 100;
  const f = (n: number) => {
    const k = (n + h! / 30) % 12;
    const a = sat * Math.min(light, 1 - light);
    const channel = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(channel * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `${f(0)}${f(8)}${f(4)}`;
}

// `a` moved `t` of the way towards `b`, in sRGB.
function mixHex(a: string, b: string, t: number) {
  const channels = (hex: string) =>
    [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const [ca, cb] = [channels(a), channels(b)];
  return ca
    .map((value, i) =>
      Math.round(value + (cb[i]! - value) * t)
        .toString(16)
        .padStart(2, "0")
    )
    .join("");
}

describe("windowThemeStyle content and panel", () => {
  it.each(
    WINDOW_THEMES.flatMap((theme) =>
      (["light", "dark"] as const).flatMap((mode) =>
        (["content", "panel"] as const).map(
          (part) => [theme.name, part, mode, theme] as const
        )
      )
    )
  )("%s keeps %s text at WCAG AA in %s mode", (_, part, mode, theme) => {
    const variables = windowThemeStyle(theme)[part][mode];
    const color = (name: string) => tripletToHex(variables[`--${name}`]!);
    const surfaces = ["background", "card", "popover", "muted", "accent"];
    for (const surface of surfaces) {
      // The panel sets only the surfaces the sidebar shows.
      if (!variables[`--${surface}`]) continue;
      expect(
        contrastRatio(color("foreground"), color(surface))
      ).toBeGreaterThanOrEqual(AA);
      expect(
        contrastRatio(color("muted-foreground"), color(surface))
      ).toBeGreaterThanOrEqual(AA);
    }
    expect(
      contrastRatio(color("active-foreground"), color("active"))
    ).toBeGreaterThanOrEqual(AA);
    // An item under the pointer: `bg-active/60` over the surface.
    expect(
      contrastRatio(
        color("active-foreground"),
        mixHex(color("card"), color("active"), 0.6)
      )
    ).toBeGreaterThanOrEqual(AA);
  });

  it("leaves a grey frame's page almost neutral", () => {
    const { content } = windowThemeStyle({
      base: "1c1d21",
      highlight: "3d63dd",
      gradient: false
    });
    const saturation = Number.parseFloat(
      content.dark["--card"]!.split(" ")[1]!
    );
    expect(saturation).toBeLessThan(5);
  });
});

describe("randomWindowTheme", () => {
  it("makes a valid custom theme for any random source", () => {
    for (const r of [0, 0.25, 0.5, 0.9999]) {
      const theme = randomWindowTheme(true, () => r);
      expect(parseWindowTheme(serializeWindowTheme(theme))).toEqual(theme);
      expect(theme.gradient).toBe(true);
    }
  });
});
