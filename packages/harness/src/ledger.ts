import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export type LedgerEntry = {
  iteration: number;
  change: string;
  gates: Record<string, boolean>;
  decision: "keep" | "revert";
  reason: string;
  /** ISO timestamp, supplied by the caller (the harness has no clock). */
  at: string;
};

export function appendLedger(path: string, entry: LedgerEntry): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

export function readLedger(path: string): LedgerEntry[] {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as LedgerEntry);
  } catch {
    return [];
  }
}
