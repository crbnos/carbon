---
paths: ["packages/dev/src/commands/up.ts"]
triggers: ["crbn up"]
promoted: null
---
# Two `crbn up` in one worktree take each other down

**Context:** `crbn up` records its pid in `~/.carbon/stacks/<slug>/up`, and its teardown first stops whichever `crbn up` that file names.

**Problem:** An agent started `crbn up` in the background, then the user started another in the same worktree. The second overwrote the marker and reused the first's dev servers. Stopping the agent's run then SIGINT'd the user's run through the marker, and every app went down.

**Rule:** Run one `crbn up` per worktree. Check `ps` for a running one (or ask) before starting it, and never stop it while someone else may be using it.

**Applies to:** Agents and humans booting a stack in a shared worktree.
