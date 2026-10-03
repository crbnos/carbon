// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Stack } from "expo-router";

/**
 * This tab is a STACK, not a single screen.
 *
 * Without a layout here Expo Router treats every file in the directory as its
 * own entry in the parent Tabs navigator — so `index` and the detail route each
 * became a tab of their own, the bar grew to seven items, and every label was
 * truncated to "Oper…". The layout collapses them into one tab whose detail
 * screen pushes on top of its list.
 */
export default function PickingTabLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
