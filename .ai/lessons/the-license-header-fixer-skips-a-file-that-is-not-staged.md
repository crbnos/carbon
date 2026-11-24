---
paths: ["packages/checks/src/sources/license-files.ts"]
triggers: ["license-headers"]
promoted: null
---
# The license-header fixer skips a file that is not staged

**Context:** Multi-jurisdiction tax (2026-10-17). Two new files were committed with no SPDX header, although the fixer had run before each commit.

**Problem:** `pnpm --filter @carbon/checks license-headers` walks `git ls-files --cached`. An untracked file is outside that walk, so the fixer reports "0 fixed" and the file stays bare. The conformance test then fails later, on someone else's run.

**Rule:** Stage a new source file (`git add`) before you run the license-header fixer, then stage it again after the fixer writes the header.

**Applies to:** every new source file, and `packages/checks/src/sources/license-files.ts`.
