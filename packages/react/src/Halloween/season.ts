// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { halloweenTheme } from "@carbon/utils";
import { useSyncExternalStore } from "react";
import { useFetchers } from "react-router";
import { useRouteData } from "../hooks/useRouteData";

// The one check every Halloween decoration sits behind: the user picked the
// Halloween theme in Account settings → Appearance. Nobody else gets anything
// rendered, styled or listened to. Out of season the server renders the
// default theme instead (`resolveTheme`), so it switches itself off on time.

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
