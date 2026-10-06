# Change Notice Impact sync to pinned main

Inputs: feature `9c00fff3b79f5ebfd398629f44caa0826b07e498`, main `7b706db15167e96d4761f947e86363649a4a0ef5`, base `d0b9e04710a2fd63b8fcdd21e717a78dd5a9af42`.

## Boundaries

One normal local merge, then a separate generated authz forward-date commit if required. No push, history rewrite, migrations, database history edits, manual generated policy edits, new test infrastructure, or UI redesign. The app stays stopped for static checks. Main owns shared architecture and tooling; the feature owns Impact semantics.

## Plan

- [x] Verify clean feature tip and local safety ref; fetch and pin main.
- [x] Read pinned guidance and compare all three trees, upstream commits, overlaps, and merge preview. Consume four read-only integration audits.
- [x] Start `git merge --no-ff --no-commit` against the pinned SHA; record every conflict.
- [ ] Reconcile source conflicts and automatic overlaps. Keep transactional Impact deletion/provenance and upstream price-break cleanup, shared helpers, revision inheritance, server functions, and compiler contracts.
- [ ] Preserve stable refresh callbacks through the canonical query wrapper without changing save-in-flight behavior. Adapt existing tests to the current imports and signatures.
- [ ] Reconcile decoded catalogs and generated database artifacts against main plus migration-proven feature additions. Keep deleted infrastructure deleted. Regenerate MCP from source.
- [ ] Audit discovery, coverage, decisions, task independence, terminal lifecycle, source authorization, exact-company OAuth, public adapters/raw exclusions, and UI wiring.
- [ ] Confirm no unresolved paths or conflict markers, inspect resolution diffs, and perform frozen installation.
- [ ] With this repository's app stopped, run focused tests, safe authz tests, manifest verification, scoped ERP/database/jobs/query typechecks, Lingui, focused Biome, conformance/license, and ERP production build. Record incompatible live DB gates/browser smoke as NOT RUN.
- [ ] Verify exact MERGE_HEAD; create a normal two-parent local merge commit using only documented dataset/backup skips required by the stale database.
- [ ] Generate and verify a later canonical Impact authz migration before removing the stale file; inspect semantics and make a separate normal local commit. Do not apply it.
- [ ] Verify committed-tree checks, clean state, ordered merge parents and ancestry, final remote-main observation, and the requested 58-item report.

## Evidence

Run logs, reference snapshots, decoded comparisons, and audit reports are kept outside the repository. Database-generated reconciliation is not a claim of live canonical regeneration. No test requiring fixture writes to the stale local database will be run.
