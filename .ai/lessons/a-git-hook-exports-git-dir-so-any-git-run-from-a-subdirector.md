---
paths: ["packages/jobs/src/scripts/check-backups.ts", "scripts/generate-mcp.ts", "scripts/git-hooks/**"]
triggers: ["GIT_DIR", "git add", "GIT_WORK_TREE"]
promoted: null
---
# A git hook exports GIT_DIR, so any git run from a subdirectory gets the wrong work tree

**Context:** The pre-commit backup check (`packages/jobs/src/scripts/check-backups.ts`,
reached through `pnpm --filter @carbon/jobs`, so its cwd is `packages/jobs`) regenerates
`packages/jobs/manifests/schema.json` and stages it with `git add <absolute path>`.

**Problem:** Run by hand it staged the right path. Under the hook it ALSO indexed the
same content as a root-level `manifests/schema.json` on every migration commit — a
6,994-line file that existed nowhere on disk, resurfacing after each `git rm --cached`.
Git runs hooks with `GIT_DIR` exported and no `GIT_WORK_TREE`; with `GIT_DIR` set, git
treats the CURRENT directory as the work-tree root, so an absolute path under
`packages/jobs` was recorded relative to `packages/jobs`. An absolute path does not
protect you: the index path is computed from the assumed work tree, not from cwd.

**Rule:** Any script a git hook may invoke must run its git commands from the
repository root (`cwd: REPO_ROOT` derived from `import.meta.dirname`, or `git -C`),
never from the package `pnpm --filter` dropped it in. Verify a hook-driven `git add`
by reading `git show --stat HEAD` after the commit, not by running the script by hand.

**Applies to:** `check-backups.ts`, `scripts/generate-mcp.ts`'s digest staging, the
lingui staging in `.husky/pre-commit`, and any future hook step that writes and stages
a generated file from inside a workspace package.
