// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ThemeStyle } from "@carbon/utils";
import {
  isAppPath,
  resolveThemeValue,
  themeByName,
  themeStyle
} from "@carbon/utils";
import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore
} from "react";
import { useFetchers, useLocation } from "react-router";
import { useRouteData } from "./useRouteData";

// A color drag's unsaved value; `undefined` is no preview.
let preview: string | undefined;
const previewListeners = new Set<() => void>();

/** Shows a theme without saving it; `undefined` ends the preview. */
export function setThemePreview(value: string | undefined) {
  if (value === preview) return;
  preview = value;
  for (const listener of previewListeners) listener();
}

function subscribePreview(listener: () => void) {
  previewListeners.add(listener);
  return () => {
    previewListeners.delete(listener);
  };
}

/** The theme to render, by name (`resolveThemeValue`). */
export function useThemeValue(): string {
  const previewed = useSyncExternalStore(
    subscribePreview,
    () => preview,
    () => undefined
  );
  return resolveThemeValue(previewed, [], useSavedThemeValue());
}

/** The theme in use, or the one being saved: `useThemeValue` without the
 *  preview. A picker compares a pick with it. */
export function useSavedThemeValue(): string {
  const fetchers = useFetchers();
  const routeData = useRouteData<{ theme?: string }>("/");
  return resolveThemeValue(
    undefined,
    fetchers.map((fetcher) => fetcher.formData?.get("theme")),
    routeData?.theme
  );
}

/** The theme's `themeStyle`, or `null` for a theme without `colors`. */
export function useThemeStyle(): ThemeStyle | null {
  const value = useThemeValue();
  return useMemo(() => {
    const colors = themeByName(value).colors;
    return colors ? themeStyle(colors) : null;
  }, [value]);
}

/** The page tint for `<html>`, inside the signed-in app only. */
export function useThemeContent(
  mode: "light" | "dark"
): Record<string, string> | undefined {
  const style = useThemeStyle();
  const { pathname } = useLocation();
  return style && isAppPath(pathname) ? style.content[mode] : undefined;
}

const ShellThemeStyle = createContext<ThemeStyle | null>(null);

/**
 * The shell passes its `useThemeStyle()` down, so the rail and the module
 * sidebar paint without each subscribing to every fetcher.
 */
export const ThemeStyleProvider = ShellThemeStyle.Provider;

/** The shell's theme style, or `null` outside a `ThemeStyleProvider`. */
export function useShellThemeStyle() {
  return useContext(ShellThemeStyle);
}
