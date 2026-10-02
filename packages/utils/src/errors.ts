// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The message to show for a failed call: the error's own message when it has
 * one, else `fallback`. Server functions leave `message` empty for data-layer
 * failures precisely so the caller's copy wins.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  const message =
    typeof error === "string"
      ? error
      : (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" && message !== "" ? message : fallback;
}
