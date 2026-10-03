// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendLedger, type LedgerEntry, readLedger } from "./ledger";

const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  iteration: 1,
  change: "centered the button",
  gates: { lint: true, conformance: true },
  decision: "keep",
  reason: "all floor gates green",
  at: "2026-06-25T00:00:00Z",
  ...over
});

describe("ledger", () => {
  it("appends entries and reads them back in order", () => {
    const path = join(mkdtempSync(join(tmpdir(), "led-")), "ledger.jsonl");
    appendLedger(path, entry({ iteration: 1 }));
    appendLedger(path, entry({ iteration: 2, decision: "revert" }));
    const all = readLedger(path);
    expect(all.map((e) => e.iteration)).toEqual([1, 2]);
    expect(all[1]?.decision).toBe("revert");
  });

  it("reads an empty/missing ledger as []", () => {
    expect(readLedger(join(tmpdir(), "nope-ledger.jsonl"))).toEqual([]);
  });
});
