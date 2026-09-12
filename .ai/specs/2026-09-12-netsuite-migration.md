# One-Click NetSuite → Carbon Migration

> Status: implemented
> Author: Claude
> Date: 2026-09-12
> Research: `packages/netsuite/GAPS.md` (generated), Oracle NetSuite SuiteTalk REST / SuiteQL documentation
> Related: `.claude/rules/onboarding-company-templates.md` (the job/snapshot/revert pattern this reuses), `.claude/rules/csv-import-system.md` (the `externalIntegrationMapping` idempotency pattern this reuses)

## TLDR

A prospect on NetSuite cannot try Carbon without a week of CSV wrangling, and the CSV
importer covers customers, suppliers, items and methods — not the chart of accounts, not
on-hand stock, not open orders, and nothing at all about what it left behind. This spec
adds **Settings → Migrate from NetSuite**: connect NetSuite once, press Preview to see
exactly what would land, press Migrate, and get the whole account — chart of accounts,
customers, suppliers, items, bills of material, opening stock and open sales and purchase
orders — plus a report of everything that stayed in NetSuite and what to do about each
item. A pre-migration snapshot makes the whole thing revertible in one click.

Carbon only ever READS from NetSuite. There is no write-back and no two-way sync.

## Problem Statement

- **Nothing migrates an ERP today.** `import-csv` handles 27 entity types but only from a
  hand-mapped CSV, one entity at a time, with no cross-entity references: an order cannot
  be imported at all, because nothing resolves its customer and item ids.
- **The chart of accounts, on-hand stock and open orders are the three things a customer
  cannot start without**, and none of them has an import path.
- **Nobody tells the customer what did not come.** A migration's real risk is not a failed
  import — it is a successful one that quietly left the lot numbers behind, discovered at
  month-end close.
- **A migration must be undoable.** The backup/restore engine already does exactly this for
  demo data (`company-template`), and a migration is strictly more frightening than demo data.

## Proposed Solution

### Shape

Three layers, split so the interesting part is testable without a NetSuite account or a
database:

| Layer | Where | What it knows |
|---|---|---|
| **Extract** | `@carbon/netsuite` `src/extract/` | NetSuite only. SuiteQL, pagination, governance, feature probing. |
| **Map** | `@carbon/netsuite` `src/map/` | Both, and nothing else. Pure functions, snapshot → `MigrationPlan`. |
| **Load** | `@carbon/jobs` `src/netsuite/load/` | Carbon only. Kysely against the generated types, one transaction. |

`MigrationPlan` (`packages/netsuite/src/plan.ts`) is the contract between them. Nothing
downstream of `map/` sees a NetSuite field name; nothing upstream of the loader sees a
database client. Every product decision — which NetSuite item type becomes which Carbon
item type, which orders are in scope — lives in `map/`, in one reviewable place.

### The job

`carbon/netsuite-migration`, modelled directly on `company-template`:

1. Guard: refuse a second run while one is pending review.
2. Marker row (`externalIntegrationMapping`, `integration = 'netsuite-migration'`) with
   throttled `{ phase, done, total }` progress — the page's only window into a run that
   takes minutes.
3. Connect (resolve credentials from the vault), extract, map.
4. Snapshot the company (`buildCompanyBackup`) — reused on retry, never retaken.
5. Load the whole plan in ONE transaction.
6. Settle on `ready`, holding the run report; the user Keeps or Reverts.

`netsuite-migration-finalize` (Keep/Dismiss) and `netsuite-migration-revert` share a
per-company concurrency key with the migration, so the three can never overlap.

### Design decisions

**D1 — SuiteQL, not the REST record service.** A collection `GET /record/v1/customer`
returns only ids and links, so reading 4,000 customers is 4,001 requests against an account
whose entire concurrency allotment is 5. The same read in SuiteQL is 4 requests.

**D2 — Keyset pagination by default.** NetSuite caps SuiteQL's `offset` at 100,000 and
then silently stops returning rows. `suiteQLKeyset` pages on `id > :last` instead; the
OFFSET path remains for bounded lookups and REFUSES at the ceiling rather than truncating.

**D3 — Probe the account before reading it.** Features change the schema, releases rename
it (2026.1 split `entityaddress` into per-record-type tables), and role permissions hide
it with no error. `probeAccount` resolves the address, inventory, BOM and unit tables up
front, and records what it could not find in the run report.

**D4 — Merge onto Carbon's config, never duplicate it.** Carbon seeds a company with a
chart of accounts, an `EA` unit, payment terms and customer statuses. Every foundation
tier matches case-insensitively by name/code first and only inserts what is genuinely new.
A second "Net 30" is a data-quality bug the customer inherits on day one.

**D5 — Idempotent by external id, not by re-running blind.** Every migrated record is
linked in `externalIntegrationMapping` under `integration = 'netsuite'`, so a second run
updates rather than duplicates. The one thing with no natural key — opening stock — carries
a deterministic `itemLedger.externalDocumentId` marker instead.

**D6 — One transaction for the whole plan.** A half-migrated company (customers but no
items, orders pointing at items that do not exist) is not a state anybody can reason about.

**D7 — Preview runs the real code path.** The dry run loads the plan for real and then
throws to roll the transaction back. A preview that took a different path would prove
nothing about the migration it previews.

**D8 — Credentials never enter the event payload.** Inngest stores event bodies in run
history. The job resolves them from `companyIntegration` + Supabase Vault instead.

**D9 — Only open orders, with remaining quantities.** A migrated line's quantity is
`ordered − shipped`. Importing the original quantity would re-promise what NetSuite
already shipped.

**D10 — Document numbers are preserved, and the sequence is advanced past them.** The
number a customer service rep knows still finds the order; `advanceDocumentSequences`
moves Carbon's own numbering forward so the next order does not collide.

**D11 — One subsidiary per company, and the job refuses to choose.** A OneWorld account
with several non-elimination subsidiaries stops with a structured choice on the marker,
which the page renders as a picker. Merging them would double-count intercompany revenue
and inventory.

**D12 — The gap register is code, not prose.** `GAP_CATALOG` is the source of truth;
`GAPS.md` is generated from it and a test fails when the two drift. Extraction counts what
each gap costs THIS account, and a gap proven to cost zero is dropped from the report — but
a gap extraction could not probe is still shown, because "we could not check" and "there is
nothing there" must not look the same to somebody deciding whether to cut over.

**D13 — Ambiguity is left blank, never guessed.** A `05/06/2026` transaction date (DD/MM
in one account's preference, MM/DD in another's) lands as null with a note. A promised date
silently off by months is worse than a missing one. The same rule governs country codes
and Carbon's Material/Tool item types.

### What is migrated

Currencies, units of measure, payment terms, shipping methods, locations, departments, the
chart of accounts, customer and supplier types, customers and suppliers (with addresses and
contacts), items (with cost, price, units), supplier parts, bills of material, opening
stock, and open sales and purchase orders — in that order, which is the order their foreign
keys require.

### What is not

31 catalogued gaps, in `packages/netsuite/GAPS.md`. The six rated high: GL transaction
history, open AR/AP balances, one-subsidiary-per-company, routings and bills of process,
work orders and WIP, and lot/serial numbers on hand.

## Verification

- `pnpm --filter @carbon/netsuite test` — 46 tests over the client, the TBA signer, the
  mappers and the gap register.
- `pnpm --filter @carbon/jobs test` — includes the id map and sequence-advance helpers.
- `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs --filter=@carbon/netsuite`
  — the loader is written in Kysely against the GENERATED database types, so every column
  it writes is checked at compile time. That is what caught `currency` having no `name`.

## Known limits

- The SuiteQL queries are grounded in Oracle's documentation and captured account metadata,
  but a few table names vary by account version (`bomrevisioncomponentmember` vs
  `bomcomponent`, `inventorybalance` vs `inventoryitemlocations`). Those are probed at run
  start; the rest have not been exercised against a live account in this branch.
- Lead time, customer tax rate and BOM component scrap are extracted as null pending a
  decision on which NetSuite column is authoritative for each.
- The migration reads the whole account into memory before loading. That is fine at the
  scale of a manufacturer moving off NetSuite (tens of thousands of rows) and is bounded by
  `maxRowsPerTable`, but a multi-million-row account would need a streaming load.
