// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useStore } from "@nanostores/react";
import type { WritableAtom } from "nanostores";
import { useCallback } from "react";

export function useNanoStore<T>(atom: WritableAtom<T>, idbKey?: string) {
  const value = useStore(atom);

  const set = useCallback(
    (value: T | ((current: T) => T), initial = false) => {
      if (typeof value === "function") {
        atom.set((value as (current: T) => T)(atom.get()));
      } else {
        atom.set(value);
      }
    },
    [atom]
  );

  return [value, set] as const;
}
