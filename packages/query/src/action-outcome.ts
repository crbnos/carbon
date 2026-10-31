// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type FailureReason, isFailureReason } from "@carbon/utils";

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

/**
 * The error of a service function's result (`{ data, error }`), as the
 * action returns it: `{ category, message, status }`.
 */
export function serviceErrorMessage(data: unknown): string | null {
  if (data == null || typeof data !== "object") return null;
  const { error } = data as { error?: unknown };
  if (error == null || typeof error !== "object" || !("category" in error)) {
    return null;
  }
  const { message } = error as { message?: unknown };
  return typeof message === "string" ? message : null;
}

/**
 * What to show for a service function's error: its `title` (the operation's
 * own message when the error carries a `reason`), else its `message`.
 */
export function serviceError(
  data: unknown
): { title: string; reason?: FailureReason } | null {
  const message = serviceErrorMessage(data);
  if (message === null) return null;
  const { title, reason } = (data as { error: Record<string, unknown> }).error;
  return {
    title: typeof title === "string" && title !== "" ? title : message,
    ...(isFailureReason(reason) && { reason })
  };
}
