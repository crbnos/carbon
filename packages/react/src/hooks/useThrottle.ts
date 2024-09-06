import { useRef } from "react";

/**
 * A function that you call with a throttle delay, the function will be called at most once per delay
 *
 * @param fn The function to throttle
 * @param delay In ms
 */
export default function useThrottle<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
) {
  const timeout = useRef<ReturnType<typeof setTimeout>>();
  const lastArgs = useRef<Parameters<T>>();

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
