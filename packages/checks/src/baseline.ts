import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Violation } from "./check";

export type BaselineKey = string;

// Resolve from this source file (packages/checks/src/baseline.ts), not cwd, so
// the baseline is found regardless of where the process is invoked from.
const BASELINE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "conformance/baseline.json"
);

export function keyOf(checkId: string, v: Violation): BaselineKey {
  return `${checkId}::${v.file}::${v.snippet}`;
}

/** Pure parse so it is unit-testable without disk. */
export function parseBaseline(json: string | undefined): Set<BaselineKey> {
  if (!json) return new Set();
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? new Set(arr as BaselineKey[]) : new Set();
  } catch {
    return new Set();
  }
}

export function loadBaseline(path = BASELINE_PATH): Set<BaselineKey> {
  try {
    return parseBaseline(readFileSync(path, "utf8"));
  } catch {
    return new Set();
  }
}

export function writeBaseline(keys: BaselineKey[], path = BASELINE_PATH): void {
  writeFileSync(path, `${JSON.stringify([...keys].sort(), null, 2)}\n`);
}
