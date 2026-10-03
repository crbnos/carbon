// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { router } from "expo-router";

/**
 * Back, or the board when there is nothing to go back to.
 *
 * The inspection and assembly screens are usually reached by a REPLACE: a card
 * opens the operation screen, the server answers that the operation belongs on
 * another view, and the operation screen swaps itself for that view so Back
 * does not land on a screen that would only redirect again. Done from inside
 * the tabs, that replace takes the tabs' own place in the parent stack — so
 * there is no history left, and a plain `router.back()` was an unhandled
 * `GO_BACK` that left the operator on the screen with a dead Back button.
 *
 * Reached by a push instead (a scanned traveller, a deep link), the history is
 * there and Back behaves as Back.
 */
export function backOrBoard() {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace("/(app)/(tabs)/operations");
}
