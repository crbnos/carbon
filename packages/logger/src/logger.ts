// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  configureSync,
  getConfig,
  getConsoleSink,
  getLogger as getLogTapeLogger,
  type LoggerConfig,
  type Logger as LogTapeLogger
} from "@logtape/logtape";
import { resolveLevel } from "./levels";

/** Root category — every Carbon log sits under this prefix. */
export const CARBON_ROOT_CATEGORY = "carbon";

/** The access log's category, under the root. */
export const ACCESS_LOG_CATEGORY = "http";

/** LogTape's own warnings (a sink that threw, a bad configuration). */
export const META_LOGGER: LoggerConfig<"console", never> = {
  category: ["logtape", "meta"],
  lowestLevel: "warning",
  sinks: ["console"]
};

/** A LogTape logger with one name per level: `warning`, never the `warn` alias. */
export type Logger = Omit<LogTapeLogger, "warn">;

/**
 * Until an app configures logging, records go to a plain console sink instead
 * of being dropped. A script, a seed or a test then logs like the app does,
 * and a record written while a module loads is kept. The app's
 * `ensureLoggingConfigured` replaces this configuration.
 */
function configureFallback(): void {
  configureSync({
    sinks: { console: getConsoleSink() },
    loggers: [
      {
        category: [CARBON_ROOT_CATEGORY],
        lowestLevel: resolveLevel(
          typeof document === "undefined" ? "server" : "browser"
        ),
        sinks: ["console"]
      },
      META_LOGGER
    ]
  });
}

/**
 * Get a logger scoped to a Carbon category.
 *
 * @example
 * getLogger("auth")          // ["carbon","auth"]
 * getLogger("erp", "sales")  // ["carbon","erp","sales"]
 * getLogger("jobs", fnName)  // ["carbon","jobs",fnName]
 */
export function getLogger(...category: string[]): Logger {
  if (getConfig() === null) configureFallback();
  return getLogTapeLogger([CARBON_ROOT_CATEGORY, ...category]);
}
