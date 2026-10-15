// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
