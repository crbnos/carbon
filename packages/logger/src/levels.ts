import { readEnv } from "./env";

/** LogTape severity levels, lowest → highest. */
export const LOG_LEVELS = [
  "trace",
  "debug",
  "info",
  "warning",
  "error",
  "fatal"
] as const;

export type CarbonLogLevel = (typeof LOG_LEVELS)[number];

function isLogLevel(value: string): value is CarbonLogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/**
 * Parse a raw `LOG_LEVEL` value. Never throws — an unknown value falls back and
 * warns. The warning uses `console.warn` because this runs before LogTape is
 * configured, so it is the only channel available.
 */
export function parseLogLevel(
  value: string | undefined | null,
  fallback: CarbonLogLevel
): CarbonLogLevel {
  const normalized = value?.toLowerCase().trim();
  if (normalized && isLogLevel(normalized)) return normalized;
  if (value) {
    // biome-ignore lint/suspicious/noConsole: pre-configure, only safe channel
    console.warn(
      `[@carbon/logger] invalid LOG_LEVEL "${value}", using "${fallback}"`
    );
  }
  return fallback;
}

/**
 * Resolve the effective level for a runtime from `LOG_LEVEL`, with a sensible
 * default derived from `NODE_ENV`. Browser production is quieter (`warning`)
 * since client logs reach the user's devtools.
 */
export function resolveLevel(runtime: "server" | "browser"): CarbonLogLevel {
  const isProd = readEnv("NODE_ENV") === "production";
  const fallback: CarbonLogLevel =
    runtime === "browser"
      ? isProd
        ? "warning"
        : "debug"
      : isProd
        ? "info"
        : "debug";
  return parseLogLevel(readEnv("LOG_LEVEL"), fallback);
}
