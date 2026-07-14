import { getAnsiColorFormatter, type TextFormatter } from "@logtape/logtape";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

/** Morgan "dev"-style status color: red 5xx, yellow 4xx, cyan 3xx, green 2xx. */
function statusColor(status: number): string {
  if (status >= 500) return "\x1b[31m";
  if (status >= 400) return "\x1b[33m";
  if (status >= 300) return "\x1b[36m";
  if (status >= 200) return "\x1b[32m";
  return RESET;
}

/** Per-level color for the `LEVEL` field. */
const LEVEL_COLOR: Record<string, string> = {
  trace: "\x1b[90m",
  debug: "\x1b[36m",
  info: "\x1b[32m",
  warning: "\x1b[33m",
  error: "\x1b[31m",
  fatal: "\x1b[35m"
};

/** Per-method color: read green, create yellow, replace blue, patch cyan, delete red. */
const METHOD_COLOR: Record<string, string> = {
  GET: "\x1b[32m",
  HEAD: "\x1b[32m",
  POST: "\x1b[33m",
  PUT: "\x1b[34m",
  PATCH: "\x1b[36m",
  DELETE: "\x1b[31m",
  OPTIONS: "\x1b[35m"
};

/** Time-only `HH:MM:SS.mmm` from an epoch-ms timestamp (no date). */
function clockTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(
    d.getSeconds()
  )}.${pad(d.getMilliseconds(), 3)}`;
}

const PID = typeof process !== "undefined" ? process.pid : 0;

/**
 * Dev formatter for the `carbon.http` category. Renders a pino-style prefix —
 * `[HH:MM:SS.mmm] LEVEL (pid): [module] …` (time only, no date) — then the
 * message. For access-log records (set by `requestIdMiddleware`) the message
 * is a Morgan "dev"-style `METHOD /path?query STATUS 12.3 ms` line, status
 * colored by range, with any captured (already-redacted) request body appended
 * dimmed underneath. Any other `carbon.http` record falls back to its rendered
 * message.
 */
export const httpDevFormatter: TextFormatter = getAnsiColorFormatter({
  format({ message, record }) {
    const { method, pathname, search, status, responseTime, body } =
      record.properties;

    let line = message;
    if (
      typeof method === "string" &&
      typeof pathname === "string" &&
      typeof status === "number"
    ) {
      const query = typeof search === "string" ? search : "";
      // Truncate (not round) to at most 1 decimal — no padded trailing zero.
      const time =
        typeof responseTime === "number"
          ? ` ${DIM}${Math.trunc(responseTime * 10) / 10} ms${RESET}`
          : "";
      const methodColor = METHOD_COLOR[method] ?? RESET;
      line = `${BOLD}${methodColor}${method}${RESET} ${statusColor(status)}${status}${RESET} ${pathname}${query}${time}`;
      // The Morgan line only renders method/path/status/time, so a captured
      // request body (debug only, already redacted) would otherwise be dropped
      // — append it dimmed on its own line.
      if (body !== undefined) {
        const rendered = typeof body === "string" ? body : JSON.stringify(body);
        line += `\n  ${DIM}body ${rendered}${RESET}`;
      }
    }

    const clock = clockTime(record.timestamp);
    const levelColor = LEVEL_COLOR[record.level] ?? RESET;
    const label = record.level.toUpperCase();
    // Drop the shared `carbon` root so the module reads `[http]`, `[erp.sales]`.
    const segments =
      record.category[0] === "carbon"
        ? record.category.slice(1)
        : record.category;
    const module = segments.join(".");

    return `${DIM}[${clock}]${RESET} ${levelColor}${label}${RESET} ${DIM}(${PID})${RESET}: ${DIM}[${module}]${RESET} ${line}`;
  }
});
