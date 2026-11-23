// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { FailureReason } from "./error-reason";

/** A refused save, as `respond` (`@carbon/api`) returns it to the form that posted. */
export type FormError = { message: string; reason: FailureReason | null };

/** The `formError` of an action's data, if it carries one. */
export function readFormError(data: unknown): FormError | null {
  if (!data || typeof data !== "object" || !("formError" in data)) return null;
  const formError = (data as { formError: unknown }).formError;
  if (!formError || typeof formError !== "object") return null;
  const { message, reason } = formError as Partial<FormError>;
  return typeof message === "string"
    ? { message, reason: reason ?? null }
    : null;
}
