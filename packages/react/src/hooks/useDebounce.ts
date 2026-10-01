// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect, useRef } from "react";

/**
 * A function that you call with a debounce delay, the function will only be called after the delay has passed
 *
 * @param fn The function to debounce
 * @param delay In ms
 * @param executeOnUnmount Whether to execute the pending function when component unmounts
 */
export default function useDebounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
  executeOnUnmount: boolean = false
) {
  const timeout = useRef<ReturnType<typeof setTimeout>>();
  const argsRef = useRef<Parameters<T>>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    return () => {
      if (executeOnUnmount && timeout.current && argsRef.current) {
        clearTimeout(timeout.current);
        fn(...argsRef.current);
      } else if (timeout.current) {
        clearTimeout(timeout.current);
      }
    };
  }, [executeOnUnmount]);

  return (...args: Parameters<T>) => {
    if (timeout.current) {
      clearTimeout(timeout.current);
    }

    argsRef.current = args;
    timeout.current = setTimeout(() => {
      fn(...args);
    }, delay);
  };
}
