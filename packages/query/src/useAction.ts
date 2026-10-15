// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toast } from "@carbon/react";
import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { actionOutcome, serviceErrorMessage } from "./action-outcome";

export { actionOutcome, serviceErrorMessage };

type ActionData<T> = NonNullable<ReturnType<typeof useFetcher<T>>["data"]>;
/** What `onSuccess` / `onError` can receive: never a 422 with field errors,
 *  which the form shows itself. */
type ActionResult<T> = Exclude<ActionData<T>, { fieldErrors: unknown }>;

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
 * Without `onError`, a service function's error is shown as a toast. Other
 * error shapes are left to the action's own flash.
 *
 * The cache needs nothing from the caller: the root middleware marks every
 * loader entry stale after the action.
 */
// biome-ignore lint/suspicious/noExplicitAny: an untyped fetcher's data is `any`, as with useFetcher
export function useAction<T = any>(
  options: {
    key?: string;
    onSuccess?: (data: ActionResult<T>) => void;
    onError?: (data: ActionResult<T>) => void;
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
      callbacks.current.onSuccess?.(data as ActionResult<T>);
    } else if (outcome === "error") {
      if (callbacks.current.onError) {
        callbacks.current.onError(data as ActionResult<T>);
      } else {
        const message = serviceErrorMessage(data);
        if (message) toast.error(message);
      }
    }
  }, [state, data]);

  return Object.assign(fetcher, {
    /** A submission is in flight (submitting, or reloading after it). */
    isPending: state !== "idle",
    /** The values being submitted, for showing them before the server answers. */
    pending: fetcher.formData
  });
}
