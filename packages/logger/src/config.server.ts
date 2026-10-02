// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { AsyncLocalStorage } from "node:async_hooks";
import {
  configureSync,
  getConsoleSink,
  getJsonLinesFormatter
} from "@logtape/logtape";
import { redactByField } from "@logtape/redaction";
import { isAbandonedRead } from "./context.server";
import { devFormatter } from "./dev-formatter";
import { readEnv } from "./env";
import { httpDevFormatter } from "./http-formatter";
import { type CarbonLogLevel, resolveLevel } from "./levels";
import { CARBON_ROOT_CATEGORY } from "./logger";
import { maskRedactedField, REDACT_FIELD_PATTERNS } from "./redaction";

const CONFIGURED = Symbol.for("carbon.logging.configured");

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
 * Configure LogTape for a Node server once per process.
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
  const consoleSink = getConsoleSink({ formatter });
  // Redact sensitive field names (password, token, secret, …) before records
  // reach the sink. Cheap: matches field names, not values. Masks rather than
  // deletes, and skips email/phone/address — see ./redaction.ts.
  const sink = pretty
    ? consoleSink
    : redactByField(consoleSink, {
        fieldPatterns: REDACT_FIELD_PATTERNS,
        action: maskRedactedField
      });

  // HTTP access logs (`requestIdMiddleware`) get their own sink: a Morgan
  // "dev"-style colored line in dev, the same structured+redacted sink as
  // everything else in prod (still JSONL — no separate treatment needed there).
  const httpSink = pretty
    ? getConsoleSink({ formatter: httpDevFormatter })
    : sink;

  configureSync({
    reset: true,
    contextLocalStorage: new AsyncLocalStorage(),
    sinks: { console: sink, httpConsole: httpSink },
    filters: {
      // Once the client of a read has gone, its database reads are cancelled
      // and each comes back as an AbortError. Those are not failures, the same
      // stance `handleError` takes on an aborted request. Anything else logged
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
        sinks: ["console"],
        filters: ["liveRequest"]
      },
      {
        category: [CARBON_ROOT_CATEGORY, "http"],
        lowestLevel: level,
        sinks: ["httpConsole"],
        // Don't also emit through the root "console" sink — one line per request.
        parentSinks: "override"
      },
      {
        category: ["logtape", "meta"],
        lowestLevel: "warning",
        sinks: ["console"]
      }
    ]
  });

  g[CONFIGURED] = true;
}
