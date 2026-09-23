import { inspect } from "node:util";
import {
  ansiColorFormatter,
  type LogRecord,
  type TextFormatter
} from "@logtape/logtape";

// Stamped on every record inside a request (`requestIdMiddleware`). It is for
// correlating prod JSON lines; repeating it on every dev line is noise.
const AMBIENT_KEYS = new Set(["requestId"]);

/** Top-level property names a message template renders itself, or null for `{*}` (all of them). */
function referencedKeys(raw: LogRecord["rawMessage"]): Set<string> | null {
  // A tagged-template message carries its values positionally, not as properties.
  if (typeof raw !== "string") return new Set();
  const keys = new Set<string>();
  // `{key}` is a placeholder; `{{` / `}}` are escaped literal braces.
  for (const [, key = ""] of raw.matchAll(/(?<!\{)\{([^{}]+)\}(?!\})/g)) {
    const name = key.trim();
    if (name === "*") return null;
    keys.add(name.split(/[.[]/)[0] ?? name);
  }
  return keys;
}

/**
 * LogTape's `ansiColorFormatter` prints only the message template, so any
 * property the message doesn't name — `log.error("Failed to finalize quote",
 * { error })` — never reached the dev terminal, stack and all. This prints the
 * same line and appends those properties. Prod JSON lines already carry them.
 */
export const devFormatter: TextFormatter = (record) => {
  const line = ansiColorFormatter(record);
  const referenced = referencedKeys(record.rawMessage);
  if (referenced === null) return line;

  const extra = Object.fromEntries(
    Object.entries(record.properties).filter(
      ([key]) => !referenced.has(key) && !AMBIENT_KEYS.has(key)
    )
  );
  if (Object.keys(extra).length === 0) return line;

  return `${line.trimEnd()} ${inspect(extra, { colors: true, depth: 5 })}\n`;
};
