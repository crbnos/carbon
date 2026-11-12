# Feature run: Serial traveler — one label follows the unit from the pick to the finished good

- Date: 2026-11-12
- Mode: approval-per-phase
- Request: Build "scan the serial" (option 2). Change the Carbon code locally. Seed anonymized data modeled on the TDI-300N turbojet example, and test against it. Add an option that blocks completion until every traced part is scanned in; the option is off by default. The kitting station has a label printer. Include the user's process, without scenario planning (held for future work).
- User's process: management sets safety stock; MRP suggests jobs; management reviews and releases them; water spiders pick each job's parts from Warehouse 1 to the stations; a line feeder keeps stations stocked from a screen of waiting operators; one traveler label per unit prints at the pick and follows it to the finished good; an operation with 2 or more sub-assemblies needs every traveler scanned; the finished good prints its serial label; the serial traces to the MRP plan, the releaser, operators, lots and times; dashboards find defect patterns. Deferred: capacity scenarios.
- Reference: open-mrp/api batch scanning (`FindNextAvailableBatchInFlow`).
- Shareable process page: https://claude.ai/artifact/GKoCC7X4s8rKMo8pcbHJHf
- Notes doc: https://claude.ai/artifact/AFJGkQffFz77QZVSGxWToF
- Phase plan: research [skip — the user declined it] · spec [run] · plan [run, slice 1] · execute [run] · test [run] · self-review [run]

## Decisions

Approval mode: the user decided at each gate. The grill resolutions live in the spec's Open Questions section (Q1–Q12).

- 2026-11-12: the user approved the slice 1 plan and the new `PickingList` print source (Ask First in `packages/printing/AGENTS.md`).
- 2026-11-12: the user authorized a reset of the local test database (`crbn reset`), because the local migration history had drifted (`20261110150000_purchase-order-force-delete.sql` objects existed but were not recorded).

## Phase log

- Step 0: mode and phases chosen by the user — 2026-11-12.
- Phase 2 (spec): done 2026-11-12. `.ai/specs/2026-11-12-serial-traveler-line-flow.md`. STE-80 pass done.
- Phase 3 (plan): done 2026-11-12. `.ai/plans/2026-11-12-serial-traveler-line-flow.md`, 52 tasks in 7 phases. STE-80 pass done. Approved by the user.
- Phase 4 (execute): started 2026-11-12 on branch `feat/serial-traveler`.
  - Tasks 7, 8, 9 committed (`427af5b10b`, `a8afa7e12c`, `5b52d576bf`).
  - Tasks 1–5 applied to the local database after the reset; types regenerated; authz migration `20261112182502_serial-traveler-authz.sql` written.
  - Phase A done: Tasks 1–6 committed (`5e6299b948`; test `traveler-target.test.sql`).
  - Phase B done: Tasks 7–15 committed. Task 13 reads candidate parent units with 2 batched reads (the plan's per-candidate read broke the N+1 rule).
  - Phase C done to Task 29 (2026-11-12): dataset `motor-line` validates with 0 violations; `db:check:datasets` passes for all 6 datasets. Plan gaps fixed during execution: Task 23a (`Dataset.assetIndustryId`, so a dev-only dataset reuses the motor CAD assets) and the bearing batch properties in Task 25.
  - Task 30 done 2026-11-12 with the user's approval: `motor-line` seeded (company `dbr02to440h3qi4ggcdg`); every row check matched. The seed needs `NODE_EXTRA_CA_CERTS=$HOME/.portless/ca.pem` under portless, and the stack must be awake (it hibernates).
  - Paused after phase C for the user's scan test.
  - Incident: the untracked spec, plan and run record files disappeared from `.ai/` during execution, cause not found. The plan was rebuilt from the scratch drafts, the spec and this record from the session. They are now committed to the branch.
  - Incident 2: the run record was deleted again and the plan's progress reverted to its committed state, during Phase B. Cause not found; the pre-commit hook does no stash or clean. From now on the plan progress and this record are committed after each update.

## Outcome

- Pending.
