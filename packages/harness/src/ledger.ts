import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export type LedgerEntry = {
  iteration: number;
  change: string;
  gates: Record<string, boolean>;
  /**
   * `keep` = task-approved commit on the branch. `checkpoint` = committed and
   * pushed (work preserved) but the task isn't approved yet — a later attempt
   * fixes forward on top of it. `revert` = removed from the branch (attempts
   * are still preserved on a rescue branch before any reset).
   */
  decision: "keep" | "revert" | "checkpoint";
  reason: string;
  /** The plan task this iteration worked on, as "k/N: title". */
  task?: string;
  /** Proof gaps this iteration — behavior gate could not verify either way. */
  unverified?: string[];
  /** Product questions the judge raised (disputed acceptance criteria). */
  questions?: string[];
  /** Interpretation calls the doer made instead of asking a human. */
  assumptions?: string[];
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
