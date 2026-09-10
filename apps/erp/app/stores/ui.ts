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
  /** True while the current route renders a module content sub-nav. Lets the
   * mobile Topbar show a "Sections" trigger only where one exists. */
  hasContentSidebar: boolean;
  setHasContentSidebar: (has: boolean) => void;
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
  hasContentSidebar: false,
  setHasContentSidebar: (has) => set({ hasContentSidebar: has }),
  suggestionPrefill: null,
  requestSuggestion: (prefill) => set({ suggestionPrefill: prefill }),
  clearSuggestionRequest: () => set({ suggestionPrefill: null })
}));
