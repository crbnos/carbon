// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Range } from "@tiptap/core";
import { create } from "zustand";

// The slash-command query and the range it replaces. One store for the page:
// the command list renders through a tunnel, outside the editor's subtree.
export const useCommandStore = create<{ query: string; range: Range | null }>()(
  () => ({ query: "", range: null })
);

export const setCommandQuery = (query: string) =>
  useCommandStore.setState({ query });
export const setCommandRange = (range: Range | null) =>
  useCommandStore.setState({ range });
