// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useWindowDimensions } from "react-native";

/**
 * The one place the app's two shapes are decided.
 *
 * 1024pt is web MES's own breakpoint for moving the controls into a right-hand
 * column (`--controls-width`), and it is what separates the two devices this
 * app has to be: a tablet clamped to a machine, where there is room beside the
 * work, and a phone in a hand, where there is not.
 *
 * `isSplit` additionally requires LANDSCAPE. An iPad in portrait is 834pt wide
 * — a phone by the width test, correctly, because a list and a full operation
 * screen side by side in 834pt gives neither enough room. Rotating the device
 * switches the layout live, which is why this reads dimensions rather than a
 * device class.
 */
export const TABLET_MIN_WIDTH = 1024;

export function useLayout() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const isTablet = width >= TABLET_MIN_WIDTH;
  return {
    width,
    height,
    isLandscape,
    isTablet,
    /** Render the list and the operation side by side. */
    isSplit: isTablet && isLandscape
  };
}
