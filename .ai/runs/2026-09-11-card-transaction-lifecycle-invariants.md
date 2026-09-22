# Bugfix run: Card transaction lifecycle audit invariants

- Date: 2026-09-11
- Mode: fully-autonomous
- Request: "go ahead"
- Phase plan: root-cause [resume — proven HIGH] · instrument [skip — deterministic schema gap] · fix [complete] · test [complete — direct SQL/Deno/DB integration] · commit [complete — explicitly requested]

## Decisions

- Root cause: resume from the completed nuclear-review finding; the missing invariant is statically proven.
- Runtime instrumentation: skipped because direct SQL statements deterministically reproduce the invalid states.
- Browser verification: skipped because this is a database-only integrity boundary with no user-facing behavior change.
- Compatibility: perform a read-only inventory before creating or applying the migration; do not fabricate missing actors or timestamps.

## Phase log

- root-cause: HIGH — current lifecycle trigger permits stored status/audit combinations that the posting and voiding code do not produce.
- fix: added a retry-safe, fail-closed validated CHECK migration; expanded the SQL invalid-state matrix; kept Deno fixture rollback compatible.
- verify: SQL integrity PASS; 30 focused Deno post-card tests PASS; 5 real-DB Ramp staging tests PASS; 16 post/void/concurrency tests PASS; database/jobs scoped typechecks PASS; lint PASS; datasets 4/4 PASS; live malformed rows 0.
- independent review: nuclear review found no defect in the fix. Adversarial probes proved clean retry, malformed-row diagnostics, recovery after correction, and rejection of a hostile same-name constraint.
- gate limitation: `db:check:backups` cannot give a branch-local verdict because current `origin/main` is 11 commits ahead and its manifest requires 11 Returns tables absent from this branch/database. Sync main, migrate, and rerun before merge.

## Outcome

- Code commit: `726f5911bf fix(accounting): enforce card lifecycle audits`.
- Docs commit: `d45d26695f docs(ramp): record card lifecycle invariant`.
- Browser test intentionally skipped: the change is a database-only invariant and was exercised below the UI through the actual SQL and posting paths.
