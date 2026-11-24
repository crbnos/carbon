# Database migrations lessons

SQL migrations, triggers, views, functions, constraints, foreign keys, seeds and datasets, schema backups.

## A failed COPY in a plain-text dump can swallow the rest of the restore

```scope
id: a-failed-copy-in-a-plain-text-dump-can-swallow-the-rest-of-t
paths: ["scripts/restore-database.sh","packages/dev/src/commands/restore.ts"]
triggers: ["ON_ERROR_STOP"]
```

**Context:** On 2026-10-09 a `crbn restore` of a prod cluster backup ended with ✅. The restored database had no index, constraint, trigger or policy in `public`, and an empty migration ledger. The trailing `migration up --include-all` would then have replayed all 1,159 migrations.

**Problem:** The local stack's auth, storage and realtime tables come from its own service images, and they are older than prod's. Prod's `storage.objects` has a column (`archived_at`) that the local table does not have. A `COPY` that names an unknown column or table fails when psql parses it, so psql never enters copy mode. It then reads the block's data rows as SQL. In that data an unbalanced quote opened a string that never closed, so psql read the rest of the file as part of it. With `ON_ERROR_STOP=0`, nothing failed. The same drift also reaches DDL. The backup's newer `storage.protect_bucket_control_columns` trigger reads columns that the local `storage.buckets` does not have, so every bucket insert failed. Those service-schema objects survive later restores, because a restore drops only `public`. Separately, a Supabase backup is not one consistent snapshot: it contained payments whose journal it did not hold. So 15 foreign keys could not be validated.

**Rule:** Do not trust a restore that ran with `ON_ERROR_STOP=0` until you verify it by name. `scripts/restore-database.sh` now does these things:

1. It fits each non-public `COPY` to the local columns, and drops the block when the local table does not exist.
2. It skips function definitions owned by the auth, storage and realtime admin roles. Those functions belong to the local service images.
3. It checks each `public` index, constraint, trigger and policy from the dump, and the ledger row count. It re-adds a foreign key that cannot be validated as `NOT VALID`.
4. It exits 1 on any shortfall, and `crbn restore` then does not migrate.

A ✓ that a script prints after a step that is allowed to fail is not evidence. Read the state back.

**Applies to:** `scripts/restore-database.sh`, `packages/dev/src/commands/restore.ts`, and any tool that loads a plain-text dump through psql.

## A merged-away table breaks every existing backup unless the rename map and schema manifest move with it

```scope
id: a-merged-away-table-breaks-every-existing-backup-unless-the
paths: ["packages/jobs/src/backups/renames.ts","packages/jobs/manifests/schema.json",".claude/rules/workflow-database-migration.md"]
triggers: ["DROP TABLE","RENAME TO","TABLE_RENAMES"]
```

**Context:** The sales-rules PR (#1382) merged `storageRule` / `storageRuleItemAssignment` / `storageRuleWorkCenterAssignment` into the shared `enforcementRule*` tables and dropped the old ones. The branch shipped with no `TABLE_RENAMES` entries and a stale `packages/jobs/manifests/schema.json` still listing the dropped tables.

**Problem:** A restore that meets an unmapped missing table refuses by design (`applyTableRenames` → `assertBackupImportable`), so every customer backup taken before the merge would stop restoring the moment it shipped. The pre-commit `db:check:backups` gate that catches this only runs against a migrated LOCAL database — on a worktree with no dev stack the hook skips with a warning, which is exactly the state a reviewer or merge-fixer is in.

**Rule:** A migration that renames or drops any tenant-scoped table needs, in the same commit: (1) a `TABLE_RENAMES` entry (`packages/jobs/src/backups/renames.ts` — new name, or `null` if the feature died), (2) a default (or nullability) on any NEW NOT-NULL column of the rename target so old backup rows can load, and (3) a regenerated `manifests/schema.json`, which requires running `pnpm db:migrate` + `pnpm db:check:backups` against a live local DB. If the DB isn't running, say so — a skipped hook is not a passed check.

**Applies to:** `packages/database/supabase/migrations/**` table renames/drops, `packages/jobs/src/backups/renames.ts`, `packages/jobs/manifests/schema.json`, `.claude/rules/workflow-database-migration.md` step 3b.

## A migration on main can carry a timestamp ahead of UTC

```scope
id: a-migration-on-main-can-carry-a-timestamp-ahead-of-utc
paths: ["packages/database/supabase/migrations/*.sql"]
triggers: []
```

**Context:** `supabase migration new` stamps a migration with the current UTC time. A migration merged to `main` (`20261009141827_link-custom-field-type.sql`) carried a time about 2.5 hours ahead of UTC, likely from a local clock.

**Problem:** Every migration created after the pull got an older timestamp than that file. Production's `supabase db push` refuses a migration that sorts before one it already applied, so the new migrations would have failed to deploy. The clobber check and every test passed; nothing local shows it.

**Rule:** After you pull `main`, compare your migrations' timestamps with the newest one on `main` (`ls packages/database/supabase/migrations | tail`). If yours sort first, rename them to sort after it, keep their order and content, and use a non-`000000` HHMMSS. Re-generate a generated `authz migration` file first, then rename it with the rest.

**Applies to:** `packages/database/supabase/migrations/`; every branch that adds a migration.

## A trigger that fills a default skips only a backup load

```scope
id: a-trigger-that-fills-a-default-skips-only-a-backup-load
paths: []
triggers: ["app.sync_in_progress","app.dataset_apply","app.backup_load"]
```

**Context:** The part number display triggers (`20261121061455_supplier-part-number-display.sql` and the customer migration after it) first skipped when `app.sync_in_progress` was set, so the dataset apply could stamp the seeded lines itself. Then they skipped `app.dataset_apply`, and a TypeScript helper stamped the seeded lines after the tiers.

**Problem:** `app.sync_in_progress` is also the accounting sync's flag (`withTriggersDisabled`, `@carbon/ee/accounting`). The Xero purchase order pull deletes and re-inserts every line under it, so every synced line came back with no display choice and no copy of the supplier part number. The `app.dataset_apply` skip needed a second copy of the trigger's rule in TypeScript, and that helper's company-wide UPDATE stamped a real company's legacy lines on a dev seed without a wipe.

**Rule:** A trigger that fills a default for a new row skips only `app.backup_load`: a restore brings its own values. Let it run during a dataset apply: the tiers insert parents before children, so it gives seeded rows the values it gives any row. Use `app.sync_in_progress` only to skip side effects an external sync must not cause (events, webhooks, contact cleanup).

**Applies to:** Every new BEFORE/AFTER row trigger or interceptor that fills or derives a value on insert.

## `account` is scoped by `companyGroupId`, not `companyId`

```scope
id: account-is-scoped-by-companygroupid-not-companyid
paths: ["packages/database/src/datasets/tiers/09-accounting.ts"]
triggers: ["from(\"account\")","FROM account","FROM \"account\"","selectFrom(\"account\")"]
```

**Context:** The dataset's accounting tier picked a GL account with `SELECT id FROM account WHERE class = 'Asset' ORDER BY number LIMIT 1` and posted the seeded journal lines against it. The tiers run on a raw `pg` client, which bypasses RLS entirely.

**Problem:** `account` is one of the few business tables NOT keyed by `companyId` — it belongs to the company *group*, so there is no `companyId` predicate to add by reflex and an unscoped `LIMIT 1` silently reaches across tenants. With RLS off there is nothing else stopping it, so one company's journal lines can be posted to another tenant's chart of accounts. Adding `AND "companyId" = $1` would simply have failed with `column "companyId" does not exist`, which is what makes the omission easy to leave in.

**Rule:** In any service-role or Kysely path, confirm which column actually scopes the table before writing the predicate — `companyId` for most, `companyGroupId` for `account` and its children. A `LIMIT 1` with no tenancy predicate in RLS-bypassing code is a cross-tenant bug even when it "works" locally, because a single-tenant dev database cannot show it.

**Applies to:** `packages/database/src/datasets/tiers/09-accounting.ts`; any `account` lookup in `packages/jobs/**`, `apps/erp/app/modules/**` postings, or a Kysely transaction.

## An entity in `audit.config.ts` records nothing until its tables have `events: true`

```scope
id: an-entity-in-audit-config-ts-records-nothing-until-its-table
paths: ["packages/database/src/audit.config.ts","packages/database/src/event-system/attachments.ts"]
triggers: ["auditConfig","syncAuditSubscriptions"]
```

**Context:** Change notice history (the `changeOrder` audit entity) was empty in the History drawer even with audit logging on (2026-10-08).

**Problem:** `auditConfig.entities.changeOrder` listed its 4 tables, and `syncAuditSubscriptions` created AUDIT subscriptions for them. But `packages/database/src/event-system/attachments.ts` gave `changeOrder` only a statement broadcast and the 3 child tables no entry at all, so no async event trigger existed and nothing reached the event queue. Every check looked green: subscriptions present, sweeper succeeding, queue empty.

**Rule:** When you add an entity to `audit.config.ts`, give each of its tables `events: true` in `attachments.ts` and ship it with `pnpm --filter @carbon/database authz migration <name>`. To debug an empty audit log, first check `pg_trigger` for `trg_event_async_*` on the table.

**Applies to:** `packages/database/src/audit.config.ts`, `packages/database/src/event-system/attachments.ts`.

## Appending SQL to an already-applied migration silently does nothing

```scope
id: appending-sql-to-an-already-applied-migration-silently-does
paths: ["packages/database/supabase/migrations/*.sql"]
triggers: [".rpc(","NOTIFY pgrst"]
```

**Context:** A migration adding `companySettings.requireMfa` was written and applied. Later, a `users_with_verified_mfa` RPC was appended to that SAME file and `pnpm db:migrate` was re-run. The function was never created. The employees page then showed "Not set up" for every user — including one with a verified factor — because the missing RPC returned an error that the loader discarded as an empty result.

**Problem:** Supabase tracks applied migrations by FILENAME. Once a file has run it is never re-read, so statements appended to it are invisible on every existing database while still applying to a fresh one. The two diverge silently, and there is no error at migrate time to notice.

**Rule:** Never append to a migration file that may already have been applied — a file is immutable the moment it runs anywhere. New statements go in a NEW timestamped file, even a one-line `CREATE OR REPLACE`. Corollary: a migration that adds an RPC also needs a PostgREST schema reload (`NOTIFY pgrst, 'reload schema'`) or the function stays invisible to the app; and a service call whose failure is indistinguishable from an empty result must check `error` explicitly rather than `data ?? []`.

**Applies to:** `packages/database/supabase/migrations/**`, any `client.rpc(...)` call site.

## Backdated migration timestamps break remote deploys

```scope
id: backdated-migration-timestamps-break-remote-deploys
paths: ["packages/database/supabase/migrations/*.sql","ci/src/migrations.ts"]
triggers: ["CREATE OR REPLACE VIEW"]
```

**Context:** CI `supabase db push --include-all` failed on all remotes with `column pi.balance does not exist` while applying `20260616061244`, which recreated the `purchaseInvoices` view.

**Problem:** A migration merged with a timestamp OLDER than already-deployed migrations gets applied out of order on remotes: the remote had already run `20260630095023` (drops `purchaseInvoice.balance`), so the backdated view recreation referenced a dropped column. Worse, the newer `20260630*` batch had forked its view body from a pre-fix definition, silently reverting the backdated migration's fix (`supplierShippingCost` multiply vs divide) — the backdated migration was both broken AND dead code.

**Rule:** Never merge a migration whose timestamp is older than the newest migration already on `main`/deployed. Before writing a view/RPC recreation, fork from the NEWEST definition of that view (grep all migrations, take the last). When rescuing a failed backdated migration, strip the superseded parts and re-land the still-wanted change in a fresh forward-dated migration; don't rename already-partially-applied files (re-applies them).

**Applies to:** `packages/database/supabase/migrations/`, `ci/src/migrations.ts`, any long-lived branch adding migrations.

## `CREATE OR REPLACE VIEW` without `WITH (...)` silently drops `security_invoker`

```scope
id: create-or-replace-view-without-with-silently-drops-security
paths: []
triggers: ["CREATE OR REPLACE VIEW","CREATE VIEW","security_invoker"]
```

**Context:** `openJobMaterialLines` served every company's open job material lines to the anon
key (reported against production, 2026-09-26). The clause had been added, audited back in, and
then dropped by four separate migrations that recreated the view from an older copy.

**Problem:** `CREATE OR REPLACE VIEW` REPLACES the view's options with whatever the statement
states, so a recreation that omits `WITH (security_invoker = true)` turns an invoker view back
into an owner-rights one. Owner rights bypass RLS on every table underneath, and every `public`
view is a PostgREST endpoint. Nothing failed: the app filters by `companyId` itself, so every
screen still looked right.

**Rule:** Every `CREATE [OR REPLACE] VIEW` states `security_invoker` — copy a view's definition
from its NEWEST migration, and re-check the `WITH` clause when you do. Test a view the way an
attacker reads it: `SET LOCAL ROLE anon; SELECT count(*) FROM "view";` must be 0. Join on
`companyId` too, so a view is tenant-consistent on its own.

**Applies to:** `packages/database/supabase/migrations/**`; enforced by the
`no-view-without-invoker` conformance check and the `view-without-security-invoker` invariant.

## Demo datasets state percentages the way people write them; the tier converts

```scope
id: demo-datasets-state-percentages-the-way-people-write-them-th
paths: ["packages/database/src/datasets/tiers/*"]
triggers: ["PricingRuleSpec","discountPercent","taxPercent"]
```

**Context:** `PricingRuleSpec.amount` is documented and validated as percent points
(0–100], but tier 02 inserted it into `pricingRule.amount` unchanged.

**Problem:** the pricing engine multiplies by a fraction (`price × amount`), so every demo
"5% discount" was a 500% discount and drove prices to the ≥ 0 floor. It surfaced only when
the price trace showed the step — the validator checked the dataset's own convention, not
the column's.

**Rule:** When a dataset field and the column it lands in use different units, convert in
the tier at the insert, next to a comment naming both units — and check any new percent
field against how the engine reads the column, not against the dataset type.

**Applies to:** `packages/database/src/datasets/tiers/*` — `pricingRule.amount`, and any
other fraction-valued column (`discountPercent`, `taxPercent`, rates).

## Enumerate the full ON DELETE graph before writing a data-deleting migration

```scope
id: enumerate-the-full-on-delete-graph-before-writing-a-data-del
paths: ["packages/database/supabase/migrations/20260812032423_job-material-self-reference-guard.sql"]
triggers: ["DELETE FROM"]
```

**Context:** A migration deleted 50 `jobMaterial` rows where a job listed its own output item as a material. A dry run "passed": it completed, and `productionQuantity` was verified unchanged at 4,566 rows.

**Problem:** The verification only covered the one child table that happens to be `NO ACTION`. `jobMaterial → jobMakeMethod → jobOperation` cascades into **six** further tables — `productionEvent` (labor/time), `jobOperationTool`, `jobOperationStep`, `jobOperationParameter`, `rework`, `nonConformanceJobOperation` — all `CASCADE`, all silent. `productionQuantity` was noticed precisely because `NO ACTION` raises an error; the destructive edges said nothing. Comparing the restored database against the untouched backup showed `productionEvent` had gone 3,159 → 3,158: one real customer labor record destroyed by a migration that appeared to succeed.

**Rule:** Before any `DELETE` in a migration, query `pg_constraint` for `confrelid` of every table the delete can reach and read `confdeltype` for each edge (`c` = CASCADE, `r`/`a` = RESTRICT/NO ACTION, `n` = SET NULL). The `RESTRICT` edges are the ones that will teach you by failing; the `CASCADE` edges are where the data actually goes. Design the cleanup so the cascade cannot reach anything historical — here, detaching (`parentMaterialId = NULL`) every subtree containing ANY `jobOperation`, so only empty method copies are collected. Verify with a probe that builds the exact structure, runs the real delete statement, and asserts the child rows survive — and where a snapshot exists, diff the affected table's count against the backup rather than trusting that the statement completed.

**Applies to:** `packages/database/supabase/migrations/20260812032423_job-material-self-reference-guard.sql`, any migration under `packages/database/supabase/migrations/` containing `DELETE FROM`.

## Lifecycle transitions need a stored state invariant

```scope
id: lifecycle-transitions-need-a-stored-state-invariant
paths: []
triggers: ["chargeStatus"]
```

**Context:** Charges use triggers to restrict Draft edits and the Draft→Posted→Voided transition sequence, while imports and test cleanup can intentionally bypass ordinary triggers.

**Problem:** Transition guards constrained how a row could change but did not guarantee that every stored status had its required audit shape. A status-only write could leave a Posted or Voided row without its actor and timestamp evidence.

**Rule:** Pair lifecycle transition guards with a validated database CHECK that defines every legal stored state. Fail migration preflight with row identities when existing data violates the invariant; never fabricate missing audit actors or timestamps.

**Applies to:** Charges and any auditable document lifecycle whose writers can bypass ordinary triggers or write status and audit fields independently.

## Node 24's readline splits a JSON line at U+2028 and U+2029

```scope
id: node-24-s-readline-splits-a-json-line-at-u-2028-and-u-2029
paths: ["packages/jobs/src/inngest/functions/tasks/company-backup.ts"]
triggers: ["createInterface","node:readline","deserializeTable"]
```

**Context:** `deserializeTable` read a backup table's NDJSON with
`readline.createInterface`. Restores worked locally (Node 22) and failed on BYOC
(Node 24) with "Unterminated string in JSON at position 662".

**Problem:** From Node 24, readline also ends a line at U+2028 (line separator)
and U+2029 (paragraph separator). `JSON.stringify` leaves both unescaped, so a
row holding text pasted from Word or a PDF was cut mid-string. `jq` reads the
same file without complaint, so checking the archive with it passes.

**Rule:** Read NDJSON by splitting on "\n" yourself (the one separator the
writer emits), never with readline. Reproduce JSON-reading bugs on the Node
version the deployment runs (`mise exec node@24 -- …`).

**Applies to:** `packages/jobs/src/inngest/functions/tasks/company-backup.ts`
(`deserializeTable`) and any new NDJSON or JSON-lines reader.

## `ON DELETE SET NULL` on a composite FK nulls every referencing column, not just the pointer

```scope
id: on-delete-set-null-on-a-composite-fk-nulls-every-referencing
paths: []
triggers: ["ON DELETE SET NULL","ON UPDATE SET NULL","SET DEFAULT"]
```

**Context:** A nullable pointer column that references a sibling table on Carbon's composite key, e.g. `workflow.activeVersionId` → `workflowVersion("id", "companyId")` (`20260730142317_workflows-foundation.sql`). Because every Carbon table is keyed `("id", "companyId")`, any such pointer FK is necessarily multi-column and includes `companyId`.

**Problem:** A bare `FOREIGN KEY ("activeVersionId", "companyId") REFERENCES ... ON DELETE SET NULL` sets **all** referencing columns to NULL when the parent row is deleted — including `companyId`, which is `NOT NULL`. The delete then fails with `null value in column "companyId" of relation "workflow" violates not-null constraint`, and the referenced row can never be deleted. It looks correct in review, applies cleanly, and only surfaces the first time something deletes the parent.

**Rule:** On a composite FK whose referencing columns include `companyId` (or any NOT NULL column), name the column in the action: `ON DELETE SET NULL ("activeVersionId")`. The column-list form needs Postgres 15+ (the local stack is 15.14). Same trap applies to `ON UPDATE SET NULL` and to `SET DEFAULT`. Always prove it with a real delete against the live schema — a migration that applies successfully tells you nothing about its referential actions.

**Applies to:** any migration adding a nullable pointer column that references another table's composite `("id", "companyId")` key.

## Per-edge findings are not a row count

```scope
id: per-edge-findings-are-not-a-row-count
paths: ["packages/jobs/src/backups/scope.ts"]
triggers: ["findExportScopeViolations","excludedRows","computeScopeExclusions"]
```

**Context:** `findExportScopeViolations` returns one entry per offending FK edge
(`jobOperationDependency` violates `jobId`, `operationId` and `dependsOnId`), and the
backup UI summed `violations[].rows` for the figure it showed the user.

**Problem:** A row escaping scope through three foreign keys was counted three times.
The failed-backup banner claimed "10 rows" where 4 rows existed, and the same sum sat on
the confirm button of an irreversible delete that then removed 4 — the toast and the
modal disagreed inside one flow.

**Rule:** When a diagnostic groups by RELATIONSHIP (FK edge, constraint, rule), it
cannot be summed into a count of ROWS. Compute the distinct count separately — one
`count(*)` over the OR of the offending predicates — and keep the per-edge list purely
as the breakdown. Name the two so they cannot be confused (`violations` vs
`rowsByTable`) and say so in the type's doc comment.

**Applies to:** `packages/jobs/src/backups/scope.ts`
(`findExportScopeViolationsDetailed`, `computeScopeExclusions`, `totalExcludedRows`),
`Manifest.excludedRowsByTable`, and any future "N things are wrong" surface.

## Porting a trigger body: start from its newest definition

```scope
id: porting-a-trigger-body-start-from-its-newest-definition
paths: ["packages/database/src/event-system/handlers/*.sql"]
triggers: ["CREATE OR REPLACE FUNCTION","sync_insert_company_related_records"]
```

**Context:** The event-system port (`20260410031811_remaining-interceptors.sql`) turned `insert_company_related_records` into the interceptor `sync_insert_company_related_records` (found 2026-10-24).

**Problem:** The interceptor inserts `companySettings` with only its id. The trigger it replaced also set `useMetric` from the company's country (`20250725212215_metric-default.sql`) and created the two billing address rows (`20260304112615_purchasing-info.sql`). For six months every new company started imperial, and nothing failed: the column has a default and the address reads use `maybeSingle`.

**Rule:** Before porting a function, find its newest definition (`grep -l "FUNCTION <name>" migrations/*.sql | tail -1`) and carry every statement across, or drop one on purpose with a note. A behavior that only sets a default value has no test to fail when it is lost: pin it with one (`seed-company.test.ts` pins `useMetric` per country).

**Applies to:** `packages/database/src/event-system/handlers/*.sql`, any migration that replaces a trigger function.

## Single-column FKs on multi-tenant children accept cross-tenant ids

```scope
id: single-column-fks-on-multi-tenant-children-accept-cross-tena
paths: ["apps/erp/app/modules/shared/shared.service.ts"]
triggers: ["assertCompanyRecords","FOREIGN KEY"]
```

**Context:** `jobOperationBatch` shipped with `locationId`/`processId`/`workCenterId` FKs referencing only the parent's `id`. The `batch-operations` edge fn wrote `payload.locationId`/`workCenterId` straight into the row after `requirePermissions` — which authorizes the CALLER for a company, not the record ids in the body.

**Problem:** A single-column FK checks only that the id EXISTS, so a company-A row pointing at company-B's location/work center satisfies it, and a service-role edge fn bypasses RLS — the write lands, mis-filing the batch and stamping foreign work centers onto job operations. Nothing fails until an export or a human notices.

**Rule:** In a server function, re-read every payload record id under `companyId` and refuse on a miss (`assertCompanyRecords`, `apps/erp/app/modules/shared/shared.service.ts`). Structurally, make tenant-scoped FKs composite — `(<col>, "companyId") REFERENCES parent(id, "companyId")` — adding `UNIQUE (id, "companyId")` on parents whose PK is single-column, and using PG15 `ON DELETE SET NULL (<col>)` for nullable FKs so `companyId` survives. Precedents: `20260703143904_composite-tenant-fks.sql`, `20260901132702_batch-composite-tenant-fks.sql`.

**Applies to:** postings (`apps/erp/app/modules/*/*.service.ts`) taking record ids in the input; any migration adding an FK from a `companyId`-scoped table to another tenant-scoped parent.

## The backups schema baseline on main can carry phantom tables from a dirty local DB

```scope
id: the-backups-schema-baseline-on-main-can-carry-phantom-tables
paths: ["packages/jobs/manifests/schema.json","packages/jobs/src/scripts/check-backups.ts","scripts/git-hooks/pre-commit"]
triggers: ["CARBON_SKIP_BACKUP_CHECK","TABLE_RENAMES"]
```

**Context:** `pnpm db:check:backups` blocked the currency-refactor commit on `onshapeSyncRun`/`onshapeItemSyncState` — tables with NO migration anywhere in the repo.

**Problem:** `packages/jobs/manifests/schema.json` regenerates from the committing developer's LIVE schema. If that database has tables applied from an unmerged branch, they enter the committed baseline, and every later committer's check flags them as "dropped without a rename mapping" — a false alarm that invites `--no-verify` reflexes or, worse, bogus `TABLE_RENAMES: null` entries declaring never-shipped tables dropped.

**Rule:** When `db:check:backups` blocks on a missing table, first verify the table exists in ANY migration (`grep -r <table> packages/database/supabase/migrations/`). No migration ⇒ baseline pollution, not your break: regenerate `schema.json` from a clean fully-migrated database (the catalog code in `src/backups/schema.ts` + the manifest shape in `check-backups.ts`), commit it with `CARBON_SKIP_BACKUP_CHECK=1`, and say why in the commit message. Never add a rename entry for a table that never shipped.

**Applies to:** `packages/jobs/manifests/schema.json`, `packages/jobs/src/scripts/check-backups.ts`, `.husky/pre-commit`.

## The migration ledger must travel with the schema it describes

```scope
id: the-migration-ledger-must-travel-with-the-schema-it-describe
paths: ["scripts/restore-database.sh"]
triggers: ["schema_migrations","pg_restore"]
```

**Context:** A `crbn restore` left the people board dead ("Failed to load people assignments"): the dump's schema was weeks older than the branch, yet `supabase migration up` reported "schema already up to date", so ~60 migrations' worth of tables (people, workflows, inspections, the operationType enum consolidation) silently didn't exist.

**Problem:** The restore script dropped every `public` object and loaded the dump — but never touched `supabase_migrations.schema_migrations`. The local ledger (which recorded everything as applied against the PRE-restore database) survived, and the dump's own ledger rows lost their primary-key conflicts under `ON_ERROR_STOP=0`. Result: an older schema paired with a newer ledger, which makes every "apply what's pending" mechanism a no-op. Diagnosing it required probing per-migration artifacts (tables, enum values, functions) because the ledger could no longer be trusted; recovery was deleting the stale ledger rows and replaying, marking the two genuinely-applied ones on their loud "already exists" failures.

**Rule:** Any operation that replaces schema state wholesale (restore, snapshot rollback, volume swap) must replace the migration ledger in the same stroke — truncate it before the load so the source's ledger lands and anything the backup predates genuinely pends. When a ledger and its schema disagree, believe the schema: probe artifacts, don't trust records. `scripts/restore-database.sh` now truncates the ledger before loading the dump; `crbn restore`'s trailing `applyMigrations` step is unchanged and picks up the pending set.

**Applies to:** `scripts/restore-database.sh`, any future backup/restore or snapshot tooling.

## A dropped column breaks string selects that typecheck cannot see

```scope
id: a-dropped-column-breaks-string-selects-that-typecheck-cannot
paths: []
triggers: ["DROP COLUMN","RENAME COLUMN","drop column","rename column"]
```

**Context:** The several-assets change for lessee leases (2026-10-11) moved twelve columns from `lease` to `leaseLine` and recreated the `leases` view.

**Problem:** Typecheck passed, but the Lease Liabilities report still selected the moved columns from the view through `fetchAllFromTable(client, "leases", "id, …, lesseeClassification, …")`. The column list is a string, so the report would only have failed at runtime.

**Rule:** After a migration drops or moves a column, grep every string select of the table and its views (`.select("…")`, `fetchAllFromTable` column lists, embeds) for the old name. Do not rely on typecheck for them.

**Applies to:** any migration that drops, renames or moves a column.

## A function redefined by forking its last migration picks up whatever that fork did

```scope
id: a-function-redefined-by-forking-its-last-migration-picks-up
paths: ["packages/database/src/event-system/functions/**","packages/database/src/authz/helpers/**"]
triggers: ["CREATE OR REPLACE FUNCTION","create_audit_log_table","insert_audit_log_batch"]
```

**Context:** Database functions were changed by copying the newest definition into a new migration and editing it. `create_audit_log_table` was forked several times; one fork made its existing-table branch re-attach the append-only trigger and re-run `secure_audit_log_table` unconditionally, and `insert_audit_log_batch` calls it on every write.

**Problem:** `CREATE TRIGGER` fires PostgREST's `pgrst_ddl_watch` event trigger, which reloads the schema cache. With one audit table and one search table per company that reload took 10-13 s in production, and every request with an embed waited for it: 480+ reloads a day, each one stalling joins for every company. No test or review could see it, because each fork looked like a small diff against a file nobody reads end to end. `dispatch_event_batch` lost its composite-key pairing the same way once.

**Rule:** A function that changes more than once is authored as a single file, not as a chain of forks. The event system's functions live in `packages/database/src/event-system/functions/<name>.sql`; edit the file and run `pnpm --filter @carbon/database authz migration <name>`. A function on a write path must not run DDL: check the catalog first and only repair what is missing (`audit-log-no-ddl-on-write.test.sql` asserts the trigger and policy oids do not change across writes).

**Applies to:** `packages/database/src/event-system/functions/`, `packages/database/src/authz/helpers/`, `no-authz-ddl-in-migrations` (`@carbon/checks`).

## A hardcoded list that mirrors the schema goes stale silently, and a restore still reports success

```scope
id: a-hardcoded-list-that-mirrors-the-schema-goes-stale-silently
paths: ["packages/jobs/src/inngest/functions/tasks/company-backup*.ts"]
triggers: ["STORAGE_PATH_COLUMNS","READABLE_ID_TABLES","buildIdMaps"]
```

**Context:** Two independent cross-company restore defects, found together while
tracing one broken restored company. (1) #1148 (2026-07-20) added `glbPath` /
`graphPath` to `modelUpload` and removed `modelPath` from `STORAGE_PATH_COLUMNS`
without adding the two new columns, so restored assemblies pointed at the SOURCE
company's storage prefix. (2) `2a19048def` (2026-08-31) correctly widened
id-remapping to composite-PK tables, which swept in `part`/`material`/
`consumable`/`service`/`tool` — whose `id` is a human-authored part number
(`ADCS-001`) that the `parts` view joins against `item."readableId"`, not an
identifier. Every Items page rendered empty against 860 intact rows.

**Problem:** Both lists mirror a schema property no constraint expresses, so
neither compiler nor DB catches drift. Worse, the restore job reports SUCCESS in
both cases — the rows load and the files copy; only a join or a URL silently
resolves to nothing. And both are invisible on a same-company restore, where the
remap is a no-op, so the usual manual test passes.

**Rule:** When a list in code enumerates schema facts (path columns, tables
exempt from a transform), pin it with a test that fails when the schema outgrows
it, and state in the list's own doc comment what must be added alongside a new
column/table. When widening a rule that mints or rewrites ids, ask which of the
newly-swept tables use that column as a VALUE others match on rather than as an
identifier — `part.id` is a part number. Verify a restore by querying the view
the UI reads (`parts`), not the table (`part`); the table was always full.

**Applies to:** `packages/jobs/src/inngest/functions/tasks/company-backup.ts`
(`STORAGE_PATH_COLUMNS`, `READABLE_ID_TABLES`), `buildIdMaps` in
`company-backup.transforms.ts`, and any future cross-company restore work — test
cross-company, never same-company.

## A migration file created while migrations are running is recorded as applied — empty

```scope
id: a-migration-file-created-while-migrations-are-running-is-rec
paths: ["packages/database/supabase/migrations/*.sql"]
triggers: ["schema_migrations"]
```

**Context:** Phase D of the rentals plan. `crbn up` was booting (its migrate step
runs `supabase migration up --include-all`) while `pnpm db:migrate:new lease-enum`
created the next migration file, whose SQL was written a few seconds later.

**Problem:** The running migrate step picked up the brand-new, still-empty file and
recorded version `20260923051441` in `supabase_migrations.schema_migrations` with
zero statements. Every later `crbn migrate` treated it as applied, so the enum value
it adds never reached the database; the regenerated types silently lacked it and
the first symptom was an unrelated-looking TS2353 in `@carbon/ee`. A sibling file
created four seconds later had its SQL in time and applied normally — so "the other
migration worked" proves nothing.

**Rule:** Never create or edit a migration file while `crbn up` / `crbn migrate` /
`pnpm db:migrate` is running; write the SQL first (or wait for the run to finish).
When a regenerated type is missing something a new migration adds, check
`select version, array_length(statements, 1) from supabase_migrations.schema_migrations
order by version desc limit 5` — a NULL statement count on your version means it was
recorded empty. Idempotent SQL can then be re-applied with `psql -f`.

**Applies to:** every new migration under `packages/database/supabase/migrations/`
during a `crbn up` boot or a background migrate.

## A migration that re-scopes companies uses the company test of the migration it follows

```scope
id: a-migration-that-re-scopes-companies-uses-the-company-test-o
paths: ["packages/database/supabase/migrations/20261008211304_reset-accounting.sql","packages/database/supabase/migrations/20261009004448_accounting-cutover.sql"]
triggers: ["JE-SEED-","\"accountingEnabled\" = true"]
```

**Context:** `20261008211304_reset-accounting.sql` deletes the journals of every company except the demo-template companies. It finds those as the companies that hold a `JE-SEED-%` journal, which only tier 09 of the dataset seed writes. `20261009004448_accounting-cutover.sql` (section 7) then gives the spared companies a cutover, because their history is already in Carbon.

**Problem:** The second migration first chose its companies by `accountingEnabled = true`. Only the dev CLI ever set that flag. A template applied through onboarding or Settings → Demo Data has it false. So those companies kept their Posted seed journals, but got no cutover. Their seeded Posted Opening Balance then blocked the enable wizard for good. Commit 38602af774 changed the test to the reset's `JE-SEED-%` test.

**Rule:** If migration B acts on the companies that migration A chose, B copies A's predicate. Do not use a flag that "should" mean the same thing. Before you write the `WHERE`, read A's predicate. Then grep every writer of any flag you plan to use instead.

**Applies to:** `packages/database/supabase/migrations/20261008211304_reset-accounting.sql`; `packages/database/supabase/migrations/20261009004448_accounting-cutover.sql`; any data migration that follows another data migration.

## A public SECURITY DEFINER function that calls net.http_post is a remote-DoS surface — put it in an internal schema

```scope
id: a-public-security-definer-function-that-calls-net-http-post
paths: ["packages/database/supabase/migrations/*.sql"]
triggers: ["SECURITY DEFINER","security definer","net.http_post","REVOKE EXECUTE"]
```

**Context:** The push-based event-queue wake (`20260721184852_event-queue-wake.sql`) originally defined `wake_event_queue()` / `sweep_event_queue()` in the `public` schema. Both are SECURITY DEFINER and call `net.http_post` (pg_net) to POST to the `event-wake` edge function. The trigger (`dispatch_event_batch`) and pg_cron call them as the owner (superuser).

**Problem:** Every `public` function is auto-exposed as a PostgREST RPC (`/rest/v1/rpc/<name>`), reachable by `anon`. Worse than mere exposure: referencing such a function as a **non-superuser** role segfaults the backend (pg_net 0.20 / PG15) — reproducible via `SET ROLE authenticated; EXPLAIN SELECT public.wake_event_queue();`, which crashed even though `EXPLAIN` never runs the body and the role lacked EXECUTE. The crash happens at plan/permission-resolution time, **before** the ACL check — so `REVOKE ALL … FROM PUBLIC, anon, authenticated` does NOT protect: an unauthenticated `POST /rpc/wake_event_queue` crash-loops the whole DB (postmaster reinitializes all backends → "database system is in recovery mode" for every client). Same-body call as superuser was fine, which is why the trigger/cron paths worked and masked it in end-to-end testing.

**Rule:** Never define an internal SECURITY DEFINER helper (especially one calling `net.http_post` / pg_net) in `public`. Put it in the internal `util` schema (the existing Carbon/Supabase convention — cf. `util.process_embeddings`), where `anon`/`authenticated` have no `USAGE`, so the API can't reference it at all and a hostile call fails cleanly with `permission denied for schema util` before any crash-prone planning. Callers that are triggers/pg_cron run as owner and reach `util` fine; update their bodies to `util.<fn>()`. Keep `REVOKE ALL … FROM PUBLIC` on the util function as defense-in-depth, but the schema-USAGE gate is the real fix. Verify with `SET ROLE authenticated; SELECT util.<fn>();` → must be a clean `permission denied`, not a dropped connection. Note PostgREST-exposed schemas exclude `util`/`pgmq` but include `public`/`net` (`has_schema_privilege('anon', <schema>, 'USAGE')`).

**Applies to:** any new SECURITY DEFINER function that calls pg_net/`net.http_post` or is meant to be trigger/cron-only (`packages/database/supabase/migrations/`). Trigger functions returning `trigger` are not RPC-exposed (safe in public), but VOID/scalar helpers are.

**Update (2026-09-24):** pg_net is not required. On `supabase/postgres:15.14.1.112`, a plain
`LANGUAGE sql` function (`select 1`) with `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`
segfaults the backend (signal 11) when called under `SET ROLE authenticated` or `anon`. This was
reproduced in a fresh container of that image. A missing table privilege, a `RAISE`, and "must be owner"
are all ordinary errors. So `REVOKE EXECUTE` on any function in `public` is itself an unauthenticated DoS
(`POST /rest/v1/rpc/<fn>`). Gate API access INSIDE the function instead, and raise on
`current_setting('role', true) IN ('anon','authenticated')` without the permission — see
`assert_audit_log_access` in `20260924171942_audit-log-company-scope.sql`. When you test a revoke, use a
throwaway container (`docker run --rm supabase/postgres:<tag>`), never a shared dev database. The crash
restarts every backend. `20260924192316_api-function-guards-not-revokes.sql` replaced the six existing public-function
revokes (integration secrets, `upsert_company_integration_patch`, the job-completion helpers). A nested
helper of a SECURITY DEFINER function cannot use the role-GUC guard, because `current_setting('role')`
still reads `authenticated` inside the nested call. Make those `SECURITY INVOKER` instead.

## A RAISE in a completion RPC aborts the UPDATE that triggered it

```scope
id: a-raise-in-a-completion-rpc-aborts-the-update-that-triggered
paths: []
triggers: ["complete_job_to_inventory","sync_finish_job_operation","attach_event_trigger"]
```

**Context:** `complete_job_to_inventory` gained guards refusing a completion it could not satisfy (zero quantity, a fractional serial quantity, fewer receivable units than completed).

**Problem:** That function is not only called from the ERP complete route — `sync_finish_job_operation` calls it from a BEFORE trigger interceptor, and `dispatch_event_interceptors` has no `EXCEPTION` block. So a serial item with no serial sequence (whose job keeps one whole-quantity seed entity, because `assign-serial-numbers` returns early with no sequence) made the raise propagate out and abort the `jobOperation` UPDATE itself: the operator could not mark the operation Done at all.

**Rule:** Before adding a `RAISE` to a SQL function, grep for trigger interceptors that call it. A refusal that is a useful error on a request path is a hard block on a trigger path. Either handle the case rather than refusing it, or make the trigger caller skip the call.

**Applies to:** `complete_job_to_inventory`, `sync_finish_job_operation`, and any function registered through `attach_event_trigger`.

## A rule about a column belongs where every writer of that column passes

```scope
id: a-rule-about-a-column-belongs-where-every-writer-of-that-col
paths: ["packages/database/src/event-system/handlers/sync_item_tracking_type_change.sql"]
triggers: ["itemTrackingType","sync_item_tracking_type_change","setItemTrackingType"]
```

**Context:** An item's tracking type (Inventory, Batch, Serial) is copied onto job
materials, job make methods and open document lines when they are made. Draws read the
copy to choose untracked or tracked stock. `setItemTrackingType` updated the copy, but
only on Draft and Planned jobs, and it did not check stock.

**Problem:** Six code paths write `item.itemTrackingType` on an existing item: the
properties panel, `updateItem`, `updatePart` and its siblings, CSV import, the Onshape
field writer and the bulk update. Only two of them updated the copy, and none checked
stock or released jobs. An item changed from Batch to Inventory kept its lots, which no
untracked draw can see, so the next issue drove the bin negative. A released job kept
the old copy, so its issues selected materials by the copy and moved stock by the item.

**Rule:** When a column change must be checked or carried to other rows, put that rule
in the database (a statement handler on the table), not in one service function. Before
you choose the place, list every writer of the column with `git grep`. A rule in one
writer is a rule the other writers skip.

**Applies to:** `sync_item_tracking_type_change`
(`packages/database/src/event-system/handlers/`), and any flag copied from a master
record onto open documents.

## A second foreign key between two tables breaks every PostgREST embed between them

```scope
id: a-second-foreign-key-between-two-tables-breaks-every-postgre
paths: []
triggers: ["FOREIGN KEY","PGRST201","REFERENCES \"workCenter\"","REFERENCES \"jobOperation\""]
```

**Context:** The OEE provider work (2026-10-13) added `workCenter."loadedJobOperationId"` with a foreign key to `jobOperation`, which already had `"workCenterId"` → `workCenter`.

**Problem:** With two relationships between the same pair of tables, PostgREST cannot pick one, and every existing embed of one from the other (`jobOperation` → `workCenter(name)`: batches, the batch PDF, notifications) failed at runtime with PGRST201. Typecheck passed, because the generated types still compiled; only a request to an affected screen showed it.

**Rule:** Before adding a foreign key, grep for embeds between the two tables in both directions (`table(` inside `.select(…)` strings). If any exist, either leave the new column without a foreign key and keep it consistent another way (an interceptor that clears it on delete), or disambiguate every embed with `table!constraint_name(…)` in the same change. When replacing a foreign key (a composite one for tenancy), drop the old one in the same migration, never add beside it.

**Applies to:** migrations that add a foreign key, especially to widely embedded tables (`workCenter`, `jobOperation`, `item`, `job`).

## A verdict computed against its own input is a tautology — diff across time, at read time

```scope
id: a-verdict-computed-against-its-own-input-is-a-tautology-diff
paths: ["packages/jobs/src/backups/schema.ts"]
triggers: ["reportBackupCompatibility","getCompanyBackups"]
```

**Context:** PR #1477 stored a "can this backup still be restored?" verdict (`compatibility.json`) beside each backup, written once by the export job and never refreshed. Its badge, typed-confirm gate, and no-confirm-button state were the PR's headline UX. CI was green; ~500 lines of tests passed.

**Problem:** The export computed `reportBackupCompatibility(catalog, manifest)` where the manifest had just been PROJECTED from that same catalog, in the same process. `diff(x, project(x))` is empty by construction, so the stored status was `"ready"` for every backup forever, and every downstream state driven by findings was unreachable. Nothing failed: the function was correct, the tests exercised it with hand-built drifted inputs, and only the one production call site was degenerate.

**Rule:** A comparison is only meaningful when its two sides come from different points in time or different origins. When a check's input is derived from the thing it is checked against — at the same moment, by the same code — the check can only ever pass, and green tests won't catch it because tests construct the divergent inputs the call site never produces. Compute such verdicts at READ time (live schema vs stored artifact), and when reviewing, trace where each argument of a comparison actually comes from at the real call site.

**Applies to:** `packages/jobs/src/backups/schema.ts` (`reportBackupCompatibility`), `getCompanyBackups` in `apps/erp/app/modules/settings/settings.service.ts`, and any future "is X still valid?" precomputation (schema drift, config validation, cache-freshness verdicts).

## Aging report previews need seeded open documents

```scope
id: aging-report-previews-need-seeded-open-documents
paths: ["apps/erp/app/routes/x+/reports+/*aging*","packages/database/src/datasets/**"]
triggers: ["ar-aging","ap-aging"]
```

**Context:** Sharing a local AR/AP aging UI preview.

**Problem:** The dev server rendered the reports, but the default test company had no sales or purchase invoices, so both reports appeared empty. The dataset seed then failed on `inspectionDocument.drawingNumber`: the local database carried a newer schema from `main` than the branch's own code.

**Rule:** Check the report RPCs for open rows before handing off a preview. Seed an isolated company when the current test company contains unrelated records, and verify both report counts after seeding. When a seed fails on a column, compare the branch's generated types with the local database before editing the dataset: merge `main` (or migrate a clean database) rather than changing the tier.

**Applies to:** Local aging report previews and `packages/database/src/datasets/`.

## Audit FK snapshots: constraint-less columns are invisible to schema discovery; junction targets need hops

```scope
id: audit-fk-snapshots-constraint-less-columns-are-invisible-to
paths: ["packages/database/src/audit.config.ts","packages/jobs/src/inngest/functions/events/fk-snapshots.ts","packages/jobs/src/inngest/functions/events/audit.ts"]
triggers: ["fkDisplayRegistry","fkDisplayHops","snapshotFields","get_foreign_key_map"]
```

**Context:** Audit-log diffs resolve FK ids into frozen display names ("Location: Chicago → Dallas") via `get_foreign_key_map` + `fkDisplayRegistry` (`packages/database/src/audit.config.ts`, handler in `packages/jobs/src/inngest/functions/events/{audit,fk-snapshots}.ts`). Found while fixing "audit log shows location id instead of name" (2026-08).

**Problem:** Three distinct shapes made raw ids reach the UI. (1) `get_foreign_key_map` reads `pg_constraint`, so reference columns **without a real FK constraint** are invisible to it — no snapshot no matter what the registry says. This schema has many: `salesOrder.salesPersonId`, `salesInvoice.assignee`, line-level `locationId`s on `purchaseOrderLine`/`salesOrderLine`/`salesInvoiceShipment`, `inventoryCountLine.storageUnitId`, etc. (2) Junction targets (`customerContact`/`supplierContact`, `opportunity`, `fulfillment`…) have no displayable columns of their own — the name lives one hop away (`contact.fullName`), which single-hop resolution can't reach. (3) A target table simply missing from `fkDisplayRegistry` silently degrades to the raw id — no error anywhere.

**Rule:** When adding a reference column to an audited table, either give it a real FK constraint (registry/hops then cover it automatically) or declare a per-column `snapshotFields` override on that table's audit config. For targets whose display value lives on another table, use `fkDisplayHops` (two-stage batched lookup). Resolution precedence is override > hop > registry; hops and registry must stay disjoint, and overrides must not target hop tables — both invariants are enforced by tests in `fk-snapshots.test.ts`. Snapshots are frozen at write time: config changes never backfill existing audit rows.

**Applies to:** `packages/database/src/audit.config.ts` (`fkDisplayRegistry`, `fkDisplayHops`, `snapshotFields`), `packages/jobs/src/inngest/functions/events/fk-snapshots.ts` + `audit.ts`, and any migration adding reference columns to tables listed in `auditConfig.entities`.

## Check a column's default before you filter on NULL

```scope
id: check-a-column-s-default-before-you-filter-on-null
paths: []
triggers: ["Status\" IS NULL","optimizeStatus","net.http_request_queue"]
```

**Context:** The `queue_model_pipeline` handler first selected new models `WHERE "optimizeStatus" IS NULL`.

**Problem:** `modelUpload.optimizeStatus` is `NOT NULL DEFAULT 'Idle'`, so the filter matched no row and the handler queued nothing. The insert succeeded and nothing failed.

**Rule:** Read the column definition in the newest migration (or `\d` on the local database) before you write `IS NULL` against it. Test a new handler in a rolled-back transaction and assert the queued `net.http_request_queue` body.

**Applies to:** SQL handlers, sweepers and views that pick rows by a status column.

## A caller-supplied document number used to leave the counter behind

```scope
id: a-caller-supplied-document-number-used-to-leave-the-counter
paths: ["packages/database/src/event-system/handlers/sync_advance_document_sequence.sql","apps/erp/app/components/Form/SequenceOrCustomId.tsx"]
triggers: ["get_next_sequence","SequenceOrCustomId","document_sequence_pattern","sync_advance_document_sequence"]
```

**Context:** Documents take their number from `get_next_sequence` unless the caller supplies one: a custom ID typed into `SequenceOrCustomId`, or an MCP / API upsert (`upsertSalesOrder`, `upsertQuote`, `upsertPurchaseOrder`, `upsertJob`, …) whose create path requires the number.

**Problem:** A supplied number never moved the `sequence` row. Once the counter reached a number an agent or a user had already used, every new document failed on the unique constraint ("Failed to insert sales order") until someone moved the counter by hand.

**Rule:** The counter is kept ahead in the database, not in app code: the `sync_advance_document_sequence` after-interceptor moves `sequence.next` past any number saved in the sequence's format, on insert and on a number change. A new numbered table must be added to that interceptor's `CASE` and given the interceptor in `attachments.ts`; the `document-sequence-synced` conformance check fails CI for a new counter that is neither covered nor in its `EXEMPT_COUNTERS`. Never "fix" a collision by retrying `get_next_sequence`.

**Applies to:** `packages/database/src/event-system/handlers/sync_advance_document_sequence.sql`, `util.document_sequence_pattern`, any table with a readable document number.

## A derived flag on a row that `ON DELETE SET NULL` points at must be released before the delete

```scope
id: a-derived-flag-on-a-row-that-on-delete-set-null-points-at-mu
paths: ["packages/database/src/event-system/handlers/*"]
triggers: ["quantityNonNettable","effectiveNettable","refresh_storage_unit_nettable","storage_unit_release_non_nettable_stock"]
```

**Context:** `itemStockQuantities.quantityNonNettable` counts the stock in storage units whose `effectiveNettable` is false. `itemLedger.storageUnitId` references `storageUnit` with `ON DELETE SET NULL` (2026-10-28).

**Problem:** Deleting a non-nettable unit sets its ledger rows' `storageUnitId` to NULL, and the ledger's statement handler then sees rows that point at no unit, which count as nettable. It cannot tell the stock was non-nettable, because the unit row is already gone, so `quantityNonNettable` keeps the stock forever. An AFTER interceptor on the unit is too late as well: the foreign key's own trigger has already nulled the rows.

**Rule:** When an aggregate is keyed on a property of a row that an `ON DELETE SET NULL` foreign key points at, undo that row's contribution in a BEFORE DELETE interceptor (`storage_unit_release_non_nettable_stock`), while the referencing rows still point at it. Prefer recomputing an aggregate from its source over adjusting it by deltas wherever the input can change without a write to the aggregated table (`util.refresh_storage_unit_nettable`).

**Applies to:** `packages/database/src/event-system/handlers/`, any derived total over `itemLedger` keyed on a `storageUnit` property.

## A foreign key to `account` must be RESTRICT, and a new one needs a merge policy

```scope
id: a-foreign-key-to-account-must-be-restrict-and-a-new-one-need
paths: ["packages/database/src/account-import.ts","packages/database/src/account-import-reads.ts","apps/erp/test/database/apply-account-import.test.ts"]
triggers: ["REFERENCES \"account\"","REFERENCE_POLICY","applyAccountImport","repointReferences"]
```

**Context:** The chart of accounts import (2026-10-12) re-points references when it merges accounts and deletes an account nothing uses.

**Problem:** `journalLine.accountId` and the order, invoice and supplier quote line FKs were `ON DELETE SET NULL`. Deleting an account with Draft or Provisional lines succeeded and silently emptied the lines' account; Posted lines only refused by accident, through the immutability trigger. The import also has to know, for every column that names an account, whether a merge may move it.

**Rule:** Give a new foreign key to `account` `ON DELETE RESTRICT`, and classify it in `REFERENCE_POLICY` (`packages/database/src/account-import.ts`): `repoint`, `repoint-if-draft`, `repoint-if-unposted-journal` or `history`. The `apply-account-import` live-database test fails until it is listed. A soft reference (no FK) goes in `SOFT_REFERENCES` and the apply's `repointReferences`.

**Applies to:** migrations that add a column referencing `account`; `packages/database/src/account-import.ts`; `applyAccountImport` (`apps/erp/app/modules/accounting/accounting.service.ts`) and its live test `apps/erp/test/database/apply-account-import.test.ts`.

## A function redefinition forked from an old copy reverts every migration between

```scope
id: a-function-redefinition-forked-from-an-old-copy-reverts-ever
paths: ["packages/database/supabase/migrations/*.sql"]
triggers: ["CREATE OR REPLACE FUNCTION","complete_job_to_inventory","backflush_job_materials","get_inventory_quantities"]
```

**Context:** `20261014171619_receive-consumed-serial-units` (2026-10-15) changed one branch of `complete_job_to_inventory`. Its header says it was "forked from 20261006221601". The same thing happened earlier. `complete_job_to_inventory` gained a Non-Inventory branch in `20260707022142` (services post WIP to COGS, with no inventory artifacts). Six days later, `20260713190909` (raw-materials split) and `20260713222236` (overhead fix) each forked the function from the older `20260630092517` baseline. Both deleted the Non-Inventory branch. Service job completions then posted phantom Finished Goods until `20260714043017` restored the branch.

**Problem:** two later migrations had redefined the function: `20261009010412` (every company posts job costing, Provisional before the cutover) and `20261014135003` (lock the production events a completion posts). The fork's `CREATE OR REPLACE` replaced the whole body, so both changes were silently undone: a company with no cutover got no Job Receipt journal, and a concurrent production-event post could double-post. The SQL tests that would have caught it either predated always-post or failed already and were not run. "Fork from the newest definition" also fails when the author greps only for the migration that matters to their change. They miss later redefinitions that added unrelated branches. A dropped branch gives no error. The wrong behavior shows only when someone uses the other feature.

**Rule:** list every migration that touches the function (`grep -l '<fn_name>' migrations/*.sql | sort`). Copy the body from its NEWEST definition (`grep -l "FUNCTION <name>" migrations | tail -1`). Then diff your body against that exact file (`diff <(sed -n 'a,bp' newest.sql) <(...)`), so the only hunks are your intended edits. A branch you do not understand (an `itemTrackingType` guard, a feature flag) is load-bearing: carry it forward. Never rebuild the body from an older file or from memory. The `function-redefinition-keeps-changes` check fails a redefinition that drops lines its predecessor added. Run the SQL tests that call the function (`scripts/run-local-accounting-check.ts psql -f …`).

**Applies to:** `packages/database/supabase/migrations/`: any migration with `CREATE OR REPLACE FUNCTION` on a function defined more than once, especially the long posting functions (`complete_job_to_inventory`, `backflush_job_materials`, `get_inventory_quantities`) and sync interceptors. Also reviews of migrations that redefine shared functions.

**Also after a merge (2026-09-28):** a branch's migration added the Make to Asset branch to `complete_job_to_inventory`. Main's `20260925121735_rpc-function-guards` was forked from the definition before it, to add one guard line. The two merged cleanly, because they are different files. In timestamp order main's copy ran last, so every fresh or local database lost the asset branch. Production pushes with `--include-all`, which applies the older branch file AFTER main's, so there the guard went missing instead. `check-clobbers` compares against the merge base and reported nothing. After you merge main, list main's migrations newer than your branch's oldest. Grep them for every function and view your migrations define. For any hit, write a NEW migration dated after both that carries both changes (here, since folded into `20261006221601_complete-job-to-asset.sql`).

**Also when you add return columns:** adding aging detail columns to `get_ap_open_by_supplier` kept the supplier reference behavior, but changed the line breaks around fields its previous migration added. `function-redefinition-keeps-changes` compares added SQL lines literally, so the harmless layout change failed CI conformance and tests. When you extend an RPC return shape, keep the exact lines that its newest definition added where possible. Put new select expressions on separate lines. Run the conformance test before you commit.

## A globally-unique primary key means a fixed id literal collides across companies

```scope
id: a-globally-unique-primary-key-means-a-fixed-id-literal-colli
paths: ["packages/database/src/datasets/tiers/**","packages/database/supabase/migrations/20241030005037_external-links.sql"]
triggers: ["externalLink","insertInto(\"period\")","from(\"period\")"]
```

**Context:** The onboarding demo dataset hard-coded UUID literals as `externalLink.id` in two places so the public share URLs (`/share/quote/:id`, `/share/supplier-quote/:id`) would be stable for documentation screenshots. Seeding the first company worked; the second one onto the same database died with `duplicate key value violates unique constraint "externalLinks_pkey"`.

**Problem:** Almost every Carbon table has the composite PK `("id","companyId")`, which makes a repeated `id` harmless across tenants — so a fixed literal *looks* safe by analogy. But a handful of tables are keyed on `id` alone: `externalLink` (`PRIMARY KEY ("id")`, `20241030005037_external-links.sql`) and `period` (`PRIMARY KEY ("id")`, no `companyId` column at all). For those, a literal is a database-wide singleton. The failure only appears on the *second* company, so it passes every single-company test and first surfaces in production or in a shared dev database.

**Rule:** Never write a literal primary key in seed/fixture code — let the column's `id()`/`xid()` default mint it and read the value back (`insertId`). Before assuming a repeated id is tenant-safe, check the actual `PRIMARY KEY` in the migration, not the table-template convention. For a global table with no unique key to conflict against (`period`), a read-then-insert also needs `pg_advisory_xact_lock` or a unique index — two companies seeding concurrently will otherwise both insert, and the duplicates are visible to every tenant.

**Applies to:** `packages/database/src/datasets/tiers/**`; any SQL/TS fixture that writes `externalLink`, `period`, or another `PRIMARY KEY ("id")` table; `.claude/rules/onboarding-company-templates.md`.

## A LANGUAGE sql set-returning function's internal ORDER BY is not guaranteed through PostgREST

```scope
id: a-language-sql-set-returning-function-s-internal-order-by-is
paths: ["apps/mes/app/services/allocation.ts"]
triggers: ["get_available_tracked_entities","sortLotsByPickMethod","RETURNS SETOF","RETURNS TABLE"]
```

**Context:** `get_available_tracked_entities` (a `LANGUAGE sql STABLE` set-returning function) was extended with a `p_sort_method` param and a CASE-based `ORDER BY` (FEFO/FIFO/LIFO) to power an on-the-fly picking suggestion. FEFO worked, but calling the RPC for FIFO returned rows in the wrong order — its only effective sort key was the trailing `te."createdAt" ASC`, which came back unordered. Adding an explicit outer `ORDER BY "createdAt"` at the call site fixed it, proving the function's internal order was being dropped.

**Problem:** The Postgres planner **inlines** simple `LANGUAGE sql` functions into the calling query; when the caller (here, PostgREST via `client.rpc(...)`) supplies no outer `ORDER BY`, the inlined subquery's `ORDER BY` can be optimized away. Ordering that leads with a real indexed/leading column (expiration for FEFO) may survive by luck; ordering whose only key is a trailing column silently does not. Unit tests and typecheck can't catch this — only real-data querying does.

**Rule:** Do not rely on a `LANGUAGE sql` set-returning function's internal `ORDER BY` to reach the app. Either (a) sort authoritatively in the app after the RPC returns (return the sort columns and order in TS — see `apps/mes/app/services/allocation.ts` `sortLotsByPickMethod`, applied in `getSuggestedAllocationForMaterial`), or (b) if ordering must live in SQL, use `LANGUAGE plpgsql` with `RETURN QUERY ... ORDER BY` (plpgsql is never inlined). Always verify RPC ordering against seeded real data, not just unit tests.

**Applies to:** `packages/database/supabase/migrations/` set-returning `LANGUAGE sql` functions consumed via `client.rpc(...)`; any app code that greedy-fills / picks "the first row" from an RPC result.

## A list-query benchmark that omits the ORDER BY measures a query the app never runs

```scope
id: a-list-query-benchmark-that-omits-the-order-by-measures-a-qu
paths: ["packages/database/supabase/migrations/20260807011742_lateralize-order-list-views.sql","packages/database/supabase/migrations/20260806235710_perf-list-query-indexes.sql","apps/erp/app/utils/query.ts"]
triggers: ["JOIN LATERAL","EXPLAIN ANALYZE"]
```

**Context:** Lateralizing the `salesOrders`/`purchaseOrders` list views on `sid/perf-audit-hot-paths`. The rewrite benchmarked as a ~9x win and shipped; re-measuring later against the real endpoint showed page 1 taking **41.6 seconds**.

**Problem:** The benchmark ran `SELECT ... FROM "salesOrders" WHERE "companyId" = $1 LIMIT 100` — no `ORDER BY`. Every one of these endpoints applies a fixed default sort (`setGenericQueryFilters(query, args, [{ column: "createdAt", ascending: false }])`). That one clause inverts the result: with no sort the planner pushes `LIMIT 100` below the lateral join so the aggregate runs ~100 times (10.6 ms vs 91.3 ms for the bulk form — the win that was measured); with the sort and no index supplying its order, every row must be produced before the limit applies, so the aggregate runs once per order in the company — 10,000 times, each re-scanning `item` under a non-indexable RLS policy. Two other things hid it: the seeded tables had **never been analyzed** (`last_analyze` and `last_autoanalyze` both NULL, `n_live_tup` 0), so plan choice was unstable; and the stated rationale — "the bulk form aggregates every tenant's lines" — was simply false, since `salesOrderLine` has RLS and the view is `SECURITY INVOKER`, so it was always company-scoped.

**Rule:** Benchmark the query the service actually builds — copy the projection, the `ORDER BY` from `setGenericQueryFilters`, and the `LIMIT/OFFSET`, not a simplified `SELECT * ... LIMIT n`. Run `ANALYZE` before trusting any timing on seeded data, and check `pg_stat_user_tables.last_analyze` first. When a rewrite's premise is "this touches rows it shouldn't", verify it against `pg_policies` before optimizing — RLS may already be doing it. A LATERAL is only a win when the limit can be pushed below the join, which needs an index supplying the sort; check the plan for `Seq Scan ... loops=<number of outer rows>`, which is the signature of a per-row aggregate that was meant to run per page.

**Applies to:** `packages/database/supabase/migrations/20260807011742_lateralize-order-list-views.sql`, `20260806235710_perf-list-query-indexes.sql`, `apps/erp/app/utils/query.ts` (`setGenericQueryFilters`), and any future list-view or RLS-policy performance work.

## A migration from main can fail on a local database that already ran a newer branch migration

```scope
id: a-migration-from-main-can-fail-on-a-local-database-that-alre
paths: ["packages/database/supabase/migrations/20261021004800_*.sql","packages/database/supabase/migrations/20261021010900_*.sql"]
triggers: ["get_purchasing_planning","DROP FUNCTION"]
```

**Context:** Merging `origin/main` into `projects-wbs-research-spec` (2026-10-11). The branch's `20261021004800_planning-rpcs-segment.sql` drops and creates `get_purchasing_planning` with an extra output column, `planningSegmentId`. Main's `20261009181437_supplier-part-currency.sql` has an OLDER timestamp. It renames `supplierPart.unitPrice` to `supplierUnitPrice` and then does `CREATE OR REPLACE` on the same function with main's return type.

**Problem:** Local databases on the branch had run 135634 already. `pnpm db:migrate` then applied 181437 out of order, and statement 8 failed with `cannot change return type of existing function`. The migration rolled back, so nothing was half-applied. On a NEW database the order reverses: 181437 runs first and renames the column, and then 135634 failed too, because a `LANGUAGE sql` body is checked at creation (`check_function_bodies` is on) and it read `ps."unitPrice"`. The clobbers check saw neither problem: the branch DROPs and CREATEs, and the check compares names, not bodies.

**Rule:** After you merge main, compare the function names that main's new migrations define with the names that the branch's migrations define (DROP + CREATE included). For each match, do these things:

1. Write one NEW migration, dated after both, that carries both changes (here `20261021010900_merge-main-job-costing-and-planning.sql`).
2. If the branch migration has not shipped, also fix the branch migration so that it applies AFTER main's migration on a new database (here `20261021004800` now reads `supplierUnitPrice` and `currencyCode`).
3. For a local database that ran the branch migration first, do this one-off step before `pnpm db:migrate`. It is safe because nothing depends on the function in `pg_depend`, and the new migration creates the function again:

```bash
docker exec -i <worktree>-postgres-1 psql -U postgres \
  -c 'DROP FUNCTION public.get_purchasing_planning(text, text, text[]);'
pnpm db:migrate
```

Never edit main's migration to make it apply.

**Applies to:** every local database of this branch that applied `20261021004800` before it merged main; any merge where both sides redefine one function and the return type differs.

## A new table handler's generated migration fails locally with "must be owner"

```scope
id: a-new-table-handler-s-generated-migration-fails-locally-with
paths: ["packages/database/src/event-system/handlers/*.sql","packages/database/src/event-system/functions/*.sql"]
triggers: ["must be owner","OWNER TO postgres"]
```

**Context:** A new statement handler (`queue_pmi_inspection_plans`) was added to `event-system/handlers/` and `attachments.ts`. `pnpm db:migrate` synced it, then `authz migration` wrote the generated migration that ships it (2026-10-27).

**Problem:** The next `pnpm db:migrate` failed on that migration with `must be owner of function queue_pmi_inspection_plans`. The sync had created the function as `supabase_admin`. Every older handler is owned by `postgres`, the role the migration runs its `CREATE OR REPLACE` as. Production never syncs, so only a local database that synced first is affected.

**Rule:** If the generated migration of a new managed function fails locally with "must be owner", run `ALTER FUNCTION public.<name>() OWNER TO postgres;` as `supabase_admin`, then run `pnpm db:migrate` again. Do not edit the generated migration.

**Applies to:** `packages/database/src/event-system/handlers/*.sql`, `packages/database/src/event-system/functions/*.sql`, `pnpm --filter @carbon/database authz migration`.

## A unique index over a nullable column never deduplicated, and adding a real one breaks silent writers

```scope
id: a-unique-index-over-a-nullable-column-never-deduplicated-and
paths: ["packages/database/src/event-system/handlers/*membership*"]
triggers: ["CREATE UNIQUE INDEX","uq_membership","NULLS NOT DISTINCT"]
```

**Context:** Employee re-invite (2026-10-15). `membership` had `uq_membership ("groupId", "memberGroupId", "memberUserId")`, and every user membership has `memberGroupId` NULL.

**Problem:** Under the default `NULLS DISTINCT`, rows with a NULL in the key never conflict, so the constraint that looked like it deduplicated user memberships never had. Writers inserted duplicates without error. A new unique index on `("groupId", "memberUserId")` made those same writers fail: the insert interceptors had no `ON CONFLICT`, and the employee-type change interceptor moved a membership onto a group the user was already in. Each would have failed the employee, customer-account or supplier-account write that fired it.

**Rule:** Before adding a unique index, list every writer of the table, interceptors included, and give each one `ON CONFLICT … DO NOTHING` or a conflict-safe update in the same change. When a composite unique key includes a nullable column, assume it deduplicates nothing for rows where that column is NULL.

**Applies to:** `membership` and its interceptors in `packages/database/src/event-system/handlers/`, and any unique key with a nullable column.

## Adding CHECK + VALIDATE requires auditing every WRITER of the column and pre-cleaning data in the same migration

```scope
id: adding-check-validate-requires-auditing-every-writer-of-the
paths: []
triggers: ["VALIDATE CONSTRAINT","NOT VALID"]
```

**Context:** The currency refactor added `CHECK ("exchangeRate" > 0)` + `VALIDATE` on 12 document tables. Review found `get-method` had been writing `exchangeRate: l.exchangeRate ?? 0` into `quoteLinePrice` for every legacy null-rate quote line, and the old `NUMERIC(10,4)` clamp had stored sub-0.00005 rates as literal `0.0000`.

**Problem:** `VALIDATE CONSTRAINT` scans existing rows mid-deploy — one violating row anywhere fails the whole migration in production, and post-deploy the unfixed writer fails at runtime (a whole edge-function transaction). A constraint that is obviously true "going forward" says nothing about years of rows written by code paths you didn't grep.

**Rule:** Before adding a CHECK on an existing column: (1) grep EVERY writer of that column — app services, edge functions, triggers, seeds — and fix any that can produce a violating value in the same change set; (2) repair existing violating rows in the same migration, before the VALIDATE (`UPDATE … WHERE <violates>` with an explainable value); (3) remember old NUMERIC(p,s) clamps — a widened column can still hold rounded-to-zero values from its clamped era.

**Applies to:** any `ADD CONSTRAINT … CHECK` + `VALIDATE` migration; posting writers (`apps/erp/app/modules/*/*.service.ts`) of the constrained column.

## Changing `seed.data.ts` only reaches NEW companies — existing companies need a reconciling migration

```scope
id: changing-seed-data-ts-only-reaches-new-companies-existing-co
paths: ["packages/database/src/seed-data.ts","packages/database/src/seed-dev.ts"]
triggers: ["periodCloseTaskDefinition","seedCompany","seed-data"]
```

**Context:** The period-close checklist changed (dropped "Close the period", reclassified two Auto/Manual tasks to Action). Those edits went into `packages/database/supabase/functions/lib/seed.data.ts` (+ `seed-company` / `seed-dev`), which only run on **company creation**. Existing companies — seeded by the original migration's `INSERT … FROM company` — kept the old task set, so the fixes never reached them.

**Problem:** Seed data (`seed.data.ts` + `seed-company`) and migration-time seeds (`INSERT … FROM company`) are two different populate paths. Editing the former fixes new companies; existing companies are frozen at whatever the migration inserted. The two silently drift.

**Rule:** When you change seeded per-company template rows (`periodCloseTaskDefinition`, `paymentTerm`, `accountDefault`, …) in `seed.data.ts`, also write an idempotent **reconciling migration** for existing companies (`INSERT … FROM company … ON CONFLICT DO UPDATE`, plus deletes for removed rows), guarded on the `system` user for the `createdBy` FK. Validate it in a rolled-back psql txn that simulates the old state. Deleting instance rows to force re-instantiation is fine when no real data depends on them (confirm first).

**Applies to:** any change to `packages/database/src/seed-data.ts` per-company templates; `seedCompany` (`apps/erp/app/modules/settings/settings.service.ts`), `seed-dev.ts`.

## `CREATE OR REPLACE VIEW` cannot reorder columns — DROP + CREATE when `t.*` grows

```scope
id: create-or-replace-view-cannot-reorder-columns-drop-create-wh
paths: []
triggers: ["CREATE OR REPLACE VIEW"]
```

**Context:** The work-center batch-capacity migration added `batchCapacity`/`minimumBatchQuantity` to `workCenter` and re-declared the `workCenters` view (which selects `wc.*` before aliased join columns like `locationName`) with `CREATE OR REPLACE VIEW`.

**Problem:** `CREATE OR REPLACE VIEW` can only APPEND columns at the end — the new `wc.*` columns expand in the middle, shifting `locationName` to a new position, and Postgres refuses with `cannot change name of view column "locationName" to "batchCapacity"`. The migration fails at apply time even though the SQL looks like a routine re-declare.

**Rule:** When a view selects `t.*` and the underlying table gains columns that land BEFORE any explicitly-aliased column, re-declare with `DROP VIEW IF EXISTS` + `CREATE VIEW` (checking dependent views first) — not `CREATE OR REPLACE`. Only a pure append at the end of the select list is REPLACE-safe.

**Applies to:** every `packages/database/supabase/migrations/*.sql` that re-declares a `SELECT t.*, …` view after an `ALTER TABLE … ADD COLUMN` (`workCenters`, `processes`, `jobs`, and siblings).

## Never feed a nullable user id into a NOT NULL audit column from a DB function

```scope
id: never-feed-a-nullable-user-id-into-a-not-null-audit-column-f
paths: ["packages/database/supabase/migrations/*.sql","packages/database/src/event-system/handlers/*.sql"]
triggers: ["p_new->>'updatedBy'","NEW.\"updatedBy\"","p_user_id"]
```

**Context:** A live demo failed to record production quantities, backflush materials, or complete the job. `sync_update_job_operation_quantities` auto-flipped the operation to `Done` without stamping `updatedBy`; `sync_finish_job_operation` then passed `p_new->>'updatedBy'` (NULL) as `p_user_id` into `complete_job_to_inventory`, whose `itemLedger` insert violated `createdBy NOT NULL` (23502) and rolled back the entire cascade. A sweep found the same latent bug in `sync_purchase_invoice_line_price_change` (payload `updatedBy` → NOT NULL `purchaseInvoicePriceChange.updatedBy`) — right next to a migration that had fixed the adjacent trigger for exactly this reason.

**Problem:** `updatedBy` is nullable on every table, and trigger/interceptor UPDATEs don't go through the app layer that normally stamps it. So `p_new->>'updatedBy'`, `NEW."updatedBy"`, and `p_user_id DEFAULT NULL` params are all NULL-able user sources; writing them into a NOT NULL `createdBy`/`updatedBy`/`postedBy` makes the whole transaction (including the user's original write) roll back with 23502. The failure is invisible in testing whenever the row happens to have been user-updated before.

**Rule:** In SQL functions: (1) any UPDATE issued by a trigger/interceptor that other interceptors may react to must stamp `"updatedBy"` (from the payload's `createdBy`/`updatedBy`) and `"updatedAt"`; (2) never write a payload user field into a NOT NULL column without a fallback — `COALESCE(p_new->>'updatedBy', p_new->>'createdBy')` (`createdBy` is NOT NULL on source tables); (3) functions taking `p_user_id` that write audit columns must not default it to NULL, or must guard right after `BEGIN` with a fallback to the entity's `createdBy` (see `20260706182830_fix-null-user-audit-columns.sql`). When forking a large function to add such a guard, extract the newest body verbatim (sed) and diff-verify instead of retyping.

**Applies to:** `packages/database/supabase/migrations/` — all `sync_*` interceptors and any PL/pgSQL function writing `createdBy`/`updatedBy`/`postedBy`; reviews of new event-system interceptors.

## Postgres transition tables are visible ONLY to the function the trigger invokes directly

```scope
id: postgres-transition-tables-are-visible-only-to-the-function
paths: ["packages/database/supabase/migrations/20260812002453_*.sql"]
triggers: ["batched_new","batched_old","attach_statement_handler","REFERENCING NEW TABLE"]
```

**Context:** The `itemStockQuantities` aggregate needed a statement-level handler on `itemLedger` so a bulk posting is one upsert instead of N. The event system already builds statement-level triggers (`trg_event_async_*` with `REFERENCING NEW TABLE AS batched_new`), so the obvious move was to have `dispatch_event_batch()` forward to a custom function.

**Problem:** A nested call cannot see the transition tables. A plain function called from the trigger function fails with `relation "batched_new" does not exist` — and this holds for dynamic SQL too (`EXECUTE 'SELECT count(*) FROM batched_new'` fails identically), because the ephemeral named relation lives in the trigger function's own query environment and is not propagated. The only ways to hand a batch onward are materializing it into a temp table per statement (real cost on a hot write path) or not nesting at all. Separately, `dispatch_event_batch()` early-returns when a table has no active subscription and when `app.sync_in_progress` is set — both correct for queueing, fatal for an aggregate that must always be maintained.

**Rule:** A function that needs `batched_new`/`batched_old` must be attached as the trigger's own function. Use `attach_statement_handler(table, functions[])` (`20260812002453`), the statement-level sibling of the row-level interceptors; it does not enqueue to PGMQ. Handlers are attached for INSERT/UPDATE/DELETE and must branch on `TG_OP` — only `batched_new` exists on INSERT, only `batched_old` on DELETE (PL/pgSQL plans lazily, so an unexecuted branch never resolves its missing table). Note also that adding a defaulted parameter to `attach_event_trigger` is a trap: two overloads are live, and a third with defaults makes existing 2-arg calls ambiguous.

**Applies to:** `packages/database/supabase/migrations/20260812002453_event-system-statement-handlers.sql`, `.claude/rules/event-system.md`, any statement-level trigger work under `packages/database/supabase/migrations/`.

## Re-applying demo data runs code a first apply never reaches

```scope
id: re-applying-demo-data-runs-code-a-first-apply-never-reaches
paths: ["packages/database/src/datasets/**"]
triggers: ["PARENT_CHECK_TABLES"]
```

**Context:** A new table (`customerContractInvoiceLine`) got a CHECK that needs `customerContractInvoiceId` OR `memoId`. The demo datasets seed it with only the invoice.

**Problem:** Settings → Demo Data on a company that already had data failed with "new row … violates check constraint". The wipe that runs first nulls every nullable FK pointing at a table it clears, which emptied both columns. `pnpm db:check:datasets` stayed green: it applied each dataset once, to an empty scratch company, so the wipe never met a seeded row.

**Rule:** A seeded table whose CHECK needs one of several nullable FKs goes in `PARENT_CHECK_TABLES` (`packages/database/src/datasets/wipe.ts`). The dataset check now re-applies each dataset over itself, so this fails before commit. When a test only exercises the first run of an idempotent operation, also run it a second time.

**Applies to:** `packages/database/src/datasets/` (wipe, verify), migrations that add CHECKs over nullable FK columns.

## `sum(DISTINCT expr)` is not a fan-out dedup — it collapses equal values from different rows

```scope
id: sum-distinct-expr-is-not-a-fan-out-dedup-it-collapses-equal
paths: []
triggers: ["sum(DISTINCT","SUM(DISTINCT"]
```

**Context:** The `salesOrders` view aggregated line totals in a lateral that also LEFT JOINs `job` (one line → many jobs), and used `sum(DISTINCT <line total>)` to cancel the join fan-out. An order with two different lines that compute to the same amount (e.g. two items at 10 × $50 each) counted that amount once, understating the total on the list page, the dashboard KPI chart, and the sales funnel — while the detail page and PDF (app-side plain sums) were correct. Dozens of real orders were affected.

**Problem:** `DISTINCT` inside an aggregate dedupes by VALUE, not by source row. It cancels duplication from a join fan-out only as long as no two *distinct* rows produce the same value — for money amounts (repeated items, same qty × price) that collision is routine. The failure is silent and data-dependent: the view verifies "byte-identical" against its predecessor because the predecessor had the same bug.

**Rule:** Never use `sum(DISTINCT ...)`/`count(DISTINCT ...)`-style aggregates to undo join fan-out. Compute the aggregate in its own lateral/subquery over just the table being summed (no fan-out ⇒ plain `sum()`), and keep the fanned join in a separate lateral for the aggregates that need it. When reviewing a view, treat any `agg(DISTINCT ...)` over a joined row set as a probable value-collapse bug. Fixed in `20260812211507_fix-sales-order-total-duplicate-line-amounts.sql`.

**Applies to:** `packages/database/supabase/migrations/` views aggregating over joins (`salesOrders`, `purchaseOrders`, quotes/invoices list views); any SQL review touching `sum(DISTINCT`.
