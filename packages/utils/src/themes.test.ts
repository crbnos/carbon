// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CalendarDate } from "@internationalized/date";
import { afterEach, describe, expect, it, vi } from "vitest";
import { halloweenTheme } from "./halloween-theme";
import {
  DEFAULT_THEME_NAME,
  isThemeAvailable,
  resolveTheme,
  selectableThemes,
  themes
} from "./themes";

const inSeason = new CalendarDate(2026, 10, 31);
const firstDay = new CalendarDate(2026, 10, 20);
const lastDay = new CalendarDate(2026, 11, 1);
const dayBefore = new CalendarDate(2026, 10, 19);
const dayAfter = new CalendarDate(2026, 11, 2);

describe("isThemeAvailable", () => {
  it("always offers a theme with no window", () => {
    const zinc = resolveTheme("zinc", dayAfter);
    expect(isThemeAvailable(zinc, dayAfter)).toBe(true);
  });

  it("offers a seasonal theme inside its window, both ends included", () => {
    expect(isThemeAvailable(halloweenTheme, firstDay)).toBe(true);
    expect(isThemeAvailable(halloweenTheme, inSeason)).toBe(true);
    expect(isThemeAvailable(halloweenTheme, lastDay)).toBe(true);
  });

  it("withholds a seasonal theme outside its window", () => {
    expect(isThemeAvailable(halloweenTheme, dayBefore)).toBe(false);
    expect(isThemeAvailable(halloweenTheme, dayAfter)).toBe(false);
  });
});

describe("isThemeAvailable with no date", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const availableAt = (instant: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(instant);
    return isThemeAvailable(halloweenTheme);
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

describe("selectableThemes", () => {
  it("adds the seasonal theme to the everyday ones only in season", () => {
    expect(selectableThemes(inSeason)).toHaveLength(themes.length + 1);
    expect(selectableThemes(dayAfter)).toHaveLength(themes.length);
  });

  it("never puts a seasonal theme in the everyday list", () => {
    expect(themes.map((t) => t.name)).not.toContain(halloweenTheme.name);
  });
});

describe("resolveTheme", () => {
  it("returns the stored theme when it is offered", () => {
    expect(resolveTheme("violet", dayAfter).name).toBe("violet");
    expect(resolveTheme(halloweenTheme.name, inSeason).name).toBe(
      halloweenTheme.name
    );
  });

  it("falls back to the default for a seasonal theme out of season", () => {
    expect(resolveTheme(halloweenTheme.name, dayAfter).name).toBe(
      DEFAULT_THEME_NAME
    );
  });

  it("falls back to the default for a removed or missing theme", () => {
    expect(resolveTheme("pumpkin-spice", inSeason).name).toBe(
      DEFAULT_THEME_NAME
    );
    expect(resolveTheme(undefined).name).toBe(DEFAULT_THEME_NAME);
    expect(resolveTheme(null).name).toBe(DEFAULT_THEME_NAME);
  });
});
