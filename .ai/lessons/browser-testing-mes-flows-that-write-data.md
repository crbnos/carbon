---
paths: []
triggers: ["agent-browser"]
promoted: null
---
# Browser-testing MES flows that write data

- **Context:** Verifying AssemblyView keyboard shortcuts with agent-browser while editing the same file (Vite HMR live).
- **Problem:** Step records appeared at timestamps with no corresponding keypress; hours went into suspecting the new code. Cause: overlapping test sessions — a page left open across HMR edits (sometimes with a modal up) replays/refires interactions, and interleaved key presses land on freshly auto-advanced steps.
- **Rule:** When a browser test writes rows, run it as a closed loop: wipe the rows, reload the page fresh, then check the DB after EVERY single action before pressing the next key. Never diagnose from an accumulated tail of prior test sessions.
- **Applies to:** agent-browser verification of any MES/ERP flow with side effects, especially while HMR is live.
