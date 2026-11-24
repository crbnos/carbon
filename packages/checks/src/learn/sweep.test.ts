// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { Signal } from "./inbox";
import { fixCommitSignals, groupSignals } from "./sweep";

const signal = (overrides: Partial<Signal>): Signal => ({
  kind: "gate-failure",
  at: "2026-11-20T10:00:00.000Z",
  worktree: "/a",
  checkId: "no-raw-redirect",
  file: "apps/erp/app/routes/x+/a.tsx",
  ...overrides
});

describe("groupSignals", () => {
  it("keeps a check that failed twice or more since the date, and drops a one-off", () => {
    expect(
      groupSignals(
        [
          signal({}),
          signal({ kind: "refused-edit", worktree: "/b", file: "apps/b.tsx" }),
          signal({ checkId: "no-local-timezone" }),
          signal({ at: "2026-11-01T10:00:00.000Z", checkId: "old-check" }),
          signal({ at: "2026-11-01T10:00:00.000Z", checkId: "old-check" }),
          signal({ kind: "learned", checkId: undefined, file: undefined })
        ],
        "2026-11-17T00:00:00.000Z"
      )
    ).toEqual([
      {
        checkId: "no-raw-redirect",
        count: 2,
        files: ["apps/b.tsx", "apps/erp/app/routes/x+/a.tsx"],
        worktrees: 2
      }
    ]);
  });
});

describe("fixCommitSignals", () => {
  const commit = (
    sha: string,
    subject: string,
    at: string,
    files: string[]
  ) => ({
    sha,
    subject,
    at,
    files
  });

  it("flags a fix to a file another commit changed in the 14 days before it", () => {
    expect(
      fixCommitSignals([
        commit("f1", "fix(sales): void once", "2026-11-20T10:00:00Z", ["a.ts"]),
        commit("c1", "feat(sales): void", "2026-11-10T10:00:00Z", ["a.ts"]),
        commit("c0", "feat: older", "2026-10-01T10:00:00Z", ["a.ts"]),
        commit("c2", "feat: other file", "2026-11-15T10:00:00Z", ["b.ts"])
      ])
    ).toEqual([
      { sha: "f1", subject: "fix(sales): void once", earlier: ["c1"] }
    ]);
  });

  it("ignores a commit that is not a fix, and a fix with no earlier change", () => {
    expect(
      fixCommitSignals([
        commit("c1", "feat: a", "2026-11-10T10:00:00Z", ["a.ts"]),
        commit("f1", "fix: b", "2026-11-20T10:00:00Z", ["b.ts"])
      ])
    ).toEqual([]);
  });
});
