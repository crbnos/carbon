---
paths: ["packages/checks/src/sources/license-files.ts"]
triggers: ["license-headers"]
promoted: null
---
# The license-header fixer only sees files git tracks

**Context:** `pnpm --filter @carbon/checks license-headers -- <paths>` writes the SPDX header. It walks `git ls-files --cached`.

**Problem:** A new, untracked file is not in that list, so the fixer reports "0 fixed" and the file keeps no header until the `spdx-license-header` check fails at commit.

**Rule:** Run `git add -N <new files>` (intent to add; it records no content) before the fixer, then run the fixer with those paths.

**Applies to:** every new source file outside generated output.
