# Feature run: PMI (model-based definition) in the STEP viewer

- Date: 2026-10-26
- Mode: fully-autonomous
- Request: "we need to support tolerances in our step file viewer. model based definitions spec i believe it's called" — then "fully autonomous".
- Phase plan: research [run — new technical domain: AP242 PMI, OCCT XCAF API, how CAD viewers show PMI] · spec [run — crosses the Rust converter, the Inngest jobs, the shared graph contract and the viewer] · plan [run] · execute [run] · test [run only if a local stack can run the assembler; else skip with reason] · self-review [run]

## Decisions
- Spec gate (open questions): resolved autonomously — assembly player out of v1; no backfill (Reoptimize adds PMI); new nullable `modelUpload.pmiPath`; first instance of a part in an assembly; no face-click picking in v1. Ask-First checks: the column is on an artifact table, not a production-critical one; `pmi.json` is an additive, versioned internal contract — 2026-10-26.
- Plan gate: approved autonomously — the plan follows the spec's thumbnail sibling and keeps the converter output byte-identical — 2026-10-26.
- Scope: view-only. The viewer shows PMI. Inspection features from PMI are a later change — the recommendation given to the user, who did not object — 2026-10-26.
- PMI kinds: semantic values AND graphical presentation — the semantic values make a later inspection link possible; the presentation is what designers expect to see — 2026-10-26.
- Build environment: no Rust toolchain or OCCT on the host. Build the `carbon-occt:8.0.0-p1` base image in Docker and compile and test the crates inside a container — 2026-10-26.

## Phase log
- research: `.ai/research/step-pmi-viewer.md`. The first product-survey agent stalled; the user asked to retry; two smaller agents finished it. STE-80 pass done.
- spec: `.ai/specs/2026-10-26-step-pmi-viewer.md`. All open questions resolved autonomously and marked so. STE-80 pass done.
- plan: `.ai/plans/2026-10-26-step-pmi-viewer.md`, 10 tasks. STE-80 pass done.
- execute: Tasks 1–10 done. Rust (occt-bridge, converter, assembler) built and tested in the `carbon-rust-dev` container: 63 assembler tests and every converter test pass, 8 of them for PMI (NIST fixtures through `PMI_FIXTURES`). Viewer: 231 tests pass; typecheck of `@carbon/viewer`, `@carbon/jobs`, `erp` and `mes` passes; Biome clean on changed files. Types generated from a throwaway database (see the plan's Deviations). The viewer subagent built Tasks 7–8; its prose went into no artifact.
- test: browser check on a throwaway Vite page mounting the real `ModelPreview` with NIST CTC 01 and CTC 05 ingest outputs. PMI lines up with the model; a picked tolerance turns blue, highlights its faces and turns the camera; a saved view filters and turns the camera. The full `/test` skill was skipped: `crbn` could not start this worktree's stack (shared Redis pool full, 16 of 16), and freeing a slot would stop another session's stack.
- self-review: a review subagent found 2 must-fix items (wire edges joined into one polyline; Latin-1 names throwing in `rust::String`) and 4 risks or suggestions taken (per-run `pmi.json` path, non-finite numbers, empty documents, datum view remap). All fixed and retested. `CODE_VERSION` bump reverted: only `plan` reads that cache.
- STE-80 pass done on the spec, the plan and this record after the last edits.
- setup: OCCT V8_0_0_p1 source cloned to `.context/occt-src` for API reference. `STEPCAFControl_Reader` defaults `myGDTMode` and `myViewMode` to true (`STEPCAFControl_Reader.cxx:286-288`), so today's convert already loads the PMI into the XCAF document.

- self-review (second, /self-review): 1 must-fix (picked annotation lying flat read rotated: focus now uses the plane's own up) and docs drift (jobs AGENTS, backup rule, viewer AGENTS, swagger). Fixed; a PMI-panel unit toggle added. Checked in the running ERP on NIST CTC 05: picked frames read upright. The local stack now runs the assembler in Docker (`carbon-assembler-pmi`, forced in `.env`), since this Mac has no native OCCT.

## Outcome
- PR: https://github.com/crbnos/carbon/pull/2048 (commit 701ca4df88). Not merged.
