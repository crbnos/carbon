import { create } from "zustand";

// Mirrors stores/ui.ts (the search-modal store) — zustand, the store idiom used here.
interface AgentStore {
  isOpen: boolean;
  threadId: string | null;
  openAgent: () => void;
  closeAgent: () => void;
  toggleAgent: () => void;
  setThread: (threadId: string | null) => void;
}

export const useAgentStore = create<AgentStore>()((set) => ({
  isOpen: false,
  threadId: null,
  openAgent: () => set({ isOpen: true }),
  closeAgent: () => set({ isOpen: false }),
  toggleAgent: () => set((state) => ({ isOpen: !state.isOpen })),
  setThread: (threadId) => set({ threadId })
}));
