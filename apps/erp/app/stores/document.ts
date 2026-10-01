// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
