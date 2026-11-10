# Feature run: Inspection plans from STEP PMI

- Date: 2026-10-27
- Mode: fully-autonomous
- Request: "when a step file is uploaded that has MBD PMI -- we are now handling it in the UI in the viewer component. but it would be really cool if the PMI created an inspection plan. and if that inspection plan was used, it brought in the model instead of a pdf" — then: "the plan should be made automatically if there are PMI. one plan with just a model. skip them. both erp and mes"
- Phase plan: research [skip — `.ai/research/step-pmi-viewer.md` covers PMI; codebase mapped by two explore agents] · spec [run] · plan [run] · execute [run] · test [skip unless cheap — needs a STEP AP242 file with PMI and a running stack] · self-review [run]

## Decisions
- Spec gate: no open questions; the user answered the four questions. — 2026-10-27
- `pageNumber` stays NOT NULL; a model feature gets 1. — The save RPC defaults it to 1, so no RPC change. — 2026-10-27

- No local stack existed: started this worktree's own services-only stack (`crbn up --no-apps`) to apply migrations and generate types. — 2026-10-27
- Item delete removes the item's PMI plans no inspection used, so an automatic plan never trips `partId` RESTRICT. — 2026-10-27
- Not committed: the user did not ask for a commit. — 2026-10-27
- Browser test skipped: needs a STEP AP242 file with PMI and the assembler running. — 2026-10-27

## Phase log
- spec: `.ai/specs/2026-10-27-pmi-inspection-plans.md`. STE-80 pass done.
- plan: `.ai/plans/2026-10-27-pmi-inspection-plans.md`. STE-80 pass done.
- execute: all tasks done, uncommitted. Gates: viewer pmi tests 36/36; DB check of the building block, duplicate guard, handler and delete cleanup (rolled back); typecheck erp, mes, jobs, viewer, database, lib; Biome; `@carbon/checks` 406/406; `db:check:datasets` 5/5; `db:check:backups` restorable; authz migration + event-system tests 13/13.

- self-review: 2 bugs found and fixed — one-sided deviations (⌀10 −0.013/−0.028) gave wrong limits; the model's selection could drift from the host's. Viewer tests 38/38; typechecks and conformance green again.
- nuclear self-review: fixes applied (see plan task 9). Viewer 242/242, database 49/49 (DB tests ran against the local stack), jobs mapping×grading 4/4, dev 9/9, checks 406/406, trigger SQL test passes, docs typecheck green. Not done: the editor refactor (left as a decision), splitting the `crbn` changes into their own PR (nothing committed yet).

## Outcome
- Built and verified locally; uncommitted.
