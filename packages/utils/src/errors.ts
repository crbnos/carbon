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
