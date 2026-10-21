// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The season window is tested on a fixture, and the registry on whatever
// seasonal themes exist, so removing one (Halloween) leaves this file as is.

import { CalendarDate } from "@internationalized/date";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THEME_NAME,
  isThemeAvailable,
  resolveTheme,
  type SeasonalTheme,
  seasonalMeshColors,
  seasonalThemes,
  selectableThemes,
  type ThemeWindow,
  themes
} from "./themes";

// Typed by what a seasonal theme may declare, so it compiles when empty.
const seasonal: readonly SeasonalTheme[] = seasonalThemes;

const spooky: { name: string; available: ThemeWindow } = {
  name: "spooky",
  available: { from: { month: 10, day: 20 }, to: { month: 11, day: 1 } }
};

describe("isThemeAvailable", () => {
  it("always offers a theme with no window", () => {
    expect(isThemeAvailable(themes[0], new CalendarDate(2026, 3, 15))).toBe(
      true
    );
  });

  it("offers a seasonal theme inside its window, both ends included", () => {
    expect(isThemeAvailable(spooky, new CalendarDate(2026, 10, 20))).toBe(true);
    expect(isThemeAvailable(spooky, new CalendarDate(2026, 10, 31))).toBe(true);
    expect(isThemeAvailable(spooky, new CalendarDate(2026, 11, 1))).toBe(true);
  });

  it("withholds a seasonal theme outside its window", () => {
    expect(isThemeAvailable(spooky, new CalendarDate(2026, 10, 19))).toBe(
      false
    );
    expect(isThemeAvailable(spooky, new CalendarDate(2026, 11, 2))).toBe(false);
  });
});

describe("isThemeAvailable with no date", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const availableAt = (instant: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(instant);
    return isThemeAvailable(spooky);
  };

  it("opens once the first time zone reaches the first day", () => {
    // Oct 19 in UTC, Oct 20 in India and on Kiritimati (UTC+14).
    expect(availableAt("2026-10-19T23:03:00Z")).toBe(true);
    // Still Oct 19 everywhere, Kiritimati included.
    expect(availableAt("2026-10-19T09:00:00Z")).toBe(false);
  });

  it("closes once the last time zone leaves the last day", () => {
    // Nov 2 in UTC, still Nov 1 at UTC-12.
    expect(availableAt("2026-11-02T11:00:00Z")).toBe(true);
    // Nov 2 everywhere.
    expect(availableAt("2026-11-02T13:00:00Z")).toBe(false);
  });
});

// A day no seasonal theme is in season.
const ordinaryDay = new CalendarDate(2026, 3, 15);

describe("resolveTheme on an ordinary day", () => {
  it("is a day with no theme in season", () => {
    for (const theme of seasonal) {
      expect(isThemeAvailable(theme, ordinaryDay)).toBe(false);
    }
  });

  it("returns the stored theme when it is offered", () => {
    expect(resolveTheme("violet", ordinaryDay).name).toBe("violet");
  });

  it("falls back to the default for a removed or missing theme", () => {
    expect(resolveTheme("pumpkin-spice", ordinaryDay).name).toBe(
      DEFAULT_THEME_NAME
    );
    expect(resolveTheme(undefined, ordinaryDay).name).toBe(DEFAULT_THEME_NAME);
    expect(resolveTheme(null, ordinaryDay).name).toBe(DEFAULT_THEME_NAME);
  });

  it("offers only the everyday themes", () => {
    expect(selectableThemes(ordinaryDay)).toEqual([...themes]);
  });
});

for (const theme of seasonal) {
  const { from, to } = theme.available;
  const firstDay = new CalendarDate(2026, from.month, from.day);
  const dayAfter = new CalendarDate(2026, to.month, to.day).add({ days: 1 });

  describe(`seasonal theme "${theme.name}"`, () => {
    it("is never one of the everyday themes", () => {
      expect(themes.map((t) => t.name)).not.toContain(theme.name);
    });

    it("is offered in season and withdrawn after it", () => {
      expect(selectableThemes(firstDay).map((t) => t.name)).toContain(
        theme.name
      );
      expect(selectableThemes(dayAfter).map((t) => t.name)).not.toContain(
        theme.name
      );
    });

    it("renders in season, for everyone when forced", () => {
      expect(resolveTheme(theme.name, firstDay).name).toBe(theme.name);
      expect(resolveTheme("violet", firstDay).name).toBe(
        theme.forced ? theme.name : "violet"
      );
    });

    it("gives way after its season, to the stored theme or the default", () => {
      expect(resolveTheme(theme.name, dayAfter).name).toBe(DEFAULT_THEME_NAME);
      expect(resolveTheme("violet", dayAfter).name).toBe("violet");
    });

    it("brings its own mesh colors", () => {
      expect(seasonalMeshColors(theme.name)).toEqual(theme.mesh);
    });
  });
}
