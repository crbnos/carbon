// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";

/** How a finished action turned out, from the shape route actions return. */
export function actionOutcome(data: unknown): "success" | "error" | null {
  if (data == null) return null;
  if (typeof data === "object") {
    const result = data as {
      success?: unknown;
      error?: unknown;
      fieldErrors?: unknown;
    };
    // `validationError`: the form shows the field errors itself.
    if (result.fieldErrors) return null;
    if (result.success === false || result.error) return "error";
  }
  return "success";
}

type ActionData<T> = NonNullable<ReturnType<typeof useFetcher<T>>["data"]>;

/**
 * A fetcher for a mutation, with the result delivered to a callback instead of
 * an effect that watches `fetcher.data`. The mutation is still a router action:
 * submit it with `.submit(...)` or `<action.Form>`, exactly as with `useFetcher`.
 *
 * `onSettled` runs once each time a submission finishes, with or without data:
 * an action that redirects (most deletes) returns none. `onSuccess` /
 * `onError` run only when there is data. `onError` is for a result with
 * `success: false` or an `error`; everything else is a success. A 422 with
 * field errors (`validationError`) is neither: the form shows them itself.
 *
 * The cache needs nothing from the caller: the root middleware marks every
 * loader entry stale after the action.
 */
// biome-ignore lint/suspicious/noExplicitAny: an untyped fetcher's data is `any`, as with useFetcher
export function useAction<T = any>(
  options: {
    key?: string;
    onSuccess?: (data: ActionData<T>) => void;
    onError?: (data: ActionData<T>) => void;
    /** Runs whenever a submission finishes, before `onSuccess` / `onError`. */
    onSettled?: (data: ActionData<T> | undefined) => void;
  } = {}
) {
  const fetcher = useFetcher<T>(options.key ? { key: options.key } : undefined);
  // The latest callbacks, so a new closure each render re-runs nothing.
  const callbacks = useRef(options);
  callbacks.current = options;
  const submitted = useRef(false);

  const { state, data } = fetcher;
  useEffect(() => {
    if (state !== "idle") {
      submitted.current = true;
      return;
    }
    if (!submitted.current) return;
    submitted.current = false;
    const outcome = actionOutcome(data);
    callbacks.current.onSettled?.((data ?? undefined) as ActionData<T>);
    if (outcome === "success") {
      callbacks.current.onSuccess?.(data as ActionData<T>);
    } else if (outcome === "error") {
      callbacks.current.onError?.(data as ActionData<T>);
    }
  }, [state, data]);

  return Object.assign(fetcher, {
    /** A submission is in flight (submitting, or reloading after it). */
    isPending: state !== "idle",
    /** The values being submitted, for showing them before the server answers. */
    pending: fetcher.formData
  });
}
