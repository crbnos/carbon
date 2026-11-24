---
paths: []
triggers: []
promoted: null
---
# Reverse inventory from the original ledger sources

**Context:** Picking a material in stages and unissuing project-job inventory.

**Problem:** A saved bin can empty between picks, and a project job can consume both project and common stock. Reusing the saved bin or default project stripe for a reversal changes physical or ownership balances.

**Rule:** Resolve stock after the draw lock for every pick, record its source per line, and reverse outstanding quantities by their original bin and stripe. Find the rows to reverse by document and item, not by a tag only some writers set: the job-completion backflush writes `Job Consumption` rows with no `documentLineId`. A refusal the person can act on is an `InvalidInputError`; a plain `Error` reads as a 500 and its text is withheld.

**Applies to:** Picking transfers, unpick, job consumption, and unissue.
