/**
 * Minimal isomorphic env reader for the logging package only.
 *
 * `@carbon/logger` deliberately does NOT depend on `@carbon/env`: that module
 * throws at load time when a required var is missing, which would make the
 * logger un-importable in bare contexts (tests, scripts, edge). Logging must be
 * a true leaf. We read the two non-secret vars we need directly.
 */
type EnvName = "LOG_LEVEL" | "NODE_ENV";

export function readEnv(name: EnvName): string | undefined {
  if (typeof document !== "undefined") {
    return (globalThis as { window?: { env?: Record<string, string> } }).window
      ?.env?.[name];
  }
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}
