---
paths: []
triggers: []
promoted: null
---
# `git add` aborts the whole invocation on one unmatched pathspec

**Context:** Committing a spec that had been moved with `git mv`, the staging command listed both the old and new paths. The old path no longer existed, so `git add` exited with `fatal: pathspec … did not match any files` and staged **nothing** — but the following `git commit` still ran and produced a commit containing only the already-staged deletion. The spec was removed from the branch without its replacement, and it was pushed before anyone noticed.

**Problem:** `git add` is all-or-nothing across its arguments, and a `fatal:` from it does not stop a `&&`-free command sequence. The failure message scrolls past in a multi-command block, and `git commit` happily commits whatever the index already held — which after a `git mv` is exactly the destructive half of the change.

**Rule:** Never list a path that a previous step may have moved or deleted. Build the staging list from `git status --porcelain` output rather than typing paths, and **verify the index before committing** — `git status --porcelain | grep -vc "^[MARD]"` must be 0, or diff `git diff --cached --name-only` against the intended file list. Treat a commit whose file count differs from the intended change as a failed commit, not a done one.

**Applies to:** any commit flow following a `git mv`, `/check-and-commit`, scripted staging.
