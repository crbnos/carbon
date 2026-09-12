paths:
  - "packages/netsuite/**"
  - "packages/jobs/src/netsuite/**"
  - "packages/jobs/src/inngest/functions/tasks/netsuite-migration.ts"
  - "packages/ee/src/netsuite/**"
  - "apps/erp/app/routes/x+/settings+/netsuite.tsx"
  - "apps/erp/app/modules/settings/ui/NetSuiteMigration/**"

# NetSuite → Carbon Migration

One click at **Settings → Migrate from NetSuite** reads a customer's NetSuite account and
writes it into the current Carbon company. Carbon only ever READS from NetSuite — no
write-back, no two-way sync.

Grounded against `packages/netsuite/`, `packages/jobs/src/netsuite/`,
`packages/jobs/src/inngest/functions/tasks/netsuite-migration.ts`, and
`apps/erp/app/routes/x+/settings+/netsuite.tsx`.

## Three layers, and why they are separate

| Layer | Package | Knows about |
|---|---|---|
| **Extract** | `@carbon/netsuite` `src/extract/` | NetSuite only |
| **Map** | `@carbon/netsuite` `src/map/` | Both — and it is PURE |
| **Load** | `@carbon/jobs` `src/netsuite/load/` | Carbon only |

`MigrationPlan` (`packages/netsuite/src/plan.ts`) is the contract. Nothing downstream of
`map/` sees a NetSuite field name; nothing upstream of `load/` sees a database client.
That split is what makes the layer with all the product decisions in it — which NetSuite
item type becomes which Carbon type — unit-testable with no NetSuite account and no
database. Do not "simplify" by having the loader read NetSuite rows.

The loader is written in **Kysely against the generated database types**, deliberately: it
is what proves at compile time that every column the migration writes exists. It is how
`currency` having no `name` column was caught.

## Reading NetSuite

**SuiteQL, not the REST record service.** A collection `GET /record/v1/customer` returns
only ids and links — 4,000 customers is 4,001 requests against an account whose whole
concurrency allotment is 5. The same read in SuiteQL is 4.

- `Prefer: transient` is REQUIRED on every SuiteQL call. Without it NetSuite answers 400
  with a message about the header, which reads like a query error.
- `limit` max is 1000; `offset` is capped at **100,000** and then silently returns nothing.
  `suiteQLKeyset` (paging on `id > :last`) is the default for anything unbounded;
  `suiteQLAll` REFUSES at the ceiling rather than truncating.
- Governance is **concurrency**, not rate: N simultaneous requests per account (5 on most
  tiers), and the N+1st is rejected with 429, not queued. The client is a semaphore plus
  backoff. A token-bucket rate limiter would be the wrong tool and would still 429.
- Column names come back **lowercased**; booleans are the text `'T'`/`'F'`; numbers arrive
  as strings. `src/extract/row.ts` is the one place that is dealt with.
- There are **no bind parameters** over REST. Every literal goes through
  `src/extract/sql.ts`.

**Probe before you read.** `probeAccount` resolves the address, inventory, BOM and
units-of-measure tables at run start, because features change the schema (Multi-Location
Inventory, Advanced BOM), releases rename it (2026.1 split `entityaddress` into
per-record-type tables), and role permissions hide it with no error at all. What it could
not find lands in the run report.

## Writing Carbon

Load order IS the contract (`load/index.ts` `TIERS`). Three orderings are load-bearing:

- **Locations before items** — inserting an `item` fires an interceptor that creates one
  `itemPlanning` row per EXISTING location.
- **Items and parties before orders** — order lines resolve through the id map.
- **Items before bills of material** — a BOM line needs both ends.

**Interceptors create rows for you; UPDATE them, never insert.** Inserting an `item`
creates its `itemCost`, `itemReplenishment`, `itemUnitSalePrice` and `itemPlanning`, plus a
Draft `makeMethod` for `Part` and `Tool` ONLY. Inserting a `customer` or `supplier` creates
its payment and shipping rows, whose primary key is the party id — an insert there violates
it outright.

**Merge onto Carbon's seeded config, never duplicate it.** Every foundation tier matches
case-insensitively by name/code first. A second "Net 30" or a second "EA" is a
data-quality bug the customer inherits on day one. The chart of accounts is the delicate
one: `account` is company-GROUP scoped, so an insert is visible to sibling companies, and
`accountDefault` points at the seeded accounts by id — merging is the only safe shape, and
a multi-company group gets an explicit warning.

**Idempotency is by external id.** Every record is linked in `externalIntegrationMapping`
under `integration = 'netsuite'`, so a re-run updates rather than duplicates. The upsert's
`.where("allowDuplicateExternalId", "=", false)` is not optional — the unique index it
arbitrates on is partial, and Postgres raises 42P10 without its predicate.

**Opening stock is the one thing with no natural key**, and doubling a customer's
inventory is the worst thing this migration could do. Each entry carries a deterministic
`itemLedger.externalDocumentId` (`netsuite:opening:<item>:<location>`) and a re-run skips
markers it already sees.

**`SET LOCAL "app.sync_in_progress" = 'true'`** for the whole load, the same flag the
dataset seeder sets: without it, 20,000 inserts enqueue 20,000 webhook events and evaluate
every customer workflow on day one.

## The job

`carbon/netsuite-migration`, modelled on `company-template` — same marker row, same
throttled progress, same snapshot/keep/revert. `netsuite-migration-finalize` and
`netsuite-migration-revert` share the per-company concurrency key so the three never
overlap.

- **Credentials are not in the event payload.** Inngest stores event bodies in run
  history. `packages/jobs/src/netsuite/credentials.ts` resolves them from
  `companyIntegration` + Supabase Vault at run time.
- **Preview runs the real code path** and throws `DryRunRollback` after the load succeeds.
  A preview that took a different path would prove nothing about the migration it previews.
- **One transaction for the whole plan.** A half-migrated company is not a state anybody
  could reason about, let alone clean up.
- **A OneWorld account with several subsidiaries stops and asks.** The choices go on the
  marker as `subsidiaryChoices` and the page renders a picker. Merging subsidiaries into
  one company double-counts intercompany revenue and inventory.

## The gap register

`packages/netsuite/src/gaps/catalog.ts` is the source of truth; `GAPS.md` is generated
from it (`pnpm --filter @carbon/netsuite generate:gaps`) and `catalog.test.ts` fails when
they drift. Ids are stable and never renumbered — the run report, the docs site and support
all reference them.

Extraction counts what each gap costs THIS account. A gap with a proven count of **zero** is
dropped from the report; a gap extraction could not probe keeps a **null** count and is
still shown. "We could not check" and "there is nothing there" must not look the same to
somebody deciding whether to cut over.

## Ambiguity is left blank, never guessed

A NetSuite account formats transaction dates as either `DD/MM/YYYY` or `MM/DD/YYYY` by
preference, and the API gives no way to tell which. `05/06/2026` therefore lands as null
with a note, while `25/06/2026` resolves. The same rule governs country codes (only ISO
alpha-2 is taken) and Carbon's `Material`/`Tool` item types (never chosen automatically —
nothing NetSuite stores distinguishes them). A promised date silently off by months is
worse than a missing one.

## Known gaps in the implementation itself

- `PlanItem.leadTime`, `PlanCustomer.taxPercent` and BOM component scrap are extracted as
  null pending a decision on which NetSuite column is authoritative for each.
- The whole account is read into memory before loading. Bounded by `maxRowsPerTable` and
  fine at a manufacturer's scale; a multi-million-row account would need a streaming load.
