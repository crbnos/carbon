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
  configured = true;

  // Dual-runtime: this module is imported by the scheduling engine, which runs
  // BOTH in the Deno edge runtime and in-process in Node (@carbon/ee/planning,
  // the ERP/MES apps, @carbon/jobs).
  //
  // ONLY the edge runtime may configure LogTape. In Node the host app already
  // owns it (`@carbon/logger`'s config.server / config.client, called from each
  // app's entry.server/entry.client), and `configureSync({ reset: true })` here
  // would REPLACE that config: the HTTP access sink disappears and the
  // contextLocalStorage goes with it, so `withContext` in requestIdMiddleware
  // warns on every request and requestId stops reaching any log line. The two
  // guards can't see each other — @carbon/logger keys off a globalThis symbol,
  // this file off a module-local flag — so last writer wins, silently.
  //
  // This second configuration exists at all because Deno cannot import
  // @carbon/logger: it is an npm workspace package, and the edge runtime only
  // mounts supabase/functions. Under Node we simply inherit the app's config;
  // `getLogger` below works either way.
  const denoEnv = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
    .Deno?.env;
  if (!denoEnv) return;

  const raw = denoEnv.get("LOG_LEVEL")?.toLowerCase().trim();
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
}

/** Logger for an edge function → category `["carbon","edge",fnName]`. */
export function getFunctionLogger(fnName: string): Logger {
  ensureConfigured();
  return getLogger(["carbon", "edge", fnName]);
}
