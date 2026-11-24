// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendSignal,
  pendingSignals,
  readSignals,
  type Signal
} from "./inbox";

const failure = (worktree: string, checkId: string): Signal => ({
  kind: "gate-failure",
  at: "2026-11-24T10:00:00.000Z",
  worktree,
  checkId
});

describe("the signal inbox file", () => {
  it("reads back every appended signal and skips a torn line", () => {
    const path = join(
      mkdtempSync(join(tmpdir(), "inbox-")),
      "deep/inbox.jsonl"
    );
    appendSignal(failure("/w", "no-raw-redirect"), path);
    appendFileSync(path, '{"kind":"gate-fa\n');
    appendSignal(failure("/w", "no-local-timezone"), path);
    expect(readSignals(path)).toEqual([
      failure("/w", "no-raw-redirect"),
      failure("/w", "no-local-timezone")
    ]);
  });

  it("reads a missing inbox as empty", () => {
    expect(readSignals(join(tmpdir(), "no-such-inbox.jsonl"))).toEqual([]);
  });
});

describe("pendingSignals", () => {
  it("keeps only the worktree's mistakes after its last learned mark", () => {
    const signals: Signal[] = [
      failure("/w", "a-check"),
      { kind: "learned", at: "2026-11-24T11:00:00.000Z", worktree: "/w" },
      failure("/other", "b-check"),
      failure("/w", "c-check"),
      {
        kind: "stop-asked",
        at: "2026-11-24T12:00:00.000Z",
        worktree: "/w",
        sessionId: "s1"
      }
    ];
    expect(pendingSignals(signals, "/w")).toEqual([failure("/w", "c-check")]);
  });
});
