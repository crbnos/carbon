# Change Notice Impact: conservative UI pass

## Design brief

Embedded operational workspace; ERP compact Table is the current-exposure exemplar (JobMaterialsTable, JobOperationsTable, ChangeNoticesTable). CustomerHeader supplies the header facts strip. ProductionPlanningOrderDrawer supplies the small embedded record table. InventoryCountHistory supplies restrained history hierarchy, not its event semantics.

Reuse existing Carbon primitives and existing writer/drawer/task components. No shared API extensions. Native Table selection cannot enforce per-row eligibility, so preserve local ID selection, all-data reconciliation, stale blockers and exact pure predicates. Reset the Table on ordered visible identity changes because native expansion is index-keyed. Local natural-height containment lets the page remain the vertical scroll owner.

Capabilities: inspect current target/source/conclusion/freshness/tasks; select only eligible current rows; retain hidden selections and block stale selections; review a bulk operation; expand current/stored facts and provenance; assess/reassess/resolve through existing forms; inspect history; manage existing linked tasks through their existing writers. Historical, source-deleted and unavailable records remain inspectable and retain permitted cleanup controls. Browser interactions will open/inspect/cancel only; no writes, refresh reconciliation or fixture changes.

One compact header with authoritative PO/Job/Material counts, To assess and coverage health. One source-coverage Alert for incomplete domains; independent task-coverage warning retained. Cancelled explains assessment lock; Done adds no duplicate banner. Current exposure is a scan table; details are expanded. Non-empty historical/unavailable collections are secondary. No raw protocol IDs in visible labels. Pane-aware facts, readable drawer identities and ICU plural labels.

## Plan

- [x] Verify branch, expected HEAD, pinned ancestor and clean worktree.
- [x] Read Carbon design/rules/lessons and actual siblings/API/semantics.
- [x] Replace header/coverage presentation; inspect focused diff.
- [x] Compose current Table and secondary collections; preserve selection/gates and all real writers.
- [x] Simplify drawer/history/task presentation and pane-aware facts; add focused presentation regressions.
- [x] Inventory message changes before any catalog edits; apply only owned ERP messages.
- [x] Browser review at 1440, 1024, 390, Draft/Done/Cancelled; Carbon mandatory self-review; maximum two evidence-based fix passes.
- [x] Stop app and verify processes terminated before scoped validation.
- [x] Focused Impact UI tests, memory-bounded ERP typecheck, changed-file Biome, narrow Lingui and diff hygiene.
- [x] Inspect explicit staging and normal-hook changes; one local commit, no push.

## Final follow-up

- [x] Remove the leftover informational scope disclosure.
- [x] Remove redundant task-origin prose from the create-follow-up drawer.
- [x] Use quiet, muted "No linked task." empty-state copy.
- [x] Verify/update owned translations through Carbon's fill-only i18n workflow.
- [x] Narrow browser verification at 1440 and 390; stop the app and verify shutdown.
- [x] Scoped validation, follow-up diff review and one normal local commit; no push.

Follow-up evidence: the 1440/390 browser checks passed without Refresh or form submissions; app processes stopped and ports released. Changed-file Biome applied no fixes. Focused Impact tests passed 5 files/60 tests; the ERP package gate passed 144 files/1,963 tests. Scoped ERP typecheck passed on the second, memory-bounded attempt after a kernel-confirmed OOM in the first. Build remains SKIP.

Translations: 12 glossary-attached chunks filled through `openai-codex/gpt-6-luna`, deterministic merge remaining 0 and unmatched 0, Linguito exit 0. The same `check-glossary.mjs --json` command exits 1 in both the clean detached baseline at `376a313dac8682d3305d7191559cd33be182ad88` and the current tree. Both have exactly 1,292 identical enforced hits, with zero current-only or baseline-only enforced violations. Advisory hits are 14,794 at baseline and 14,787 currently; the new copy adds zero enforced or advisory hits. This is proven pre-existing, non-blocking terminology debt under Carbon's fix policy. No terminology repair or populated-translation rewrite. Temporary baseline worktree and translation scratch removed; no push.

## Boundaries

UI only. No route/service/model/authz/schema/data/MCP/backup/shared primitive changes. Existing operation-view drift stays untouched. Startup, if needed: `NODE_OPTIONS=--max-old-space-size=4096 crbn up --no-portless --no-regen`. No lint/typecheck/build with the app running. Hook performs broad extraction/staging: inspect all resulting catalogs and stop on unrelated churn rather than include it or bypass hooks.
