// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The briefing entries a Claude session has already been shown. */
function seenPath(dir: string, sessionId: string): string {
  return join(dir, `carbon-brief-${sessionId.replace(/[^\w-]/g, "_")}.json`);
}

export function loadSeen(dir: string, sessionId: string): Set<string> {
  const path = seenPath(dir, sessionId);
  if (!existsSync(path)) return new Set();
  try {
    const ids = JSON.parse(readFileSync(path, "utf8"));
    return new Set(Array.isArray(ids) ? ids.map(String) : []);
  } catch {
    return new Set();
  }
}

export function saveSeen(
  dir: string,
  sessionId: string,
  seen: Set<string>
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(seenPath(dir, sessionId), JSON.stringify([...seen].sort()));
}
