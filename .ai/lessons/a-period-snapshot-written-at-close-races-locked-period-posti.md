---
paths: []
triggers: []
promoted: null
---
# A period snapshot written at close races Locked-period postings unless the posting guard locks the period row

**Context:** `closeAccountingPeriod` writes the `accountingPeriodBalance` snapshot inside its transaction, after flipping the period to `Closed`. `check_accounting_period_open` only *rejects* postings when a period is already `Closed`; a `Locked` period still accepts them (Locked is a soft freeze for adjustments). A period only becomes Closed on COMMIT.

**Problem:** In the window between the close txn's snapshot `SELECT` and its COMMIT, a concurrent posting reads the period as still-Locked (the flip is uncommitted under READ COMMITTED), is allowed, and commits a line with `postingDate <= endDate` that the snapshot never captured. The read path's delta only adds `postingDate > endDate`, so that line is silently dropped from the optimized balance until reopen+reclose — a wrong financial figure with no error.

**Rule:** When a cache/snapshot is written inside a state-flip transaction and a concurrent writer keys off the *committed* state, make the writer take a lock that conflicts with the flip. Here: the posting guard reads the target `accountingPeriod` row `FOR SHARE` (migration `20260713235930`), which blocks behind the close's row lock — postings before the flip commit first (and land in the snapshot); postings after block, then see `Closed` and are rejected. `FOR SHARE` is shared, so normal concurrent postings don't block each other; only an in-flight close serializes them. Verify with two psql sessions + `lock_timeout`.

**Applies to:** `check_accounting_period_open`; `snapshotAccountingPeriodBalances` / `accountingPeriodBalance`; any close/snapshot-on-commit pattern.
