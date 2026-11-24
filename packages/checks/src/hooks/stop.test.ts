// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { Signal } from "../learn/inbox";
import { decideStop } from "./stop";

const failure: Signal = {
  kind: "gate-failure",
  at: "2026-11-24T10:00:00.000Z",
  worktree: "/w",
  checkId: "no-raw-redirect"
};

describe("decideStop", () => {
  it("asks for /learn when the worktree has pending failures", () => {
    expect(decideStop({ session_id: "s1" }, [failure], "/w")).toEqual({
      decision: "block",
      reason:
        "This worktree logged 1 check failure (no-raw-redirect) since the last /learn. Run /learn on them before you stop. If each one was a slip already covered by its check, run `pnpm --filter @carbon/checks learn:mark` instead."
    });
  });

  it("lets the agent stop when a Stop hook already continued it", () => {
    expect(
      decideStop({ session_id: "s1", stop_hook_active: true }, [failure], "/w")
    ).toBeNull();
  });

  it("asks at most once per session", () => {
    const asked: Signal = {
      kind: "stop-asked",
      at: "2026-11-24T10:05:00.000Z",
      worktree: "/w",
      sessionId: "s1"
    };
    expect(decideStop({ session_id: "s1" }, [failure, asked], "/w")).toBeNull();
  });

  it("lets the agent stop after /learn ran for the worktree", () => {
    const learned: Signal = {
      kind: "learned",
      at: "2026-11-24T10:05:00.000Z",
      worktree: "/w"
    };
    expect(
      decideStop({ session_id: "s1" }, [failure, learned], "/w")
    ).toBeNull();
  });

  it("ignores another worktree's failures", () => {
    expect(decideStop({ session_id: "s1" }, [failure], "/other")).toBeNull();
  });
});
