import { configureSync, getConsoleSink } from "@logtape/logtape";
import { type CarbonLogLevel, resolveLevel } from "./levels";
import { CARBON_ROOT_CATEGORY } from "./logger";

const CONFIGURED = Symbol.for("carbon.logging.configured");

export type ConfigureClientLoggingOptions = {
  /** Override the env-derived level. */
  level?: CarbonLogLevel;
};

/**
 * Configure LogTape in the browser once. Uses the default console sink so
 * devtools formats objects natively. No ANSI formatter and no implicit context
 * (browsers have no AsyncLocalStorage) — those live in `config.server`.
 */
export function ensureLoggingConfigured(
  options: ConfigureClientLoggingOptions = {}
): void {
  const g = globalThis as Record<PropertyKey, unknown>;
  if (g[CONFIGURED]) return;

  configureSync({
    reset: true,
    sinks: { console: getConsoleSink() },
    loggers: [
      {
        category: [CARBON_ROOT_CATEGORY],
        lowestLevel: options.level ?? resolveLevel("browser"),
        sinks: ["console"]
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
