# Demo data — thermo-nuclear review fixes

**Source:** `.ai/runs/2026-09-23-thermo-nuclear-review.md` (item numbers #1–#24 + Minor), detail files `.ai/runs/2026-09-23-tnr-{A,B,C,D}-*.md`.
**Branch:** `feat/demo-data-completeness` · user chose: fix everything, in the suggested order.

## Ground rules

1. Repo `/Users/aashu/work/carbon/carbon`. pnpm only. Never commit/stash/reset/checkout; never `.claude/worktrees`; never rebuild the DB. DB writes only in rolled-back transactions or `pnpm db:seed:dev -- --email demo-audit@carbon.local …`.
2. Behaviour-preserving unless the item is a bug fix. **Golden oracle:** `…/scratchpad/golden/compare.sh` re-applies all 4 datasets (rolled back) and diffs per-table row counts against `baseline.json`. Pure refactors must print `DIFFS: 0`. A fix may change counts only in the tables it names — list every delta in the step report; then refresh the baseline with `cp current.json baseline.json` (the orchestrator does this after review).
3. Gate after every step: `pnpm --filter @carbon/database typecheck` (exit 0) · `pnpm --filter @carbon/database test` (all pass) · `pnpm --silent db:check:datasets` (✓×4) · `pnpm exec turbo run typecheck --filter=@carbon/jobs` · `pnpm exec biome check packages/database/src packages/jobs/src` (0 errors) · golden compare.
4. Engine rules unchanged: `need()`, DayOffset dates, tenancy predicates, no literal PKs, no global-table writes, no auth-claim spoofing. Comments sparse (why only).
5. Autonomous mode: resolve gaps with the ship-it ladder; record decisions in `.ai/specs/2026-09-23-demo-data-screen-coverage.md` Autonomous Decisions (continue numbering).

## Progress
- [x] R1: Single method copier (#8) → fixes #12 change-order tools/params, #13 quote assembly link (set in tier 02)
- [x] R2: Split `types.ts` → `types/<slice>.ts` + `types/engine.ts` + `context.ts` (#2) — D83/D84
- [x] R3: Split `validate.ts` → `validate/` modules (#1) + table-driven `validate.test.ts` (#3) — D85–D87
- [x] R4: SSOT small: enum-derived REQUIRED table (#4), shared GL sign/balance (#6), inspection-verdict core in `functions/shared` (#7), one lookup helper (#9), RULE_FIELDS + EVENT_SOURCES drift tests (#10, #11), return-credit/tier 09 memo dedupe (#21) — D88–D93
- [ ] R5: SSOT large: pure posting builders extracted from edge functions and imported (#5)
- [ ] R6: Wipe policy map (#15) + complete VOID pass (#14) + ledger-driven valuation (#16)
- [ ] R7: Types & refs: discriminated unions + generated enums (#17), typed refs (#18), job-specific production fields onto job specs (#20), sales/purchasing header dedupe (#19)
- [ ] R8: Data packs: derived defaults (#22), job → salesOrderLine only (#23), comment dedupe (#24)
- [ ] R9: Minor list (planningError, `.cts` entry, activeJobStatuses, repoRoot, fallbacks, companyId predicates, rowCount checks, coverage typing, footer, header, exports)
- [ ] R10: Full verification (gate + real re-apply + screen matrix ×4 + pre-commit drill) + docs sync + review re-run
