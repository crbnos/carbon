// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { usePreferences } from "~/lib/preferences/PreferencesProvider";
import { THEME_COLORS } from "./themeColors";

/**
 * The theme's hex values for the current colour scheme.
 *
 * `themeColors.ts` stays free of React Native imports so vitest can read it
 * against `global.css`; this is the hook half. Use it anywhere a lucide icon's
 * `color`, an `ActivityIndicator` or a native style object needs a value —
 * passing a literal, or passing `null` as the scheme, silently pins that
 * element to light mode, which is how one icon ends up invisible on a
 * night-shift tablet.
 */
export function useThemeColors() {
  // The PREFERENCE, not `useColorScheme()`. An explicit light/dark choice is
  // applied to classNames through Uniwind's ScopedTheme, which react-native's
  // own hook knows nothing about — reading the OS here would leave a screen
  // with dark panels and light-mode icons on it.
  const { resolvedScheme } = usePreferences();
  return THEME_COLORS[resolvedScheme];
}
