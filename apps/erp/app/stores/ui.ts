// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { create } from "zustand";

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
  suggestionPrefill: SuggestionPrefill | null;
  requestSuggestion: (prefill: SuggestionPrefill) => void;
  clearSuggestionRequest: () => void;
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
  suggestionPrefill: null,
  requestSuggestion: (prefill) => set({ suggestionPrefill: prefill }),
  clearSuggestionRequest: () => set({ suggestionPrefill: null })
}));
