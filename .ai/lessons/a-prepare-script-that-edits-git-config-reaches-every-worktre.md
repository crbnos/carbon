---
paths: ["package.json", "scripts/git-hooks/**"]
triggers: ["simple-git-hooks", "core.hooksPath", "preserveUnused"]
promoted: null
---
# A `prepare` script that edits git config reaches every worktree

**Context:** Replacing husky with simple-git-hooks, `prepare` unset `core.hooksPath` and installed hooks. It ran on every `pnpm install` in a worktree.

**Problem:** Worktrees share one `.git`. The unset removed the main checkout's `core.hooksPath` and simple-git-hooks wrote into the shared `.git/hooks`, so checkouts still on husky skipped their hooks without a word. The desktop app also sets `core.hooksPath` at WORKTREE scope, which a plain `git config --unset` does not touch. simple-git-hooks additionally deletes every hook it does not manage unless `preserveUnused` is set.

**Rule:** Treat a lifecycle script that touches git config or `.git/hooks` as a change to every checkout of the repository. Use `pnpm install --ignore-scripts` while such a branch is unmerged, clear both the local and the worktree scope, and set `preserveUnused: true`.

**Applies to:** root `package.json` (`prepare`, `simple-git-hooks`), `scripts/git-hooks/`.
