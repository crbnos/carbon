// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { worktreesTable } from "./ui.js";

const rows = [
  {
    path: "/work/carbon/.claude/worktrees/a-long-worktree-directory-name",
    branch: "feat/a-long-branch-name",
    current: false,
    slug: "a-long-worktree-directory-name",
    dockerState: "running"
  }
];

describe("worktreesTable", () => {
  it("draws the table when it fits", () => {
    expect(worktreesTable(rows, 200)).toContain("┌");
  });

  it("stacks each worktree on two lines when the table is too wide", () => {
    const out = worktreesTable(rows, 60);
    expect(out).not.toContain("┌");
    expect(out.split("\n")).toHaveLength(2);
    expect(out).toContain("feat/a-long-branch-name");
    expect(out).toContain("a-long-worktree-directory-name");
  });
});
