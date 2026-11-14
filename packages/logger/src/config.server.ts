// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  configureSync,
  getConsoleSink,
  getJsonLinesFormatter,
  type Sink
} from "@logtape/logtape";
import { redactByField } from "@logtape/redaction";
import { SpanStatusCode } from "@opentelemetry/api";
import { isAbandonedRead, withRequestLogContext } from "./context.server";
import { devFormatter } from "./dev-formatter";
import { readEnv } from "./env";
import { httpDevFormatter } from "./http-formatter";
import { type CarbonLogLevel, resolveLevel } from "./levels";
import {
  ACCESS_LOG_CATEGORY,
  CARBON_ROOT_CATEGORY,
  getLogger,
  META_LOGGER
} from "./logger";
import { maskRedactedField, REDACT_FIELD_PATTERNS } from "./redaction";
import { tracer } from "./span";

const CONFIGURED = Symbol.for("carbon.logging.configured");
// Its own flag: a test that resets CONFIGURED to reconfigure must not stack listeners.
const PROCESS_HANDLERS = Symbol.for("carbon.logging.process-handlers");

/**
 * A cancelled call: the AbortError itself, or what supabase-js makes of it — a
 * database error whose message starts `AbortError:`, a storage error holding
 * it as `originalError` — possibly under a result's `error`.
 */
function isAbortError(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 2) return false;
  const { name, message, error, originalError, cause } = value as Record<
    string,
    unknown
  >;
  return (
    name === "AbortError" ||
    (typeof message === "string" && message.startsWith("AbortError")) ||
    isAbortError(error, depth + 1) ||
    isAbortError(originalError, depth + 1) ||
    isAbortError(cause, depth + 1)
  );
}

export type ConfigureLoggingOptions = {
  /** Override the env-derived level. */
  level?: CarbonLogLevel;
  /** ANSI colored terminal output. Defaults to `NODE_ENV !== "production"`. */
  pretty?: boolean;
};

/**
 * Every error-level log also becomes a span in the trace of the request that
 * logged it, so the trace store can count and alert on them. Console logs stay
 * on the host; without this an error the app handled (a refusal it turned into
 * a flash message, a failed background step) was visible nowhere searchable.
 * Only the message template is recorded (`"Failed to post {document}"`), never
 * the values in it or the record's properties, so one message groups as one
 * error whatever it was about. That holds only while messages name their
 * values as placeholders: the `no-interpolated-error-log` check enforces it.
 */
const errorSpans: Sink = (record) => {
  if (record.level !== "error" && record.level !== "fatal") return;
  const message = (
    typeof record.rawMessage === "string"
      ? record.rawMessage
      : record.rawMessage.join("{}")
  ).slice(0, 300);
  const span = tracer().startSpan(`log ${record.level}`, {
    attributes: {
      "log.category": record.category.join("."),
      "log.message": message
    }
  });
  span.setStatus({ code: SpanStatusCode.ERROR, message });
  span.end();
};

/**
 * Configure LogTape for a Node server once per process, and log the process's
 * unhandled rejections and uncaught exceptions (the second exits).
 *
 * - dev  → `devFormatter` (colored terminal)
 * - prod → `getJsonLinesFormatter()` (JSONL, no ANSI), field-redacted
 *
 * Idempotent: a `globalThis` flag survives Vite SSR module re-evaluation, and
 * `reset: true` means a re-eval race reconfigures instead of throwing.
 */
export function ensureLoggingConfigured(
  options: ConfigureLoggingOptions = {}
): void {
  const g = globalThis as Record<PropertyKey, unknown>;
  if (g[CONFIGURED]) return;

  const isProd = readEnv("NODE_ENV") === "production";
  const level = options.level ?? resolveLevel("server");
  const pretty = options.pretty ?? !isProd;

  const formatter = pretty ? devFormatter : getJsonLinesFormatter();
  const consoleSink = withRequestLogContext(getConsoleSink({ formatter }));
  // Redact sensitive field names (password, token, secret, …) before records
  // reach the sink. Cheap: matches field names, not values. Masks rather than
  // deletes, and skips email/phone/address — see ./redaction.ts.
  const sink = pretty
    ? consoleSink
    : redactByField(consoleSink, {
        fieldPatterns: REDACT_FIELD_PATTERNS,
        action: maskRedactedField
      });

  // The access log is a Morgan "dev"-style line in dev, ordinary JSONL in prod.
  const httpSink = pretty
    ? withRequestLogContext(getConsoleSink({ formatter: httpDevFormatter }))
    : sink;

  configureSync({
    reset: true,
    sinks: { console: sink, httpConsole: httpSink, errorSpans },
    filters: {
      // Once the client of a read has gone, its database reads are cancelled
      // and each comes back as an AbortError. Those are not failures, the same
      // stance `handleServerError` takes on an aborted read. Anything else logged
      // after the client left (a write that failed) still gets through.
      liveRequest: (record) =>
        !(
          isAbandonedRead() &&
          Object.values(record.properties).some((value) => isAbortError(value))
        )
    },
    loggers: [
      {
        category: [CARBON_ROOT_CATEGORY],
        lowestLevel: level,
        sinks: ["console", "errorSpans"],
        filters: ["liveRequest"]
      },
      {
        category: [CARBON_ROOT_CATEGORY, ACCESS_LOG_CATEGORY],
        lowestLevel: level,
        sinks: ["httpConsole"],
        // Don't also emit through the root "console" sink — one line per request.
        parentSinks: "override"
      },
      META_LOGGER
    ]
  });

  g[CONFIGURED] = true;

  if (g[PROCESS_HANDLERS]) return;
  g[PROCESS_HANDLERS] = true;
  const log = getLogger("logger", "server");
  process.on("unhandledRejection", (reason) => {
    log.error("Unhandled promise rejection", { error: reason });
  });
  // The process state is unknown after an uncaught exception: exit and let the
  // supervisor start a clean one. A stray rejection is usually recoverable.
  process.on("uncaughtException", (error) => {
    log.error("Uncaught exception", { error });
    process.exit(1);
  });
}
