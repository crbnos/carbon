---
paths: ["apps/erp/app/routes/x+/settings+/backups.tsx"]
triggers: ["knownBackupNames", "runningExport", "failedIsStale"]
promoted: null
---
# A "did my job finish?" baseline must include the rows a FAILED run left behind

**Context:** The Backups page shows a spinner row while an export runs, and decides the
run finished when a backup appears in the list that was not in a `baseline` snapshot
taken when tracking began. The baseline recorded only backups with status `ready`.

**Problem:** A failed export leaves a **pending** (manifest-less) folder in the list.
When the user clicked "Skip corrupted rows and retry", that leftover folder later
flipped to `ready` — it was not in the ready-only baseline, so it read as "this run
completed" and the spinner vanished a second after the retry started, while the job was
still running. The job was correct throughout; only the completion test was wrong. The
same shape bit the failure banner: a marker cleared by the action could still arrive via
a revalidation already in flight, so the banner reappeared under the running row.

**Rule:** A baseline for "something NEW appeared" must snapshot **every** item already
present, in every status — not just the ones in the terminal state you are waiting for.
A prior failure's debris is exactly what will later transition into that state and fake
a completion. And when a stale record can still arrive after you delete it, identify it
by **identity** (the exact row you superseded), never by comparing a client timestamp
against a server one — clock skew then decides your control flow.

**Applies to:** `apps/erp/app/routes/x+/settings+/backups.tsx` (`runningExport`,
`knownBackupNames`, `failedIsStale`), and any optimistic progress row driven by polling
a list.
