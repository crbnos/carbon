// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CalendarDate } from "@internationalized/date";
import { today } from "@internationalized/date";
import * as cookie from "cookie";
import template from "lodash.template";
import { halloweenTheme } from "./halloween-theme";

/** The everyday themes: what every theme picker offers all year. */
export const themes = [
  {
    name: "zinc",
    label: "Modern",
    mesh: {
      light: ["#edecef", "#f4f4f6", "#fafafb", "#f0eff2"],
      dark: ["#18181b", "#000000", "#0D0D0D", "#050505"]
    },
    activeColor: {
      light: "220 5.9% 2%",
      dark: "220 5.2% 33.9%"
    },
    cssVars: {
      light: {
        background: "220 4% 95%",
        foreground: "220 10% 3.9%",
        card: "0 0% 100%",
        "card-foreground": "220 10% 3.9%",
        popover: "0 0% 100%",
        "popover-foreground": "220 10% 3.9%",
        active: "222 10% 85%",
        "active-foreground": "222 0 8%",
        primary: "220 5.9% 10%",
        "primary-foreground": "0 0% 98%",
        secondary: "220 4.8% 95.9%",
        "secondary-foreground": "220 5.9% 10%",
        muted: "220 4.8% 92.9%",
        "muted-foreground": "220 3.8% 46.1%",
        accent: "220 4.8% 95.9%",
        "accent-foreground": "220 5.9% 10%",
        destructive: "0 74% 42%",
        "destructive-foreground": "0 0% 98%",
        border: "220 5.9% 90%",
        input: "220 5.9% 90%",
        ring: "220 5.9% 10%",
        success: "142 70% 45%",
        "success-foreground": "0 0% 98%"
      },
      dark: {
        // Vercel/Geist-inspired dark mode - pure black base
        background: "0 6.8% 8.1%",
        foreground: "0 0% 93%",
        card: "0 10% 3.9%",
        "card-foreground": "0 0% 93%",
        popover: "0 0% 7%",
        "popover-foreground": "0 0% 93%",
        primary: "0 0% 100%",
        "primary-foreground": "0 0% 0%",
        active: "0 0% 14%",
        "active-foreground": "0 0% 100%",
        secondary: "0 0% 7%",
        "secondary-foreground": "0 0% 93%",
        muted: "0 10% 10%",
        "muted-foreground": "0 0% 63%",
        accent: "0 0% 10%",
        "accent-foreground": "0 0% 93%",
        destructive: "0 100% 64%",
        "destructive-foreground": "0 0% 0%",
        border: "0 0% 15%",
        input: "0 0% 15%",
        ring: "0 0% 35%",
        success: "152 72% 53%",
        "success-foreground": "0 0% 0%"
      }
    }
  },
  {
    name: "neutral",
    label: "Brutal",
    mesh: {
      light: ["#eeece9", "#f4f3f1", "#faf9f8", "#f1efed"],
      dark: ["#1c1917", "#000000", "#0D0D0D", "#050505"]
    },
    activeColor: {
      light: "0 0% 45.1%",
      dark: "0 0% 32.2%"
    },
    cssVars: {
      light: {
        background: "0 4% 95%",
        foreground: "0 0% 3.9%",
        card: "0 0% 93%",
        "card-foreground": "0 0% 3.9%",
        popover: "0 0% 93%",
        "popover-foreground": "0 0% 3.9%",
        primary: "0 0% 9%",
        "primary-foreground": "0 0% 98%",
        active: "0 0% 88%",
        "active-foreground": "0 0% 12%",
        secondary: "0 0% 96%",
        "secondary-foreground": "0 0% 9%",
        muted: "0 0% 92.9%",
        "muted-foreground": "0 0% 45.1%",
        accent: "0 0% 96%",
        "accent-foreground": "0 0% 9%",
        destructive: "0 74% 42%",
        "destructive-foreground": "0 0% 98%",
        border: "0 0% 80%",
        input: "0 0% 80%",
        ring: "0 0% 3.9%",
        success: "142 70% 45%",
        "success-foreground": "0 0% 98%"
      },
      dark: {
        background: "20 6.8% 8.1%",
        foreground: "0 0% 98%",
        card: "0 10% 3.9%",
        "card-foreground": "0 0% 98%",
        popover: "0 0% 8.9%",
        "popover-foreground": "0 0% 98%",
        primary: "30 24% 94%",
        "primary-foreground": "0 0% 1%",
        active: "30 24% 16%",
        "active-foreground": "0 0% 98%",
        secondary: "0 0% 14.9%",
        "secondary-foreground": "0 0% 98%",
        muted: "0 10% 10%",
        "muted-foreground": "0 0% 63.9%",
        accent: "0 0% 14.9%",
        "accent-foreground": "0 0% 98%",
        destructive: "0 100% 64%",
        "destructive-foreground": "0 0% 0%",
        border: "0 0% 14.9%",
        input: "0 0% 14.9%",
        ring: "0 0% 83.1%",
        success: "142 70% 45%",
        "success-foreground": "0 0% 98%"
      }
    }
  },
  {
    name: "red",
    label: "Cherry",
    mesh: {
      light: ["#fdf0f1", "#fdf6f6", "#fffafa", "#fdf3f3"],
      dark: ["#2d0a0a", "#000000", "#0D0D0D", "#050505"]
    },
    activeColor: {
      light: "0 72.2% 50.6%",
      dark: "0 72.2% 50.6%"
    },
    cssVars: {
      light: {
        background: "0 4% 95%",
        foreground: "0 0% 3.9%",
        card: "0 0% 100%",
        "card-foreground": "0 0% 3.9%",
        popover: "0 0% 100%",
        "popover-foreground": "0 0% 3.9%",
        primary: "0 72.2% 50.6%",
        "primary-foreground": "0 85.7% 97.3%",
        active: "0 55% 92%",
        "active-foreground": "0 72% 50%",
        secondary: "0 0% 96.1%",
        "secondary-foreground": "0 0% 9%",
        muted: "0 0% 92.9%",
        "muted-foreground": "0 0% 45.1%",
        accent: "0 0% 96.1%",
        "accent-foreground": "0 0% 9%",
        destructive: "0 74% 42%",
        "destructive-foreground": "0 0% 98%",
        border: "0 0% 89.8%",
        input: "0 0% 89.8%",
        ring: "0 72.2% 50.6%",
        success: "142 70% 45%",
        "success-foreground": "0 0% 98%"
      },
      dark: {
        background: "0 6.8% 8.1%",
        foreground: "0 0% 98%",
        card: "0 10% 3.9%",
        "card-foreground": "0 0% 98%",
        popover: "0 0% 8.9%",
        "popover-foreground": "0 0% 98%",
        primary: "0 72.2% 50.6%",
        "primary-foreground": "0 85.7% 97.3%",
        active: "0 40% 17%",
        "active-foreground": "0 80% 63%",
        secondary: "0 0% 14.9%",
        "secondary-foreground": "0 0% 98%",
        muted: "0 10% 10%",
        "muted-foreground": "0 0% 63.9%",
        accent: "0 0% 14.9%",
        "accent-foreground": "0 0% 98%",
        destructive: "0 100% 64%",
        "destructive-foreground": "0 0% 0%",
        border: "0 0% 14.9%",
        input: "0 0% 14.9%",
        ring: "0 72.2% 50.6%",
        success: "142 70% 45%",
        "success-foreground": "0 0% 98%"
      }
    }
  },
  {
    name: "orange",
    label: "Apricot",
    mesh: {
      light: ["#fdf4e9", "#fdf8f1", "#fffbf6", "#fdf6ed"],
      dark: ["#2d1a0a", "#000000", "#0D0D0D", "#050505"]
    },
    activeColor: {
      light: "17 96% 57%",
      dark: "17 96% 57%"
    },
    cssVars: {
      light: {
        background: "17 4% 95%",
        foreground: "20 14.3% 4.1%",
        card: "0 0% 100%",
        "card-foreground": "20 14.3% 4.1%",
        popover: "0 0% 100%",
        "popover-foreground": "20 14.3% 4.1%",
        primary: "17 96% 57%",
        "primary-foreground": "60 9.1% 97.8%",
        active: "11 55% 92%",
        "active-foreground": "17 88% 51%",
        secondary: "24 4.8% 95.9%",
        "secondary-foreground": "24 9.8% 10%",
        muted: "24 4.8% 92.9%",
        "muted-foreground": "25 5.3% 44.7%",
        accent: "24 4.8% 95.9%",
        "accent-foreground": "24 9.8% 10%",
        destructive: "0 74% 42%",
        "destructive-foreground": "60 9.1% 97.8%",
        border: "20 5.9% 90%",
        input: "20 5.9% 90%",
        ring: "17 96% 57%",
        success: "142 70% 45%",
        "success-foreground": "0 0% 98%"
      },
      dark: {
        background: "20 6.8% 8.1%",
        foreground: "20 9.1% 97.8%",
        card: "20 10% 3.9%",
        "card-foreground": "60 9.1% 97.8%",
        popover: "20 14.3% 8.9%",
        "popover-foreground": "60 9.1% 97.8%",
        primary: "17 96% 57%",
        "primary-foreground": "60 9.1% 3.8%",
        active: "18 40% 17%",
        "active-foreground": "18 80% 63%",
        secondary: "12 6.5% 15.1%",
        "secondary-foreground": "60 9.1% 97.8%",
        muted: "12 10% 10%",
        "muted-foreground": "24 5.4% 63.9%",
        accent: "12 6.5% 15.1%",
        "accent-foreground": "60 9.1% 97.8%",
        destructive: "0 100% 64%",
        "destructive-foreground": "0 0% 0%",
        border: "12 6.5% 15.1%",
        input: "12 6.5% 15.1%",
        ring: "17 96% 57%",
        success: "142 70% 45%",
        "success-foreground": "0 0% 98%"
      }
    }
  },
  {
    name: "yellow",
    label: "Lemon",
    mesh: {
      light: ["#fdf8e2", "#fdfaec", "#fffdf4", "#fdf9e7"],
      dark: ["#2d2a0a", "#000000", "#0D0D0D", "#050505"]
    },
    activeColor: {
      light: "65 95.8% 53.1%",
      dark: "65 100% 50%"
    },
    cssVars: {
      light: {
        background: "65 4% 95%",
        foreground: "20 14.3% 4.1%",
        card: "0 0% 100%",
        "card-foreground": "20 14.3% 4.1%",
        popover: "0 0% 100%",
        "popover-foreground": "20 14.3% 4.1%",
        primary: "65 95.8% 53.1%",
        "primary-foreground": "65 83.3% 14.1%",
        active: "65 98% 61%",
        "active-foreground": "65 55% 23%",
        secondary: "65 4.8% 95.9%",
        "secondary-foreground": "65 9.8% 10%",
        muted: "65 4.8% 92.9%",
        "muted-foreground": "25 5.3% 44.7%",
        accent: "65 4.8% 95.9%",
        "accent-foreground": "24 9.8% 10%",
        destructive: "0 74% 42%",
        "destructive-foreground": "65 9.1% 97.8%",
        border: "20 5.9% 90%",
        input: "20 5.9% 90%",
        ring: "47.9 14.3% 4.1%",
        success: "142 70% 45%",
        "success-foreground": "0 0% 98%"
      },
      dark: {
        background: "65 6.8% 8.1%",
        foreground: "65 9.1% 97.8%",
        card: "65 10% 3.9%",
        "card-foreground": "65 9.1% 97.8%",
        popover: "65 14.3% 4.1%",
        "popover-foreground": "65 9.1% 97.8%",
        primary: "65 100% 53.1%",
        "primary-foreground": "65 83.3% 14.1%",
        active: "65 40% 17%",
        "active-foreground": "65 80% 63%",

        secondary: "12 6.5% 15.1%",
        "secondary-foreground": "65 9.1% 97.8%",
        muted: "12 10% 10%",
        "muted-foreground": "24 5.4% 63.9%",
        accent: "12 6.5% 15.1%",
        "accent-foreground": "65 9.1% 97.8%",
        destructive: "0 100% 64%",
        "destructive-foreground": "0 0% 0%",
        border: "12 6.5% 15.1%",
        input: "12 6.5% 15.1%",
        ring: "65 91.7% 32.9%",
        success: "142 70% 45%",
        "success-foreground": "0 0% 98%"
      }
    }
  },

  {
    name: "green",
    label: "Mint",
    mesh: {
      light: ["#e9fbf2", "#f0fcf6", "#f6fdf9", "#edfcf4"],
      dark: ["#023225", "#000000", "#0D0D0D", "#050505"]
    },
    activeColor: {
      light: "171 62% 41%",
      dark: "171 98% 59%"
    },
    cssVars: {
      light: {
        background: "171 4% 95%",
        foreground: "171 10% 3.9%",
        card: "0 0% 100%",
        "card-foreground": "171 10% 3.9%",
        popover: "0 0% 100%",
        "popover-foreground": "171 10% 3.9%",
        primary: "171 62% 41%",
        "primary-foreground": "171 100% 97.3%",
        active: "171 62% 92%",
        "active-foreground": "171 62% 22%",
        secondary: "171 4.8% 95.9%",
        "secondary-foreground": "171 5.9% 10%",
        muted: "171 4.8% 92.9%",
        "muted-foreground": "171 3.8% 46.1%",
        accent: "171 4.8% 95.9%",
        "accent-foreground": "171 5.9% 10%",
        destructive: "0 74% 42%",
        "destructive-foreground": "0 0% 98%",
        border: "171 5.9% 90%",
        input: "171 5.9% 90%",
        ring: "171 62% 41%",
        success: "142 70% 45%",
        "success-foreground": "0 0% 98%"
      },
      dark: {
        background: "171 6.8% 8.1%",
        foreground: "0 0% 95%",
        popover: "171 0% 9%",
        "popover-foreground": "171 0% 95%",
        card: "171 10% 3.9%",
        "card-foreground": "171 0% 95%",
        primary: "171 98% 59%",
        "primary-foreground": "144.9 80.4% 10%",
        active: "171 98% 15%",
        "active-foreground": "171 98% 59%",
        secondary: "171 3.7% 15.9%",
        "secondary-foreground": "0 0% 98%",
        muted: "171 10% 10%",
        "muted-foreground": "171 5% 64.9%",
        accent: "171 6.5% 15.1%",
        "accent-foreground": "0 0% 98%",
        destructive: "0 100% 64%",
        "destructive-foreground": "0 0% 0%",
        border: "171 3.7% 15.9%",
        input: "171 3.7% 15.9%",
        ring: "171 71.8% 29.2%",
        success: "142 70% 45%",
        "success-foreground": "0 0% 98%"
      }
    }
  },
  {
    name: "blue",
    label: "Blueberry",
    mesh: {
      light: ["#eef3fd", "#f5f8fe", "#fcfdfe", "#f1f5fd"],
      dark: ["#0a1a2d", "#000000", "#0D0D0D", "#050505"]
    },
    activeColor: {
      light: "237 57% 30%",
      dark: "216 98% 52%"
    },
    cssVars: {
      light: {
        background: "237 4% 95%",
        foreground: "237 98% 4.9%",
        card: "0 0% 100%",
        "card-foreground": "237 98% 4.9%",
        popover: "0 0% 100%",
        "popover-foreground": "237 98% 4.9%",
        primary: "237 57% 30%",
        "primary-foreground": "210 40% 98%",
        active: "237 57% 88%",
        "active-foreground": "237 57 30%",
        secondary: "210 40% 96.1%",
        "secondary-foreground": "237.2 47.4% 11.2%",
        muted: "237 40% 92.9%",
        "muted-foreground": "215.4 16.3% 46.9%",
        accent: "237 40% 96.1%",
        "accent-foreground": "237.2 47.4% 11.2%",
        destructive: "0 74% 42%",
        "destructive-foreground": "210 40% 98%",
        border: "214.3 31.8% 91.4%",
        input: "214.3 31.8% 91.4%",
        ring: "237.2 83.2% 53.3%",
        success: "142 70% 45%",
        "success-foreground": "0 0% 98%"
      },
      dark: {
        background: "220 6.8% 8.1%",
        foreground: "220 0% 95%",
        popover: "216 0% 9%",
        "popover-foreground": "220 0% 95%",
        card: "220 10% 3.9%",
        "card-foreground": "220 10% 95%",
        primary: "216 98% 52%",
        "primary-foreground": "216 80.4% 100%",
        active: "216 50% 15%",
        "active-foreground": "216 98% 58%",
        secondary: "220 10% 15.9%",
        "secondary-foreground": "220 0% 98%",
        muted: "220 10% 10%",
        "muted-foreground": "220 5% 64.9%",
        accent: "220 10% 15.9%",
        "accent-foreground": "0 0% 98%",
        destructive: "0 100% 64%",
        "destructive-foreground": "0 0% 0%",
        border: "220 10% 15.9%",
        input: "220 10% 15.9%",
        ring: "216 71.8% 29.2%",
        success: "142 70% 45%",
        "success-foreground": "0 0% 98%"
      }
    }
  },
  {
    name: "violet",
    label: "Lavender",
    mesh: {
      light: ["#f3f0fe", "#f7f5fe", "#fbfaff", "#f5f2fe"],
      dark: ["#1e0a2d", "#000000", "#0D0D0D", "#050505"]
    },
    activeColor: {
      light: "238 57% 50%",
      dark: "253.4 70% 40.4%"
    },
    cssVars: {
      light: {
        background: "238 4% 95%",
        foreground: "224 71.4% 4.1%",
        card: "0 0% 100%",
        "card-foreground": "224 71.4% 4.1%",
        popover: "0 0% 100%",
        "popover-foreground": "224 71.4% 4.1%",
        primary: "238 57% 50%",
        "primary-foreground": "238 20% 98%",
        active: "238 57% 88%",
        "active-foreground": "238 57% 44%",
        secondary: "220 14.3% 95.9%",
        "secondary-foreground": "220.9 39.3% 11%",
        muted: "238 57% 92.9%",
        "muted-foreground": "238 8.9% 46.1%",
        accent: "238 33.3% 95.9%",
        "accent-foreground": "220.9 39.3% 11%",
        destructive: "0 74% 42%",
        "destructive-foreground": "210 20% 98%",
        border: "220 13% 91%",
        input: "220 13% 91%",
        ring: "238 83.3% 57.8%",
        success: "142 70% 45%",
        "success-foreground": "0 0% 98%"
      },
      dark: {
        background: "263 6.8% 8.1%",
        foreground: "263 20% 98%",
        card: "263 41.4 5%",
        "card-foreground": "210 20% 98%",
        popover: "263 41.4 8.9%",
        "popover-foreground": "210 20% 98%",
        primary: "171 98% 59%",
        "primary-foreground": "144.9 80.4% 10%",
        active: "327 40% 17%",
        "active-foreground": "327 80% 63%",
        secondary: "263 27.9% 16.9%",
        "secondary-foreground": "263 20% 98%",
        muted: "263 10% 10%",
        "muted-foreground": "217.9 10.6% 64.9%",
        accent: "263 27.9% 12.9%",
        "accent-foreground": "210 20% 98%",
        destructive: "0 100% 64%",
        "destructive-foreground": "0 0% 0%",
        border: "263 27.9% 16.9%",
        input: "263 27.9% 16.9%",
        ring: "263.4 70% 50.4%",
        success: "142 70% 45%",
        "success-foreground": "0 0% 98%"
      }
    }
  }
] as const;

type MonthDay = { month: number; day: number };

/**
 * The days of the year a seasonal theme is on, both ends included, within
 * one calendar year (`from` on or before `to`).
 */
export type ThemeWindow = { from: MonthDay; to: MonthDay };

/** Four mesh-gradient stops per mode, for the ERP's onboarding backdrop. */
export type MeshColors = {
  light: readonly [string, string, string, string];
  dark: readonly [string, string, string, string];
};

/**
 * A theme that takes over the signed-in app for a few days a year: while in
 * season it renders for everyone until they pick another theme, and when the
 * season ends everyone is back on their own. Pickers list it only while it is in
 * season. Everything about it lives on the theme, so removing one is deleting
 * its file and its `seasonalThemes` entry.
 */
export type SeasonalTheme = {
  name: string;
  label: string;
  /** When it is on. The only switch: no flag, no deploy on the day. */
  available: ThemeWindow;
  mesh: MeshColors;
  activeColor: { light: string; dark: string };
  cssVars: { light: Record<string, string>; dark: Record<string, string> };
};

export const seasonalThemes = [
  halloweenTheme
] as const satisfies readonly SeasonalTheme[];

const allThemes = [...themes, ...seasonalThemes] as const;

export type Theme = (typeof allThemes)[number];
export type ThemeName = Theme["name"];

/** The first everyday theme is the default. */
const defaultTheme: Theme = themes[0];
export const DEFAULT_THEME_NAME = themes[0].name;

function dayOfYear({ month, day }: MonthDay) {
  return month * 100 + day;
}

// The first and last time zones to reach a date: UTC+14 and UTC-12.
const EARLIEST_TIME_ZONE = "Pacific/Kiritimati";
const LATEST_TIME_ZONE = "Etc/GMT+12";

/**
 * Whether a seasonal theme is on.
 *
 * Given a `date`, the window is checked against that day. Without one it is
 * on while it is in season anywhere on Earth: the server has no time zone
 * for the user, and checking one fixed zone (UTC) turned Halloween on five
 * and a half hours late in India. So the server and the browser agree, and a
 * user sees it from at most a day before their own first day to at most a
 * day after their last.
 */
export function isInSeason(
  theme: { available: ThemeWindow },
  date?: CalendarDate
) {
  const from = dayOfYear(theme.available.from);
  const to = dayOfYear(theme.available.to);
  if (date) {
    const current = dayOfYear(date);
    return current >= from && current <= to;
  }
  return (
    dayOfYear(today(EARLIEST_TIME_ZONE)) >= from &&
    dayOfYear(today(LATEST_TIME_ZONE)) <= to
  );
}

/** The seasonal theme on now, if any. */
export function seasonalThemeNow(date?: CalendarDate): Theme | undefined {
  return seasonalThemes.find((theme) => isInSeason(theme, date));
}

/**
 * The everyday theme a stored name picks, whatever is in season. An unknown
 * name (a theme since removed, or a seasonal one) falls back to the default,
 * so removing a theme never breaks a browser that still holds its cookie.
 */
export function storedTheme(name: string | null | undefined): Theme {
  return themes.find((candidate) => candidate.name === name) ?? defaultTheme;
}

/**
 * The theme to render for a stored name: a seasonal theme in season, unless
 * this browser switched it off (`seasonalOff`, the name of the seasonal theme
 * it picked away from); otherwise the stored everyday theme (`storedTheme`).
 */
export function resolveTheme(
  name: string | null | undefined,
  {
    date,
    seasonalOff
  }: { date?: CalendarDate; seasonalOff?: string | null } = {}
): Theme {
  const seasonal = seasonalThemeNow(date);
  return seasonal && seasonal.name !== seasonalOff
    ? seasonal
    : storedTheme(name);
}

/** The everyday theme a browser picked. */
export const THEME_COOKIE = "theme";

/** The seasonal theme a browser picked away from while it was in season. */
export const SEASONAL_OFF_COOKIE = "seasonal-theme-off";

const THEME_MAX_AGE = 60 * 60 * 24 * 365;
// Long enough to outlast a season, short enough to be gone by the next one.
const SEASONAL_OFF_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Whether a page is inside the signed-in app (`/x`), the only place a
 * seasonal theme shows: sign-in, shared links and onboarding keep the brand.
 */
export function isAppPath(pathname: string) {
  return pathname === "/x" || pathname.startsWith("/x/");
}

export function themeForRequest(
  cookieHeader: string | null,
  pathname: string
): Theme {
  const cookies = cookieHeader ? cookie.parse(cookieHeader) : {};
  if (!isAppPath(pathname)) return storedTheme(cookies[THEME_COOKIE]);
  return resolveTheme(cookies[THEME_COOKIE], {
    seasonalOff: cookies[SEASONAL_OFF_COOKIE]
  });
}

/** A cookie a theme pick writes; `maxAge: 0` deletes it. */
export type ThemeCookieWrite = { name: string; value: string; maxAge: number };

/**
 * The cookies a theme pick writes. A seasonal theme turns itself back on and
 * keeps the stored theme. An everyday theme is stored and, when picked inside
 * the app while a seasonal theme is on, switches that one off for this
 * browser; a pick made elsewhere (onboarding) never saw it, so leaves it on.
 */
export function themeCookieWrites(
  theme: string,
  { inApp, date }: { inApp: boolean; date?: CalendarDate }
): ThemeCookieWrite[] {
  if (isSeasonalTheme(theme)) {
    return [{ name: SEASONAL_OFF_COOKIE, value: "", maxAge: 0 }];
  }
  const writes = [{ name: THEME_COOKIE, value: theme, maxAge: THEME_MAX_AGE }];
  const seasonal = inApp ? seasonalThemeNow(date) : undefined;
  if (seasonal) {
    writes.push({
      name: SEASONAL_OFF_COOKIE,
      value: seasonal.name,
      maxAge: SEASONAL_OFF_MAX_AGE
    });
  }
  return writes;
}

/**
 * The themes a picker lists: the seasonal theme first while it is in season,
 * then every everyday theme.
 */
export function pickableThemes(date?: CalendarDate): readonly Theme[] {
  const seasonal = seasonalThemeNow(date);
  return seasonal ? [seasonal, ...themes] : themes;
}

/**
 * Any theme by name, seasonal ones included, else the default: the root
 * `Document` renders the name its loader already resolved, without deciding
 * the season again.
 */
export function themeByName(name: string | null | undefined): Theme {
  return allThemes.find((theme) => theme.name === name) ?? defaultTheme;
}

/**
 * Whether a name is a seasonal theme. Picking one saves no everyday theme: it
 * only turns the seasonal theme back on for this browser.
 */
export function isSeasonalTheme(name: string | null | undefined) {
  // Typed, so it still compiles once the list is empty.
  return seasonalThemes.some((theme: SeasonalTheme) => theme.name === name);
}

export const BASE_THEME_WITH_VARIABLES = `
:root {
  --background: <%- colors.light["background"] %>;
  --foreground: <%- colors.light["foreground"] %>;
  --card: <%- colors.light["card"] %>;
  --card-foreground: <%- colors.light["card-foreground"] %>;
  --popover: <%- colors.light["popover"] %>;
  --popover-foreground: <%- colors.light["popover-foreground"] %>;
  --primary: <%- colors.light["primary"] %>;
  --primary-foreground: <%- colors.light["primary-foreground"] %>;
  --active: <%- colors.light["active"] %>;
  --active-foreground: <%- colors.light["active-foreground"] %>;
  --secondary: <%- colors.light["secondary"] %>;
  --secondary-foreground: <%- colors.light["secondary-foreground"] %>;
  --muted: <%- colors.light["muted"] %>;
  --muted-foreground: <%- colors.light["muted-foreground"] %>;
  --accent: <%- colors.light["accent"] %>;
  --accent-foreground: <%- colors.light["accent-foreground"] %>;
  --destructive: <%- colors.light["destructive"] %>;
  --destructive-foreground: <%- colors.light["destructive-foreground"] %>;
  --border: <%- colors.light["border"] %>;
  --input: <%- colors.light["input"] %>;
  --ring: <%- colors.light["ring"] %>;
  --radius: <%- radius %>rem;
  --success: <%- colors.light["success"] %>;
  --success-foreground: <%- colors.light["success-foreground"] %>;
}

.dark {
  --background: <%- colors.dark["background"] %>;
  --foreground: <%- colors.dark["foreground"] %>;
  --card: <%- colors.dark["card"] %>;
  --card-foreground: <%- colors.dark["card-foreground"] %>;
  --popover: <%- colors.dark["popover"] %>;
  --popover-foreground: <%- colors.dark["popover-foreground"] %>;
  --primary: <%- colors.dark["primary"] %>;
  --primary-foreground: <%- colors.dark["primary-foreground"] %>;
  --active: <%- colors.dark["active"] %>;
  --active-foreground: <%- colors.dark["active-foreground"] %>;
  --secondary: <%- colors.dark["secondary"] %>;
  --secondary-foreground: <%- colors.dark["secondary-foreground"] %>;
  --muted: <%- colors.dark["muted"] %>;
  --muted-foreground: <%- colors.dark["muted-foreground"] %>;
  --accent: <%- colors.dark["accent"] %>;
  --accent-foreground: <%- colors.dark["accent-foreground"] %>;
  --destructive: <%- colors.dark["destructive"] %>;
  --destructive-foreground: <%- colors.dark["destructive-foreground"] %>;
  --border: <%- colors.dark["border"] %>;
  --input: <%- colors.dark["input"] %>;
  --ring: <%- colors.dark["ring"] %>;
  --success: <%- colors.dark["success"] %>;
  --success-foreground: <%- colors.dark["success-foreground"] %>;
}`;

export function getThemeCode(theme: Theme) {
  if (!theme) {
    return "";
  }

  return template(BASE_THEME_WITH_VARIABLES)({
    colors: theme.cssVars,
    radius: 0.5
  });
}
