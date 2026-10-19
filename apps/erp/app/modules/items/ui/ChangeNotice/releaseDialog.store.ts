// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { create } from "zustand";

// Cross-subtree open-state for the Change Notice release dialog. The header
// "Release" button and the rail's Release section live in separate React
// subtrees under the $id route, so neither can pass the other a callback; both
// toggle this store instead. The dialog itself is rendered once (in the rail).
export const useReleaseDialogOpen = create<boolean>()(() => false);
export const setReleaseDialogOpen = (open: boolean) =>
  useReleaseDialogOpen.setState(open, true);
