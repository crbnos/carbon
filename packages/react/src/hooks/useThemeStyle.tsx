// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ThemeStyle } from "@carbon/utils";
import { isAppPath, isThemeName, themeByName, themeStyle } from "@carbon/utils";
import { useMemo, useSyncExternalStore } from "react";
import { useFetchers, useLocation } from "react-router";
import { useRouteData } from "./useRouteData";

// A value shown before it is saved: a color drag paints every pointer move
// here and saves once at the end, since each save re-runs the root loader.
// `undefined` is no preview.
let preview: string | undefined;
const previewListeners = new Set<() => void>();

/**
 * Shows a theme value at once without saving it; `undefined` ends the
 * preview. The caller saves it (a `theme` post to `/`) and then ends it.
 */
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

/**
 * The theme to render, by name. A preview wins, then a pending pick (any
 * fetcher posting a valid `theme`: the Appearance pane posts to `/`, the ERP's
 * avatar menu to its theme route), then the root loader's resolved theme. So
 * a pick shows before the loader revalidates with the cookie. A `theme` field
 * that is not a theme name (a document template's JSON) is ignored.
 */
export function useThemeValue(): string {
  const previewed = useSyncExternalStore(
    subscribePreview,
    () => preview,
    () => undefined
  );
  const fetchers = useFetchers();
  const routeData = useRouteData<{ theme?: string }>("/");
  if (previewed !== undefined && isThemeName(previewed)) return previewed;
  for (const fetcher of fetchers) {
    const pending = fetcher.formData?.get("theme");
    if (typeof pending === "string" && isThemeName(pending)) return pending;
  }
  return themeByName(routeData?.theme).name;
}

/**
 * The styles of the theme to render: `frame` for the shell's
 * `SidebarProvider`, `rail` for the desktop `NavRail`, `content` for `<html>`,
 * `panel` for the module sidebar. `null` for a theme with no `colors` (a
 * color theme), which renders the frame plain.
 */
export function useThemeStyle(): ThemeStyle | null {
  const value = useThemeValue();
  return useMemo(() => {
    const colors = themeByName(value).colors;
    return colors ? themeStyle(colors) : null;
  }, [value]);
}

/**
 * The content variables of the theme for a mode, for `<html>`: the
 * page, cards, popovers and dialogs take the frame's hue. Only inside the
 * signed-in app (`isAppPath`): sign-in, shared links and onboarding keep the
 * plain theme. `undefined` for the default.
 */
export function useThemeContent(
  mode: "light" | "dark"
): Record<string, string> | undefined {
  const style = useThemeStyle();
  const { pathname } = useLocation();
  return style && isAppPath(pathname) ? style.content[mode] : undefined;
}
