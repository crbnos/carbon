// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Return a boolean indicating if the JS has been hydrated already.
 * When doing Server-Side Rendering, the result will always be false.
 * While a component hydrates, the result is false; it is true from then on.
 * A component that mounts after hydration starts with true.
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
  // The server snapshot is what React reads while it hydrates THIS component,
  // whenever that happens. A page hydrates in pieces (each Suspense boundary on
  // its own), so a flag flipped by the first mount is already true when a later
  // piece hydrates: it then renders its client-only content against the
  // server's fallback, and React discards the server-rendered page.
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}
