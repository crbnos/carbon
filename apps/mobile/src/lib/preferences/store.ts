// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MES_LOCALES, type MesLocale } from "@carbon/mes-core";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Device preferences: the app's language and its light/dark choice.
 *
 * Deliberately NOT keyed by instance, unlike everything else this app stores.
 * A language and a theme belong to the tablet and the person holding it, not
 * to the Carbon it happens to be pointed at — a shared terminal on a shop
 * floor keeps its language when a kitter switches it between production and
 * staging.
 *
 * AsyncStorage, not SecureStore: neither value is a secret, and SecureStore is
 * backed by the keychain, which is slower and limited in size.
 */

const KEY = "preferences.v1";

/** "device"/"system" mean "follow the OS", which is the default for both. */
export type LocalePreference = MesLocale | "device";
export type ThemePreference = "light" | "dark" | "system";

export type Preferences = {
  locale: LocalePreference;
  theme: ThemePreference;
};

export const DEFAULT_PREFERENCES: Preferences = {
  locale: "device",
  theme: "system"
};

const THEMES: ThemePreference[] = ["light", "dark", "system"];

/** Validates stored JSON rather than trusting it — it is a year-old string. */
function parse(raw: string | null): Preferences {
  if (!raw) return DEFAULT_PREFERENCES;
  try {
    const value = JSON.parse(raw) as Partial<Preferences>;
    const locale =
      value.locale === "device" ||
      (typeof value.locale === "string" &&
        (MES_LOCALES as readonly string[]).includes(value.locale))
        ? (value.locale as LocalePreference)
        : DEFAULT_PREFERENCES.locale;
    const theme =
      typeof value.theme === "string" &&
      THEMES.includes(value.theme as ThemePreference)
        ? (value.theme as ThemePreference)
        : DEFAULT_PREFERENCES.theme;
    return { locale, theme };
  } catch {
    // A corrupt blob must not stop the app booting; the defaults are usable.
    return DEFAULT_PREFERENCES;
  }
}

export async function loadPreferences(): Promise<Preferences> {
  try {
    return parse(await AsyncStorage.getItem(KEY));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export async function savePreferences(preferences: Preferences) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(preferences));
  } catch {
    // A failed write costs the operator their choice next launch, which is
    // better than a crash while they are mid-shift.
  }
}

export { parse as parsePreferences };
