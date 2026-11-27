# Lesson clean-up, 2026-11-24

The user approved this policy for groups A and C of
`.ai/runs/2026-11-24-lesson-triage.md`:

1. If a rule or a check states every clause of a lesson, delete the lesson. If
   it states only part, trim the lesson to the rest, and name the rule or check.
2. If the code a lesson names moved, update the lesson. If the code and the
   pitfall are both gone, delete the lesson.

6 agents applied it to the 18 topic files. Each agent first checked that the
named rule or check really says what the reviewer claimed.

| Action | Lessons |
|---|---|
| Deleted | 23 |
| Trimmed | 89 |
| Updated | 56 |
| Kept unchanged | 14 |

The reviewers were wrong 5 times. The agents kept or corrected those lessons:
`per-edge-findings-are-not-a-row-count` (the code still exists),
`validatedform-needs-the-validator-not-the-raw-schema` (the lesson itself was
false, so it is deleted), `a-cron-that-walks-every-tenant-must-isolate-each-tenant`
(a wrong `maxDuration` clause is removed),
`openproductionorders-is-mrp-supply-not-the-open-jobs-for-an` and
`a-published-schema-default-is-a-promise-the-server-has-to-ke` (the pitfall is
still real).

The lesson `the-root-env-overrides-env-local-so-a-worktree-s-db-port-is`
disagreed with `environment-configuration.md`. Both are true for different
loaders: `crbn` loads `.env.local` over `.env`, but vitest and the Deno tests
read the root `.env`. The lesson now describes the shared database
(`wt_<slug>`) and says to export this worktree's URL first.

### database-access, auth-and-security — 3 deleted, 19 trimmed, 8 updated, 1 kept

| id | action | reason |
|---|---|---|
| a-cast-to-an-optional-property-silently-yields-undefined-on | trimmed | The cast section stays; the pool section now names `getProcessPool`. |
| a-client-swap-can-change-runtime-value-types-kysely-once-ret | trimmed | The BIGINT, pool-factory and client-swap clauses stay. |
| a-generated-column-is-writable-in-the-supabase-insert-type-b | trimmed | "An Insert type does not prove a column is writable" stays. |
| a-header-and-the-get-method-copy-into-it-share-one-transacti | trimmed | Only the `withTransaction` sentence is removed. |
| a-jsonb-column-returns-object-keys-in-another-order-than-you | trimmed | The general sorted-key rule stays. |
| a-kysely-write-needs-its-own-rls-gate | trimmed | The general gate and the rename steps stay. |
| a-local-only-sync-step-does-not-deploy-authz-manifest-2026-0 | trimmed | The CI-gate clause and "prove the test red first" stay. |
| a-postgrest-filter-on-an-embedded-column-needs-inner-or-it-f | trimmed | The rule for every query stays. |
| chained-supabase-writes-in-a-route-action-are-not-a-transact | trimmed | The locked-read precondition stays; now names `finalizePurchasingRfq`. |
| comparing-a-kysely-timestamp-against-a-postgrest-one-is-sile | trimmed | The SECURITY DEFINER section is removed; sections 1 and 2 stay. |
| kysely-returns-date-columns-as-js-date-s-postgrest-returns-s | trimmed | "Fix it at the driver" stays. |
| kysely-writes-in-a-server-function-bypass-rls-every-one-need | trimmed | The row-count and resume clauses stay. |
| max-rows-is-enforced-in-production-but-not-by-the-local-dev | trimmed | The general paging rule stays. |
| multi-tenancy-every-query-must-scope-by-companyid | deleted | Two rules and `AGENTS.md` state every clause. |
| never-build-postgrest-or-filter-strings-from-external-values | kept | The check catches `.ilike.` only. |
| a-js-array-bound-for-a-jsonb-column-must-be-stringified-on-t | updated | Now names `@carbon/database/json` and `convertDocument`. |
| a-module-the-browser-bundles-must-not-reach-the-kysely-runti | updated | Now names the UI files that import strict-backflush. |
| a-ts-expect-error-on-generated-db-types-is-evidence-of-a-dro | updated | Points to the matching lesson in `database-migrations.md`. |
| kysely-builds-one-column-list-per-multi-row-insert-a-conditi | updated | `quoteLineToJob` is in `production.service.ts` now. |
| node-side-re-exports-from-the-deno-functions-tree-must-dodge | deleted | The code and the pitfall are both gone. |
| retrying-a-5xx-from-a-non-idempotent-edge-function-multiplie | updated | Now uses `storageReadFetch` as the example. |
| ts-expect-error-ts2589-on-supabase-joined-selects-is-fragile | updated | Gone route names removed; the general pitfall stays. |
| a-constant-between-mcp-read-and-its-function-drops-the-mcp-t | trimmed | The digest diff check stays; names `*_PAGING` and `leafDocs`. |
| a-link-minted-for-an-api-key-names-its-creator-not-the-key | trimmed | The rule for any new link-returning operation stays. |
| error-cause-shows-the-cause-to-the-user | deleted | `flash-system.md` states both clauses. |
| moving-a-list-building-block-out-of-its-module-drops-the-pub | trimmed | "Do not move it" and the digest diff stay. |
| permission-admits-a-read-only-api-key | trimmed | "Ask what the gate means for a key" stays. |
| a-key-looked-up-anywhere-in-the-payload-finds-the-wrong-one | updated | Gone dispatcher names removed. |
| a-shared-executor-acquires-callers-nobody-planned-for-grep-e | updated | Gone executor names removed. |
| rls-does-not-bound-an-mcp-tool-handed-db-its-declared-permis | updated | Now says to set the function's own `permission`. |

### database-migrations, accounting-and-posting, sales-purchasing-invoicing — 1 deleted, 15 trimmed, 10 updated, 5 kept

One reviewer claim was wrong: `per-edge-findings-are-not-a-row-count` (kept; `totalExcludedRows` exists).

| id | action | reason |
|---|---|---|
| a-caller-supplied-document-number-used-to-leave-the-counter | trimmed | The check covers the CASE part; "do not retry `get_next_sequence`" stays. |
| a-function-redefined-by-forking-its-last-migration-picks-up | trimmed | "No DDL on a write path" stays. |
| a-function-redefinition-forked-from-an-old-copy-reverts-ever | trimmed | The diff step, the SQL tests and the merge note stay. |
| a-hardcoded-list-that-mirrors-the-schema-goes-stale-silently | kept | The general rule is only in the lesson. |
| a-language-sql-set-returning-function-s-internal-order-by-is | trimmed | The general rule and the plpgsql option stay. |
| a-merged-away-table-breaks-every-existing-backup-unless-the | trimmed | "A skipped hook is not a passed check" stays. |
| a-public-security-definer-function-that-calls-net-http-post | trimmed | The verify step stays; an outdated "keep REVOKE ALL" is removed. |
| a-rule-about-a-column-belongs-where-every-writer-of-that-col | kept | "List every writer" is only in the lesson. |
| a-second-foreign-key-between-two-tables-breaks-every-postgre | kept | The general rule is not in a rule. |
| a-trigger-that-fills-a-default-skips-only-a-backup-load | kept | The general rule is not in a rule. |
| an-entity-in-audit-config-ts-records-nothing-until-its-table | trimmed | The `pg_trigger` debug step stays. |
| audit-fk-snapshots-constraint-less-columns-are-invisible-to | trimmed | The disjoint invariants and "no backfill" stay. |
| backdated-migration-timestamps-break-remote-deploys | trimmed | The backdating rule and the rescue steps stay. |
| create-or-replace-view-without-with-silently-drops-security | trimmed | The anon count test and the `companyId` join stay. |
| per-edge-findings-are-not-a-row-count | kept | The "stale" claim was wrong. |
| porting-a-trigger-body-start-from-its-newest-definition | trimmed | The port to a new name and the default-pinning test stay. |
| postgres-transition-tables-are-visible-only-to-the-function | deleted | `event-system.md` states every clause. |
| re-applying-demo-data-runs-code-a-first-apply-never-reaches | trimmed | "Run an idempotent test twice" stays. |
| a-foreign-key-to-account-must-be-restrict-and-a-new-one-need | updated | Names `softReferenceBranches` and the current `REFERENCE_POLICY`. |
| adding-check-validate-requires-auditing-every-writer-of-the | updated | Now names `getMethod`. |
| changing-seed-data-ts-only-reaches-new-companies-existing-co | updated | Now names `seed-data.ts` and `seedCompany`. |
| single-column-fks-on-multi-tenant-children-accept-cross-tena | updated | New precedent migration and `batchOperation`. |
| the-backups-schema-baseline-on-main-can-carry-phantom-tables | updated | Now names `scripts/git-hooks/pre-commit`. |
| a-job-s-wip-is-not-only-the-lines-documented-against-the-job | trimmed | "Write the journal before Done" stays. |
| a-per-row-document-representation-must-be-decided-in-one-pla | trimmed | The pattern for new families stays. |
| apportion-a-document-total-never-concentrate-its-rounding-re | trimmed | The stable ordering and "derive then verify" stay. |
| posting-group-style-matrices-are-a-rejected-pattern | kept | The design rule against N×M matrices is not in a rule. |
| a-detector-and-the-builder-it-feeds-share-one-zero-value-rul | updated | Now names `resetAndRecostInventory`. |
| chart-of-accounts-group-headers-have-no-number-resolve-paren | updated | Now names `seed-data.ts`. |
| never-resolve-a-control-account-by-number-name | updated | Now names `postSalesInvoice` and `postPayment`. |
| a-new-row-reusing-a-readable-id-must-qualify-it-externallink | updated | Now names `getMethod`. |

### ui-components-and-forms, tables-and-lists, dates-numbers-i18n — 5 deleted, 14 trimmed, 3 updated, 3 kept

One lesson was false: `validatedform-needs-the-validator-not-the-raw-schema` (deleted; `ValidatedForm` takes the raw schema now).

| id | action | reason |
|---|---|---|
| a-clickable-row-made-keyboard-reachable-must-not-wrap-its-ow | deleted | `conventions-ui.md` has all three clauses. |
| a-drag-re-rendered-every-card-on-the-board | trimmed | The check enforces the `useSensor` constant; the thin-shell card and the render count stay. |
| a-drawer-rendered-as-item-drawer-cannot-animate-closed | trimmed | The `Presence`-chain check and the frame trace stay. |
| a-grid-position-must-name-a-sample-id-not-samples-index-of-a | trimmed | `inspection-system.md` has `placeSamples`; the embed-ordering point stays. |
| a-new-record-type-copies-its-sibling-s-ui-not-the-generic-ar | trimmed | `AGENTS.md` has the sibling rule; "add a missing pattern to carbon-design" stays. |
| a-plain-duration-does-not-time-animate-in-animate-out | trimmed | The `getComputedStyle` check stays. |
| a-route-dialog-closed-by-navigating-cannot-animate-closed-ei | trimmed | The close-then-navigate order with unsaved changes stays. |
| a-submit-button-that-stays-live-is-a-duplicate-write-engine | trimmed | Gone names removed; the retry-wrapper and job-retry clauses stay. |
| a-temporary-override-lives-in-the-thing-it-overrides-not-in | trimmed | Gone Halloween names removed; the general pitfall stays. |
| every-ui-task-names-its-precedent-screen-and-is-checked-by-s | deleted | The `carbon-design` skill states every clause. |
| position-sticky-inside-a-horizontal-board-needs-a-content-wi | trimmed | The scroll-root clamp and the sticky column classes stay. |
| react-aria-compares-formatoptions-by-reference-an-inline-lit | trimmed | "Do the same in a new wrapper" stays. |
| react-aria-s-blur-commit-makes-the-input-formatter-part-of-a | trimmed | "Round a derived value to the field's scale first" stays. |
| the-theme-a-page-renders-is-not-the-theme-the-user-picked | deleted | Its code is gone, and `coding-conventions.md` has the clauses still true. |
| unmounting-a-collapsed-panel-throws-away-the-state-inside-it | deleted | `conventions-ui.md` §7 states it in the same words. |
| a-zod-refine-that-returns-an-object-instead-of-a-boolean-sil | updated | Line reference updated; the bug is still in the code. |
| full-screen-height-calcs-must-subtract-the-app-shell-inset | updated | Path is now `components/Layout/Navigation/CollapsibleSidebar.tsx`. |
| twin-validatedform-s-at-the-same-jsx-slot-share-one-rvf-stor | updated | `ChangeOrder` is now `ChangeNotice`. |
| validatedform-needs-the-validator-not-the-raw-schema | deleted | The claim is false now. |
| a-server-export-mapping-cannot-add-a-column-the-browser-omit | trimmed | "Check the request's column list" stays. |
| lingui-a-ternary-inside-t-bakes-the-english-words-as-runtime | kept | The rule does not say it. |
| lingui-plural-inside-a-memo-component-calls-the-global-i18n | trimmed | `select()` and the two-phrase choice stay. |
| lingui-plural-must-be-the-whole-message-with-no-variables-in | kept | The rule and the check do not say it. |
| lingui-s-msg-macro-forces-generated-translatable-strings-int | trimmed | Path updated to `packages/ee/src/workflows/catalog/`. |
| po-catalogs-are-committed-only-after-lingui-clean | kept | The rule does not say to run it after every extract. |
| typed-quantities-do-not-need-number-wrappers | kept | The rule covers only NUMERIC reads; the lesson covers any typed number. |

### routes-and-loaders, jobs-and-events, workflows — 9 deleted, 18 trimmed, 2 updated

Two reviewer claims were wrong: `a-cron-that-walks-every-tenant-must-isolate-each-tenant` told agents to set a `maxDuration` that the code does not have (the clause is removed), and `a-published-schema-default-is-a-promise-the-server-has-to-ke` names gone code but the pitfall is real (kept, now names `defineServiceFn`).

| id | action | reason |
|---|---|---|
| a-browser-safe-env-flag-isn-t-live-until-the-root-loader-s-h | trimmed | The rule gives the three edits; the lesson keeps the `getBrowserEnv()` diff debug step. |
| a-client-ts-module-is-empty-on-the-server-even-for-a-value-a | trimmed | The rule gives the naming trap; the lesson keeps "load the page after you edit `root.tsx`". |
| a-component-s-outlet-beside-the-route-s-outlet-mounts-the-ch | deleted | `coding-conventions.md` and `no-bare-outlet` state every clause. |
| a-fetcher-s-redirect-is-dropped-when-anything-revalidates-du | trimmed | The check covers the revalidator; the lesson keeps the `shouldRevalidate` debug step. |
| a-flash-returned-with-data-from-a-page-loader-never-shows | trimmed | The rule gives the redirect pattern; the lesson keeps "no `data()` flash from a page loader". |
| a-layout-that-skips-its-loader-is-only-as-correct-as-its-ski | trimmed | The rule is in `coding-conventions.md`; the lesson keeps the `_routes` debug step. |
| a-notification-click-on-an-uncontrolled-tab-opens-nothing | trimmed | The lesson keeps focus first, the `try`, and `openWindow` on failure. |
| a-realtime-subscription-to-a-table-that-is-not-published-fai | trimmed | The check covers the API; the lesson keeps "change the row while the page is open". |
| a-server-only-value-in-a-route-component-or-a-dropped-side-e | trimmed | Two checks enforce it; the lesson keeps "run `pnpm --filter erp build`". |
| a-service-worker-s-install-time-cache-can-come-out-empty-and | deleted | `service-workers.md` states it. |
| changing-a-precached-file-without-bumping-the-cache-name-cha | deleted | `service-workers.md` states it. |
| getcompanyid-read-an-httponly-cookie-in-the-browser-and-alwa | trimmed | The lesson keeps "never read a session cookie from `document.cookie`". |
| macos-silently-replaces-a-web-notification-that-reuses-a-tag | trimmed | The lesson keeps "close old notifications" and the macOS log step. |
| registering-on-load-from-entry-client-never-registers-in-dev | trimmed | The lesson keeps the `getRegistrations()` check. |
| state-seeded-from-loaded-data-is-a-copy-that-nothing-updates | deleted | `coding-conventions.md` and two checks state every clause. |
| two-hooks-that-open-the-same-realtime-topic-close-each-other | deleted | `realtime-system.md` "One channel per topic" states it. |
| work-a-request-does-not-await-is-frozen-with-the-instance-on | deleted | `packages/utils/AGENTS.md` states it. |
| a-published-schema-default-is-a-promise-the-server-has-to-ke | updated | Names `defineServiceFn` and its input parse now. |
| a-cron-that-walks-every-tenant-must-isolate-each-tenant | trimmed | The wrong `maxDuration` clause is gone. |
| a-restore-told-the-change-log-but-not-the-open-tabs | trimmed | The lesson keeps the `window.clientCache` debug step. |
| a-write-that-changes-nothing-still-costs-a-queue-message-an | updated | Names `updatePlacements` in `persist-location.ts` now. |
| inngest-concurrency-limit-0-is-no-capacity-not-unlimited | trimmed | The check enforces `>= 1`; the lesson keeps the dead-handler clause. |
| the-local-inngest-dev-server-v1-19-4-can-t-handle-debounce-i | trimmed | The lesson keeps "no `debounce` in dev" and the `docker logs` check. |
| a-new-key-in-an-inngest-step-s-return-breaks-runs-in-flight | updated | `pushRecipientIds` is gone; the example key is generic now. |
| a-change-trigger-s-before-and-after-share-a-record-id-so-an | trimmed | Path is now `packages/ee/src/workflows/runtime/`. |
| the-user-table-has-no-companyid-so-the-usual-tenancy-check-c | trimmed | The lesson keeps "confirm `companyId` per table". |
| a-default-arm-silently-defeats-discriminated-union-exhaustiv | updated | Path is now `packages/ee/src/workflows/definition/nodes.ts`. |
| a-generated-catalog-must-key-entity-refs-off-the-schema-not | updated | Path is now `packages/ee/src/workflows/catalog/build.ts`. |
| a-read-time-format-migration-seam-must-run-before-the-curren | updated | Names `packages/ee/src/workflows/definition/normalize.ts` now. |

### dev-tooling-and-ci, testing, files-cad-viewer — 6 deleted, 9 trimmed, 15 updated, 1 kept

| id | action | reason |
|---|---|---|
| a-vite-plugin-that-reads-the-file-name-must-drop-the-query-f | trimmed | "Verify with `react-router build`, not vitest" stays. |
| apps-erp-targets-es2019-so-packages-workflows-cannot-use-big | trimmed | The rule for all packages stays; the title no longer names `packages/workflows`. |
| crbn-reload-must-load-root-env-compose-substituted-secrets-s | trimmed | Now names `loadEnvFiles`; "verify the health endpoint" stays. |
| db-seed-dev-under-portless-needs-the-local-ca-and-a-hibernat | trimmed | Only "wake the hibernated stack" stays. |
| deno-edge-functions-are-not-deno-check-clean-gate-on-own-fil | deleted | The functions it names are gone; CI runs `deno check`. |
| ioredis-retrystrategy-returning-null-kills-auto-recovery | trimmed | "Test with a real Redis restart" stays. |
| on-carbon-shared-a-shared-service-s-bare-name-answers-in-eve | trimmed | The `getent ahostsv4` check stays. |
| parallel-subagents-each-running-the-heavy-checks-exhaust-the | trimmed | "A waiting heavy-lock is not a hang" stays. |
| the-edge-runtime-reuses-a-worker-env-and-all-per-pool-key | trimmed | "Put every varying value in `poolKey`" stays. |
| a-blanket-symbol-rename-re-homes-family-neutral-code-into-on | updated | Now names `ItemFilter` in `rule-filters.ts`. |
| a-git-hook-exports-git-dir-so-any-git-run-from-a-subdirector | updated | Now names `scripts/git-hooks/pre-commit`. |
| a-lookup-table-keyed-by-source-text-must-be-a-map | updated | A gone constant name is removed. |
| never-git-checkout-a-generated-file-to-undo-a-local-patch-th | updated | The gone Deno types copy is removed. |
| resolve-merge-conflicts-in-generated-files-by-regenerating-n | updated | Gone generated files are removed. |
| scripts-one-off-is-a-registry-not-a-folder-of-leftovers | updated | A deleted script name is removed. |
| turbo-typecheck-test-runs-can-regenerate-carbon-database-art | updated | The gone Deno types copy is removed. |
| vite-caches-a-module-resolution-miss-for-the-whole-dev-sessi | updated | A gone component name is replaced by a generic one. |
| a-mock-of-a-function-in-the-same-file-does-not-intercept | deleted | `testing.md` says not to mock our own code. |
| a-test-that-stays-green-when-you-break-the-code-guards-nothi | deleted | `testing.md` "Before you commit one: break the code" states every clause. |
| the-root-env-overrides-env-local-so-a-worktree-s-db-port-is | updated | Rewritten for the shared database: test runners read the root `.env`, so export this worktree's `wt_` URL first. |
| a-tested-assert-helper-that-is-never-imported-is-worse-than | updated | A gone edge-function name is removed. |
| in-a-bulk-api-sweep-a-4xx-carrying-a-service-s-generic-fallb | updated | Now names `adjustInventory`. |
| storage-keys-built-from-raw-filenames-break-silently-always | kept | The rule covers part of one clause only. |
| a-functions-shared-source-with-npm-deps-must-register-them-t | updated | Only the still-true `.d.ts` rule stays, with a new title. |
| a-wrapper-that-narrows-a-result-type-needs-its-call-sites-re | updated | A gone function name is removed. |
| name-only-fastener-classification-pin-and-spec-suffixes-mark | updated | Python names replaced by the Rust ones. |
| ordering-heuristics-must-be-gated-on-a-large-noisy-model-not | updated | Now names `sandwiched_parts`. |
| profile-the-planner-before-optimizing-the-flood-was-pass-thr | updated | Python calls replaced by the Rust ones. |
| sweeping-storage-call-sites-by-one-literal-misses-named-cons | updated | Deleted constants removed. |
| synthetic-box-meshes-fake-huge-penetration-under-sustained-s | updated | trimesh replaced by `box_part`. |
| trimesh-collisionmanager-rebuilds-bvhs-on-every-single-objec | updated | Python calls replaced by the Rust ones, with a new title. |
| verify-what-actually-rendered-before-root-causing-a-bad-moti | updated | Now names `display.ts`. |

### planning, integrations, inventory, production — 5 deleted, 18 trimmed, 9 updated, 2 kept

| id | action | reason |
|---|---|---|
| a-creation-time-swap-must-be-keyed-by-its-provenance-column | trimmed | The rule states `resolvePickRule`; the general provenance rule and the two-direction tests stay. |
| a-reservation-class-that-must-outlive-job-status-needs-an-ex | trimmed | "Grep every filter in the read path" stays. |
| a-scheduler-decision-is-only-stored-when-every-write-back-gu | trimmed | "Test the decision and the write together" stays. |
| consume-first-is-one-rule-for-bought-and-made-parts-2026-09 | trimmed | "Is the exception a product decision?" stays; paths updated. |
| consume-first-splits-are-per-assembly-not-per-unit-2026-09-1 | deleted | `supersession-system.md` states every clause. |
| openproductionorders-is-mrp-supply-not-the-open-jobs-for-an | kept | `mrp-system.md` defines the view only; the rule is only in the lesson. |
| a-degenerate-input-guard-on-a-scheduling-surface-is-a-silent | updated | Paths now name `packages/planning/src/scheduling/`. |
| a-helper-that-models-a-chain-must-be-tested-with-a-loop-2026 | updated | Path is now `packages/database/src/supersession-pick.ts`. |
| compare-oauth-scopes-the-way-the-vendor-reports-them-not-the | trimmed | The `oauth.test.ts` refusal and the diff step stay. |
| dev-response-caches-must-allow-list-never-blanket-cache-gets | trimmed | "Can two reads differ within the TTL?" stays. |
| integration-money-shapes-are-contracts-not-interchangeable-n | deleted | `ramp-integration.md` states every clause. |
| one-oauth-state-mechanism-the-cookie-helper-consumed-by-valu | trimmed | "Do not add a second signer" stays. |
| one-shot-stores-peek-for-validation-take-only-for-the-write | deleted | `onshape-panel.md` states it, and the scope is that one file. |
| open-an-oauth-popup-in-the-click-before-you-fetch-its-url | kept | The rules state it per feature only. |
| legacy-adoption-must-prove-the-entire-document-identity | deleted | No adoption code remains. |
| onshape-individual-release-assets-need-the-complete-source-i | updated | `getElementThumbnail` removed. |
| prerequisite-lookup-failures-must-hold-outbound-cursors | deleted | The cursors are gone; the general rule is in `write-time-checklist.md`. |
| provider-errors-are-not-confirmation-of-the-desired-remote-s | updated | Now names the purchase-order archive in `purchase-order.ts`. |
| unbounded-mapping-sets-require-bounded-status-reads | updated | The sweep name is removed; the chunking rule stays. |
| a-posting-that-moves-held-stock-must-say-it-is-the-release | trimmed | "Never set `app.sync_in_progress` to pass the hold" stays. |
| a-running-total-must-be-subtracted-from-the-pool-it-was-take | trimmed | The general pool rule and the accumulator test stay. |
| a-tag-that-points-at-a-line-is-cleared-by-every-write-that-r | trimmed | The other attributes and the clear-test order stay. |
| a-tracked-entity-s-bin-is-where-it-is-never-the-document-lin | trimmed | The null-aware helper and the `IS NOT DISTINCT FROM` clause stay. |
| a-void-reverses-only-what-is-still-where-the-posting-put-it | trimmed | The general void rule and the `settleQuantity` trap stay. |
| returns-must-not-decrement-pickinglistline-quantitypicked-th | trimmed | The trigger reason and the writer rules stay. |
| tracked-consumption-split-must-book-against-the-entity-s-act | trimmed | "Every movement row" stays. |
| two-readers-of-the-same-shelf-must-share-one-definition-2026 | trimmed | The list of ways stock reaches a bin stays. |
| a-gate-on-the-buttons-is-not-a-gate-a-rule-needs-one-owner-a | trimmed | The client, test and allow-list clauses stay. |
| a-make-to-order-line-is-never-picked-and-never-split-for-con | trimmed | The `recalculate` warning stays; paths updated. |
| one-fact-one-source-a-pointer-beside-its-own-history-lost-th | trimmed | The general one-source rule stays. |
| a-post-insert-fix-up-pass-must-be-scoped-to-the-rows-the-flo | updated | Now names `settleConsumeFirstLines`. |
| a-post-success-prompt-must-not-live-in-the-component-the-suc | updated | Now names `batchCompleteFetcher`. |
| guard-a-state-by-listing-everything-that-writes-it-not-by-wh | updated | The old tool name is removed. |
| job-completion-side-effects-must-live-in-complete-job-to-inv | updated | Now names `returnPickedRemaindersForJob`. |

