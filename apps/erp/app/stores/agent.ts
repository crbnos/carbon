import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage
} from "zustand/middleware";

// No-op storage for SSR (the server has no sessionStorage). persist is effectively
// inert until AgentRoot calls rehydrate() on the client, where the real store is used.
const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined
};

// Mirrors stores/ui.ts (the search-modal store) — zustand, the store idiom used here.
interface AgentStore {
  isOpen: boolean;
  threadId: string | null;
  openAgent: () => void;
  closeAgent: () => void;
  toggleAgent: () => void;
  setThread: (threadId: string | null) => void;
}

export const useAgentStore = create<AgentStore>()(
  persist(
    (set) => ({
      isOpen: false,
      threadId: null,
      openAgent: () => set({ isOpen: true }),
      closeAgent: () => set({ isOpen: false }),
      toggleAgent: () => set((state) => ({ isOpen: !state.isOpen })),
      setThread: (threadId) => set({ threadId })
    }),
    {
      name: "carbon-agent",
      // Per-TAB session (sessionStorage, not localStorage): on reload we reopen the
      // panel to the last thread, but a brand-new tab/browser session starts clean.
      // `setThread(null)` (the "New chat" button) forgets the thread, so the next
      // open is blank — the agent resumes the last chat until the user starts a new one.
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? noopStorage : window.sessionStorage
      ),
      partialize: (s) => ({ isOpen: s.isOpen, threadId: s.threadId }),
      // Defer hydration to a client effect (AgentRoot) — the server has no
      // sessionStorage, so rehydrating at store init would desync SSR/first render.
      skipHydration: true
    }
  )
);
