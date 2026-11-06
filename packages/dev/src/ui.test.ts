// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { steady, worktreesTable } from "./ui.js";

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

describe("steady", () => {
  function fakeStream() {
    const writes: string[] = [];
    const stream = {
      columns: 80,
      write(data: string, cb?: () => void) {
        writes.push(data);
        cb?.();
        return true;
      }
    } as unknown as NodeJS.WriteStream;
    return { writes, out: steady(stream) };
  }

  it("sends the erase and the redraw in one write", () => {
    const { writes, out } = fakeStream();
    out.write("\x1b[1G");
    out.write("\x1b[J");
    out.write("◆  Pulling docker images...");
    expect(writes).toEqual([
      "\x1b[?2026h\x1b[1G\x1b[J◆  Pulling docker images...\x1b[?2026l"
    ]);
    expect(out.columns).toBe(80);
  });

  it("sends held writes when the process exits", () => {
    const { writes, out } = fakeStream();
    out.write("\x1b[?25h");
    process.emit("exit", 0);
    expect(writes).toEqual(["\x1b[?2026h\x1b[?25h\x1b[?2026l"]);
  });

  it("flushes cursor-only writes and runs their callbacks", async () => {
    const { writes, out } = fakeStream();
    let called = false;
    out.write("\x1b[?25h", () => {
      called = true;
    });
    expect(writes).toEqual([]);
    await Promise.resolve();
    expect(writes).toEqual(["\x1b[?2026h\x1b[?25h\x1b[?2026l"]);
    expect(called).toBe(true);
  });
});
