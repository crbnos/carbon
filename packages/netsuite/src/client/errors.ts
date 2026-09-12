/**
 * One error type for every NetSuite failure, so a caller can branch on WHY a
 * migration stopped without string-matching a message.
 *
 * `retryable` is decided here, once, rather than at each call site — the
 * transport's backoff loop and the job's error reporting must never disagree
 * about whether a failure was transient.
 */
export type NetSuiteErrorKind =
  | "auth" // 401/403 — bad credentials, missing role permission, disabled feature
  | "rate-limit" // 429 / SSS_REQUEST_LIMIT_EXCEEDED — concurrency governance
  | "not-found" // 404 — record type or record absent (often: feature not enabled)
  | "invalid-request" // 400 — our query or payload is wrong
  | "server" // 5xx — NetSuite side
  | "network" // fetch threw, timeout, DNS
  | "unknown";

export class NetSuiteError extends Error {
  readonly kind: NetSuiteErrorKind;
  readonly status: number | undefined;
  readonly detail: string | undefined;
  /** NetSuite's own `o:errorCode`, e.g. `SSS_REQUEST_LIMIT_EXCEEDED`. */
  readonly code: string | undefined;
  /** Correlation id from the `X-NetSuite-Operation-Id` response header. */
  readonly operationId: string | undefined;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      kind: NetSuiteErrorKind;
      status?: number;
      detail?: string;
      code?: string;
      operationId?: string;
      cause?: unknown;
    }
  ) {
    super(message, { cause: options.cause });
    this.name = "NetSuiteError";
    this.kind = options.kind;
    this.status = options.status;
    this.detail = options.detail;
    this.code = options.code;
    this.operationId = options.operationId;
    this.retryable =
      options.kind === "rate-limit" ||
      options.kind === "server" ||
      options.kind === "network";
  }
}

export function kindForStatus(status: number): NetSuiteErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate-limit";
  if (status === 404) return "not-found";
  if (status >= 500) return "server";
  if (status >= 400) return "invalid-request";
  return "unknown";
}

/**
 * NetSuite answers errors with RFC 7807 problem+json whose `o:errorDetails[]`
 * carries the actual cause; the top-level `title` is usually a generic
 * "Invalid Request". Pull both so the UI can show something actionable.
 */
export function parseErrorBody(body: unknown): {
  detail?: string;
  code?: string;
} {
  if (!body || typeof body !== "object") return {};
  const record = body as Record<string, unknown>;

  const details = record["o:errorDetails"];
  if (Array.isArray(details) && details.length > 0) {
    const first = details[0] as Record<string, unknown> | undefined;
    return {
      detail:
        typeof first?.detail === "string"
          ? first.detail
          : typeof record.detail === "string"
            ? record.detail
            : undefined,
      code:
        typeof first?.["o:errorCode"] === "string"
          ? first["o:errorCode"]
          : undefined
    };
  }

  return {
    detail: typeof record.detail === "string" ? record.detail : undefined,
    code:
      typeof record["o:errorCode"] === "string"
        ? record["o:errorCode"]
        : undefined
  };
}
