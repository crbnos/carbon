# Bugfix run: journal verification defects

- Date: 2026-11-04
- Mode: fully-autonomous
- Request: "fix them" (the defects and recommendations from the journal verification)
- Phase plan: root-cause [done: journals read back, .context/jv-*] · instrument [skip: deterministic scenarios] · fix [run] · test [skip: red→green DB proofs cover posting] · commit [skip: not asked]

## Decisions

- Scope: defects 1-6, the expense entry credit and inventory counts by owner, read from "fix them". The two recommendations are separable.
- Capitalize element: refuse (matches the existing project-level refusal), rather than write CIP rows from the job paths.
- Counts: a scan or import row counts the bin and spreads over owners; no new CSV column.
- Maintenance serial returns left: its cost rows name no unit, so it needs its own change. Moved service time entries left: the shared labor diff has no date in its key.

## Phase log

- root-cause: HIGH, journals read back in .context/jv-evidence*.
- fix: each committed test seen red, then green. ERP database tests 1116, unit 2375, SQL 7, checks 410, typecheck, datasets, backups, clobbers.

## Outcome

- Committed and pushed to origin/projects-port-main: 5e3bf5676d, ebaff3ef12, 02f91afa68. Backup check skipped by flag on the first commit (stack down); it passed on the same schema before the commits.
