// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLayout } from "./useLayout";

/**
 * Whether this is a tablet, by width alone.
 *
 * Kept as its own hook because that is the question `HeroButton` and
 * `ActionDock` actually ask — they size and place a control, which depends on
 * having room beside the content, not on the orientation. `useLayout().isSplit`
 * is the stricter test, for deciding whether two panes fit at all.
 */
export function useIsTablet() {
  return useLayout().isTablet;
}

export { TABLET_MIN_WIDTH } from "./useLayout";
