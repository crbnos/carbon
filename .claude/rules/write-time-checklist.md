---
paths:
  - "apps/**"
  - "packages/**"
---

# Write-time checklist

Answer these BEFORE you write a file, and again over the diff before you call
the task done. `/execute` Step 2, `/fix` 3.4 and `/self-review` Step 2 all run
this list, so the writer and the reviewer ask the same questions.
`/check-and-commit` and the pre-commit hook run the `@carbon/checks`
conformance gate behind it.

How to use it:

1. Pick sections by what the TASK touches, not only the file in front of you.
   A route that serves a bulk UI action owns the UI bulk-button question even
   when the task names no component.
2. A line that starts with **Only if** applies when its condition holds.
   Skip it otherwise, without comment.
3. The rule in brackets holds the detail. The question stands on its own when
   no rule is named.

Every item is a mistake a review round had to fix AFTER the code was written
(PR #1601: 35 fix commits and 60 bot findings on one feature). Do not skip a
section because the task looks small: the per-row Apply loop in that PR was
rewritten three times because it started per-row.

## Any write (service function, route action, engine, job)

- Does the UPDATE/DELETE carry every predicate you checked (status, companyId,
  location, "nothing received")? `read → if ok → write` is two statements and a
  race. End the write in `.select("id")` / `.returning(...)`. An empty result
  is "changed since read", never success. [database-patterns]
- Did you write the transition matrix (from → to, and who may trigger each)
  as a comment above the service function before the first status write?
  Every status write names its from-state (`.eq("status", from)` or
  `.in("status", [...])`). A terminal state is excluded from every write that
  is not the transition into it.
- **Only if** the write mutates another document after a status claim (Open →
  Actioned, then apply): the claim sits adjacent to the mutation, RETURNS every
  column the mutation derives from, and the mutation uses those values, not the
  request body. The body is a selector (ids), nothing else. The release of a
  failed claim reads and surfaces its own `{ error }`.
- A bulk selection (`ids: string[]`) is one statement when every row takes the
  same value (`UPDATE … WHERE id = ANY(...) AND "companyId" = … RETURNING id`)
  and one Kysely transaction with `UPDATE … FROM (VALUES …)` and explicit
  `::type` casts when rows take different values. Never a per-row loop. Guard
  the empty list before any `IN (…)`. Dedupe ids at the validator
  (`.transform((ids) => [...new Set(ids)])`). **Only if** the batch emits an
  event: once, after the batch. **Only if** per-row work must stay per-row
  (it calls a server function with its own transaction): group by target so two
  changes to one row never run concurrently. [database-patterns]
- **Only if** this is a diff-sync (read rows → diff → write against a unique
  key): read with the transaction handle and take `pg_advisory_xact_lock` on the
  scope first. Aggregate candidates so no two share a natural key. Restate the
  row-state the diff assumed in every DELETE/UPDATE. Compare jsonb structurally,
  never by `JSON.stringify` equality. Skip unchanged rows and leave
  `updatedAt`/`updatedBy` alone on derived data. Re-check in the SQL any flag
  another writer can set without your lock.
- Did you grep for the document's existing writer of this column (status
  transition, quantity, date) and call it? Two writers for one column is a bug:
  delete the ungated one. Did you read the helper you call to its end? Does it
  recompute a parent status, re-sequence, or notify?
- **Only if** the write sets a column with a coupled sibling: `quantity` ↔
  `scrapQuantity` (`scrapAllowance`), line quantity or price ↔ tax percent plus
  tax amount, `dueDate` ↔ `deadlineType`. Open the form that edits the column
  and look for rendering keyed on a sibling; every such sibling is part of the
  write. [numeric-precision]
- Is `success` derived from every outcome bucket the action has (applied,
  refused, failed), with counts from the rows returned, not the ids requested?
- **Only if** this is a scheduled run with a "has work" short-circuit: the
  predicate unions every table the run WRITES, not only its inputs. Clearing
  stale output is work.

## Tenancy and permissions

- `.eq("companyId", …)` on every write statement, including inside the helper
  you merely call? A scoped read before it protects nothing. [database-patterns]
- In a `bypassRls` route: parse `action`/`intent` BEFORE `requirePermissions`
  and pass the verb for that branch (`create` for a create, `update` for a
  status or field change, `delete` for a branch that deletes a row). Do not
  re-gate branches the task does not touch.
- **Only if** the task adds a table to the authz manifest: `read:` is explicit,
  with a comment naming the pages that read it. A table only engines and routes
  write with the service role sets `create/update/delete: false`.
  `ENABLE ROW LEVEL SECURITY` precedes the first policy. [authz-manifest]
- **Only if** the write sets a user-id column other than `createdBy`/`updatedBy`
  (a column that `REFERENCES "user"("id")`): verify the id is an active employee
  of this company (`employee` by `id`, `companyId`, `active`) in a `*.server.ts`
  helper before the write, and return a field error on failure. Reuse the
  module's helper when one exists.
- **Only if** you cloned a component across modules: grep the clone for the
  source module's name in `permissions.can`, `path.to.*` and `*_view`.
- **Only if** the page is location-scoped: `.eq("locationId", …)` on every
  read. On a write, a record at another location is refused: 409 for a single
  record, counted as not changed in a batch.
- **Only if** the task writes a SQL `SECURITY DEFINER` read: the first
  statement is `PERFORM assert_company_access(company_id)`, not a block copied
  from an older sibling. [authz-manifest]

## Reads at volume (demo data never reaches these limits)

- Is every `.in()` list bounded by the page size or a constant, never by a
  result set's cardinality? When it can grow past about 100 ids, `chunkArray`
  it (`@carbon/utils`) and re-sort after concatenating. Embed over the FK
  instead of a post-lookup. State the bound in a comment. [database-patterns]
- **Only if** an engine or job reads rows whose absence causes a delete: wrap
  the read in `fetchAllFromTable` / `fetchAll` (`@carbon/database`) with a
  deterministic `.order()`. A bare `.rpc()` or `.select()` stops at 1000 rows
  and the diff deletes everything past the cap.
- Inside `for (const id of ids)`: no `.eq("id", id).single()`. Read the batch
  before the loop. `Promise.all` independent reads, sized to the pool.
- **Only if** the task writes SQL functions: a `LANGUAGE sql` read function is
  `STABLE`. A LATERAL that builds JSON read by sibling subqueries gets
  `OFFSET 0`. A grid filter argument is `TEXT[]` with `= ANY(...)`. A signature
  change drops BOTH signatures. `CREATE OR REPLACE FUNCTION … plpgsql` restates
  `SET search_path`. [database-migration-patterns]

## Errors

- No bare `await serviceFn(...)` as a statement. Every `{ error }` is read,
  including each element of a `Promise.all`. `?? []` after a read is legal only
  after the error branch returned or threw. A loader logs and throws. An engine
  persisting a derived value throws. [coding-conventions]
- **Only if** the action does follow-up work after a committed write
  (recalculate, notify, trigger): wrap it in try/catch, `logger.error`, put the
  failure in its own response bucket, and make `success` depend on it. Never
  log-and-continue silently. Never let a follow-up 500 an action that already
  applied.
- Bad input never returns 500. A ValidatedForm action uses
  `validator(schema).validate(formData)` and `validationError` (422). A JSON or
  fetcher action uses `safeParse` and returns `{ success: false, message }` with
  status 400. Never `.parse()` on request input. FormData numerics coerce
  (`zfd.numeric`). [conventions-forms]
- `logger.error` with context before every failure return caused by a failed
  read or write, including a loader that renders `[]` for a failed read; the
  empty state must not look like success. Rejected input logs `warn`.
- **Only if** the table has a UNIQUE constraint (grep its migration): branch on
  the SQLSTATE through one shared helper (add `isUniqueViolation` to
  `@carbon/utils` when none exists), never an inline `"23505"` or message
  match, and return a field error on a form write.
- **Only if** this is a scheduled job: an empty source list warns. "Nothing
  due" stays silent.

## Dates and numbers

- "Today" has one source per layer. Engine: `todayDate` injected in the
  company zone. UI: a required prop from the loader's `locationToday`, never
  `?? today(getLocalTimeZone())`. SQL: `location_today(location_id,
  company_id)`, never `CURRENT_DATE` in a function that takes a location. Memo
  and cache keys include today. A displayed wall-clock time names its zone.
  [date-handling]
- **Only if** you write a date fallback chain on a document row
  (`promisedDate → orderDate + leadTime`): does the sibling engine already have
  one? Extract one pure function and call it from both. Clamp an overdue supply
  to `max(date, today)` before comparing it with a need. [mrp-system]
- **Only if** the logic reads a bounded window: an entity whose evidence lies
  outside the window gets no verdict. Write the last-day-in and first-day-out
  tests. Per-period aggregates stop at periods ending on or after today.
- **Only if** the logic compares or converts quantities: measure in the unit
  the action WRITES. Open the view definition; a derived sum that includes
  scrap is not `job.quantity`. Never convert a value that already arrived
  converted. Write the unit in the field's JSDoc when two fields feed one delta.
- A stored number used as a loop step or divisor is clamped (`Math.max(1, …)`)
  and tested with 0 and NaN. A sizing loop asserts `quantity > 0` before
  pushing. A threshold's operator (`>` or `>=`) lives in ONE helper. A numeric
  setting has the same range in `CHECK` and in `.min()/.max()`.
  [numeric-precision]

## Migrations

- Every `*Id` column: `REFERENCES … ON DELETE <deliberate choice>` plus an
  index (partial `WHERE … IS NOT NULL` for nullable targets). Regenerable output
  cascades. Verify the parent's key shape first; several tables' PK is `(id)`
  alone, so a composite reference needs a `UNIQUE` prerequisite in the same
  migration. [database-migration-patterns]
- `CREATE OR REPLACE FUNCTION`: fork from the NEWEST prior definition
  (`grep -l 'FUNCTION.*\bname(' migrations | sort | tail -1`), keep every guard
  it had, write `-- Forked from <file>`. The new file's timestamp sorts after
  `origin/main`'s newest. [workflow-database-migration]
- **Only if** the new table has a CHECK across nullable FK columns: add it to
  the dataset wipe's explicit-delete list and run `pnpm db:check:datasets`. A
  comment that says a list "mirrors" another: update both lists, or state the
  difference and why. [onboarding-company-templates]

## UI

- `fetcher.submit` never inside a loop: one request with all ids, and the
  server branches on each row's stored type. A bulk button is disabled with
  the eligible count, computed by the handler's own predicate. "No request, no
  feedback" is not an allowed state.
- A list filtered by status renders only that status, and every derived count
  and empty-check comes from the filtered set. A server-side filter on a child
  collection is re-applied to the rendered children.
- Effects: a reset is keyed on the scope that invalidates the state (search
  params, selected id), never on loader `[data]`. No new
  `biome-ignore … suppressed due to migration`. Toasts are keyed on
  `fetcher.state` plus `fetcher.data`, never `[data?.message]`. A drawer's
  fetching effect starts `if (!isOpen) return`. A `useMemo` that calls `t\``
  lists `t` and `i18n`. `useNumberFormatter(<module constant>)`, never bare.
- Drawers stay mounted for the exit animation: `isOpen` plus a kept item,
  never `{item && <Drawer/>}`. A raw `fetch` mutation calls `@carbon/query`'s
  `useRevalidator` on success. [conventions-ui]
- Editable cells commit on blur or close, never per keystroke.
- A change to `Grid`, `Table` or `packages/react` for one consumer is a prop
  that defaults to the old behaviour. Virtual tables are `table-fixed` with a
  `size` per column. Dividers come from `divide-y`, not `&& <Separator/>`.
  Clicks inside an expandable row `stopPropagation`.
- A select that narrows a column's domain still accepts and shows the stored
  value. A settings card sits beside the other cards for the same concern.

## Types, copy, names

- Status, type and mode parameters are typed with
  `Database["public"]["Enums"][…]`, validated with `z.enum(tuple)`, and accept
  `| null` instead of `?? ""`. One consumer needs a looser field → a local
  `Omit<…> & {…}`, never a widened shared validator. Navigate with the id the
  route expects (the parent, not the line). **Only if** a DB enum crosses a
  request boundary in another casing: one exported map, used at every dispatch.
- Every literal that reaches the UI is wrapped: JSX text, placeholders, labels,
  breadcrumbs, menu labels, ternary arms, and the SECOND copy of a mirrored
  component. `<Plural>` for counts. `msg` outside component bodies. `.po`
  catalogs filled in the same commit. Route-action `message` strings stay
  plain. [i18n-lingui-system]
- One name per concept: grep every alias across `t\``, `msg\``, `aria-label`,
  `.claude/rules` and `docs/content` before the UI is done. A label names the
  field, not a preposition. A long `helperText` becomes a glossary term and a
  `termId`.

## Dead code

- Name the importer before exporting. A validator no route imports is deleted.
  Writing the second of a pair (`Production*` / `Purchasing*`)? Extract the
  shared piece first; copies drift. No defensive filter the producer already
  guarantees. Identical `switch` arms are one return. `redirect` comes from
  `@carbon/utils`.

## Docs, in the same commit

- A new file in a subsystem is added to its rule's `paths:`. A new export,
  table, column or `ui/` file gets its AGENTS.md line. A new enum value or
  sibling updates every prose list that enumerates the set. A redefined
  function updates every "newest definition" pointer. A rename is chased with
  `git grep` across `.ai/`, `.claude/rules/`, `**/AGENTS.md`, `docs/content`
  and migration comments. [keep-sources-in-sync]
- Comments state design reasons, not numbers ("five connections" rots). A
  comment naming a code path names one that exists. A new declaration goes
  above a comment block or below its symbol, never between the two.
- **Only if** the task adds a `companySettings` column or a form field: a
  `<Field>` in its reference page, and a glossary term for a new concept.

## Tests the fixes had to add afterwards — write them first

- Every guarded write has a wire-level test that asserts the predicate text
  and parameters: a Kysely `DummyDriver` subclass (precedent:
  `apps/erp/app/modules/shared/sort-order.test.ts`) or, for supabase-js, a
  `createClient` with a recording `fetch`. A set-based write asserts the
  statement count is independent of batch size and that the empty batch sends
  nothing.
- Every read-then-write: list the interleavings. Each one becomes a test that
  feeds a different value at the write than at the read.
- Every guard ships with the test that submits what it rejects: a foreign id,
  a non-Open row, a boundary value, a second concurrent call, scrap > 0, a 0 or
  NaN step, jsonb keys in a different order.
