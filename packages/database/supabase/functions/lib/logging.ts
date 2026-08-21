import {
  configureSync,
  getConsoleSink,
  getJsonLinesFormatter,
  getLogger,
  type Logger,
} from "@logtape/logtape";
import { redactByField } from "@logtape/redaction";

/**
 * Deno-native twin of `@carbon/logger` for Supabase edge functions.
 *
 * Edge functions run on Deno and cannot import the workspace package, so this
 * mirrors its config: LogTape configured on first use, always JSON Lines (edge
 * logs go to the Supabase log drain), field-redacted, level from `LOG_LEVEL`.
 * Keep this in sync with `packages/logger/src/config.server.ts`.
 */
const LOG_LEVELS = [
  "trace",
  "debug",
  "info",
  "warning",
  "error",
  "fatal",
] as const;
type Level = (typeof LOG_LEVELS)[number];

let configured = false;

function ensureConfigured(): void {
  if (configured) return;

  // Dual-runtime: this module is imported by the scheduling engine, which now
  // runs BOTH in the Deno edge runtime and in-process in Node (the app/jobs no
  // longer round-trip to the `schedule` edge function). `Deno` is undefined in
  // Node, so read the level from whichever env is present (mirrors the
  // `typeof Deno` guard in postgres/index.ts).
  const denoEnv = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
    .Deno?.env;
  const rawLevel = denoEnv
    ? denoEnv.get("LOG_LEVEL")
    : (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env?.LOG_LEVEL;
  const raw = rawLevel?.toLowerCase().trim();
  const level: Level =
    raw && (LOG_LEVELS as readonly string[]).includes(raw)
      ? (raw as Level)
      : "info";

  configureSync({
    reset: true,
    sinks: {
      console: redactByField(
        getConsoleSink({ formatter: getJsonLinesFormatter() })
      ),
    },
    loggers: [
      { category: ["carbon"], lowestLevel: level, sinks: ["console"] },
      { category: ["logtape", "meta"], lowestLevel: "warning", sinks: ["console"] },
    ],
  });

  configured = true;
}

/** Logger for an edge function → category `["carbon","edge",fnName]`. */
export function getFunctionLogger(fnName: string): Logger {
  ensureConfigured();
  return getLogger(["carbon", "edge", fnName]);
}
