// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { halloweenTheme } from "@carbon/utils";
import { useSyncExternalStore } from "react";
import { useFetchers } from "react-router";
import { useRouteData } from "../hooks/useRouteData";

// The one check every Halloween decoration sits behind: the root loader's
// theme is Halloween. While it is in season the theme is forced for everyone
// (`forced` on `halloweenTheme`); out of season the server renders the
// stored or default theme instead (`resolveTheme`), so everything switches
// itself off on time and nothing is rendered, styled or listened to.

// Hydration never reverses, so there is nothing to listen to.
function subscribe() {
  return () => {
    // Nothing to unsubscribe.
  };
}

/**
 * Whether the Halloween decorations are on. False on the server: they
 * measure the page and listen to the document, so they mount after hydration.
 */
export function useHalloween() {
  const root = useRouteData<{ theme?: string }>("/");
  // A theme being saved from the Appearance pane counts at once.
  const pending = useFetchers()
    .find((fetcher) => fetcher.formData?.has("theme"))
    ?.formData?.get("theme");
  const theme = typeof pending === "string" ? pending : root?.theme;
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
  return hydrated && theme === halloweenTheme.name;
}
