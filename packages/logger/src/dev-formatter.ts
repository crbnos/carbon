import { inspect } from "node:util";
import {
  ansiColorFormatter,
  type LogRecord,
  type TextFormatter
} from "@logtape/logtape";

// On every in-request record; useful in prod JSON, noise on each dev line.
const AMBIENT_KEYS = new Set(["requestId"]);

// Returns null for `{*}`, which already renders every property.
function referencedKeys(raw: LogRecord["rawMessage"]): Set<string> | null {
  if (typeof raw !== "string") return new Set();
  const keys = new Set<string>();
  // `{{` / `}}` are escaped braces, not placeholders.
  for (const [, key = ""] of raw.matchAll(/(?<!\{)\{([^{}]+)\}(?!\})/g)) {
    const name = key.trim();
    if (name === "*") return null;
    keys.add(name.split(/[.[]/)[0] ?? name);
  }
  return keys;
}

// `ansiColorFormatter` drops properties the message doesn't reference (e.g. `{ error }`).
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
