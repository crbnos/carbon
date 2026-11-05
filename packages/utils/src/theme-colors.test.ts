// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  normalizeHex,
  parseThemeColors,
  randomThemeColors,
  serializeThemeColors,
  THEME_PRESETS,
  textColorOn,
  themeStyle,
  themeTextColors
} from "./theme-colors";
import { themeByName, themeForRequest, themes } from "./themes";
import { themeColorValidator } from "./types";

const AA = 4.5;
// The rail draws an unselected item's label at this opacity (`NavRail`).
const LABEL_ALPHA = 0.7;

/** Hex `text` at `alpha` over hex `background`, in whole bytes, as painted. */
function over(text: string, background: string, alpha: number) {
  const channels = (hex: string) =>
    [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const bg = channels(background);
  return channels(text)
    .map((channel, i) =>
      ((channel * alpha + bg[i]! * (1 - alpha) + 0.5) | 0)
        .toString(16)
        .padStart(2, "0")
    )
    .join("");
}

describe("parseThemeColors", () => {
  it("reads a preset by name", () => {
    expect(parseThemeColors("plum")).toEqual({
      base: "6b21a8",
      highlight: "e879f9",
      gradient: false
    });
  });

  it("reads a custom value", () => {
    expect(parseThemeColors("custom:dc540c:f89b6c:g")).toEqual({
      base: "dc540c",
      highlight: "f89b6c",
      gradient: true
    });
    expect(parseThemeColors("custom:dc540c:f89b6c:s")?.gradient).toBe(false);
  });

  // The value reaches a style attribute.
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
    expect(parseThemeColors(value)).toBeNull();
  });

  it("round-trips a custom theme", () => {
    const theme = { base: "123abc", highlight: "fedcba", gradient: true };
    expect(parseThemeColors(serializeThemeColors(theme))).toEqual(theme);
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

describe("preset and custom themes", () => {
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

  it("reads a preset theme from the theme cookie", () => {
    const theme = themeForRequest("theme=jade", "/x");
    expect(theme.name).toBe("jade");
    expect(theme.colors).toEqual({
      base: "047857",
      highlight: "34d399",
      gradient: false
    });
  });

  it("reads a custom theme from the encoded cookie", () => {
    const theme = themeForRequest(
      `theme=${encodeURIComponent("custom:dc540c:f89b6c:g")}`,
      "/x"
    );
    expect(theme.name).toBe("custom:dc540c:f89b6c:g");
    expect(theme.colors?.gradient).toBe(true);
  });

  it("falls back to the default for a removed preset", () => {
    expect(themeForRequest("theme=removed-preset", "/x").name).toBe(
      themes[0].name
    );
  });

  it("gives a color theme no colors", () => {
    expect(themeByName("red").colors).toBeUndefined();
  });
});

/** The same 400 custom themes on every run, half of them gradients. */
function seededCustomThemes() {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const hex = () => ((random() * 0x1000000) | 0).toString(16).padStart(6, "0");
  return Array.from({ length: 400 }, (_, i) => ({
    base: hex(),
    highlight: hex(),
    gradient: i % 2 === 0
  }));
}

describe("THEME_PRESETS", () => {
  it("has unique, cookie-safe names", () => {
    const names = THEME_PRESETS.map((theme) => theme.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z]+$/);
      // A preset name must not shadow a color theme.
      const colorThemeNames: readonly string[] = themes.map((t) => t.name);
      expect(colorThemeNames).not.toContain(name);
    }
  });

  it.each(
    THEME_PRESETS.flatMap((theme) =>
      (["light", "dark"] as const).map(
        (mode) => [theme.name, mode, theme.colors] as const
      )
    )
  )("%s reads at WCAG AA in the rail in %s mode", (_, mode, theme) => {
    const { text, frame, railTiles } = themeTextColors(theme, mode);
    // An unselected label on the frame, and the selected item on its tile.
    for (const background of frame) {
      expect(
        contrastRatio(over(text, background, LABEL_ALPHA), background)
      ).toBeGreaterThanOrEqual(AA);
    }
    for (const tile of railTiles) {
      expect(contrastRatio(text, tile)).toBeGreaterThanOrEqual(AA);
    }
    // Group titles and trailing icons use the rail's muted text.
    const muted = themeStyle(theme).rail[mode]["--muted-foreground"]!;
    const [triplet, alpha] = muted.split(" / ");
    expect(tripletToHex(triplet!)).toBe(text);
    for (const background of frame) {
      expect(
        contrastRatio(over(text, background, Number(alpha)), background)
      ).toBeGreaterThanOrEqual(AA);
    }
  });

  it("carries the rail's labels at WCAG AA for any custom colors", () => {
    for (const theme of seededCustomThemes()) {
      for (const mode of ["light", "dark"] as const) {
        const { text, frame } = themeTextColors(theme, mode);
        for (const background of frame) {
          expect(
            contrastRatio(over(text, background, LABEL_ALPHA), background)
          ).toBeGreaterThanOrEqual(AA);
        }
      }
    }
  });

  it("carries the labels at AA between a gradient's stops, too", () => {
    // The browser blends stops in sRGB, which can dip below both of them.
    // A blended pixel rounds to a byte either way, worth about 0.01.
    const presets = THEME_PRESETS.map((preset) => preset.colors);
    for (const theme of [...presets, ...seededCustomThemes()]) {
      if (!theme.gradient) continue;
      for (const mode of ["light", "dark"] as const) {
        const { text, frame } = themeTextColors(theme, mode);
        const [base, mid, end] = frame as [string, string, string];
        for (const [from, to] of [
          [base, mid],
          [mid, end]
        ]) {
          for (let i = 1; i < 32; i++) {
            const background = over(to!, from!, i / 32);
            expect(
              contrastRatio(over(text, background, LABEL_ALPHA), background)
            ).toBeGreaterThanOrEqual(AA - 0.01);
          }
        }
      }
    }
  });

  it("has a distinct hue for every vivid preset", () => {
    // Light mode shows the picked colors, so a shared base would look alike.
    const colors = THEME_PRESETS.map((preset) => preset.colors);
    const bases = colors.map((theme) => theme.base);
    const gradients = colors.filter((theme) => theme.gradient);
    expect(new Set(gradients.map((theme) => theme.base)).size).toBe(
      gradients.length
    );
    expect(bases).toContain("0071a4");
  });
});

describe("themeTextColors", () => {
  it("puts dark text on a light frame and light text on a dark one", () => {
    expect(
      themeTextColors(
        { base: "ece5d8", highlight: "cbb994", gradient: false },
        "light"
      ).text
    ).toBe("18181b");
    expect(
      themeTextColors(
        { base: "3f0e40", highlight: "1264a3", gradient: false },
        "light"
      ).text
    ).toBe("ffffff");
  });

  it("checks every stop of a gradient: base, midpoint and end", () => {
    expect(
      themeTextColors(
        { base: "dc540c", highlight: "f89b6c", gradient: true },
        "dark"
      ).frame
    ).toHaveLength(3);
  });
});

/** The channels of the first `rgb(...)` in a CSS value, or of the stop at `at`. */
function rgbOf(css: string, at?: string): [number, number, number] {
  const pattern = at
    ? new RegExp(`rgb\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\) ${at}`)
    : /rgb\(([\d.]+) ([\d.]+) ([\d.]+)\)/;
  return pattern.exec(css)!.slice(1).map(Number) as [number, number, number];
}

function sum([r, g, b]: [number, number, number]) {
  return r + g + b;
}

function hslChannels(triplet: string): [number, number, number] {
  const hex = tripletToHex(triplet);
  return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [
    number,
    number,
    number
  ];
}

// Pixels sampled from the reference design (2026-11-05).
describe("matches the reference design's colors", () => {
  const near = (
    actual: [number, number, number],
    expected: [number, number, number],
    tolerance = 8
  ) => {
    for (const [i, value] of actual.entries()) {
      expect(Math.abs(value - expected[i]!)).toBeLessThanOrEqual(tolerance);
    }
  };

  it.each([
    ["921d21", [0x63, 0x1a, 0x18]],
    ["228b07", [0x22, 0x3f, 0x18]]
  ] as const)("deepens the picked frame %s in dark mode", (base, expected) => {
    const { frame } = themeStyle({
      base,
      highlight: "ffffff",
      gradient: false
    });
    near(rgbOf(frame.dark.background!), [...expected]);
  });

  it("keeps the picked frame in light mode", () => {
    const { frame } = themeStyle({
      base: "228b07",
      highlight: "9e0b2e",
      gradient: true
    });
    const light = frame.light.background!;
    // Reference: #448627 on the diagonal, #83252C in the corners.
    near(rgbOf(light, "0%"), [0x83, 0x25, 0x2c]);
    // The reference green fails AA for the rail's labels, so ours is deeper.
    near(rgbOf(light, "50%"), [0x13, 0x63, 0x00]);
  });

  it("leaves a light frame light", () => {
    const { frame } = themeStyle({
      base: "ece5d8",
      highlight: "cbb994",
      gradient: false
    });
    expect(frame.light.background).toBe("rgb(236 229 216)");
    expect(frame.dark.background).toBe("rgb(236 229 216)");
  });

  it("deepens the highlight for a dark sidebar's selected item", () => {
    const { panel } = themeStyle({
      base: "228b07",
      highlight: "ff81aa",
      gradient: false
    });
    // Fitted to 2 samples, so within a tenth of the channel range.
    const [r, g, b] = hslChannels(panel.dark["--active"]!);
    for (const [value, reference] of [
      [r, 0xa5],
      [g, 0x29],
      [b, 0x43]
    ] as const) {
      expect(Math.abs(value - reference)).toBeLessThanOrEqual(24);
    }
  });
});

function theme(base: string, highlight: string) {
  return themeStyle({ base, highlight, gradient: true });
}

describe("themeStyle", () => {
  it("paints a solid frame with the base color", () => {
    const { frame, rail } = themeStyle({
      base: "3f0e40",
      highlight: "1264a3",
      gradient: false
    });
    expect(frame.dark.background).toBe("rgb(63 14 64)");
    expect(rail.dark.background).toBe("transparent");
    expect(rail.dark["--foreground"]).toBe("0 0% 100%");
  });

  it("puts the base on the diagonal and a deep end in the other 2 corners", () => {
    const theme = { base: "921d21", highlight: "36c5f0" };
    const { frame } = themeStyle({ ...theme, gradient: true });
    const flat = themeStyle({ ...theme, gradient: false }).frame.dark
      .background!;
    // `to top right` puts 50% on the top-left to bottom-right diagonal.
    const stops = frame.dark.background!.split(/\) (\d+)%/);
    expect(frame.dark.background).toMatch(/^linear-gradient\(to top right, /);
    expect(frame.dark.background).toContain(`${flat} 50%`);
    expect(stops.filter((part) => /^\d+$/.test(part))).toEqual([
      "0",
      "28",
      "50",
      "72",
      "100"
    ]);
    // This pair's corners are navy, darker than the red base.
    const [r, g, b] = rgbOf(frame.dark.background!, "0%");
    expect(b).toBeGreaterThan(r);
    expect(r + g + b).toBeLessThan(sum(rgbOf(flat)));
  });

  it("goes round the hue wheel, so red to cyan passes through violet, not grey", () => {
    const { frame } = theme("921d21", "36c5f0");
    const mid = /rgb\(([\d.]+) ([\d.]+) ([\d.]+)\) 28%/.exec(
      frame.dark.background!
    );
    const [r, g, b] = mid!.slice(1).map(Number) as [number, number, number];
    // Violet: blue and red both above green. A straight blend is grey.
    expect(b).toBeGreaterThan(g + 15);
    expect(r).toBeGreaterThan(g + 10);
  });

  it("blends in OKLab, so blue to lime passes through teal, not grey", () => {
    const { frame } = theme("0071a4", "9bc339");
    const mid = /rgb\(([\d.]+) ([\d.]+) ([\d.]+)\) 28%/.exec(
      frame.dark.background!
    );
    const [r, g, b] = mid!.slice(1).map(Number) as [number, number, number];
    // Teal: green and blue both well above red. An sRGB blend gives r ≈ b.
    expect(g).toBeGreaterThan(r + 20);
    expect(b).toBeGreaterThan(r + 20);
  });

  it("sets every rail variable as an HSL triplet", () => {
    const { rail } = themeStyle({
      base: "0b3352",
      highlight: "1580c4",
      gradient: true
    });
    for (const [key, value] of [
      ...Object.entries(rail.light),
      ...Object.entries(rail.dark)
    ]) {
      if (!key.startsWith("--")) continue;
      // `--active` (a translucent tile) and `--muted-foreground` carry an alpha.
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

describe("themeStyle content and panel", () => {
  it.each(
    THEME_PRESETS.flatMap((theme) =>
      (["light", "dark"] as const).flatMap((mode) =>
        (["content", "panel"] as const).map(
          (part) => [theme.name, part, mode, theme.colors] as const
        )
      )
    )
  )("%s keeps %s text at WCAG AA in %s mode", (_, part, mode, theme) => {
    const variables = themeStyle(theme)[part][mode];
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
    const { content } = themeStyle({
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

describe("randomThemeColors", () => {
  it("makes a valid custom theme for any random source", () => {
    for (const r of [0, 0.25, 0.5, 0.9999]) {
      const theme = randomThemeColors(true, () => r);
      expect(parseThemeColors(serializeThemeColors(theme))).toEqual(theme);
      expect(theme.gradient).toBe(true);
    }
  });
});

describe("textColorOn", () => {
  it.each([
    ["48 96% 53%", "18181b"], // yellow: light enough for dark ink
    ["0 0% 100%", "18181b"],
    ["221 83% 53%", "ffffff"], // blue
    ["240 10% 3.9%", "ffffff"]
  ])("on %s, uses %s text", (hsl, text) => {
    expect(textColorOn(hsl)).toBe(text);
  });
});
