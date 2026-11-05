// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { themeByName, themeForRequest, themes } from "./themes";
import { themeColorValidator } from "./types";
import {
  contrastRatio,
  normalizeHex,
  parseWindowTheme,
  randomWindowTheme,
  serializeWindowTheme,
  WINDOW_THEMES,
  windowThemeStyle,
  windowThemeTextColors
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

// Window themes are themes: one `theme` cookie, one validator, one resolver.
describe("window themes as themes", () => {
  it("accepts a preset and a custom value as a theme", () => {
    for (const theme of ["forge", "custom:dc540c:f89b6c:g", "zinc"]) {
      expect(themeColorValidator.safeParse({ theme }).success).toBe(true);
    }
  });

  it.each([
    "custom:zzz",
    "custom:DC540C:F89B6C:g",
    "custom:dc540c:f89b6c:g;color:red",
    "default"
  ])("refuses %j as a theme", (theme) => {
    expect(themeColorValidator.safeParse({ theme }).success).toBe(false);
  });

  it("reads a window theme from the theme cookie", () => {
    const theme = themeForRequest("theme=jade", "/x");
    expect(theme.name).toBe("jade");
    expect(theme.window).toEqual({
      base: "0e3a2c",
      highlight: "0f7a52",
      gradient: false
    });
  });

  it("reads a custom theme from the encoded cookie", () => {
    const theme = themeForRequest(
      `theme=${encodeURIComponent("custom:dc540c:f89b6c:g")}`,
      "/x"
    );
    expect(theme.name).toBe("custom:dc540c:f89b6c:g");
    expect(theme.window?.gradient).toBe(true);
  });

  it("falls back to the default for a removed preset", () => {
    expect(themeForRequest("theme=removed-preset", "/x").name).toBe(
      themes[0].name
    );
  });

  it("gives a color theme no window colors", () => {
    expect(themeByName("red").window).toBeUndefined();
  });
});

describe("WINDOW_THEMES", () => {
  it("has unique, cookie-safe names", () => {
    const names = WINDOW_THEMES.map((theme) => theme.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z]+$/);
      // A preset name must not shadow a color theme.
      const colorThemeNames: readonly string[] = themes.map((t) => t.name);
      expect(colorThemeNames).not.toContain(name);
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

  it("checks every stop of a gradient: glow, base, midpoint and end", () => {
    expect(
      windowThemeTextColors({
        base: "dc540c",
        highlight: "f89b6c",
        gradient: true
      }).frame
    ).toHaveLength(4);
  });
});

function theme(base: string, highlight: string) {
  return windowThemeStyle({ base, highlight, gradient: true });
}

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

  it("blooms the end color from the bottom left into the base", () => {
    const { frame } = windowThemeStyle({
      base: "921d21",
      highlight: "36c5f0",
      gradient: true
    });
    const [bloom, wash] = frame.background!.split(
      /, (?=(?:radial|linear)-gradient)/
    );
    expect(bloom).toMatch(/^radial-gradient\(120% 95% at 0% 100%, /);
    expect(wash).toMatch(
      /^linear-gradient\(45deg, rgb\([\d. ]+\) 0%, rgb\(146 29 33\) 45%, /
    );
  });

  it("goes round the hue wheel, so red to cyan passes through violet, not grey", () => {
    const { frame } = theme("921d21", "36c5f0");
    const mid = /rgb\(([\d.]+) ([\d.]+) ([\d.]+)\) 38%/.exec(frame.background!);
    const [r, g, b] = mid!.slice(1).map(Number) as [number, number, number];
    // Violet: blue and red both well above green. A straight blend is grey.
    expect(b).toBeGreaterThan(g + 25);
    expect(r).toBeGreaterThan(g + 10);
  });

  it("blends in OKLab, so blue to lime passes through teal, not grey", () => {
    const { frame } = theme("0071a4", "9bc339");
    const mid = /rgb\(([\d.]+) ([\d.]+) ([\d.]+)\) 38%/.exec(frame.background!);
    const [r, g, b] = mid!.slice(1).map(Number) as [number, number, number];
    // Teal: green and blue both well above red. An sRGB blend gives r ≈ b.
    expect(g).toBeGreaterThan(r + 20);
    expect(b).toBeGreaterThan(r + 20);
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
    // `card-end`: the bottom of a gradient theme's module sidebar.
    const surfaces = [
      "background",
      "card",
      "card-end",
      "popover",
      "muted",
      "accent"
    ];
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
