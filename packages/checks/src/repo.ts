// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Repo } from "./check";
import { repoRoot } from "./sources/migrations";

/** The repository at `root`, with each input read at most once. */
export function openRepo(root: string = repoRoot()): Repo {
  const loaded = new Map<(root: string) => unknown, unknown>();
  return {
    root,
    read<T>(load: (root: string) => T): T {
      if (!loaded.has(load)) loaded.set(load, load(root));
      // The map holds, for each loader, exactly what that loader returned.
      return loaded.get(load) as T;
    }
  };
}
