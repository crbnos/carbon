---
paths: []
triggers: []
promoted: null
---
# Never blind-pop a stash in a Conductor worktree — the stash stack is shared/stale

**Context:** During /execute, proving an erp typecheck failure pre-existing by temporarily parking three edited files with `git stash push -u <paths>` in a Conductor workspace.

**Problem:** The `stash push` failed ("could not write index" — likely a concurrent git process from a sibling workspace; untracked-file pathspecs also fail plain `stash push`). No stash was created, but the follow-up `git stash pop` applied the TOP of the existing stash stack — an old stash from a *different branch's* work — half-applying unrelated files with merge conflicts (`UU`) and staged changes that then had to be surgically reverted.

**Rule:** In Conductor/multi-worktree checkouts, don't use `git stash` for temporary file parking at all. Prove a failure is pre-existing with `git show HEAD~1:<file>` / `git log -- <file>` / a merge-base check instead. If stash is truly unavoidable: verify the push succeeded AND `git stash list` shows YOUR entry at stash@{0} before ever popping, and never `pop` after a failed `push`.

**Applies to:** any git stash usage in Conductor workspaces; /execute and /check-and-commit loops; proving pre-existing test/typecheck failures.
