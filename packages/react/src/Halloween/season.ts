// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { halloweenTheme } from "@carbon/utils";
import useHydrated from "../hooks/useHydrated";
import { useRouteData } from "../hooks/useRouteData";

// The one check every Halloween decoration sits behind: the root loader's
// theme is Halloween. That is the case inside the app in season (`available`
// on `halloweenTheme`, applied by `themeForRequest`) for everyone who has not
// picked another theme, and for no one on any other day, so everything
// switches on and off by itself, and the rest of the year nothing is
// rendered, styled or listened to.

/**
 * Whether the Halloween decorations are on. False on the server: they
 * measure the page and listen to the document, so they mount after hydration.
 */
export function useHalloween() {
  const root = useRouteData<{ theme?: string }>("/");
  const hydrated = useHydrated();
  return hydrated && root?.theme === halloweenTheme.name;
}
