// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The season is tested on a fixture, and the registry on whatever seasonal
// themes exist, so removing one (Halloween) leaves this file as it is.

import { CalendarDate } from "@internationalized/date";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THEME_NAME,
  isInSeason,
  isSeasonalTheme,
  pickableThemes,
  resolveTheme,
  type SeasonalTheme,
  seasonalThemes,
  storedTheme,
  type ThemeWindow,
  themeByName,
  themeCookieWrites,
  themeForRequest,
  themes
} from "./themes";
import { themeColorValidator } from "./types";

// Typed by what a seasonal theme may declare, so it compiles when empty.
const seasonal: readonly SeasonalTheme[] = seasonalThemes;

const spooky: { available: ThemeWindow } = {
  available: { from: { month: 10, day: 20 }, to: { month: 11, day: 1 } }
};

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

// Seasonal themes replace every theme while in season, so they meet it too.
const everyTheme = [...themes, ...seasonalThemes];

describe("destructive colour contrast", () => {
  it.each(
    everyTheme.flatMap((theme) =>
      (["light", "dark"] as const).map((mode) => [theme.name, mode] as const)
    )
  )("%s %s: destructive-foreground on destructive", (name, mode) => {
    const vars = everyTheme.find((t) => t.name === name)!.cssVars[mode];
    expect(
      contrast(vars.destructive, vars["destructive-foreground"])
    ).toBeGreaterThanOrEqual(TEXT);
  });

  it.each(everyTheme.map((theme) => theme.name))(
    "%s light: destructive text on every surface",
    (name) => {
      const vars = everyTheme.find((t) => t.name === name)!.cssVars.light;
      for (const surface of SURFACES) {
        expect(
          contrast(vars.destructive, vars[surface]),
          surface
        ).toBeGreaterThanOrEqual(TEXT);
      }
    }
  );

  it.each(everyTheme.map((theme) => theme.name))(
    "%s dark: destructive text on every surface",
    (name) => {
      const vars = everyTheme.find((t) => t.name === name)!.cssVars.dark;
      for (const surface of SURFACES) {
        expect(
          contrast(vars.destructive, vars[surface]),
          surface
        ).toBeGreaterThanOrEqual(TEXT);
      }
    }
  );
});

describe("isInSeason", () => {
  it("is on inside the window, both ends included", () => {
    expect(isInSeason(spooky, new CalendarDate(2026, 10, 20))).toBe(true);
    expect(isInSeason(spooky, new CalendarDate(2026, 10, 31))).toBe(true);
    expect(isInSeason(spooky, new CalendarDate(2026, 11, 1))).toBe(true);
  });

  it("is off outside it", () => {
    expect(isInSeason(spooky, new CalendarDate(2026, 10, 19))).toBe(false);
    expect(isInSeason(spooky, new CalendarDate(2026, 11, 2))).toBe(false);
  });
});

describe("isInSeason with no date", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const onAt = (instant: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(instant);
    return isInSeason(spooky);
  };

  it("turns on once the first time zone reaches the first day", () => {
    // Oct 19 in UTC, Oct 20 in India and on Kiritimati (UTC+14).
    expect(onAt("2026-10-19T23:03:00Z")).toBe(true);
    // Still Oct 19 everywhere, Kiritimati included.
    expect(onAt("2026-10-19T09:00:00Z")).toBe(false);
  });

  it("turns off once the last time zone leaves the last day", () => {
    // Nov 2 in UTC, still Nov 1 at UTC-12.
    expect(onAt("2026-11-02T11:00:00Z")).toBe(true);
    // Nov 2 everywhere.
    expect(onAt("2026-11-02T13:00:00Z")).toBe(false);
  });
});

// A day no seasonal theme is on.
const ordinaryDay = new CalendarDate(2026, 3, 15);

describe("resolveTheme on an ordinary day", () => {
  it("is a day with no theme in season", () => {
    for (const theme of seasonal) {
      expect(isInSeason(theme, ordinaryDay)).toBe(false);
    }
  });

  it("returns the stored theme", () => {
    expect(resolveTheme("violet", { date: ordinaryDay }).name).toBe("violet");
    expect(storedTheme("violet").name).toBe("violet");
    expect(themeByName("violet").name).toBe("violet");
    expect(isSeasonalTheme("violet")).toBe(false);
  });

  it("falls back to the default for a removed or missing theme", () => {
    expect(resolveTheme("pumpkin-spice", { date: ordinaryDay }).name).toBe(
      DEFAULT_THEME_NAME
    );
    expect(resolveTheme(undefined, { date: ordinaryDay }).name).toBe(
      DEFAULT_THEME_NAME
    );
    expect(resolveTheme(null, { date: ordinaryDay }).name).toBe(
      DEFAULT_THEME_NAME
    );
  });
});

for (const theme of seasonal) {
  const { from, to } = theme.available;
  const firstDay = new CalendarDate(2026, from.month, from.day);
  const lastDay = new CalendarDate(2026, to.month, to.day);
  const dayAfter = lastDay.add({ days: 1 });

  describe(`seasonal theme "${theme.name}"`, () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("is listed first in the pickers only while in season", () => {
      expect(pickableThemes(firstDay).map((t) => t.name)).toEqual([
        theme.name,
        ...themes.map((t) => t.name)
      ]);
      expect(pickableThemes(dayAfter)).toEqual(themes);
      expect(themeColorValidator.safeParse({ theme: theme.name }).success).toBe(
        true
      );
    });

    it("replaces every theme while in season, unless the browser switched it off", () => {
      for (const day of [firstDay, lastDay]) {
        expect(resolveTheme("violet", { date: day }).name).toBe(theme.name);
        expect(resolveTheme(undefined, { date: day }).name).toBe(theme.name);
        expect(
          resolveTheme("violet", { date: day, seasonalOff: theme.name }).name
        ).toBe("violet");
      }
    });

    it("shows only inside the signed-in app", () => {
      vi.useFakeTimers();
      vi.setSystemTime(`${firstDay.toString()}T12:00:00Z`);
      const picked = "theme=violet";
      const switchedOff = `theme=violet; seasonal-theme-off=${theme.name}`;
      expect(themeForRequest(picked, "/x").name).toBe(theme.name);
      expect(themeForRequest(picked, "/x/sales").name).toBe(theme.name);
      expect(themeForRequest(picked, "/login").name).toBe("violet");
      expect(themeForRequest(picked, "/share/quote/1").name).toBe("violet");
      expect(themeForRequest(picked, "/xylophone").name).toBe("violet");
      expect(themeForRequest(null, "/login").name).toBe(DEFAULT_THEME_NAME);
      expect(themeForRequest(switchedOff, "/x").name).toBe("violet");
    });

    it("is switched off by an everyday pick made inside the app", () => {
      expect(
        themeCookieWrites("violet", { inApp: true, date: firstDay })
      ).toEqual([
        { name: "theme", value: "violet", maxAge: 31536000 },
        { name: "seasonal-theme-off", value: theme.name, maxAge: 2592000 }
      ]);
    });

    it("stays on after a pick made outside the app or out of season", () => {
      const storesOnly = [{ name: "theme", value: "violet", maxAge: 31536000 }];
      expect(
        themeCookieWrites("violet", { inApp: false, date: firstDay })
      ).toEqual(storesOnly);
      expect(
        themeCookieWrites("violet", { inApp: true, date: dayAfter })
      ).toEqual(storesOnly);
    });

    it("turns back on when picked, keeping the stored theme", () => {
      expect(
        themeCookieWrites(theme.name, { inApp: true, date: firstDay })
      ).toEqual([{ name: "seasonal-theme-off", value: "", maxAge: 0 }]);
    });

    it("hands everyone back their own theme after its season", () => {
      expect(resolveTheme("violet", { date: dayAfter }).name).toBe("violet");
      expect(resolveTheme(theme.name, { date: dayAfter }).name).toBe(
        DEFAULT_THEME_NAME
      );
    });

    it("is never a stored pick, but renders by name", () => {
      expect(isSeasonalTheme(theme.name)).toBe(true);
      expect(storedTheme(theme.name).name).toBe(DEFAULT_THEME_NAME);
      expect(themeByName(theme.name).name).toBe(theme.name);
    });
  });
}
