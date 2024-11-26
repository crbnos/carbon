import { useEffect, useRef } from "react";

/**
 * A function that you call with a throttle delay, the function will be called at most once per delay
 *
 * @param fn The function to throttle
 * @param delay In ms
 * @param executeOnUnmount Whether to execute the pending function when component unmounts
 */
export default function useThrottle<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
  executeOnUnmount: boolean = false
) {
  const timeout = useRef<ReturnType<typeof setTimeout>>();
  const lastArgs = useRef<Parameters<T>>();

  useEffect(() => {
    return () => {
      if (executeOnUnmount && timeout.current && lastArgs.current) {
        clearTimeout(timeout.current);
        fn(...lastArgs.current);
      } else if (timeout.current) {
        clearTimeout(timeout.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executeOnUnmount]);

  return (...args: Parameters<T>) => {
    lastArgs.current = args;

    if (timeout.current) {
      return;
    }

    timeout.current = setTimeout(() => {
      if (lastArgs.current) {
        fn(...lastArgs.current);
      }
      timeout.current = undefined;
    }, delay);
  };
}
