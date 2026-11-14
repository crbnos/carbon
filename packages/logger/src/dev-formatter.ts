// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { inspect } from "node:util";
import {
  ansiColorFormatter,
  type LogRecord,
  type TextFormatter
} from "@logtape/logtape";
import { getLogContext, type LogContext } from "./context.server";

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
  try {
    const referenced = referencedKeys(record.rawMessage);
    if (referenced === null) return line;

    // The request's own ids are on every line of it: useful in prod JSON, noise
    // here. A record's own value (a job's companyId) still shows.
    const ambient: LogContext = getLogContext() ?? {};
    const extra = Object.fromEntries(
      Object.entries(record.properties ?? {}).filter(
        ([key, value]) => !referenced.has(key) && ambient[key] !== value
      )
    );
    if (Object.keys(extra).length === 0) return line;

    return `${line.trimEnd()} ${inspect(extra, { colors: true, depth: 5 })}\n`;
  } catch {
    // Appending details must never cost the log line itself.
    return line;
  }
};
