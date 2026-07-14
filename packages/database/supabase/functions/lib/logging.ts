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

  const raw = Deno.env.get("LOG_LEVEL")?.toLowerCase().trim();
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
