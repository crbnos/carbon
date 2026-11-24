---
paths: []
triggers: []
promoted: null
---
# The manifest-digest hook checks the working tree, not the staged copy

**Context:** The trial balance PR (2026-10-13) left `tool-manifest.digest.json` out of a commit, thinking its diff was unrelated drift.

**Problem:** `check:manifest` regenerates the digest and compares it with the file on disk. The disk copy was the regenerated one, so the hook passed while the commit carried the stale digest. Only running the check against the committed version showed "2 changed".

**Rule:** Never leave a regenerated `tool-manifest.digest.json` unstaged on the assumption that it is drift. Run `pnpm --silent check:manifest` with the committed copy restored; when it fails, the regenerated digest belongs in the commit.

**Applies to:** `apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json`, `scripts/git-hooks/pre-commit`.
