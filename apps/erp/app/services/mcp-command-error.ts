// Pure helper shared by the `{module}.mcp.server.ts` wrappers; no server
// imports, so it is testable on its own.

/** A command's failure as the `{ data, error }` a tool returns. */
export function commandError(
  message: string,
  cause: unknown
): { message: string } {
  const detail =
    cause && typeof cause === "object" && "message" in cause
      ? String((cause as { message: unknown }).message)
      : typeof cause === "string"
        ? cause
        : null;
  return {
    message: detail && detail !== message ? `${message}: ${detail}` : message
  };
}
