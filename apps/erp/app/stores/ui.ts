// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { create } from "zustand";
import type { SubmoduleLayout } from "~/utils/submodule-visibility";

export type SuggestionPrefill = {
  suggestion: string;
  anonymous: boolean;
  sendToCarbon: boolean;
};

interface UIStore {
  isSearchModalOpen: boolean;
  openSearchModal: () => void;
  closeSearchModal: () => void;
  toggleSearchModal: () => void;
  isSidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  isRailOpen: boolean;
  setRailOpen: (open: boolean) => void;
  suggestionPrefill: SuggestionPrefill | null;
  requestSuggestion: (prefill: SuggestionPrefill) => void;
  clearSuggestionRequest: () => void;
  // The unsaved sub-module layout while Customize is open, otherwise null.
  draftSubmoduleLayout: SubmoduleLayout | null;
  setDraftSubmoduleLayout: (layout: SubmoduleLayout | null) => void;
}

export const useUIStore = create<UIStore>()((set) => ({
  isSearchModalOpen: false,
  openSearchModal: () => set({ isSearchModalOpen: true }),
  closeSearchModal: () => set({ isSearchModalOpen: false }),
  toggleSearchModal: () =>
    set((state) => ({ isSearchModalOpen: !state.isSearchModalOpen })),
  isSidebarOpen: true,
  setSidebarOpen: (open) => set({ isSidebarOpen: open }),
  toggleSidebar: () =>
    set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  isRailOpen: false,
  setRailOpen: (open) => set({ isRailOpen: open }),
  suggestionPrefill: null,
  requestSuggestion: (prefill) => set({ suggestionPrefill: prefill }),
  clearSuggestionRequest: () => set({ suggestionPrefill: null }),
  draftSubmoduleLayout: null,
  setDraftSubmoduleLayout: (layout) => set({ draftSubmoduleLayout: layout })
}));
