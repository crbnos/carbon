// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { errorDescription, toast } from "@carbon/react";
import { serviceError } from "./action-outcome";

function show(error: {
  title: string;
  reason?: Parameters<typeof errorDescription>[1];
}) {
  toast.error(error.title, {
    description: errorDescription(error.title, error.reason)
  });
}

/** `useAction`'s default: only a service function's error, so a flash never toasts twice. */
export function toastServiceFailure(data: unknown): void {
  const error = serviceError(data);
  if (error) show(error);
}

/**
 * The error toast for an action's result, from a custom `onError`: a service
 * function's title with why it failed as the second line, or the `message`
 * of any other `{ error }` the action returned.
 */
export function toastServiceError(data: unknown): void {
  const error = serviceError(data) ?? otherError(data);
  if (error) show(error);
}

function otherError(data: unknown): { title: string } | null {
  const error = (data as { error?: unknown } | null | undefined)?.error;
  if (typeof error === "string" && error !== "") return { title: error };
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" && message !== ""
    ? { title: message }
    : null;
}
