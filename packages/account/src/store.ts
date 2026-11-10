// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { create } from "zustand";
import type { AccountSettingsTab } from "./models";

type AccountSettingsStore = {
  /** The open pane; null while the modal is closed. */
  tab: AccountSettingsTab | null;
  open: (tab?: AccountSettingsTab) => void;
  close: () => void;
};

/** Opens the account settings modal from anywhere in an app that mounts it. */
export const useAccountSettings = create<AccountSettingsStore>()((set) => ({
  tab: null,
  open: (tab = "profile") => set({ tab }),
  close: () => set({ tab: null })
}));
