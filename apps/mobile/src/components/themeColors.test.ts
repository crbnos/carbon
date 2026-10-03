// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { THEME_COLORS } from "./themeColors";

/**
 * `themeColors.ts` exists because a lucide icon, a bottom sheet and an
 * ActivityIndicator all take a hex rather than a className. A hex is a copy,
 * and a copy drifts — so this converts `global.css`'s own hsl triples and
 * asserts every entry matches.
 *
 * `theme.test.ts` already pins global.css against the web theme. Together they
 * make one chain: web theme → global.css → the hexes native components use.
 */

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** `--name: H S% L%;` pairs under one selector. */
function cssTokens(selector: string) {
  const css = readFileSync(join(appRoot, "global.css"), "utf8");
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`global.css has no \`${selector}\` block`);
  const body = css.slice(start, css.indexOf("}", start));

  const tokens: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    const key = m[1];
    const value = m[2];
    if (key && value) tokens[key] = value.trim();
  }
  return tokens;
}

/** `H S% L%` → `#rrggbb`, the same conversion a browser applies to hsl(). */
function hslToHex(triple: string) {
  const parts = triple.split(/\s+/);
  const h = Number.parseFloat(parts[0] ?? "");
  const s = Number.parseFloat((parts[1] ?? "").replace("%", "")) / 100;
  const l = Number.parseFloat((parts[2] ?? "").replace("%", "")) / 100;
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) {
    throw new Error(`not an hsl triple: "${triple}"`);
  }

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = l - c / 2;
  const channel = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r1)}${channel(g1)}${channel(b1)}`;
}

/** themeColors.ts keys → the CSS custom property each one copies. */
const TOKEN_TO_CSS = {
  background: "background",
  foreground: "foreground",
  card: "card",
  muted: "muted",
  mutedForeground: "muted-foreground",
  border: "border",
  primary: "primary",
  primaryForeground: "primary-foreground",
  destructive: "destructive"
} as const;

const SELECTORS = {
  light: ":root",
  dark: ":root:where(.dark, .dark *)"
} as const;

describe("hslToHex", () => {
  // The converter is the thing every assertion below trusts, so it is checked
  // against values that are independently known rather than only used.
  it("converts known triples", () => {
    expect(hslToHex("0 0% 100%")).toBe("#ffffff");
    expect(hslToHex("0 0% 0%")).toBe("#000000");
    // Tailwind publishes red-500 as both hsl(0 84.2% 60.2%) and #ef4444, so
    // this pins the converter against a value from outside this repo.
    expect(hslToHex("0 84.2% 60.2%")).toBe("#ef4444");
    expect(hslToHex("220 5.9% 90%")).toBe("#e4e5e7");
  });
});

describe.each(["light", "dark"] as const)("%s theme hexes", (scheme) => {
  const tokens = cssTokens(SELECTORS[scheme]);

  it.each(
    Object.entries(TOKEN_TO_CSS)
  )("%s matches global.css", (key, cssName) => {
    const triple = tokens[cssName];
    expect(
      triple,
      `global.css ${SELECTORS[scheme]} has no --${cssName}`
    ).toBeDefined();
    expect(THEME_COLORS[scheme][key as keyof typeof TOKEN_TO_CSS]).toBe(
      hslToHex(triple as string)
    );
  });
});
