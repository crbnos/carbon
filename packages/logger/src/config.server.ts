import { AsyncLocalStorage } from "node:async_hooks";
import {
  ansiColorFormatter,
  configureSync,
  getConsoleSink,
  getJsonLinesFormatter
} from "@logtape/logtape";
import { redactByField } from "@logtape/redaction";
import { readEnv } from "./env";
import { httpDevFormatter } from "./http-formatter";
import { type CarbonLogLevel, resolveLevel } from "./levels";
import { CARBON_ROOT_CATEGORY } from "./logger";

const CONFIGURED = Symbol.for("carbon.logging.configured");

export type ConfigureLoggingOptions = {
  /** Override the env-derived level. */
  level?: CarbonLogLevel;
  /** ANSI colored terminal output. Defaults to `NODE_ENV !== "production"`. */
  pretty?: boolean;
};

/**
 * Configure LogTape for a Node server once per process.
 *
 * - dev  → `ansiColorFormatter` (colored terminal)
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

  const formatter = pretty ? ansiColorFormatter : getJsonLinesFormatter();
  const consoleSink = getConsoleSink({ formatter });
  // Redact sensitive field names (password, token, secret, …) before records
  // reach the sink. Cheap: matches field names, not values.
  const sink = pretty ? consoleSink : redactByField(consoleSink);

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
    loggers: [
      {
        category: [CARBON_ROOT_CATEGORY],
        lowestLevel: level,
        sinks: ["console"]
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
