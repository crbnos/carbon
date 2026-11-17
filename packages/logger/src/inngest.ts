// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger, type Logger } from "./logger";

/**
 * Inngest's `Logger` interface: `{ info, warn, error, debug }`, each
 * `(...args: unknown[]) => void`. Passed to `new Inngest({ logger })` so every
 * job's `ctx.logger` flows into LogTape under `["carbon","jobs"]`.
 */
export type InngestLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
};

function isProperties(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * A job's `ctx.logger` takes the call `getLogger` takes — a message template
 * and its properties, an `Error` standing for `{ error }` (after the message,
 * or alone) — so a line reads the same whichever logger wrote it, and error
 * spans group it by its template.
 * Inngest's own lines are not templates: any other call, and a lone string
 * holding a brace, is logged as a value.
 */
function emit(logger: Logger, level: "debug" | "info" | "warning" | "error") {
  return (...args: unknown[]): void => {
    const [message, properties] = args;
    if (message instanceof Error && args.length === 1) {
      logger[level]("Job error", { error: message });
      return;
    }
    if (typeof message === "string" && args.length <= 2) {
      if (properties instanceof Error) {
        logger[level](message, { error: properties });
        return;
      }
      if (isProperties(properties)) {
        logger[level](message, properties);
        return;
      }
      if (properties === undefined && !message.includes("{")) {
        logger[level](message);
        return;
      }
    }
    logger[level]("{message}", { message, args: args.slice(1) });
  };
}

export function createInngestLogger(): InngestLogger {
  const logger = getLogger("jobs");
  return {
    debug: emit(logger, "debug"),
    info: emit(logger, "info"),
    warn: emit(logger, "warning"),
    error: emit(logger, "error")
  };
}
