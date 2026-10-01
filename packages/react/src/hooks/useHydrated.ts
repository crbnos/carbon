// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useState } from "react";
import useMount from "./useMount";

let hydrating = true;

/**
 * Return a boolean indicating if the JS has been hydrated already.
 * When doing Server-Side Rendering, the result will always be false.
 * When doing Client-Side Rendering, the result will always be false on the
 * first render and true from then on. Even if a new component renders it will
 * always start with true.
 *
 * Example: Disable a button that needs JS to work.
 * ```tsx
 * const hydrated = useHydrated();
 * return (
 *   <button type="button" isDisabled={!hydrated} onClick={doSomethingCustom}>
 *     Click me
 *   </button>
 * );
 * ```
 */
export default function useHydrated() {
  let [hydrated, setHydrated] = useState(() => !hydrating);

  useMount(() => {
    hydrating = false;
    setHydrated(true);
  });

  return hydrated;
}
