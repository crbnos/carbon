# Full Chart-of-Accounts Mapping for Accounting Integrations

> Status: draft
> Author: Brad Barbin
> Date: 2026-08-27

## TLDR

The accounting-sync Account Mapping tab (Xero / QuickBooks Online / Rillet) only
lets a user map the ~30–45 `accountDefault` "posting-default" accounts to the
external system. Any GL account outside that set — most importantly an Expense
account chosen on a **PO indirect-purchase line** (`purchaseOrderLineType =
"G/L Account"`) — has **no UI path to be mapped**, so when its purchase-invoice
journal syncs it parks as an `UNMAPPED_ACCOUNTS` warning with nothing the user can
do to resolve it. The sync runtime already resolves *any* mapped account
(`getAccountMappings` is unscoped); the accountDefault restriction lives purely in
three UI-layer points. This spec widens the tab to the **full chart of accounts** —
keeping the required (accountDefault) set primary, adding a searchable expansion for
every other account — and closes the loop by surfacing the exact accounts that are
**blocking a sync right now** (from the parked journals' `metadata.unmappedAccountIds`)
with a deep-link from Sync Activity. No schema change; no runtime change.

## Problem Statement

A purchase order line can charge a GL account directly (`purchaseOrderLine.accountId`,
line type `"G/L Account"` — the "indirect purchase" path). The account picker on that
line filters to Expense-class accounts but does **not** check whether the account has
an external mapping. At purchase-invoice time the journal debits that exact account
(`post-purchase-invoice/index.ts`, `case "G/L Account"`), and the sync engine pushes
it to Xero/QBO/Rillet.

If that account is not one of the posting-default accounts:

1. The per-journal preflight (`collectUnmappedJournalAccounts` →
   `runJournalEntryPreflight`, `packages/ee/src/accounting/core/posting.ts:536-969`)
   finds no external code for it and raises `errorCode: UNMAPPED_ACCOUNTS`,
   `warning: true`, `metadata.unmappedAccountIds: [<accountId>]`.
2. The provider throws `JournalEntrySyncError`; the batch loop isolates it and parks
   **that one journal** as a retryable `Warning` (`core/operations.ts:566-588`). Every
   other journal still syncs. There is no default/suspense fallback (by design).
3. **The account never appears in the Account Mapping tab** — the tab is scoped to the
   `accountDefault` set at three points, so there is no control to map it. The warning
   sits indefinitely with no user-actionable fix.

Concrete failure: a company buys an indirect item (e.g. office supplies) on a PO,
charging its `6xxx` Expense account. The invoice posts and syncs. Because that expense
account isn't a posting default, the journal parks `UNMAPPED_ACCOUNTS`. The user opens
the integration settings, sees only the posting-default accounts, and has no way to map
the expense account — the sync is stuck with no recourse short of a DB edit.

Note on history: `main` never shipped a full-CoA mapping *table*. PR #1308 (the
multi-provider sync engine, 2026-08-14) went from posting-default dropdowns straight to
the accountDefault-scoped tab; a full-account design existed only in the v1 sync-engine
spec and was scoped down before it shipped. This spec builds the full-CoA mapping that
was designed but never delivered.

## Proposed Solution

Widen the Account Mapping tab from the `accountDefault` set to the **full chart of
accounts**, presented as **required set primary + searchable full-CoA expansion**, and
add a **reactive "needs mapping now" signal** driven by the accounts that are actually
blocking syncs. The sync runtime is untouched — it already resolves any mapping in
`externalIntegrationMapping` (`entityType = "account"`).

Structure of the tab, top to bottom:

1. **Needs attention** — the union of:
   - **Required, unmapped**: `accountDefault` accounts with no mapping
     (`getUnmappedPostingAccounts`, today's list) — badged **Required**.
   - **Blocking a sync**: distinct account ids pulled from parked journal operations
     whose `errorCode = UNMAPPED_ACCOUNTS` (`metadata.unmappedAccountIds`) for this
     company + integration — badged **Blocking sync**. This is what closes the PO pain:
     the exact expense account holding up a journal is surfaced at the top with a mapping
     control, even though it isn't a posting default.
2. **Mapped** — accounts with an existing mapping (required and optional alike; the
   loader's accountDefault filter at `integrations.$id.tsx:217-220` is removed so
   previously-hidden optional mappings show).
3. **All accounts (expansion)** — a searchable list of the full chart of accounts
   (`account` where `isGroup = false`, company-group-scoped, ordered by `number`),
   grouped by account type/class, so a user can proactively map any account before it
   ever blocks a sync. Collapsed by default; opening it (or typing in the search box)
   reveals the full list.

Readiness semantics: **only the required (accountDefault) set gates integration
readiness.** Optional accounts are map-if-you-want; not mapping them never flags the
integration as incomplete — but the moment one *blocks a sync* it is promoted into
"Needs attention" (the Bookkeep lazy-required pattern from research).

Auto-match helpers: **Suggest-with-AI stays scoped to the required set** (avoids
proposing never-syncing accounts and needless model cost); **Match-by-code** (exact
Carbon `number` == provider `code`) is **extended to the full chart** — it is cheap,
deterministic, and useful across the whole CoA.

Deep-link: the Sync Activity view links a parked `UNMAPPED_ACCOUNTS` journal to this tab
with the offending accounts pre-focused (anchored/highlighted in "Needs attention"), so
a blocked sync is one click from its fix.

Reference: `.ai/research/full-coa-account-mapping-ui.md` — sync connectors keep a curated
required set primary with the full chart opt-in; the inline "map it from the blocked
transaction" affordance is the differentiator almost nobody ships.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Mappable scope | Full chart of accounts (`account`, `isGroup = false`), required set distinguished | The whole point — any account a transaction can hit (esp. PO GL-account lines) must be mappable |
| Layout | Required set primary + searchable full-CoA expansion | Research: sync connectors never ship a flat hundreds-row grid; keep required curated, full chart opt-in |
| Readiness gating | Only the `accountDefault` (required) set gates readiness; optional accounts don't | accountDefault is the set automated postings are *guaranteed* to run through; the rest are opt-in |
| Reactive signal | Surface accounts from parked `UNMAPPED_ACCOUNTS` journals in "Needs attention" + deep-link from Sync Activity | Directly resolves the PO pain; the differentiator research flagged; data already exists (`metadata.unmappedAccountIds`) |
| Suggest-with-AI scope | Required set only | Avoids proposing never-syncing accounts and unnecessary model cost |
| Match-by-code scope | Full chart | Exact `number == code` is cheap, deterministic, safe to run over the whole CoA |
| Runtime resolution | Unchanged — `getAccountMappings` stays unscoped | Runtime already resolves any mapping; only the UI was scoped |
| Data model | No schema change | `externalIntegrationMapping` (`entityType = "account"`) already accepts any `accountId`; write path (`upsertAccountMapping`) imposes no restriction |
| List scale | Client-side load-all + search + type grouping + unmapped-first; no pagination | Tab reads via Kysely (bypasses the `max_rows = 1000` PostgREST cap); ~101 leaf accounts by default, a few hundred worst-case is fine client-side |
| Permission scoping | Unchanged — `permissions.can("update", "settings")` | Same surface, same gate; no RBAC change |
| Service shape (heuristic 2) | New/modified readers take `client` first, return `{data, error}`, never throw | Matches existing `@carbon/ee` account-mapping readers |
| Form pattern (heuristic 5) | Reuse existing `ValidatedForm` + `accountMappingUpsertValidator` / `accountMappingBulkUpsertValidator` per-row and bulk forms | No new form contract needed; validators already accept any `accountId` |
| Module layout (heuristic 6) | Changes stay in existing files: `AccountMapping.tsx`, `integrations.$id.tsx`, `settings.models.ts`, `@carbon/ee .../account-mapping.ts` | No new module or scattered files |
| Backward compatibility (heuristic 7) | Removing the loader's accountDefault filter *reveals* previously-hidden optional mappings; no stored data changes, no FROZEN surface touched | Purely additive to the UI; existing mappings and runtime behavior unchanged |

## Data Model Changes

**None.** Mappings already live in `externalIntegrationMapping` with
`entityType = "account"`, unique on `(entityType, entityId, integration, companyId)`,
and the write path accepts any `accountId`. The parked-journal signal reads existing
sync operation rows (`errorCode = UNMAPPED_ACCOUNTS`, `metadata.unmappedAccountIds`).

Heuristics 1 (multi-tenancy) and 3 (RLS) are satisfied by the existing tables — no new
tables are introduced, so there is nothing to add `companyId` / composite PK / RLS to.

## API / Service Changes

In `packages/ee/src/accounting/core/account-mapping.ts`:

- **New reader `getFullChartMappableAccounts(db, { companyId })`** (or
  reuse an existing full-CoA reader if one fits) — returns all `account` rows where
  `isGroup = false`, scoped to the company group, ordered by `number`, as
  `{ id, number, name, type/class }`. Used to populate the "All accounts" expansion.
  Client-first, returns `{ data, error }`, never throws.
- **New reader `getAccountsBlockingSync(client, { companyId, integration })`** — returns the
  distinct account ids (joined to `account` for `number`/`name`) collected from parked
  sync operations with `errorCode = UNMAPPED_ACCOUNTS` and status `Warning` for this
  company + integration, via each operation's `metadata.unmappedAccountIds`. Feeds the
  "Blocking sync" rows in "Needs attention".
- **`matchAccountsByCode`** — widen its candidate set from the accountDefault-scoped list
  to the full chart (exact `number == code` match against the provider chart). Keep it a
  proposer (writes nothing).
- **`getUnmappedPostingAccounts`** — unchanged; it remains the "Required, unmapped" source.
- **`getAccountMappings`** — unchanged (already unscoped).

In `apps/erp/app/routes/x+/settings+/integrations.$id.tsx`:

- **`getAccountMappingTabData`** — remove the `mappableIds`/`scopedMappings` accountDefault
  filter (lines ~211-220) so all mappings render in "Mapped". Add the two new reads
  (`getFullChartMappableAccounts`, `getAccountsBlockingSync`) to the `Promise.all`, and
  pass `required` (accountDefault ids), `blocking`, and `allAccounts` through to the
  component. Keep the Kysely client and the "log-don't-throw" degradation.
- **Action handlers** — `upsert-account-mapping`, `bulk-upsert-account-mappings`,
  `ai-suggest-account-mappings` are unchanged; they already accept any `accountId`.
  (Optional) accept a query param on the tab route to pre-focus the accounts named by a
  deep-link.

In `apps/erp/app/modules/settings/settings.models.ts`:

- Validators unchanged (`accountMappingUpsertValidator`, `accountMappingBulkUpsertValidator`,
  `accountMappingAiSuggestValidator` all type `accountId` as a bare `z.string().min(1)`).

## UI Changes

`apps/erp/app/modules/settings/ui/Integrations/AccountMapping.tsx`:

- Restructure the two sections (`Unmapped` / `Mapped`) into three:
  **Needs attention** (Required-unmapped + Blocking-sync, each row badged), **Mapped**,
  and a collapsible **All accounts** expansion.
- Add a **search box** (matches account `number` and `name`) and **group-by-account-type**
  within the expansion; **unmapped-first** ordering. No pagination, no nested
  `max-h`+`overflow-y-auto` scroll region (per `.ai/lessons.md`) — use the collapse and
  the search to keep the list bounded.
- Reuse `AccountMappingRowForm` (per-row `ValidatedForm`, `Combobox` of provider accounts)
  unchanged; reuse `MatchByCodeDrawer` (now fed full-chart proposals) and `AiSuggestModal`
  (still fed the required-set `unmapped` only).
- Badges: **Required** (accountDefault), **Blocking sync** (from parked journals). A
  mapped optional account shows no badge.
- Support pre-focusing accounts named by the Sync Activity deep-link (anchor + transient
  highlight in "Needs attention").

Sync Activity view (the accounting sync operations list):

- On a parked journal with `errorCode = UNMAPPED_ACCOUNTS`, render a **"Map accounts"**
  link to the integration's Account Mapping tab, pre-focusing the offending account ids.

## Acceptance Criteria

- [ ] With an integration connected, a user opens the Account Mapping tab and sees three
      regions: **Needs attention**, **Mapped**, and a collapsible **All accounts**.
- [ ] Typing an account name or number in the search box filters the **All accounts** list
      to matching leaf accounts (group headers excluded), grouped by account type.
- [ ] A user maps a non-posting-default Expense account (e.g. `6xxx`) to a provider account
      and saves; a row appears in **Mapped** and no longer in **All accounts** as unmapped.
- [ ] After creating a PO with a `"G/L Account"` line charging an **unmapped** Expense
      account and posting its purchase invoice, the sync parks the journal as
      `UNMAPPED_ACCOUNTS`; that Expense account then appears under **Needs attention →
      Blocking sync** on the mapping tab.
- [ ] Mapping that "Blocking sync" account and re-driving the sync (reconciliation sweep or
      manual retry) moves the journal from `Warning` to a synced state — verified end to end.
- [ ] The Sync Activity row for that parked journal has a **"Map accounts"** link that opens
      the tab with the offending account pre-focused/highlighted.
- [ ] **Required** (accountDefault) accounts are badged **Required**; leaving an *optional*
      account unmapped does **not** flag the integration as incomplete, while a required one
      still does.
- [ ] **Match-by-code** proposes exact `number == code` matches across the full chart;
      **Suggest-with-AI** still operates only over the required-set unmapped accounts.
- [ ] Previously-hidden optional mappings (any mapping outside accountDefault created via
      other means) now render in **Mapped** (loader filter removed).
- [ ] Scoped typecheck (`@carbon/ee`, `erp`) and the accounting-sync tests pass; a
      full-CoA company (~100+ leaf accounts) renders the tab without a nested scroll region
      and without truncation.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Large customer charts (thousands of accounts) make the client-side list sluggish | Med | Search + collapse + type-grouping keep the rendered set small; if a real customer chart proves too large, add server-side paginated search as a follow-up (explicitly out of scope for v1) |
| `max_rows = 1000` truncates the full-CoA read | Low | Tab reads via Kysely, which bypasses the PostgREST cap; if any read is routed through supabase-js it must use `fetchAll*` with a stable `.order()` (`.ai/lessons.md`) |
| Removing the loader accountDefault filter surfaces stale/legacy mappings that confuse users | Low | They are real, runtime-honored mappings; showing them is correct. If any are truly orphaned, they render in **Mapped** and can be cleared — not hidden |
| Match-by-code across the full chart proposes matches for accounts that never sync | Low | Proposals are user-confirmed, never auto-applied; a harmless-but-unused mapping costs nothing at runtime |
| Reading `metadata.unmappedAccountIds` couples the UI to the parked-operation shape | Low | Shape is already stable and produced by `runJournalEntryPreflight`; read defensively (missing/empty metadata → no blocking rows) |
| Provider chart missing a code for a Carbon account (archived / API failure) | Low | Existing fallback-option behavior in `AccountMappingRowForm` is preserved; empty chart degrades the tab to Carbon-accounts-only, as today |

## Open Questions

> Resolved with the user on 2026-08-27 before this spec was written (spec-writing Step 5).

- [x] **Primary layout — full flat CoA grid vs required-primary with opt-in expansion?**
      Why it matters: determines the entire tab structure and whether the tab scales.
      **Answer:** Required set primary + searchable full-CoA expansion. Research shows sync
      connectors never ship a flat hundreds-row grid; the curated required set stays primary
      and the full chart is opt-in.
- [x] **Include the reactive blocked-journal signal in v1?**
      Why it matters: this is what actually resolves the PO pain (surfacing the exact account
      holding up a sync) versus merely exposing the full chart and leaving the user to hunt.
      **Answer:** Yes — surface accounts from parked `UNMAPPED_ACCOUNTS` journals in "Needs
      attention" and deep-link to the tab from Sync Activity. The data
      (`metadata.unmappedAccountIds`) already exists.
- [x] **Scope of the auto-match helpers once the full CoA is mappable?**
      Why it matters: AI-suggest across 100+ accounts is costly and would propose
      never-syncing accounts; match-by-code is cheap and deterministic.
      **Answer:** Suggest-with-AI stays scoped to the required set; Match-by-code extends to
      the full chart.
- [x] **How to handle chart-of-accounts scale?**
      Why it matters: the current tab has no search/pagination and relies on the small
      required set; the full CoA is 101+ leaf accounts and grows.
      **Answer:** Client-side load-all (via Kysely, which bypasses `max_rows`) + search box +
      group-by-account-type + unmapped-first ordering; no pagination. Server-side paginated
      search is a follow-up only if a real customer chart reaches the thousands.

## Changelog

- 2026-08-27: Created. Open questions resolved with the user before writing; competitor
  research at `.ai/research/full-coa-account-mapping-ui.md`; runtime confirmed unscoped
  (`getAccountMappings`) so no engine or schema change is required.
