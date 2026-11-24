---
paths: []
triggers: []
promoted: null
---
# An `isolation: "worktree"` subagent forks from `main`, not the parent's current branch

**Context:** Dispatching three `Agent` subagents with `isolation: "worktree"` to run `/feature` autonomously for NIST items, each told it was "forked from branch `nist-800-110-audit`" and building on code that lives ONLY on that branch (`packages/auth/src/services/auth-events.server.ts` etc., absent from `main`).

**Problem:** The worktree the Agent tool creates forks from the repo's default (`main`), NOT the parent session's current branch HEAD. A subagent that trusts the "you are on <branch>" framing is actually on a `main`-based commit missing all the branch's work. Two of three agents noticed (the referenced file was absent at HEAD) and re-branched from `origin/nist-800-110-audit`; the third did not — it **vendored a duplicate** of the branch-only `auth-events.server.ts`, and its PR branch dragged in ~70 files of `main`-only work plus the duplicate, so the PR was unmergeable and had to be rebuilt by hand.

**Rule:** When an agent's task depends on unmerged branch code, do not assume the worktree is based on that branch. In the dispatch prompt, require the agent to `git fetch origin` and explicitly branch from `origin/<intended-base>`, set the PR `--base` to it, and **verify the base before writing code** (confirm a known branch-only file exists at HEAD; STOP and report if it is missing rather than recreating/vendoring it). When a delivered branch looks wrong, check `git merge-base <base> <deliveredBranch>` against the base HEAD — a merge-base far back means it forked from the wrong place. To salvage a mis-based branch, extract only its real new files onto a fresh branch off the correct base (don't cherry-pick its whole divergent history).

**Applies to:** any `Agent` call with `isolation: "worktree"` whose work builds on unmerged branch state; PR base selection for agent-produced branches.
