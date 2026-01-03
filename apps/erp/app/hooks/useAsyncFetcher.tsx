import { noop } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import type { Fetcher } from "react-router";
import { useFetcher } from "react-router";

type FetcherOptions = {
  key?: string;
  onStateChange?: (state: Fetcher["state"]) => Promise<void> | void;
};

export function useAsyncFetcher<TData>(options?: FetcherOptions) {
  const onStateChange = options?.onStateChange || noop;

  const fetcher = useFetcher<TData>({
    key: options?.key
  });

  const instance = useRef<PromiseWithResolvers<TData>>();

  if (!instance.current) {
    instance.current = Promise.withResolvers<TData>();
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const submit = useCallback(
    (...args: Parameters<typeof fetcher.submit>) => {
      fetcher.submit(...args);
      return instance.current!.promise;
    },
    [fetcher, instance]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const load = useCallback(
    (...args: Parameters<typeof fetcher.load>) => {
      fetcher.load(...args);
      return instance.current!.promise;
    },
    [fetcher, instance]
  );

  useEffect(() => {
    onStateChange(fetcher.state);
    if (fetcher.state === "idle") {
      if (fetcher.data) {
        instance.current?.resolve(fetcher.data as TData);
        instance.current = Promise.withResolvers<TData>();
      }
    }
  }, [fetcher.state, fetcher.data, onStateChange]);

  return {
    ...fetcher,
    data: fetcher.data as TData,
    submit,
    load
  };
}
