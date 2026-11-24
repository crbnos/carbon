---
paths: []
triggers: []
promoted: null
---
# Two sessions in one worktree share every uncommitted file

**Context:** Two parallel sessions worked in the same Conductor worktree: one on contracts Phase B, one on hardening the period runs. Both edited `accounting.server.ts`, `propose-revenue-recognition-run/index.ts` and the accounting `AGENTS.md`.

**Problem:** Each session's uncommitted edits sat in the same files as the other's. Neither could commit a file whole, so every commit needed hunk-level staging, and a doc written by one session described the other's half-finished code.

**Rule:** Before a task, run `git status` and treat any change you did not make as foreign: stage only your own hunks and never stash, reset or check out over them. For a long task, ask for an isolated worktree (`isolation: "worktree"`) instead of sharing one.

**Applies to:** Any session that starts in a worktree with uncommitted changes; parallel agents dispatched into the same checkout.
