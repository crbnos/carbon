---
paths:
  - "apps/**"
  - "packages/**"
triggers:
  - { text: ".update(", minCount: 2 }
  - ".delete()"
  - '.eq("status"'
  - "fetcher.submit("
  - "CREATE OR REPLACE FUNCTION"
  - "useEffect("
summary:
  - "End every guarded UPDATE or DELETE with `.select(\"id\")` or `.returning(...)`; an empty result means \"changed since read\", never success."
  - "Every supabase-js write carries `.eq(\"companyId\", ...)`, including inside a helper you call."
  - "Make a bulk write one statement or one transaction with `UPDATE ... FROM (VALUES ...)`, never a per-row loop."
  - "Read every `{ error }`, each element of a `Promise.all` too; never call `.parse()` on request input."
  - The server decides business rules; the UI may hint but must not be the only check.
---

# Write-time checklist

Answer before you write a file, and again over the diff before you commit. `/execute`, `/fix` and `/self-review` run this list.

- Pick the sections the task touches, not only the file in front of you.
- Skip a line marked **Only if** unless its condition holds.
- A bracketed name is the rule with the detail. Each question stands alone.
- **Already enforced by `@carbon/checks`** (the commit fails; do not re-answer
  these): `no-unscoped-kysely-write` (Kysely writes carry companyId),
  `no-unguarded-submit`, `no-raw-revalidator`, `no-unmounting-dialog`,
  `no-state-copy-of-loader-data`, `no-inline-unique-violation`,
  `no-foreign-key-without-on-delete`, `no-local-timezone` (server code),
  `no-missing-audit-column`, `no-required-column-without-default`,
  `no-numeric-precision`, `no-raw-rounding`, `route-action-shape`,
  `service-fn-file`, `no-db-client-in-service`, `function-redefinition-keeps-changes`.
  If a check fires, fix the code. Do not baseline a new hit.

## Writes (service function, route action, engine, job)

- Does every UPDATE/DELETE carry each predicate you checked (status, companyId, location)? End it with `.select("id")` or `.returning(...)`; an empty result means "changed since read", never success. [database-patterns]
- Does every status write name its from-state (`.eq("status", from)` or `.in(...)`)?
- Does one writer own each column? Grep for the existing writer and call it. Read the helper you call to its end: does it recompute a parent status, re-sequence, or notify?
- Is a bulk write one statement (`WHERE id = ANY(...) AND "companyId" = ... RETURNING id`) when every row gets the same value, or one transaction with `UPDATE ... FROM (VALUES ...)` and explicit casts when they differ? Never a per-row loop. Guard the empty list, and dedupe ids in the validator. [database-patterns]
- Is success derived from every outcome (applied, refused, failed), counted from the rows returned rather than the ids requested?
- **Only if** the write sets a column with a coupled sibling (`quantity`/`scrapQuantity`, price/tax percent/tax amount, `dueDate`/`deadlineType`): is the sibling in the same write? [numeric-precision]
- **Only if** the write claims a status, then mutates another document: does the claim return every column the mutation derives from, and does the mutation use those, not the request body? Does a failed claim's release surface its own error?
- **Only if** it is a diff-sync (read, diff, write on a unique key): take `pg_advisory_xact_lock` on the scope before the read, restate the assumed row state in each DELETE/UPDATE, and compare jsonb structurally.
- **Only if** the write takes untracked stock out (a negative `itemLedger` row): when no bin was chosen, does the bin come from stock (`planUntrackedDraw`; `planHeldUntrackedDraw` for nonconforming or returned stock; `shipmentSourceBinChooser` for a document line), never NULL or "the first row" by default? Does a serial or batch row use the bin the unit holds stock in? Does a reversal book against the row it reverses? [inventory-system]
- **Only if** the batch emits an event: emit it once, after the batch.
- **Only if** a scheduled job short-circuits on "no work": does the predicate include every table the run writes, stale output included?

## Tenancy and permissions

- Does every supabase-js write carry `.eq("companyId", …)`, including inside a helper you call? A scoped read before it protects nothing. [database-patterns]
- In a `bypassRls` route, parse `action`/`intent` before `requirePermissions` and pass that branch's verb. Do not re-gate branches the task does not touch.
- **Only if** the table joins the authz manifest: explicit `read:`; `create/update/delete: false` for service-role-only writes; `ENABLE ROW LEVEL SECURITY` before the first policy. [authz-manifest]
- **Only if** a column holds a user id other than `createdBy`/`updatedBy`: is it an active employee of this company, checked before the write, with a field error on failure? [user-employee-job-relationships]
- **Only if** the page is location-scoped: `.eq("locationId", …)` on reads. A write to a record at another location is refused (409 for one record, not counted in a batch).
- **Only if** a SQL `SECURITY DEFINER` read: is `PERFORM assert_company_access(company_id)` the first statement? [authz-manifest]
- **Only if** you cloned a component from another module: grep the clone for the source module's name in `permissions.can`, `path.to.*` and `*_view`.

## Reads at volume

- Is every `.in()` list bounded by a page size or constant, never by a result set? Past about 100 ids, `chunkArray` it and re-sort. Embed over the FK instead of a second lookup. [database-patterns]
- Inside a loop, no per-id `.single()`. Read the batch before the loop, and `Promise.all` independent reads.
- **Only if** an engine or job deletes rows absent from a read: read with `fetchAllFromTable` or `fetchAll` and a deterministic `.order()`. A bare `.select()` or `.rpc()` stops at 1000 rows, and the diff deletes the rest.
- **Only if** the task writes SQL functions: `LANGUAGE sql` reads are `STABLE`; `CREATE OR REPLACE ... plpgsql` restates `SET search_path`; a signature change drops both signatures. [database-migration-patterns]

## Errors

- Is every `{ error }` read, including each element of a `Promise.all`? No bare `await serviceFn(...)` statement. `?? []` only after the error branch has returned or thrown. [coding-conventions]
- A failed read or write logs with context and throws or returns an error. A loader must not render an empty list that looks like success. Rejected input logs `warn`.
- Bad input is never a 500. A ValidatedForm action uses `validator(schema).validate(formData)` and `validationError` (422). A JSON action uses `safeParse` and returns 400. Never `.parse()` on request input. [conventions-forms]
- **Only if** the action does follow-up work after a committed write: wrap it, `logger.error` it, report it in its own response bucket, and let `success` depend on it. Never 500 an action that already applied.
- **Only if** the table has a UNIQUE constraint: branch on the error with `isUniqueViolation` from `@carbon/utils`. A form write returns a field error.
- **Only if** a scheduled job: an empty source list warns; "nothing due" stays silent.

## Dates and numbers

- No JavaScript `Date` for parsing, formatting or arithmetic. [date-handling]
- "Today" has one source per layer: an engine takes an injected `todayDate` in the company zone; the UI takes the loader's `locationToday` prop; SQL uses `location_today(location_id, company_id)`, never `CURRENT_DATE` in a location function. Memo and cache keys include today. [date-handling]
- **Only if** a date fallback chain (`promisedDate → orderDate + leadTime`) on a document row: does a sibling engine already have one? Extract one pure function and call it from both. [mrp-system]
- **Only if** the logic reads a bounded window: an entity whose evidence lies outside the window gets no verdict. Test the last day in and the first day out.
- **Only if** the logic compares or converts quantities: measure in the unit the action writes. Check the view definition; a derived sum may include scrap. [numeric-precision]
- A stored number used as a loop step or divisor is clamped (`Math.max(1, …)`) and tested at 0 and NaN. A numeric setting has the same range in its SQL `CHECK` and its `.min()`/`.max()`. [numeric-precision]

## Migrations

- Every foreign key has an index (partial when nullable). Check the parent's key shape first; a composite reference needs a UNIQUE in the same migration. [database-migration-patterns]
- `CREATE OR REPLACE FUNCTION` forks from the newest prior definition (`grep -l 'FUNCTION.*\bname(' migrations | sort | tail -1`), keeps every guard it had, and says `-- Forked from <file>`. [workflow-database-migration]
- **Only if** a new table has a CHECK across nullable FK columns: add it to the dataset wipe and run `pnpm db:check:datasets`. [onboarding-company-templates]

## UI

- The server decides business rules. The UI may hint (disable, preview, show a count) but must not be the only check.
- No `fetcher.submit` in a loop: one request with every id, and the server branches per row. A bulk button shows the eligible count from the handler's own predicate.
- A list filtered by status renders only that status, and every count and empty check reads the filtered set.
- Avoid `useEffect`. If you need one, put it in a named hook. Toasts key on `fetcher.state` and `fetcher.data`. [conventions-ui]
- Editable cells commit on blur or close, never per keystroke.
- A change to a shared `Grid`, `Table` or `packages/react` component for one consumer is a prop that defaults to the old behaviour.
- The loader returns only what the page renders. Do not fetch a whole table to show one field.

## Types, copy, names

- Status, type and mode values use `Database["public"]["Enums"][…]` and `z.enum(tuple)`, and accept `| null` rather than `?? ""`.
- Every literal that reaches the UI is wrapped (`t`, `<Trans>`, `<Plural>` for counts, `msg` outside components), and the `.po` catalogs are filled in the same commit. Route-action `message` strings stay plain. [i18n-lingui-system]
- One name per concept. Grep the label across `t\``, `aria-label`, `.claude/rules` and `docs/content` before the UI is done.

## Dead code

- Name the importer before you export. A validator with no caller is deleted.
- Writing the second of a pair (`Production*` / `Purchasing*`)? Extract the shared part first; copies drift.

## Docs, in the same commit

- A new file in a subsystem joins its rule's `paths:`. A new export, table, column or `ui/` file gets its AGENTS.md line. A new enum value, sibling or redefined function updates every list and "newest definition" pointer. A rename is grepped across `.ai/`, `.claude/rules/`, `**/AGENTS.md`, `docs/content` and migration comments. [keep-sources-in-sync]
- Comments state the design reason, not a number that will rot. A comment that names a code path names one that exists.

## Tests, written first

- Every guarded write has a wire-level test that asserts the predicate and its parameters. Precedent: `apps/erp/app/modules/shared/sort-order.test.ts` (a Kysely `DummyDriver`).
- Every read-then-write: list the interleavings, and write a test for each that feeds a different value at the write than at the read.
- Every guard ships with a test that submits what it rejects: a foreign id, a non-open row, a boundary value, a second concurrent call, a 0 or NaN step.
- Did you break the code and watch each new test fail? Are its expected values literals, not output of the code under test? Does it repeat no existing test of the same rule? [testing]
