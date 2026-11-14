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
  - Phases D–F done 2026-11-12 in 3 waves (Tasks 31–48). ERP, MES and package typechecks pass; `check:manifest` passes with the updated digest. Deviations: `@carbon/database/material-request` writes its "no row" check inline and uses a native timestamp (the package cannot import `@carbon/utils`); `ShortcutHelp.tsx` has no entry for the new `alt+0` shortcut; the new MES strings are extracted but not translated.
  - Remaining: Phase G (Tasks 49–52).
  - 2026-11-12: the user cancelled the automated browser test (it stalled on the chamber operations) and asked for a live Chrome walkthrough instead. Walkthrough results: Line Flow card and Print label on completion shown; releasing J000029 created PL000003 (11 lines to station bins, no assignee); starting it printed the AJ3E-0004 traveler (printJob completed, QR = MES traveler link); a scan of the injector AJ3I-0001 traveler resolved 2 levels up to engine AJ3E-0001; the traceability graph shows bearings lots and AJ3-CC under the engine; Need material created an Open request, Line feed listed it first, Resolve closed it. Recorded as `serial-traveler-line-flow-walkthrough.gif` (user's Downloads).
  - Findings to fix: (1) the `motor-line` seed puts AJ3-ENG operations on the wrong work centers (op 1 at B2 not B1, op 3 at A2 not B3, op 5 at A3 not M); (2) serial sub-assemblies (AJ3-CC) appear on the water spider's picking list although they come from Line A, not Warehouse 1; (3) the first Release click on the ERP job page did not submit because the page failed to hydrate (dev only, not traced to this branch yet). Not yet browser-checked: required-scan block at the merge, the wrong-item refusal, the finished-good label at the last operation.
  - 2026-11-12: findings fixed and re-tested after a reseed. (1) Station processes (`a4330e131a`): every AJ-3 operation stays on its station after the scheduler runs. (2) `excludeMadeParts` on release picking lists (`b63ebf2bad`): PL000003 for J000029 has 10 bought parts and no AJ3-CC. (3) The Release click: one click on a fully loaded page released J000029; the first-attempt failure was a click during a client re-render after a dev hydration mismatch on a page this branch does not change. No code change.
  - Incident: the untracked spec, plan and run record files disappeared from `.ai/` during execution, cause not found. The plan was rebuilt from the scratch drafts, the spec and this record from the session. They are now committed to the branch.
  - Incident 2: the run record was deleted again and the plan's progress reverted to its committed state, during Phase B. Cause not found; the pre-commit hook does no stash or clean. From now on the plan progress and this record are committed after each update.

## Outcome

- Pending.
