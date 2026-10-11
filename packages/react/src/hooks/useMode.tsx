// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Mode, ModePreference } from "@carbon/utils";
import {
  COLOR_SCHEME_HINT_COOKIE,
  COLOR_SCHEME_HINT_MAX_AGE,
  modeValidator,
  PREFERS_DARK_QUERY
} from "@carbon/utils";
import { useCallback, useSyncExternalStore } from "react";
import { useFetchers } from "react-router";
import { useRouteData } from "./useRouteData";

type RootModeData = { mode?: Mode; modePreference?: ModePreference };

export function useOptimisticMode() {
  const fetchers = useFetchers();
  // The root action also takes a theme color; only a mode submission counts.
  const modeFetcher = fetchers.find(
    (f) => f.formAction === "/" && f.formData?.has("mode")
  );

  if (modeFetcher && modeFetcher.formData) {
    const mode = { mode: modeFetcher.formData.get("mode") };
    const submission = modeValidator.safeParse(mode);

    if (submission.success) {
      return submission.data.mode;
    }
  }
}

/** The operating system's mode. Browser only. */
export function getSystemMode(): Mode {
  return window.matchMedia(PREFERS_DARK_QUERY).matches ? "dark" : "light";
}

/** Records the OS mode so the next server render of a `system` user matches. */
function writeColorSchemeHint(mode: Mode) {
  document.cookie = `${COLOR_SCHEME_HINT_COOKIE}=${mode}; Max-Age=${COLOR_SCHEME_HINT_MAX_AGE}; SameSite=Lax; Path=/`;
}

function subscribeToSystemMode(onChange: () => void) {
  const query = window.matchMedia(PREFERS_DARK_QUERY);
  const handler = () => {
    writeColorSchemeHint(getSystemMode());
    // Theme-color previews write one mode's variables onto <body>; drop them,
    // as a manual mode change does, so they don't outlive the mode.
    document.body.removeAttribute("style");
    onChange();
  };
  query.addEventListener("change", handler);
  return () => query.removeEventListener("change", handler);
}

/** The OS mode, live. The server snapshot is the root loader's resolved mode. */
function useSystemMode(serverMode: Mode): Mode {
  const getServerSnapshot = useCallback(() => serverMode, [serverMode]);
  return useSyncExternalStore(
    subscribeToSystemMode,
    getSystemMode,
    getServerSnapshot
  );
}

/** What the user chose: `light`, `dark`, or `system`. */
export function useModePreference(): ModePreference {
  const optimisticMode = useOptimisticMode();
  const routeData = useRouteData<RootModeData>("/");

  return (
    optimisticMode ?? routeData?.modePreference ?? routeData?.mode ?? "light"
  );
}

/** The mode being rendered: `system` resolved against the OS. */
export function useMode(): Mode {
  const preference = useModePreference();
  const routeData = useRouteData<RootModeData>("/");
  const systemMode = useSystemMode(routeData?.mode ?? "light");

  return preference === "system" ? systemMode : preference;
}
