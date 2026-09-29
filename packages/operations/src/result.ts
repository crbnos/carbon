import { getLogger } from "@carbon/logger";

const logger = getLogger("operations");

/**
 * What a caller may show the user. `message` is empty when the failure came
 * from the data layer: raw text such as `duplicate key value violates unique
 * constraint "receiptLine_pkey"` must never reach a toast, so the caller's own
 * fallback copy wins (`getEdgeFunctionErrorMessage(error, fallback)` already
 * reads `.message` and falls back when it is empty). `body` carries structured
 * extras some callers read, e.g. `invalidLineIds`.
 */
export class OperationError extends Error {
  constructor(
    message: string,
    readonly status = 500,
    readonly body: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export type OperationResult<T> =
  | { data: T; error: null }
  | { data: null; error: OperationError };

/**
 * True when `err` came from the data layer rather than from our own `throw`.
 * Structural only: it never reads message text, so an authored message that
 * mentions a table or a constraint is still shown.
 */
export function isDataLayerError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  // supabase-js PostgrestError: exactly these documented keys.
  if (
    typeof e.code === "string" &&
    "details" in e &&
    "hint" in e &&
    "message" in e
  ) {
    return true;
  }
  // node-postgres DatabaseError (SQLSTATE plus protocol fields), thrown by Kysely.
  if (typeof e.code === "string" && typeof e.severity === "string") return true;
  // ZodError: `.message` is a JSON dump of `issues`, never user-facing.
  if (e.name === "ZodError" && Array.isArray(e.issues)) return true;
  return false;
}

/**
 * A payload that fails validation is the caller's input contract, not a data
 * leak, so its issues are summarised (`path: message; …`) instead of dropped.
 */
function zodIssueSummary(err: unknown): string | null {
  const e = err as { name?: unknown; issues?: unknown };
  if (e?.name !== "ZodError" || !Array.isArray(e.issues)) return null;
  const issues = e.issues as Array<{ path?: unknown[]; message?: unknown }>;
  const parts = issues.slice(0, 5).map((issue) => {
    const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
    const message =
      typeof issue.message === "string" ? issue.message : "invalid";
    return path ? `${path}: ${message}` : message;
  });
  if (parts.length === 0) return null;
  const more = issues.length - parts.length;
  return `Invalid payload — ${parts.join("; ")}${more > 0 ? `; +${more} more` : ""}`;
}

/** The failure a caller receives for a thrown value: logged in full, surfaced sanitized. */
export function toOperationError(
  operation: string,
  err: unknown
): OperationError {
  logger.error(`${operation} failed`, { error: err });

  const errStatus = (err as { status?: unknown } | null)?.status;
  const status =
    typeof errStatus === "number" &&
    Number.isInteger(errStatus) &&
    errStatus >= 400 &&
    errStatus <= 599
      ? errStatus
      : 500;
  const body =
    err instanceof OperationError ? err.body : ({} as Record<string, unknown>);

  const raw =
    typeof err === "string"
      ? err
      : (err as { message?: unknown } | null)?.message;
  const message =
    typeof raw === "string" && raw !== "" && !isDataLayerError(err)
      ? raw
      : (zodIssueSummary(err) ?? "");

  return new OperationError(message, status, body);
}

/** Runs an operation body and turns a throw into `{ data: null, error }`. */
export async function runOperation<T>(
  operation: string,
  body: () => Promise<T>
): Promise<OperationResult<T>> {
  try {
    return { data: await body(), error: null };
  } catch (err) {
    return { data: null, error: toOperationError(operation, err) };
  }
}
