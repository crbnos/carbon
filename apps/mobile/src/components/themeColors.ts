// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The few theme colours that have to be hex.
 *
 * Almost everything in this app is styled with a Uniwind className, which reads
 * the CSS variable and follows the theme for free. Three kinds of thing cannot:
 * a lucide icon takes a `color` prop, `@gorhom/bottom-sheet` takes
 * `backgroundStyle`, and `ActivityIndicator` takes `color`. Hand-typing a hex
 * at each of those call sites is how a dark-mode sheet ends up white, so they
 * all come from here.
 *
 * These are the `global.css` tokens converted to hex, and
 * `themeColors.test.ts` converts the CSS itself and asserts every value below
 * matches. Change a token and the test fails until this file follows.
 */

export type ColorScheme = "light" | "dark";

type Token =
  | "background"
  | "foreground"
  | "card"
  | "muted"
  | "mutedForeground"
  | "border"
  | "primary"
  | "primaryForeground"
  | "destructive";

export const THEME_COLORS: Record<ColorScheme, Record<Token, string>> = {
  light: {
    background: "#f2f2f3",
    foreground: "#090a0b",
    card: "#ffffff",
    muted: "#ecedee",
    mutedForeground: "#71747a",
    border: "#e4e5e7",
    primary: "#18191b",
    primaryForeground: "#fafafa",
    destructive: "#ef4444"
  },
  dark: {
    background: "#161313",
    foreground: "#ededed",
    card: "#0b0909",
    muted: "#1c1717",
    mutedForeground: "#a1a1a1",
    border: "#262626",
    primary: "#ffffff",
    primaryForeground: "#000000",
    destructive: "#ff4747"
  }
};
