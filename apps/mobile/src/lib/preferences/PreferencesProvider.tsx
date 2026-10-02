// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MesLocale } from "@carbon/mes-core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import { useColorScheme } from "react-native";
import { deviceLocale } from "~/i18n";
import {
  DEFAULT_PREFERENCES,
  type LocalePreference,
  loadPreferences,
  type Preferences,
  savePreferences,
  type ThemePreference
} from "./store";

type PreferencesContextValue = {
  /** What the operator chose, including "follow the device". */
  locale: LocalePreference;
  theme: ThemePreference;
  /** The locale and scheme actually in effect, with "device" resolved. */
  resolvedLocale: MesLocale;
  resolvedScheme: "light" | "dark";
  setLocale: (locale: LocalePreference) => void;
  setTheme: (theme: ThemePreference) => void;
  /** False until the stored values have been read. */
  ready: boolean;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

/**
 * Reads the stored language and theme once at boot and writes them back on
 * every change.
 *
 * It renders its children IMMEDIATELY, on the defaults, rather than waiting
 * for the read. A tablet clamped to a machine must show something the moment
 * it is woken; one extra frame in the device's own language is a far better
 * first paint than a blank screen, and the stored values land a few
 * milliseconds later.
 */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] =
    useState<Preferences>(DEFAULT_PREFERENCES);
  const [ready, setReady] = useState(false);
  const scheme = useColorScheme();

  useEffect(() => {
    let cancelled = false;
    void loadPreferences().then((stored) => {
      if (cancelled) return;
      setPreferences(stored);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((next: Preferences) => {
    setPreferences(next);
    // Fire and forget: the screen must not wait on a disk write, and a failed
    // one only costs the choice at next launch.
    void savePreferences(next);
  }, []);

  const value = useMemo<PreferencesContextValue>(() => {
    const resolvedLocale =
      preferences.locale === "device" ? deviceLocale() : preferences.locale;
    const resolvedScheme =
      preferences.theme === "system"
        ? scheme === "dark"
          ? "dark"
          : "light"
        : preferences.theme;

    return {
      locale: preferences.locale,
      theme: preferences.theme,
      resolvedLocale,
      resolvedScheme,
      setLocale: (locale) => update({ ...preferences, locale }),
      setTheme: (theme) => update({ ...preferences, theme }),
      ready
    };
  }, [preferences, scheme, ready, update]);

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) {
    throw new Error("usePreferences must be used inside PreferencesProvider");
  }
  return value;
}
