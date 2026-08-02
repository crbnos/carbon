# Accounting Sync Engine v3 — Manufacturing Journal Sync, Dimensions, Tie-Out

> Status: draft
> Author: Brad Barbin + Claude
> Date: 2026-08-02
> Research: first-principles design per Brad's directive (2026-08-02) — no new competitor
> research; provider API facts verified against the provider clients in
> `packages/ee/src/accounting/providers/` and flagged VERIFY where they are not.
> Prior research: [.ai/research/quickbooks-accounting-sync-engine.md](../research/quickbooks-accounting-sync-engine.md)
> Related specs: [2026-07-09-accounting-sync-engine.md](2026-07-09-accounting-sync-engine.md) (v2 —
> the engine this refactors; still accurate for the operation ledger, providers, and pull sweep),
> [2026-07-04-accounting-cutover-activation.md](2026-07-04-accounting-cutover-activation.md) (cutover),
> [2026-07-04-integration-surface.md](2026-07-04-integration-surface.md) (Carbon as sync *target*)

## TLDR

When the v2 engine was designed, manufacturing accounting didn't exist. It does now: 17 posting
flows write journals across 21 `journalEntrySourceType` values, resolving control accounts from
`accountDefault` and stamping analytical dimensions on every line via `journalLineDimension`.
The sync engine still treats journal push as a side feature: dimensions are dropped entirely,
policy is two hard-coded source-type lists, journals that don't push leave no trace, and
reconciliation is a presence check. This spec refactors posting sync around one requirement (Brad, clarified 2026-08-02):
**every journal entry Carbon creates automatically must land in the external accounting
system's GL — and Carbon must be able to prove it.** Carbon is the operational subledger;
the external GL is the books of record. Concretely: (1) every posted journal gets a **recorded
disposition** in the sync-operation ledger (pushed, summarized-into-batch, doc-backed,
excluded, blocked); (2) source-type policy becomes a **total, typed policy table** with
per-source-type granularity (individual vs daily summary) instead of scattered lists;
(3) **dimensions sync** to provider analytics fields (QBO Class/Department, Xero Tracking,
Rillet dimensions) through slot config + value mapping; (4) reconciliation graduates to an
**account × period tie-out** with drill-down; (5) Carbon's period close gains an auto-check
that the period's journals all reached the external GL. Three phases; no rewrite of the
proven v2 machinery (operation ledger, syncers, account mapping, pull sweep all stay).

## Problem Statement

Carbon's manufacturing accounting is now the dominant producer of journals. The complete
producer inventory (verified 2026-08-02):

| Producer | Dr → Cr | sourceType |
|---|---|---|
| `post-receipt` | Inventory/WIP/Indirect → GR-NI | Purchase Receipt, Transfer Receipt |
| `post-shipment` | COGS → Inventory (+ FA disposal legs) | Sales Shipment |
| `post-purchase-invoice` | GR-NI + PPV → Payables | Purchase Invoice |
| `post-sales-invoice` | Receivables → Sales (+ COGS legs) | Sales Invoice |
| `issue` (job material issue/backflush) | WIP → Inventory | Job Consumption |
| `post-production-event` (labor/machine/setup/overhead) | WIP → Absorption accounts | Production Event |
| `complete_job_to_inventory` (Postgres fn, interceptor cascade) | FG/COGS → WIP (+ catch-up absorption) | Job Receipt, Production Event |
| `close-job` | Variance → WIP residual | Job Close |
| `post-inventory-adjustment` / `post-inventory-count` / `correct-stock-movement` | Inventory ↔ Adjustment Variance | Inventory Adjustment |
| `post-nonconformance` (scrap / disposition / inspection reject) | Scrap → Inventory | Non-Conformance, Inbound Inspection |
| `post-payment`, `post-memo` | Bank/AR/AP legs, FX, discounts | Payment, Credit Memo, Debit Memo |
| Fixed assets (app-side) | Depreciation/disposal legs | Asset Depreciation, Asset Disposal |
| Manual JE UI | user-defined | Manual |

All of these stamp `documentType`/`documentId`/`documentLineReference`, write `accountId`
(natural-balance signed amounts; Dr/Cr derives from account class + sign), and attach
dimensions (`journalLineDimension`: Item, ItemPostingGroup, Location, Employee, WorkCenter,
Process, CostCenter, CustomerType, SupplierType, AssetClass, Custom).

Against that, the v2 sync engine (`packages/ee/src/accounting/`) has five specific gaps:

1. **Dimensions are dropped.** Every provider's `JournalEntrySyncer.fetchLocal` selects only
   `id, accountId, amount, description` from `journalLine`; no provider mapper writes QBO
   `ClassRef`/`DepartmentRef`, Xero `Tracking`, or Rillet dimensions. The analytical layer
   manufacturing accounting was built for never reaches the books of record.
2. **Policy is two hard-coded lists** (`POSTING_SYNC_DEFAULT_SOURCE_TYPES`,
   `POSTING_SYNC_EXCLUDED_SOURCE_TYPES` in `core/models.ts`) plus a per-company checklist.
   Nothing forces the lists to stay exhaustive as the enum grows — `Non-Conformance` and
   `Inbound Inspection` had to be hand-merged when quality posting landed. Granularity
   (individual vs daily consolidation) is one global switch, wrong for mixed volume: a shop
   posting hundreds of production events a day wants those summarized but receipts individual.
3. **Silence is indistinguishable from loss.** A journal that doesn't sync — because its type
   is doc-backed, or disabled, or posting sync is off — produces no record. With the external
   GL as source of truth, "every journal is accounted for" must be provable, not assumed.
4. **Reconciliation can't prove the books.** The weekly cron checks that pushed entries still
   exist and compares debit sums over 90 days. There is no account × period statement of
   "Carbon activity vs what Carbon put in the provider," and no drill-down when they differ.
5. **The source-of-truth contract is implicit.** Nothing connects Carbon's period close to
   sync state: a period can close with journals still unpushed, unsynced, or parked in
   Warning — silently diverging from the books of record.

What already works and is explicitly retained: the durable `accountingSyncOperation` ledger
(idempotency, statuses, retry/skip/re-send, inbox UI), per-provider syncers + `SyncFactory`
registry, account mapping via `externalIntegrationMapping(entityType='account')`, pre-flight
rules (unmapped accounts, AR/AP control lines, unbalanced, period lock), the reversal
contract, document-mode sync for AR/AP (invoices/bills as native provider documents; the
Rillet payment webhook + pull sweep), and the event-trigger → enqueue → drain pipeline.

## Proposed Solution

### The contract (invariants)

With an accounting integration connected and posting sync enabled:

- **I1 — Total delivery.** Every `Posted` journal is delivered to the external GL — pushed
  individually, as a member of a summarized batch, or via its backing synced document — or
  carries an explicit, visible reason it is not (`excluded (config)` | `blocked (warning)`).
  Exactly one recorded disposition per journal; completeness is a query, not a hope.
- **I2 — Single representation.** Each economic event appears in the provider exactly once:
  as a native document (AR/AP) XOR as a journal entry (inventory/manufacturing economics).
  Enforced structurally by the policy table + the existing AR/AP control-account pre-flight.
- **I3 — Fidelity within declared capability.** Amounts, accounts, dates, and slot-configured
  dimensions survive the mapping. Degradation (an unmapped dimension value, a dropped
  dimension) is recorded, never silent.
- **I4 — Provider entries are append-only.** Corrections reach the provider as reversals +
  new entries (existing v2 behavior), never edits or deletes.
- **I5 — Verifiable replication.** For every mapped account and period, Carbon can state its
  posted activity, how it was represented externally, and the provider-side sum of the
  entries Carbon created — and show the drill-down when they disagree.

### Architecture

```
17 posting flows (edge fns + complete_job_to_inventory + app)
        │  journal + journalLine(accountId, signed amount) + journalLineDimension
        ▼
journal event (INSERT-as-Posted / UPDATE→Posted / →Reversed)   ← unchanged
        ▼
┌─ getJournalPostingDecision ──────────────────────────────────────────┐
│  POSTING_POLICY (total, typed) ⊕ per-company config ⊕ provider caps  │
│  → decision recorded for EVERY journal (I1):                         │
│     push-individual → operation Pending                              │
│     push-summarized → operation Pending (held for consolidation)     │
│     doc-backed / excluded → operation Excluded (terminal, reasoned)  │
└──────────────────────────────────────────────────────────────────────┘
        ▼
accountingSyncOperation ledger  ── drain / daily consolidation ──► provider mappers
        │                                                            + dimension slots
        │                                                            (QBO Class/Dept,
        │                                                             Xero Tracking,
        │                                                             Rillet dims)
        ▼
account × period tie-out (cron + on-demand) ◄── provider-side sums by external id
        ▼
period-close auto-check: "period journals fully dispositioned, none Pending/Failed/Warning"
```

### 1. Recorded dispositions (I1)

The SYNC handler already computes `getJournalPostingDecision` for every journal event. v3
records the outcome instead of discarding the negative cases:

- Pushable journal (including doc-family journals when the family is in `journals` mode) →
  operation `Pending` (unchanged mechanics).
- Doc-backed (family in `documents` mode), family-off, source-type-disabled, or
  manual-excluded journal → operation row in a new terminal status **`Excluded`**, with a
  machine reason in `errorCode` (`DOC_BACKED` | `FAMILY_OFF` | `SOURCE_TYPE_DISABLED` |
  `MANUAL_DISABLED`) and the policy snapshot in `metadata`. `Excluded` is terminal but
  re-decidable: changing the config + Re-send moves it to `Pending` (reuses the existing
  transition guard machinery).
- **Doc-backed is a delivery claim, not a dismissal.** The operation's
  `metadata.backingDocument` records `{ entityType, entityId }` (the invoice/bill/payment/
  memo), and completeness + tie-out count the journal as delivered only while that
  document's own sync operation is `Completed`. If a source type's representation is
  `document` but that document entity's sync is **disabled** in the company's sync config,
  the journal parks as `Warning` with code `DOC_SYNC_DISABLED` instead of excluding —
  those amounts would otherwise never reach the external GL, and silence is the one outcome
  this system must not produce. (A deliberate journal-only mode — pushing AR/AP journals
  where document sync is off — remains a future representation option, not an accidental
  fallback.)
- Posting sync disabled entirely, or no accounting integration → no rows (no noise for
  companies not using the feature; the tie-out page states "posting sync off").

`Skipped` keeps its meaning (a human parked it); `Excluded` means policy did. The
sync-activity inbox becomes the complete audit trail, and the completeness check is
`journal LEFT JOIN accountingSyncOperation` scoped from the integration's posting-sync
start date — journals with no operation row indicate a missed event and feed the backfill.

### 2. Posting policy as a total, typed table (I2)

Replace the two lists with one declarative policy in `core/models.ts`:

```typescript
type JournalRepresentation = "journal" | "document" | "none";
type PostingGranularity = "individual" | "daily-summary";

const POSTING_POLICY: Record<JournalEntrySourceType, {
  representation: JournalRepresentation;   // structural: how this type CAN be represented
  family?: "ar" | "ap" | "per-line";       // for "document" types: which family setting decides
  defaultEnabled: boolean;                 // for representation === "journal"
  defaultGranularity: PostingGranularity;
}> = {
  "Purchase Receipt":     { representation: "journal",  defaultEnabled: true,  defaultGranularity: "individual" },
  "Production Event":     { representation: "journal",  defaultEnabled: true,  defaultGranularity: "daily-summary" },
  "Job Consumption":      { representation: "journal",  defaultEnabled: true,  defaultGranularity: "daily-summary" },
  "Sales Invoice":        { representation: "document", family: "ar",       defaultEnabled: false, defaultGranularity: "individual" },
  "Purchase Invoice":     { representation: "document", family: "ap",       defaultEnabled: false, defaultGranularity: "individual" },
  "Payment":              { representation: "document", family: "per-line", defaultEnabled: false, defaultGranularity: "individual" },
  "Manual":               { representation: "journal",  defaultEnabled: false, defaultGranularity: "individual" },
  // ... every enum value has a row; Record<> makes omission a compile error
};
```

- `Record<JournalEntrySourceType, …>` makes the policy **total**: adding an enum value
  without a policy row breaks typecheck (the failure mode that bit Non-Conformance).
- `representation: "document"` replaces `POSTING_SYNC_EXCLUDED_SOURCE_TYPES` — the journal
  CAN be represented by the synced document (invoice/bill/payment/memo). Whether it IS
  depends on the company's **family representation** setting (below); the AR/AP
  control-account pre-flight remains the backstop in documents mode.
- Per-company config is a flat per-source-type override (`enabled`, `granularity`) — flat
  list with per-row override, no matrix (house doctrine). The stored v2 shape
  (`sourceTypes[]` + global `consolidation`) is read through a shim and written back in the
  new shape on next save (same pattern as the credentials shim).
- Provider capability still gates the whole feature (`supportsJournalPush`).

Defaults: all inventory-economics types on, `Production Event` and `Job Consumption` default
to `daily-summary`, everything else `individual`; `Manual` off by default (unchanged).

**AR/AP family representation — both cases supported.** Per company, per family
(`families.ar`, `families.ap` in the posting-sync settings), an explicit three-way choice:

- **`documents`** (default — today's behavior): invoices/bills/payments/memos sync as native
  provider documents; their journals are `Excluded/DOC_BACKED`, delivered via the backing
  document (verified per §1). For shops that run AR/AP inside the external system.
- **`journals`**: the family's documents are NOT pushed as documents; their journals push as
  journal entries like any other source type (forced `individual` granularity — see provider
  constraints). For shops that post invoices/bills **within Carbon** and only need the GL
  effect in the external system. Mutually exclusive with the family's document entity sync
  (the settings action enforces it; a decision-time `DOUBLE_REPRESENTATION` guard parks as
  `Warning` if config ever contradicts itself).
- **`none`**: explicit "we handle this family outside the sync" (e.g. re-keying invoices into
  the provider by hand). Journals record `Excluded/FAMILY_OFF` — visible and deliberate,
  counted in the tie-out's excluded column, never a silent hole.

The choice is **explicit, not derived** from entity sync toggles: a company that merely
disables invoice document sync may be re-keying invoices manually — silently flipping them
into journal push would double-post against the re-keyed documents. Family resolution per
journal: static for `Sales Invoice`/`Credit Memo`/`Sales Return` (AR) and
`Purchase Invoice`/`Debit Memo`/`Purchase Return` (AP); `Payment` resolves per journal by
inspecting which control account its lines touch (`receivablesAccount` → AR,
`payablesAccount` → AP — self-contained, no extra fetch).

Journal-mode provider constraints (why this is its own phase):

| Provider | Constraint in `journals` mode | Handling |
|---|---|---|
| QBO | A JE line on AR requires a Customer ref, AP requires a Vendor ref; max ONE AR line and ONE AP line per JE | Mapper resolves the backing document's customer/vendor mapping (JIT via `ensureDependencySynced`); control-account lines aggregated to one per JE (legit — one journal = one document = one party); granularity forced `individual` |
| Xero | Manual journals CANNOT post to system AR/AP accounts or bank-type accounts | Carbon's `receivablesAccount`/`payablesAccount`/`bankCashAccount` must map to regular (clearing-style) Xero accounts; validated from the chart pull's account types at mapping time + pre-flight code `XERO_SYSTEM_ACCOUNT` |
| Rillet | Open GL; journals accepted broadly | No structural blocker expected; sandbox-verify AR/AP account posting alongside the Fields VERIFY |

In `journals` mode the AR/AP control-account pre-flight inverts: control-account lines are
expected and allowed (the check's purpose — preventing double-posting next to documents —
only applies in `documents` mode).

### 3. Dimension sync (I3)

Two layers, mirroring how account mapping already works:

**Slot config** (per integration, in `companyIntegration.metadata.settings.postingSync.dimensionSlots`):
an ordered list of `{ dimensionId, target }` where `target` is provider-specific:

| Provider | Targets | Capacity | Mechanism |
|---|---|---|---|
| QuickBooks Online | `class`, `department` | 2 fixed slots | JE line `JournalEntryLineDetail.ClassRef` / `DepartmentRef` (values = QBO Class / Department entities) |
| Xero | `tracking:<categoryId>` | 2 (org-wide Xero limit) | Manual-journal line `Tracking: [{ TrackingCategoryID, TrackingOptionID }]` |
| Rillet | `field:<fieldId>` | N (dimension-native) | Rillet **Fields** (support confirmed by Brad, 2026-08-02); journal-item field refs; field values are **upserted** via API. VERIFY narrowed to the exact v4 endpoints/ref shape — the client does not model Fields yet |

The provider declares `journalDimensionTargets()` (id, label, capacity) so the settings UI
offers only real targets; QBO orgs without Classes enabled (feature-gated by Intuit plan)
return an empty target list and the UI says so. Dimensions you don't slot simply don't sync —
that is configuration, not degradation (high-cardinality dims like Item are expected to stay
unslotted; slot Location / CostCenter / Department-class dims).

**Value mapping** in `externalIntegrationMapping` with `entityType='dimensionValue'` and
`entityId = "<dimensionId>:<valueId>"` (valueId is polymorphic across entity-typed
dimensions, so the composite key is required). Provider option id in `externalId`, display
metadata alongside — exactly like account mapping. UI ships match-by-name bulk action; a
per-slot `autoCreate` flag creates missing provider options by name at push time
(QBO Class/Department create, Xero TrackingOption create, Rillet Field-value **upsert**).
Defaults: `autoCreate` **on** for Rillet slots (Fields are dimension-native and upsert is
the expected flow), **off** for QBO/Xero (opt-in avoids surprise writes to their lists).

**Degradation policy**: a line carrying a slot-configured dimension whose value is unmapped
(and autoCreate is off) → the journal parks as `Warning` with code `UNMAPPED_DIMENSION_VALUES`
listing them (consistent with unmapped accounts). Per-company override
`onUnmappedDimensionValue: "warn" | "drop"` — `drop` pushes without the dimension and records
what was dropped in the operation metadata (I3: recorded, never silent). Lines whose
dimension is not slotted are untouched by pre-flight.

Syncer changes: `fetchLocal` joins `journalLineDimension`; the shared
`Accounting.JournalEntryLine` schema gains `dimensions: { dimensionId, valueId }[]`; each
provider mapper resolves slots → refs through the value-mapping cache the same way account
refs already resolve.

### 4. Per-source-type granularity + drill-back (I2, scale)

The consolidation cron generalizes from "one daily batch per company" to "per source type
whose granularity is `daily-summary`": grouping key becomes
`(postingDate, accountId, mapped-dimension-tuple)` — summaries preserve exactly the
analytical granularity the provider will see, so dimension fidelity survives summarization.
Netting per group stays (existing `netJournalLinesPerAccount` behavior); the provider entry's
memo carries source type, journal count, and batch reference; batch membership (journal ids)
lives in the batch operation's `metadata`, and the inbox row expands to the member journals
(drill-back). Rounding residue per batch posts against the mapped `roundingAccount` if the
netted lines don't balance to 2dp (pre-flight still enforces balance before push).

### 5. Tie-out + period-close gate (I5)

**Tie-out** replaces the aggregate half of the weekly reconciliation:

- For each mapped account × accounting period since the posting-sync start date, compute:
  - `carbonPostedAmount` — sum of posted `journalLine.amount` (Carbon side);
  - `syncedAmount` — sum represented externally as journals (individual + batch members);
  - `docBackedAmount`, `excludedAmount`, `pendingAmount`, `blockedAmount` — from
    dispositions; a doc-backed journal counts in `docBackedAmount` only while its backing
    document's operation is `Completed`, otherwise it falls into pending/blocked;
  - `providerAmount` — provider-side sum of the entries Carbon created (fetched by external
    id, as the presence check already does), converted to natural-balance sign.
- The invariant rendered per cell: `carbonPostedAmount = syncedAmount + docBackedAmount +
  excludedAmount + pendingAmount + blockedAmount` (internal completeness, pure SQL) and
  `syncedAmount = providerAmount` (external fidelity). Provider-native entries (payroll,
  rent) are out of scope by construction — Carbon proves *its* entries, it does not audit
  the whole provider GL.
- Results persist in a new `accountingSyncTieOut` table (queryable history, drill-down UI);
  computed by the weekly cron and on demand from the UI.
- Surfaced on a tie-out page in the accounting module (`accounting_view` permission — this is
  a controller's report, not a settings surface), with a status summary card on the
  integration detail page linking to it. Cells drill into the journal list behind the number
  (Drawer overlay, house convention).

**Period-close auto-check**: a new seeded `periodCloseTaskDefinition` ("External GL sync
complete") whose auto-evaluation passes when every posted journal in the period has a
terminal disposition (`Completed`/`Excluded`/`Skipped` — nothing `Pending`/`In Flight`/
`Failed`/`Warning`) — skipped/auto-passing when posting sync is off. Seeded in
`seed.data.ts` + a reconciling migration for existing companies (per the seeding lesson).
This is the operational meaning of "the integration GL is the source of truth": Carbon does
not close a period whose books-of-record replication is incomplete.

### 6. Producer contract (documented, not rewritten)

The 17 producers already satisfy what sync needs — `sourceType`, `accountId`, document
linkage, dimensions, balance, immutability-after-post. v3 freezes that as a documented
contract in `.claude/rules/accounting-sync-handlers.md` (which is stale — it still says
"Xero is the only live provider") rather than refactoring working posting flows. Sync-time
pre-flights remain the enforcement point. No edge-function changes in this spec.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope stance | Refactor policy/dimensions/verification **around** the v2 ledger + syncers; no rewrite | v2 machinery is proven and tested; the gaps are policy shape, dimensions, and verification — not transport |
| AR/AP representation | Per-family explicit choice: `documents` (default) \| `journals` \| `none` — supports both "send invoices/bills to the provider" AND "post invoices/bills in Carbon, provider gets the GL effect" | Brad's requirement (2026-08-02): both cases must work. Explicit (never derived from entity toggles) because a shop re-keying documents manually would be double-posted by a silent flip to journals; mutual exclusion enforced in settings + `DOUBLE_REPRESENTATION` guard |
| Journal-mode granularity | AR/AP source types in `journals` mode are forced `individual` | QBO allows one AR and one AP line per JE with party refs — summarizing across documents/parties is structurally impossible there and undesirable for drill-back everywhere |
| Doc-backed = delivery via document | `DOC_BACKED` records `metadata.backingDocument`; delivered only while that document's sync is `Completed`; representation `document` with that entity's sync disabled parks `Warning/DOC_SYNC_DISABLED` | Brad's clarification (2026-08-02): ALL automated journals must reach the external GL — a doc-backed journal is only "in the GL" if the document actually synced; a disabled document sync must be loud, never a silent hole |
| Carbon GL role | Stays on, always — it is the operational subledger (WIP by job, inventory valuation, close checklist run off it) | v2 decision retained; "external SoT" is expressed as I1–I5, not by suppressing Carbon's GL |
| Disposition storage | Operation rows for every decided journal; new terminal status `Excluded` + reason codes; no new disposition table | One inbox = one audit trail; completeness becomes a LEFT JOIN; volume is bounded by journal count (same order as pushes) |
| `Excluded` vs `Skipped` | `Excluded` = policy decision (re-decidable via config + Re-send); `Skipped` = human opt-out | Preserves existing UI semantics; the two answer different audit questions |
| Policy shape | `POSTING_POLICY: Record<sourceType, {representation, defaultEnabled, defaultGranularity}>` + flat per-company per-source-type overrides | Total by type (enum growth breaks compile, not production); flat list + per-row override, no matrix (house doctrine, `feedback_no_matrix_config`) |
| Granularity | Per source type (`individual` \| `daily-summary`), defaults: Production Event + Job Consumption summarized | Manufacturing volume concentrates in those two; global consolidation was the wrong knob |
| Summary grouping key | `(postingDate, accountId, mapped-dimension-tuple)`, netted per group | Summaries carry the same analytical resolution the provider stores; netting is existing behavior |
| Account-mapping layering (default accounts ↔ provider) | Roles (control accounts) live in `accountDefault` per company; the integration maps flat `account → provider account` (v2 `externalIntegrationMapping(entityType='account')`, retained); role-sensitive logic resolves role → Carbon `accountId` → mapped provider ref | One flat mapping page per integration, roles never duplicated at the integration level; `getUnmappedPostingAccounts()` already derives the required set from `accountDefault` + journal usage; unmapped accounts park pre-flight (`UNMAPPED_ACCOUNTS`); re-pointing a default account mid-life surfaces as a new unmapped account, never a mis-post |
| Dimension slot storage | `metadata.settings.postingSync.dimensionSlots` (config), NOT mapping rows | Slots are per-integration configuration; mappings are per-value links — different lifecycles |
| Dimension value mapping | `externalIntegrationMapping(entityType='dimensionValue', entityId='<dimensionId>:<valueId>')` | Reuses the proven mapping table + service; composite key because valueId is polymorphic |
| Unmapped dimension value | Default `warn` (park, code `UNMAPPED_DIMENSION_VALUES`); per-company `drop` records dropped dims in metadata | Dimensions are the point of this refactor — silent loss undermines trust; drop stays available for pragmatists and is still recorded (I3) |
| Auto-create provider options | Per-slot `autoCreate`: default on for Rillet (Field-value upsert), default off for QBO/Xero | Low-cardinality dims (Location, CostCenter) want zero-touch onboarding; Rillet Fields are dimension-native and upsert is the expected flow (Brad, 2026-08-02); QBO/Xero opt-in avoids surprise writes |
| Tie-out scope | Carbon-originated entries only (`syncedAmount = providerAmount` by external id); provider-native entries out of scope | Carbon proves its replication; auditing the whole provider GL is not Carbon's job and is unbounded |
| Tie-out storage | New `accountingSyncTieOut` table written by cron/on-demand | Historical, queryable, drillable; a JSONB report blob can't power per-cell drill-down |
| Tie-out UI home | Accounting module page under `accounting_view`; summary card + link on the integration settings page | Controllers read tie-outs; they don't necessarily hold `settings_*` |
| Close gate | Seeded auto-check task "External GL sync complete" (+ reconciling migration) | Makes the SoT contract operational at the exact moment it matters; auto-passes when posting sync is off |
| Producer flows | Untouched; contract documented in the refreshed rule | Minimal impact; 17 working flows; sync-time pre-flight is the enforcement point |
| Multi-tenancy (heuristic 1) | `accountingSyncTieOut`: `companyId`, composite PK `("id","companyId")`, `id('tieout')`, audit columns | Golden rules |
| Service shape (heuristic 2) | New fns (`dimension-mapping.ts`, tie-out service) take `client` first, return `{data, error}` | House convention; matches `account-mapping.ts` |
| RLS (heuristic 3) | `accountingSyncOperation` policies unchanged (enum value only); `accountingSyncTieOut`: SELECT for employees with `accounting_view`; writes service-role only | Mirrors the operation-ledger pattern; tie-outs are job-written |
| Permissions (heuristic 4) | Policy/dimension config under `x+/settings+/integrations.$id` (existing `settings` scoping); tie-out route requires `accounting_view` | Config is settings; the report is accounting |
| Forms (heuristic 5) | Policy + slot + value-mapping forms use `ValidatedForm` + zod validators + route actions | House convention |
| Module layout (heuristic 6) | Engine code stays in `packages/ee/src/accounting/` (core + providers); ERP service additions in `accounting.service.ts`; no new module | `packages/ee/AGENTS.md`; one service file per module |
| Backward compat (heuristic 7) | Settings read-shim (v2 `sourceTypes[]` + global `consolidation` → v3 per-source-type), written back in new shape; enum addition is additive; existing operations/mappings untouched | Same migration pattern as v2's credential shim; EE-internal surfaces only |

## Data Model Changes

Additive only. No changes to `journal`, `journalLine`, `journalLineDimension`,
`externalIntegrationMapping`, or `accountingSyncOperation` columns.

```sql
-- 1) New terminal disposition status (idempotent; capitalized display value per enum conventions)
ALTER TYPE "syncOperationStatus" ADD VALUE IF NOT EXISTS 'Excluded';

-- 2) Tie-out results (one row per integration × period × account × computation)
CREATE TABLE "accountingSyncTieOut" (
    "id" TEXT NOT NULL DEFAULT id('tieout'),
    "companyId" TEXT NOT NULL,
    "integration" TEXT NOT NULL,
    "accountingPeriodId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "carbonPostedAmount" NUMERIC(19,4) NOT NULL DEFAULT 0,
    "syncedAmount" NUMERIC(19,4) NOT NULL DEFAULT 0,
    "docBackedAmount" NUMERIC(19,4) NOT NULL DEFAULT 0,
    "excludedAmount" NUMERIC(19,4) NOT NULL DEFAULT 0,
    "pendingAmount" NUMERIC(19,4) NOT NULL DEFAULT 0,
    "blockedAmount" NUMERIC(19,4) NOT NULL DEFAULT 0,
    "providerAmount" NUMERIC(19,4),          -- NULL until the provider fetch succeeds
    "internalDelta" NUMERIC(19,4) NOT NULL DEFAULT 0,   -- carbonPosted − (synced+docBacked+excluded+pending+blocked)
    "externalDelta" NUMERIC(19,4),                       -- synced − provider (NULL when providerAmount is NULL)
    "computedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "accountingSyncTieOut_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "accountingSyncTieOut_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "accountingSyncTieOut_period_fkey" FOREIGN KEY ("accountingPeriodId", "companyId")
      REFERENCES "accountingPeriod"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "accountingSyncTieOut_account_fkey" FOREIGN KEY ("accountId")
      REFERENCES "account"("id")
);
-- Latest-per-cell upsert target
CREATE UNIQUE INDEX "accountingSyncTieOut_cell_uq"
  ON "accountingSyncTieOut" ("companyId", "integration", "accountingPeriodId", "accountId");
CREATE INDEX "accountingSyncTieOut_period_idx"
  ON "accountingSyncTieOut" ("companyId", "integration", "accountingPeriodId");

ALTER TABLE "accountingSyncTieOut" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "accountingSyncTieOut" FOR SELECT
  USING ("companyId" = ANY (get_companies_with_employee_permission('accounting_view'::text)));
-- No INSERT/UPDATE/DELETE policies: written by jobs via service role only.
-- (Mirror the exact helper-cast style of the newest RLS migration when writing this file.)

-- 3) Period-close task: seed "External GL sync complete" (Auto) in seed.data.ts
--    + idempotent reconciling migration for existing companies (ON CONFLICT DO NOTHING,
--    createdBy = system user), per the seed-reconciliation lesson.
```

Settings (JSONB, no schema change) — `companyIntegration.metadata.settings.postingSync` v3:

```typescript
{
  enabled: boolean,
  syncFromDate?: string,
  families: { ar: "documents" | "journals" | "none", ap: "documents" | "journals" | "none" },  // default documents/documents
  sourceTypes: Record<JournalEntrySourceType, { enabled: boolean; granularity: "individual" | "daily-summary" }>,
  includeManual?: boolean,            // retired into sourceTypes.Manual.enabled by the shim
  dimensionSlots: Array<{ dimensionId: string; target: string; autoCreate: boolean }>,
  onUnmappedDimensionValue: "warn" | "drop",   // default "warn"
  periodLockPolicy: "park" | "redate",
  lockDate?: string,
}
```

After migrations: `pnpm run generate:types` before any typecheck (full-stack type chain).

## API / Service Changes

`packages/ee/src/accounting/` unless noted; all service fns `client`-first, `{data, error}`.

- **`core/models.ts`** — `POSTING_POLICY` total record (replaces the two exported lists;
  keep deprecated aliases exporting derived lists until call sites migrate within this
  branch); v3 `PostingSyncSettingsSchema` with the v2→v3 read-shim; `Excluded` in
  `SyncOperationStatusSchema` + transition table (`Excluded → Pending` via Re-send);
  `JournalEntryLine.dimensions`; new error codes `UNMAPPED_DIMENSION_VALUES`,
  `DOC_SYNC_DISABLED` + `DOUBLE_REPRESENTATION` (decision-time Warnings),
  `XERO_SYSTEM_ACCOUNT` (journal-mode pre-flight), reason codes
  `DOC_BACKED`/`FAMILY_OFF`/`SOURCE_TYPE_DISABLED`/`MANUAL_DISABLED`; `families` in the
  settings schema (journal-mode option surfaced in the UI only once Phase 4 ships).
- **`core/posting.ts`** — `getJournalPostingDecision` returns a disposition (never a silent
  skip); per-source-type granularity resolution; dimension pre-flight
  (`collectUnmappedDimensionValues`); summary aggregation keyed by
  `(postingDate, accountId, dimensionTuple)`; rounding-residue line to `roundingAccount`.
- **`core/dimension-mapping.ts` (NEW)** — `getDimensionValueMappings()`,
  `upsertDimensionValueMapping()`, `matchDimensionValuesByName()`,
  `getUnmappedSlottedDimensionValues()` — thin wrappers over
  `ExternalIntegrationMappingService` with `entityType='dimensionValue'`; slot-config
  parsing/validation against `provider.journalDimensionTargets()`.
- **`core/types.ts`** — `journalDimensionTargets(): Promise<DimensionTarget[]>` optional on
  `BaseProvider`; `ProviderCapabilities.maxJournalDimensionSlots`.
- **Providers** — `quickbooks-online`: list Classes/Departments, `ClassRef`/`DepartmentRef`
  on JE lines, optional auto-create; `xero`: list TrackingCategories/Options, `Tracking` on
  manual-journal lines, optional option auto-create; `rillet`: implement **Fields** — list
  fields + values, journal-item field refs, value upsert (autoCreate default on); VERIFY
  the exact v4 endpoints/ref shape against the sandbox before wiring.
  Each provider's `JournalEntrySyncer.fetchLocal` joins `journalLineDimension`.
- **`packages/jobs`** — `events/sync.ts`: record `Excluded` operations from the decision;
  `accounting-consolidation.ts`: partition per source type × granularity, dimension-tuple
  grouping, batch metadata with member journal ids; `accounting-reconciliation.ts` →
  tie-out computation writing `accountingSyncTieOut` (keep the presence check);
  on-demand tie-out trigger event.
- **ERP** — `accounting.service.ts`: `getAccountingSyncTieOut()` (+ drill-down query by
  cell); `getPeriodJournalSyncReadiness()` for the close auto-check wired into
  `computePeriodReadiness`; settings route `x+/settings+/integrations.$id.tsx` gains policy
  + slot + value-mapping loaders/actions; new route `x+/accounting+/sync-tieout.tsx`
  (+ Drawer drill-down child route). Route actions follow flash/redirect conventions; no
  `Response.json`.

## UI Changes

1. **Posting-sync settings** (integration detail page): per-source-type table — source type,
   representation badge (Journal / Document / Off), enabled toggle, granularity select
   (only for journal representation). Flat list, no matrix. Counts shown plainly. A
   **mapping-readiness strip** next to the enable toggle shows how many posting accounts are
   mapped out of the required set (from `getUnmappedPostingAccounts`), with
   `accountDefault`-referenced control accounts grouped first in the existing account-mapping
   section — enabling with gaps is allowed (pre-flight parks affected journals) but the gap
   is visible before the first Warning, not after.
2. **Dimension mapping section**: slot picker (Carbon dimension → provider target, capacity
   enforced, autoCreate toggle per slot), then per-slot value-mapping table with unmapped
   values surfaced first + "Match by name" bulk action. Mirrors the account-mapping section.
3. **Sync activity inbox**: `Excluded` status chip + reason; disposition filter; batch rows
   expand to member journals (drill-back).
4. **Tie-out page** (`x+/accounting+/sync-tieout.tsx`): period × account grid with internal
   and external deltas, green/amber/red cells, "Recompute" action, cell click opens a Drawer
   listing the journals and their dispositions behind the number. Summary card on the
   integration page links here.
5. **Period close checklist**: the new auto-task renders like existing Auto checks and blocks
   close while journals in the period are unsynced or parked.

MES: no changes.

## Acceptance Criteria

Phase 1 — policy + dispositions
- [ ] Posting a sales invoice (accounting enabled, posting sync on) creates an `Excluded`
      operation with reason `DOC_BACKED` and `metadata.backingDocument` pointing at the
      invoice — visible in the inbox — and no provider journal, while the invoice document
      sync proceeds as today.
- [ ] With invoice document sync disabled for the company and posting sync on, posting a
      sales invoice parks a `Warning/DOC_SYNC_DISABLED` operation (visible, actionable) —
      never a silent exclusion.
- [ ] Every `journalEntrySourceType` value has a policy row; removing one fails
      `pnpm --filter @carbon/ee typecheck`.
- [ ] A company with stored v2 posting-sync settings behaves identically through the shim
      (same source types push, same consolidation), and saving settings persists the v3 shape.
- [ ] With `Production Event` granularity `daily-summary`, a day of production events yields
      one provider journal per (account, dimension-tuple) group with drill-back metadata,
      while a receipt the same day pushes individually.
- [ ] For a seeded week of mixed journals: count(posted journals since start date) =
      count(operation rows across all dispositions) — the I1 completeness query returns
      zero unaccounted journals.

Phase 2 — dimensions
- [ ] With Location slotted to QBO Class and values mapped, a Job Consumption journal pushes
      with `ClassRef` populated per line; the same journal to Xero carries the Tracking
      option; unslotted dimensions (e.g. Item) are absent and cause no warnings.
- [ ] An unmapped slotted value parks the journal `Warning/UNMAPPED_DIMENSION_VALUES`;
      mapping the value + Retry completes it; with `onUnmappedDimensionValue: "drop"` it
      pushes and the operation metadata records the dropped dimension.
- [ ] With autoCreate on for a QBO Class slot, a new Location auto-creates the Class and
      pushes without human touch.
- [ ] Daily-summary batches group by dimension tuple: two locations on the same account on
      the same day produce two provider journal lines.
- [ ] With a Location slot targeting a Rillet Field and autoCreate on, pushing a journal
      upserts the Field value and carries it on the journal items (sandbox live-fire —
      env-gated on API keys; flagged, never faked, if unavailable).
- [ ] `pnpm --filter @carbon/ee test` covers: slot capacity enforcement, composite-key value
      mapping, per-provider mapper output (QBO/Xero/Rillet golden fixtures), degradation
      recording.

Phase 3 — tie-out + close gate
- [ ] The tie-out page shows, for a seeded period, internal delta 0 for every account; after
      manually deleting one provider journal (sandbox), recompute shows a red external delta
      on exactly the affected account × period with the missing entry in the drill-down.
- [ ] A period with one `Failed` journal operation cannot close (auto-check fails, names the
      journal); after Retry → Completed, the check passes and close proceeds.
- [ ] Tie-out rows are readable with `accounting_view` and not writable from the client
      (RLS verified).
- [ ] `.claude/rules/accounting-sync-handlers.md` refreshed to describe v3 (providers,
      policy table, dispositions, dimensions, tie-out); stale "Xero is the only live
      provider" claim gone.

Phase 4 — AR/AP journal mode (both-cases support)
- [ ] With `families.ar = "journals"` on QBO: posting a sales invoice pushes ONE journal
      entry whose AR line carries the customer ref (customer JIT-synced if unmapped), no
      Invoice document is created, and the payment applying to it pushes with the same
      contract; the same invoice under `families.ar = "documents"` produces the document and
      a `DOC_BACKED` journal disposition — never both.
- [ ] With `families.ar = "journals"` on Xero: pre-flight blocks (`XERO_SYSTEM_ACCOUNT`)
      until `receivablesAccount`/`bankCashAccount` map to regular Xero accounts; after
      remapping, the invoice journal posts as a manual journal.
- [ ] `families.ar = "none"`: invoice journals record `Excluded/FAMILY_OFF` and the tie-out
      shows them in the excluded column.
- [ ] Enabling invoice document entity sync while `families.ar = "journals"` is rejected by
      the settings action; a contrived contradictory config parks journals as
      `Warning/DOUBLE_REPRESENTATION`.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Double-posting if a doc-backed journal slips into journal push | High | Family mutual exclusion enforced in settings + `DOUBLE_REPRESENTATION` decision guard + AR/AP control-account pre-flight (documents mode) + acceptance test |
| Journal-mode payments/memos mis-route to the wrong family | Med | Static family for invoice/memo/return source types; Payment resolved from control-account lines (deterministic); unit tests over every source type × family combination |
| Dimension mapping misconfiguration mis-tags provider analytics (wrong Class on entries) | Med | Match-by-name proposes only exact matches; slot UI shows provider target names; tie-out doesn't depend on dimensions (account-level) |
| Warning-park floods on high-cardinality slotted dimension (someone slots Item) | Med | Slot UI warns on high-cardinality dimensions (value count shown); `drop` mode; autoCreate for legitimate growing dims |
| `ALTER TYPE ADD VALUE` ordering/transaction constraints in migration runner | Med | Follow `database-migration-patterns.md` enum guidance; idempotent guard; verify in rolled-back psql txn per the validation lesson |
| Summary batches hide a bad member journal (one bad line parks the whole batch) | Med | Pre-flight runs per member before aggregation; a failing member is excluded from the batch and parked individually with its own operation row |
| Tie-out provider fetch cost on large histories | Med | Scope to periods since posting-sync start; cache provider sums per completed period (closed periods don't change under I4); on-demand recompute per period |
| v2→v3 settings shim misreads an edge shape and flips a company's source types | Med | Shim unit tests over real stored shapes; behavior-parity acceptance test; settings write-back only on explicit save |
| Rillet Fields API shape differs from assumption (endpoints, ref format) | Low | Support confirmed (Brad, 2026-08-02); sandbox VERIFY of the exact v4 surface before wiring; zero-target fallback retained as the escape hatch |

## Open Questions

> Combined spec+plan request — resolutions below are **Autonomous** (codebase precedent >
> first-principles recommendation), surfaced for Brad's veto per the standing delegation.
> None fall in Ask-First territory: schema changes are additive EE-owned tables/enum values,
> no auth/RBAC/tenancy logic changes, no public contracts, no new production dependencies.

- [x] How is AR/AP represented in the external system? — **Answer (Brad, 2026-08-02, two
      steps):** (1) "source of truth" means **complete outbound delivery** — all
      automatically-created journals must land in the external GL; doc-backed delivery is
      verified via the backing document's sync status, and a disabled document sync parks
      journals as `DOC_SYNC_DISABLED`. (2) Both cases must work: sending invoices/bills to
      the external system AND posting invoices/bills within Carbon. Resolution: per-family
      explicit representation (`families.ar` / `families.ap` = `documents` (default) |
      `journals` | `none`), with journal-mode shipping as Phase 4 under the per-provider
      constraints in §2 (QBO party refs + one control line per JE; Xero non-system account
      mapping; forced individual granularity). The earlier autonomous "documents only,
      journal-mode later" position is superseded.
- [x] Does Carbon's GL get suppressed/demoted when an integration owns the books? —
      **Autonomous: no.** Carbon GL stays on (v2 decision; WIP-by-job and close tooling run
      off it). SoT is expressed as invariants I1–I5 + the close gate, not suppression.
- [x] Where do dispositions live — new table vs operation rows? — **Autonomous: operation
      rows** with terminal `Excluded` + reason codes. One inbox, one audit trail, no schema
      beyond an enum value.
- [x] Default handling of unmapped slotted dimension values — warn (park) vs drop? —
      **Autonomous: warn**, with per-company `drop` (recorded) and per-slot autoCreate.
      Rationale: dimensions are the point of this refactor; silent loss is the failure mode
      that erodes trust in the books.
- [x] Summary netting vs gross Dr/Cr totals per group? — **Autonomous: keep netting**
      (existing behavior, one line per (account, dims); memo carries count + batch ref).
      Gross-per-side would double line volume for symmetric flows; revisit only if an
      auditor requires gross activity in the provider.
- [x] Granularity defaults? — **Autonomous:** `Production Event` + `Job Consumption` →
      `daily-summary`; all other journal-represented types individual; per-company override
      per source type.
- [x] Tie-out UI home + permission? — **Autonomous:** accounting module route under
      `accounting_view` (controller-facing), summary card on the integration settings page.
- [x] Period-close gate strictness — hard block vs advisory? — **Autonomous: standard
      auto-check** (blocks like other failing auto-checks, with the existing checklist
      override semantics; auto-passes when posting sync is off). No new bypass mechanism.
- [x] Rillet dimension support? — **Answer (Brad, 2026-08-02): Rillet supports dimensions,
      called "Fields", and values likely need to be upserted via the API.** The remaining
      VERIFY is only the exact v4 endpoint/ref shape (checked against the sandbox before
      wiring); Rillet slots default `autoCreate` on accordingly.
- [x] What happens when a source type is doc-represented but that document's sync is
      disabled? — **Autonomous (prompted by Brad's delivery clarification):** park as
      `Warning/DOC_SYNC_DISABLED` — loud, actionable, never a silent hole. Auto-falling
      back to journal push was rejected: it would hit the AR/AP control-account pre-flight
      anyway and silently flip a company into journal-mode AR/AP; journal-only mode stays
      a deliberate future option.
- [x] Do doc-backed `Excluded` rows create unacceptable ledger volume? — **Autonomous: no**
      — bounded by journal count, same order as push volume; indexes already cover the
      inbox query pattern.

## Appendix — Default-Account (Control) Inventory

Verified 2026-08-02 against generated types (`packages/database/supabase/functions/lib/types.ts:330-384`)
and the newest migrations. `accountDefault` carries **50 account-reference columns**
(one row per company; nullable ones marked ∅ contribute to the required mapping set only
when populated):

- **Inventory / production**: `rawMaterialsAccount`, `finishedGoodsAccount`,
  `workInProgressAccount`, `indirectCostAccount`, `overheadAbsorptionAccount` ∅,
  `laborAbsorptionAccount` ∅, `scrapAccount` ∅
- **COGS / sales**: `costOfGoodsSoldAccount`, `salesAccount`, `salesDiscountAccount`,
  `serviceChargeAccount`
- **Variances / rounding**: `purchaseVarianceAccount`, `materialVarianceAccount`,
  `laborAndMachineVarianceAccount`, `overheadVarianceAccount`,
  `subcontractingVarianceAccount`, `lotSizeVarianceAccount`,
  `inventoryAdjustmentVarianceAccount`, `roundingAccount`
- **AR / AP / accruals**: `receivablesAccount`, `payablesAccount`,
  `goodsReceivedNotInvoicedAccount`, `prepaymentAccount`, `supplierPrepaymentAccount`,
  `customerPaymentDiscountAccount`, `supplierPaymentDiscountAccount`,
  `customerWriteOffAccount`, `supplierWriteOffAccount`, `intercompanyReceivablesAccount` ∅
- **Tax**: `salesTaxPayableAccount`, `purchaseTaxPayableAccount`,
  `reverseChargeSalesTaxPayableAccount`, `deferredTaxExpenseAccountId` ∅,
  `deferredTaxLiabilityAccountId` ∅
- **Bank / FX / other**: `bankCashAccount`, `bankLocalCurrencyAccount`,
  `bankForeignCurrencyAccount`, `realizedExchangeGainAccount`,
  `realizedExchangeLossAccount`, `currencyTranslationAccount`, `interestAccount`,
  `retainedEarningsAccount`, `maintenanceAccount`
- **Fixed assets**: `assetAquisitionCostAccount`, `assetAquisitionCostOnDisposalAccount`,
  `accumulatedDepreciationAccount`, `accumulatedDepreciationOnDisposalAccount`,
  `assetDepreciationExpenseAccount`, `assetGainOnDisposalAccount`,
  `assetLossOnDisposalAccount`

Recent churn this inventory already reflects (why it was re-verified): `inventoryAccount`
renamed to `rawMaterialsAccount` + `finishedGoodsAccount` split out (2026-07-13);
`inventoryShippedNotInvoicedAccount` **removed** (2026-07-13 — any doc naming it is
stale); `assetGainsAndLossesAccount` split into gain/loss (2026-07-17); absorption pair +
`supplierPrepaymentAccount` added (2026-07-11); `scrapAccount` added (2026-07-26).

**Derivation mechanism (no hand-list to drift):** `collectAccountDefaultAccountIds`
(`core/account-mapping.ts:93`) walks the live row and takes every column matching
`/Account(Id)?$/` — new default columns join the required mapping set automatically.
**Convention this depends on:** any future `accountDefault` account column MUST keep the
`…Account` / `…AccountId` suffix (goes into the refreshed rule file); a Phase 1 totality
test asserts every non-`companyId`/`updatedBy` column of the generated Row type matches
the pattern, so a differently-named column breaks tests instead of silently escaping the
mapping surface. Schema-typo note: `assetAquisitionCost…` (sic) is the canonical column
spelling — sync code must not "correct" it.

## Changelog

- 2026-08-02: Created. First-principles design per Brad's directive (research step
  intentionally skipped; provider facts verified in-repo, one VERIFY flagged for Rillet).
  Grounded in two full codebase surveys (sync engine internals; all 17 journal-producing
  flows). Open questions resolved autonomously under the combined spec+plan delegation and
  surfaced for veto. Implementation plan: .ai/plans/2026-08-02-accounting-sync-engine-v3.md.
- 2026-08-02 (later): Two clarifications from Brad folded in. (1) "Integration GL is the
  source of truth" = complete outbound delivery of all automated journals → I1 reframed as
  Total delivery; doc-backed dispositions now record `metadata.backingDocument` and count
  as delivered only while that document's sync is `Completed`; new decision-time
  `Warning/DOC_SYNC_DISABLED` when a doc-represented type's document sync is disabled.
  (2) Rillet dimensions confirmed as "Fields" with value upsert → VERIFY narrowed to API
  shape; Rillet slots default autoCreate on.
- 2026-08-02 (later still): Brad required BOTH AR/AP cases (documents in the provider, or
  posted within Carbon with only the GL effect synced). Added per-family representation
  (`families.ar`/`families.ap`: documents | journals | none), journal-mode provider
  constraints table (QBO party refs + one AR/AP line per JE, Xero system-account
  restriction → `XERO_SYSTEM_ACCOUNT`, forced individual granularity),
  `FAMILY_OFF`/`DOUBLE_REPRESENTATION` codes, and Phase 4 (AR/AP journal mode) with its
  acceptance criteria. Settings carry `families` from Phase 1 so no later shim is needed.
- 2026-08-02 (later still): Verified the current `accountDefault` inventory against
  generated types + newest migrations (50 account columns; recent renames/splits/removals
  reflected) — see the Appendix. Confirmed `collectAccountDefaultAccountIds` derives the
  required mapping set pattern-based from the live row (schema-driven, `scrapAccount` et
  al. covered automatically); added the suffix-naming convention + a Phase 1 totality test
  to keep it that way.
