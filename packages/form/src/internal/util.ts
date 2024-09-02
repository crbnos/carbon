import type React from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import * as R from "remeda";

export const omit = (obj: any, ...keys: string[]) => {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result;
};

export const mergeRefs = <T = any>(
  refs: Array<React.MutableRefObject<T> | React.LegacyRef<T> | undefined>
): React.RefCallback<T> => {
  return (value: T) => {
    refs.filter(Boolean).forEach((ref) => {
      if (typeof ref === "function") {
        ref(value);
      } else if (ref != null) {
        (ref as React.MutableRefObject<T | null>).current = value;
      }
    });
  };
};

export const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export const useDeepEqualsMemo = <T>(item: T): T => {
  const ref = useRef<T>(item);
  const areEqual = ref.current === item || R.equals(ref.current, item);
  useEffect(() => {
    if (!areEqual) {
      ref.current = item;
    }
  });
  return areEqual ? ref.current : item;
};
