import { create } from "zustand";

interface DocumentStore {
  /**
   * Live title of the currently-open full-screen document editor (quality
   * document, procedure). The editor streams the locked title block here so the
   * header title bar updates immediately, before the loader revalidates. The
   * persisted value is still `name` — this is a display-only mirror. Reset to
   * `null` when the editor unmounts so a stale title never leaks to the header.
   */
  liveTitle: string | null;
  setLiveTitle: (title: string | null) => void;
}

export const useDocumentStore = create<DocumentStore>()((set) => ({
  liveTitle: null,
  setLiveTitle: (liveTitle) => set({ liveTitle })
}));
