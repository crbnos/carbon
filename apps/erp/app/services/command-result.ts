// The result shape of a route command: one UI action (a status transition, a
// write plus its follow-ups) that the route and its `{module}.mcp.server.ts`
// wrapper both call. Pure, so commands in any module can share it.
//
// A command never throws for an expected failure. It returns the route's own
// failure text in `error.message` and the underlying error in `cause`, so the
// route keeps flashing the same message and the MCP wrapper can surface both
// (`commandError` in `~/services/mcp-command-error`).

export type CommandResult<T> =
  | { data: T; error: null }
  | { data: T | null; error: { message: string }; cause: unknown };

export function commandFailed<T>(
  message: string,
  cause: unknown = null,
  data: T | null = null
): CommandResult<T> {
  return { data, error: { message }, cause };
}

export function commandOk<T>(data: T): CommandResult<T> {
  return { data, error: null };
}
