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

  useEffect(() => {
    return () => {
      if (executeOnUnmount && timeout.current && argsRef.current) {
        clearTimeout(timeout.current);
        fn(...argsRef.current);
      } else if (timeout.current) {
        clearTimeout(timeout.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
