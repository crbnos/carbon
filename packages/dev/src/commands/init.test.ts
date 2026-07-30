import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalSlug } from "../worktree.js";
import { initWorktree } from "./init.js";

// Real git worktrees: prove `crbn init` provisions the worktree it's POINTED at
// (`opts.root`), not the caller/main checkout, and that the main-checkout guard
// (isLinkedWorktree = normalized git-dir vs git-common-dir) holds.
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t"
    }
  });

describe("initWorktree", () => {
  const parent = mkdtempSync(join(tmpdir(), "carbon-init-"));
  // basename "carbon" (no `-slug` suffix) → repoBase resolves to "carbon".
  const mainDir = join(parent, "carbon");
  const wtDir = join(parent, "wt-codename");
  const branch = "feat-scope-test";
  const slugFile = ".carbon-worktree";

  beforeAll(() => {
    mkdirSync(mainDir, { recursive: true });
    git(mainDir, "init", "-q");
    writeFileSync(join(mainDir, "README.md"), "x\n");
    writeFileSync(join(mainDir, ".env"), "SECRET=1\n");
    writeFileSync(
      join(mainDir, "package.json"),
      JSON.stringify({ name: "carbon", crbn: { copy: [".env"] } })
    );
    git(mainDir, "add", "-A");
    git(mainDir, "commit", "-qm", "init");
    // Conductor-style: a linked worktree whose dir name is NOT the branch.
    git(mainDir, "worktree", "add", "-q", "-b", branch, wtDir);
  });

  afterAll(() => rmSync(parent, { recursive: true, force: true }));

  it("writes the branch-derived slug under the target root, not main", async () => {
    await initWorktree({ root: wtDir, quiet: true });

    const expected = canonicalSlug({
      worktreeRoot: wtDir,
      mainRoot: mainDir,
      branch
    });
    expect(expected).toBe("carbon-feat-scope-test");
    expect(readFileSync(join(wtDir, slugFile), "utf8").trim()).toBe(expected);
    // Must NOT have provisioned the main checkout.
    expect(existsSync(join(mainDir, slugFile))).toBe(false);
  });

  it("syncs copy-files (.env) into the target worktree", async () => {
    await initWorktree({ root: wtDir, quiet: true });
    expect(readFileSync(join(wtDir, ".env"), "utf8")).toContain("SECRET=1");
  });

  it("refuses to initialize the main checkout (guard)", async () => {
    await initWorktree({ root: mainDir, quiet: true });
    expect(existsSync(join(mainDir, slugFile))).toBe(false);
  });
});
