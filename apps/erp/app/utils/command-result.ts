import type { z } from "zod";
import { ruleError } from "~/utils/supabase";

/**
 * Result shape for a COMMAND: a multi-step action whose body used to live in a
 * route action and is now shared by that route and the MCP/API tool surface.
 *
 * `flash` is the route's toast text, unchanged from when the route owned the
 * logic. `message` is what an API/MCP caller reads: the same text, plus the
 * reason when the cause is an application refusal (a plain `Error`, e.g. "Asset
 * is no longer in Draft status"). Database errors are never spelled out there,
 * matching the dispatch's policy of reducing them to fixed public messages.
 * `cause` is the original error, which the route passes to `error()` so it is
 * still logged.
 */
export type CommandError = {
  message: string;
  flash: string;
  cause?: unknown;
};

export type CommandResult<T> =
  | { data: T; error: null }
  | { data: null; error: CommandError };

/** The reason worth showing an API caller: a plain `Error` the app threw on
 *  purpose. Database/driver errors carry a `code` and stay hidden. */
function refusalReason(cause: unknown): string | null {
  if (!(cause instanceof Error) || "code" in cause) return null;
  return cause.message.length > 0 ? cause.message : null;
}

export function commandError(
  flash: string,
  cause?: unknown
): { data: null; error: CommandError } {
  const reason = refusalReason(cause);
  return {
    data: null,
    error: {
      message: reason && reason !== flash ? `${flash}: ${reason}` : flash,
      flash,
      cause
    }
  };
}

export function commandOk<T>(data: T): { data: T; error: null } {
  return { data, error: null };
}

/**
 * A command's (or engine's) result as a tool returns it: the error becomes a
 * service rule error (`ruleError`), so the MCP/API caller reads `message`
 * instead of the generic database-failure text, and nothing else on the error
 * (`cause`, `flash`) crosses the API boundary.
 */
export function toToolResult<T>(
  result: { data: T; error: null } | { data: null; error: { message: string } }
) {
  if (result.error) {
    return { data: null, error: ruleError(result.error.message) };
  }
  return { data: result.data, error: null };
}

/** A tool's own input check failing, as a rule error naming each field. The
 *  routes validate with the same validators through `validator().validate`. */
export function validationFailure(error: z.ZodError) {
  const message = error.issues
    .map((issue) =>
      issue.path.length > 0
        ? `${issue.path.join(".")}: ${issue.message}`
        : issue.message
    )
    .join("; ");
  return { data: null, error: ruleError(message) };
}
