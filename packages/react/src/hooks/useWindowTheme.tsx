// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { WindowThemeStyle } from "@carbon/utils";
import {
  asWindowTheme,
  isAppPath,
  parseWindowTheme,
  WINDOW_THEME_FIELD,
  windowThemeStyle
} from "@carbon/utils";
import { useMemo, useSyncExternalStore } from "react";
import { useFetchers, useLocation } from "react-router";
import { useRouteData } from "./useRouteData";

// A value shown before it is saved: a color drag paints every pointer move
// here and saves once at the end, since each save revalidates every loader.
// `undefined` is no preview.
let preview: string | undefined;
const previewListeners = new Set<() => void>();

/**
 * Shows a window theme value at once without saving it; `undefined` ends the
 * preview. The caller saves it (a `windowTheme` post to `/`) and then ends it.
 */
export function setWindowThemePreview(value: string | undefined) {
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

/**
 * The stored window theme value (a preset name or a `custom:` value), or
 * `null` for the default. A preview wins, then a pending pick, so the frame
 * changes before the root loader revalidates with the cookie.
 */
export function useWindowThemeValue(): string | null {
  const previewed = useSyncExternalStore(
    subscribePreview,
    () => preview,
    () => undefined
  );
  const fetchers = useFetchers();
  const routeData = useRouteData<{ windowTheme?: string | null }>("/");
  if (previewed !== undefined) return asWindowTheme(previewed);
  const pending = fetchers.find(
    (f) => f.formAction === "/" && f.formData?.has(WINDOW_THEME_FIELD)
  );
  if (pending) {
    return asWindowTheme(pending.formData?.get(WINDOW_THEME_FIELD));
  }
  return asWindowTheme(routeData?.windowTheme);
}

/**
 * The styles of the window theme to render: `frame` for the shell's
 * `SidebarProvider`, `rail` for the desktop `NavRail`. `null` is the default
 * frame, which renders exactly as it did before window themes.
 */
export function useWindowTheme(): WindowThemeStyle | null {
  const value = useWindowThemeValue();
  return useMemo(() => {
    const theme = parseWindowTheme(value);
    return theme ? windowThemeStyle(theme) : null;
  }, [value]);
}

/**
 * The content variables of the window theme for a mode, for `<html>`: the
 * page, cards, popovers and dialogs take the frame's hue. Only inside the
 * signed-in app (`isAppPath`): sign-in, shared links and onboarding keep the
 * plain theme. `undefined` for the default.
 */
export function useWindowThemeContent(
  mode: "light" | "dark"
): Record<string, string> | undefined {
  const style = useWindowTheme();
  const { pathname } = useLocation();
  return style && isAppPath(pathname) ? style.content[mode] : undefined;
}
