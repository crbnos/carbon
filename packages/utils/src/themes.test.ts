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
  resolveTheme,
  type SeasonalTheme,
  seasonalThemes,
  storedTheme,
  type ThemeWindow,
  themeByName,
  themes
} from "./themes";
import { themeColorValidator } from "./types";

// Typed by what a seasonal theme may declare, so it compiles when empty.
const seasonal: readonly SeasonalTheme[] = seasonalThemes;

const spooky: { available: ThemeWindow } = {
  available: { from: { month: 10, day: 20 }, to: { month: 11, day: 1 } }
};

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
    expect(resolveTheme("violet", ordinaryDay).name).toBe("violet");
    expect(storedTheme("violet").name).toBe("violet");
    expect(themeByName("violet").name).toBe("violet");
    expect(isSeasonalTheme("violet")).toBe(false);
  });

  it("falls back to the default for a removed or missing theme", () => {
    expect(resolveTheme("pumpkin-spice", ordinaryDay).name).toBe(
      DEFAULT_THEME_NAME
    );
    expect(resolveTheme(undefined, ordinaryDay).name).toBe(DEFAULT_THEME_NAME);
    expect(resolveTheme(null, ordinaryDay).name).toBe(DEFAULT_THEME_NAME);
  });
});

for (const theme of seasonal) {
  const { from, to } = theme.available;
  const firstDay = new CalendarDate(2026, from.month, from.day);
  const lastDay = new CalendarDate(2026, to.month, to.day);
  const dayAfter = lastDay.add({ days: 1 });

  describe(`seasonal theme "${theme.name}"`, () => {
    it("is in no picker", () => {
      expect(themes.map((t) => t.name)).not.toContain(theme.name);
      expect(themeColorValidator.safeParse({ theme: theme.name }).success).toBe(
        false
      );
    });

    it("replaces every theme for everyone while in season", () => {
      for (const day of [firstDay, lastDay]) {
        expect(resolveTheme("violet", day).name).toBe(theme.name);
        expect(resolveTheme(undefined, day).name).toBe(theme.name);
      }
    });

    it("hands everyone back their own theme after its season", () => {
      expect(resolveTheme("violet", dayAfter).name).toBe("violet");
      expect(resolveTheme(theme.name, dayAfter).name).toBe(DEFAULT_THEME_NAME);
    });

    it("is never a stored pick, but renders by name", () => {
      expect(isSeasonalTheme(theme.name)).toBe(true);
      expect(storedTheme(theme.name).name).toBe(DEFAULT_THEME_NAME);
      expect(themeByName(theme.name).name).toBe(theme.name);
    });
  });
}
