# Chart of Accounts Import

> Status: in-progress
> Author: Raul Soonawala
> Date: 2026-09-04

## TLDR

Bulk-load a chart of accounts from a CSV exported by another accounting system
(QuickBooks, Xero, NetSuite, Sage, Business Central, Odoo, Rillet, or a
hand-written sheet) through the existing CSV import wizard, mounted on the
Chart of Accounts page. One new importer case (`account`) in the `import-csv`
edge function builds the tree, matches each row to the existing chart, and
either previews the plan (dry run) or commits it in one transaction. The wizard
gains a per-table review step that runs the dry run, shows the resulting tree
and every conflict, and lets the user resolve conflicts before committing.
Additive only: the importer creates and updates accounts, never deletes.

## Problem Statement

Every company arrives with a chart of accounts. Today the only ways to get it
into Carbon are one account at a time through the New Account / New Group
forms, or a seeded default chart that rarely matches the customer's numbering.
The CSV import system covers 21 tables but not `account`, and the Chart of
Accounts page is a tree, not a `<Table>`, so it has no Bulk Import menu.

What makes accounts harder than the existing imports:

- `account` is scoped by `companyGroupId`, not `companyId`; the import payload
  carries only `companyId`.
- The chart is a tree. Parents may be referenced by number, by name, by a
  colon-delimited path in the name (QuickBooks), or implied by Begin-Total /
  End-Total rows (Business Central, Sage 50 Canada). Some exports have no
  hierarchy at all (Xero, Sage 50 US, Odoo).
- Leaves are keyed by `number` (unique per group); groups have `number = NULL`
  and are keyed by `(name, isGroup)`. Nothing today keys on a number column.
- `class` and `incomeBalance` are derived, not mapped, and must agree with the
  parent; `accountType` is required on leaves only.
- Two `isSystem` roots are frozen by trigger; a seeded chart already exists
  and `accountDefault` points at ~45 of its leaves with RESTRICT foreign keys.
- No DB guard exists for parent-is-group, same-group parent, or cycles.

## Proposed Solution

Reuse the whole import pipeline (upload, column mapping, enum mapping, route,
service, edge dispatch, results modal) and add:

1. `account` registration in `fieldMappings` / `importSchemas` /
   `importPermissions` and the edge function's table enum.
2. A pure planner (`import-csv/account-import.ts`) that turns mapped rows plus
   the existing chart into a plan: one node per row (and per synthesized
   group), each with an action `create | update | link | unchanged | skip |
   error`, its resolved parent, class, type, and the reason for any refusal.
3. A writer that applies a plan inside one Kysely transaction, parents first.
4. A `dryRun` flag and an `options` object on the import payload; the account
   case returns the plan when `dryRun` is set.
5. A per-table review step in the wizard that runs the dry run, renders the
   tree and the conflicts, and serialises structure choices and per-row
   resolutions into the final submit.
6. An Import action on the Chart of Accounts toolbar, gated on
   `create: accounting` and on the current company being the root of its group.

### Fields

| Field | Label | Type | Notes |
|---|---|---|---|
| `number` | Account Number | string | optional; leaves without a number are keyed by name |
| `name` | Account Name | string | required; may carry a path (`Parent:Child`) |
| `accountType` | Account Type | enum (21) | required; aliases cover the source-system vocabularies |
| `class` | Class | enum (5) | optional; derived from the type when absent; validated when present |
| `parent` | Parent Account | string | number, `number name`, group name, or a grouping label |
| `isGroup` | Is Group | boolean | Summary / header flag |
| `rowKind` | Row Kind | enum | Account, Group, Total, Heading, Ignore — for Begin/End-Total exports |
| `indent` | Indentation | number | places Heading rows |
| `active` | Active | boolean | inverted automatically when the mapped column is named Inactive / Hidden / Deprecated / Blocked / Archived |
| `externalId` | Source ID | string | stored in `externalIntegrationMapping` with `integration = "csv"` for re-import |

`incomeBalance` and `consolidatedRate` are never mapped: `incomeBalance` follows
`class`; `consolidatedRate` is Historical for Equity, Current for other
balance-sheet accounts, Average for income-statement accounts (the seed rule).

### Structure

`options.structure` is `auto` (default), `file`, or `carbon`.

- `file`: the hierarchy comes from the file. The signal used, in priority
  order: Row Kind (stack of open groups), Parent Account (resolved by number,
  `number name`, group name in the file or in Carbon, else a synthesized group
  named by the label), path in the name split on `options.pathSeparator`
  (default `:`). A row referenced as a parent is promoted to a group.
- `carbon`: file hierarchy is ignored; each leaf is placed under the
  shallowest active Carbon group with the same `accountType`, else the
  class group (Expense prefers the group whose type matches the leaf, then
  Operating Expenses), else the system root for its `incomeBalance`.
- `auto`: `file` when any signal is present, else `carbon`.

Top-level file groups adopt a Carbon group with the same name when the classes
agree (a file "Assets" becomes Carbon's "Assets"); otherwise they hang under
the class anchor.

### Identity

In order: an explicit `link` resolution, `externalId` via the csv mapping,
`number` for leaves, `(name, isGroup)` for groups and for numberless leaves.
A number match is an update even when the name differs. A name that is held
by a different account of the same kind is a conflict.

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Home | the shared CSV wizard, new `account` case | one import system; the wizard's enum step replaces a synonym table |
| Scope | additive: create, update, link; never delete | delete is blocked by RESTRICT FKs, the posted-journal trigger and PO/invoice CHECKs for anything referenced |
| companyGroupId | resolved in the edge function from `company.companyGroupId` | the payload contract stays `companyId`; matches `post-memo` |
| Root company | required; edge function throws otherwise | RLS lets only root-company users write the chart; Kysely bypasses RLS |
| Transaction | one, parents inserted by depth | the plan orders nodes, so no second pass is needed; uniques and roots are pre-checked per row so DB errors are not expected |
| Class change | only when the account has no journal lines | stored amounts are sign-interpreted by class |
| Cross-class re-parent | same rule as class change | it is a class change |
| Deactivate | refused when referenced by `accountDefault`, `fixedAssetClass`, or a journal line | balances vanish from every RPC while postings continue; no reactivate UI exists |
| Preview | `dryRun` on the same edge function; same planner | the plan the user reviews is the plan that commits |
| Hierarchy parsing | edge function, not the wizard | the wizard maps one column to one field; a provider pull can reuse the normaliser |
| Type vocabulary | option aliases on the 21 account types | auto-match stays exact-after-normalise and user-visible |
| Group class | from the group's own class column, else the majority of its leaves; minority leaves error | Carbon requires class agreement with the parent |

## Data Model Changes

None. `externalIntegrationMapping` gains rows with `entityType = "account"`,
`integration = "csv"`, alongside the accounting-sync rows for the same entity
type (`integration = xero | quickbooks | rillet`).

## API / Service Changes

- `importCsvValidator` (edge): `dryRun?: boolean`, `options?: Record<string, unknown>`.
- `importCsv` service: same two optional args; `enumMappings` type corrected to
  `Record<string, Record<string, string>>`.
- Route `x/shared/import/$tableId`: accepts `dryRun` and `options` (JSON string)
  form fields; returns `plan` when the edge function returns one.
- Edge response for `account`: `{ inserted, updated, errors, skipped, plan? }`.
- `CsvEntityType` gains `"account"`; `fetchLiveEntityIds` gains its case.

## UI Changes

- `imports.models.ts`: field `aliases` (column-name aliases used by the exact
  match before the LLM), `enumData.optionAliases`, `enumData.skipStepWhenUnmapped`.
- `FieldMappings.tsx`: honours the three additions; renders a per-table review
  step from `importReviewSteps` after the enum steps; widens the modal on it.
- New `ImportCSVModal/ChartOfAccountsReview.tsx`: structure choice, dry-run
  fetcher, tree preview, conflict table with per-row resolution
  (skip / rename / renumber / use existing), hidden `options` input.
- `ChartOfAccountsTableFilters.tsx` / `charts.tsx`: Import button opening
  `ImportCSVModal` for `account`; clears the accounts query cache on close.
- `UploadCSV.tsx`: template hint for `number` fields (was testing `"numeric"`).

## Acceptance Criteria

- [x] A Rillet-style export (Account Number, Account Name, Account Type, Account Subtype, Parent Grouping) imports with groups synthesized from Parent Grouping under the seeded class groups. (Browser, 2026-09-04: 4 groups + 15 accounts created, 1 renumbered in place.)
- [ ] A QuickBooks Account List export (`Parent:Child` names, Type, Detail type) imports with the path split into groups.
- [ ] A Xero export (Code, Name, Type) imports flat under Carbon's groups by type.
- [ ] A Business Central export (No., Name, Account Type Begin-Total/End-Total, Indentation) imports with the stack hierarchy.
- [x] Re-importing the same file reports every row unchanged. (Planner test; browser dry run.)
- [x] A number that already exists updates the name; a name held by a different account of the same kind is reported with a resolution. (Planner test; browser: link and rename resolutions re-plan.)
- [x] The two system roots are never written; a file "Balance Sheet" adopts the root. (Planner test.)
- [x] Deactivating an account referenced by `accountDefault` is refused per row. (Planner test.)
- [x] The dry run and the commit produce the same plan. (Same planner call; browser counts matched.)
- [x] Planner unit tests cover every structure mode, adoption, promotion, conflicts, cycles, class agreement, and resolutions. (`import-csv/account-import.test.ts`, 17 tests.)

## Out of Scope

- Deleting accounts.
- Re-pointing `accountDefault` after an import (the review lists the seeded leaves still referenced; the Default Accounts page changes them).
- Pulling a chart from a connected provider (Xero / QuickBooks / Rillet); the planner is written so a provider read can feed it later.
- Excel files, non-comma delimiters, header rows below row 1 (wizard limits).

## Feedback from the 2026-09-04 walkthrough

Two lists: what applies to the shared CSV import wizard (noted, not
implemented), and what is specific to the chart-of-accounts review step
(implemented the same day).

### General CSV upload feedback

- Closing the wizard should ask for confirmation. The close (×), Escape and
  the dev-server reload all discard the uploaded file, the column and value
  mappings and, on the review step, every resolution the user has entered,
  with no prompt. A "Discard this import?" confirmation once a file has been
  uploaded, and ideally state that survives a reload, would stop work being
  lost by a mis-click.
- The modal has no vertical constraint. `ModalContent` sizes to its content
  and `AnimatedSizeContainer` animates height with `overflow-hidden`, so a
  tall step (an enum step with many values, the review table) pushes the
  modal flush against the top of the viewport and the primary action
  (Next / Confirm Import) below the fold; the page scrolls instead of the
  modal body. Predates this branch. Candidate fix: cap `ModalContent` at
  `max-h-[calc(100vh-4rem)]` with `ModalBody` as the scroll region, and stop
  animating height when the content exceeds it.
- Check that the modal's resize animation matches origin/main's import
  window and the rest of the UI. Inherited from main: `ImportCSVModal`
  already wrapped the wizard in `AnimatedSizeContainer height` (spring,
  0.3 s), so the height animation between steps is not new. New on this
  branch: the modal switches `size` from `medium` to `xxlarge` on entering a
  review step and back on leaving it — a width jump main never does, and
  `ModalContent`'s `max-w-*` change is not animated. Verify on main
  (Customers → Bulk Import) and decide whether the width change should
  animate, be a fixed wide modal for the whole wizard, or be dropped.
- Horizontal scroll inside a modal should not be the design. The review
  table (and `ImportResultsModal`, which uses the same `w-max min-w-full`
  pattern) scrolls sideways when its columns exceed the modal width. In the
  results modal it is tolerable because the columns are the user's own CSV;
  in a review it hides the part that matters.
- On first load the chart tree is blank for a few seconds: `window.env` is
  injected differently on server and client (`root.tsx`), React reports a
  hydration mismatch and re-renders the document on the client. Unrelated to
  the import; noted because a click in that window hits an element that is
  about to be replaced.

### Chart of accounts specific feedback (implemented 2026-09-04)

- Details clipping: each plan row is two lines — the account on the first,
  the reason / changes and the resolution on the second, spanning the
  table. The table is `table-fixed` at the modal's width, so nothing scrolls
  sideways.
- Batched resolutions: picks accumulate in the review's local state and
  show as Pending; an "Update plan" action re-runs the dry run once with all
  of them, and Confirm sends the same set. A Resolved / Pending badge and
  Undo sit under each row.
- Bulk number choice: "Use the file's numbers for N matching accounts" and
  "Keep Carbon's numbers" act on every linkable conflict and every matched
  row at once, and each reverses the other. Per row, an update that
  renumbers offers "Keep Carbon's number" and "Leave this account as it is".
  The planner gained the `keepNumber` resolution (also honoured as a
  name-only match for a numbered row) and reports the matched account's
  number and name so the badge can name it. Verified in the browser: keep →
  27 updates / 7 unchanged / 0 attention; file's numbers → 34 updates.
