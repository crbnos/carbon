// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { themes } from "./themes";

// WCAG 2.1 contrast ratio between two theme values written as "H S% L%".
function contrast(a: string, b: string) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function relativeLuminance(value: string) {
  const match = value.match(/^([\d.]+)\s+([\d.]+)%?\s+([\d.]+)%$/);
  if (!match) throw new Error(`Not an HSL theme value: ${value}`);
  const h = Number(match[1]);
  const s = Number(match[2]) / 100;
  const l = Number(match[3]) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const linear = (n: number) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(0) + 0.7152 * linear(8) + 0.0722 * linear(4);
}

const TEXT = 4.5;
const SURFACES = ["card", "background", "muted", "popover"] as const;

describe("destructive colour contrast", () => {
  it.each(
    themes.flatMap((theme) =>
      (["light", "dark"] as const).map((mode) => [theme.name, mode] as const)
    )
  )("%s %s: destructive-foreground on destructive", (name, mode) => {
    const vars = themes.find((t) => t.name === name)!.cssVars[mode];
    expect(
      contrast(vars.destructive, vars["destructive-foreground"])
    ).toBeGreaterThanOrEqual(TEXT);
  });

  it.each(themes.map((theme) => theme.name))(
    "%s light: destructive text on every surface",
    (name) => {
      const vars = themes.find((t) => t.name === name)!.cssVars.light;
      for (const surface of SURFACES) {
        expect(
          contrast(vars.destructive, vars[surface]),
          surface
        ).toBeGreaterThanOrEqual(TEXT);
      }
    }
  );

  it.each(themes.map((theme) => theme.name))(
    "%s dark: destructive text on every surface",
    (name) => {
      const vars = themes.find((t) => t.name === name)!.cssVars.dark;
      for (const surface of SURFACES) {
        expect(
          contrast(vars.destructive, vars[surface]),
          surface
        ).toBeGreaterThanOrEqual(TEXT);
      }
    }
  );
});
