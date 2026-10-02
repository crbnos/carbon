// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useWindowDimensions } from "react-native";

/**
 * The one place the tablet/phone split is decided.
 *
 * 1024pt is web MES's own breakpoint for moving the controls into a right-hand
 * column (`--controls-width`), and it is what separates the two shapes this app
 * has to be: a tablet clamped to a machine, where the dock lives beside the
 * work, and a phone in a pocket, where it is a bottom bar under the thumb. An
 * iPad in portrait (834pt) is a phone by this test, which is correct — there is
 * no room for a column next to the content.
 */
export const TABLET_MIN_WIDTH = 1024;

export function useIsTablet() {
  const { width } = useWindowDimensions();
  return width >= TABLET_MIN_WIDTH;
}
