import type { Logger } from "@logtape/logtape";
import { getLogger } from "./logger";

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

function emit(logger: Logger, level: "debug" | "info" | "warning" | "error") {
  return (...args: unknown[]): void => {
    const [first, ...rest] = args;
    if (typeof first === "string") {
      // `first` is a *value*, so arbitrary `{...}` in it is never interpreted
      // as a LogTape placeholder.
      logger[level]("{message}", {
        message: first,
        ...(rest.length ? { args: rest } : {})
      });
    } else {
      logger[level]("{*}", { args });
    }
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
