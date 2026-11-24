---
paths: [".ai/playbooks/assembly-sub-assembly-motion-path.md", "apps/erp/app/routes/x+/assembly+/**"]
triggers: ["agent-browser", "AGENT_BROWSER_SESSION"]
promoted: null
---
# Browser-testing the 3D assembly page: one session, restart often

**Context:** Driving `/x/assembly/:id` with `agent-browser` for screenshots and drags (2026-10-08).

**Problem:** After roughly 40 screenshots of the WebGL page the renderer reached 3 GB+, snapshots hung for over a minute, and a later revalidation failed with "Failed to fetch" plus "WebGL Context Lost". On a fresh dev server the login's Continue button also stays disabled until hydration finishes, which looks like a broken bot check.

**Rule:** Set `AGENT_BROWSER_SESSION` to the worktree's own name, `agent-browser close` and reopen after ~40 shots, and reload the login page once if Continue stays disabled. Drive the canvas with `mouse move/down/up`, not `click`. Radix menus ignore synthetic clicks there — move the mouse off the menu and use the arrow keys plus Enter.

**Applies to:** browser verification of `packages/viewer` features in the ERP editor; `.ai/playbooks/assembly-sub-assembly-motion-path.md`.
