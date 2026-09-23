# Spend management: push-only mode, provider roles, and delegated payables

> Status: draft
> Author: Brad Barbin
> Date: 2026-09-23
> Research: `.ai/research/spend-management-one-way-push.md`

## TLDR

A spend-management platform (Ramp today) allows exactly one connected accounting
provider. When a customer wants Ramp → Rillet to be the path for card charges,
reimbursements and bill payments, Carbon cannot hold that seat. This spec adds a
second **install mode** to spend integrations — *push-only* — in which Carbon requests
a reduced OAuth scope set, never touches the accounting connection, pushes purchase
orders, item receipts and provisional bills into the spend platform coded with **the
accounting provider's own identifiers**, and stops forwarding AP to the general ledger
because it now arrives via the spend platform.

Nothing in the design names Ramp or Rillet. Integrations declare a `providerRole`
(`accounting` | `spend`), spend providers declare per-mode capabilities, accounting
providers declare how they address external entities, and every gate reads those
declarations. Adding a second spend platform, or a fourth accounting provider, is a
descriptor entry plus one lookup method.

## Problem Statement

Carbon's Ramp integration assumes Carbon is Ramp's accounting provider: it creates the
Ramp accounting connection, pushes the chart of accounts and cost-center/project fields
as coding options, and pulls charges, bills, reimbursements, transfers, cashbacks,
repayments and bill payments into Carbon's ledger.

A manufacturing customer running Rillet as the GL wants the opposite arrangement:

- Ramp → Rillet carries card charges, reimbursements and bill payments directly.
- Carbon owns purchasing, receiving and the item master, and pushes purchase orders,
  item receipts and provisional vendor bills into Ramp so a human can approve and pay
  them there.
- Carbon must not also send those bills to Rillet, or AP is counted twice.

Four things block this today:

1. **Scopes are one frozen list.** `RAMP_OAUTH_SCOPES` (17 entries including
   `accounting:write`) feeds `config.tsx` → `integration-oauth.ts:20`
   `scopes.join(" ")`. There is no subsetting and no call site that filters it.
   Consent is granted before any setting is read, so a post-install toggle cannot help.
2. **`convergeRamp` unconditionally claims the accounting seat** —
   `ensureRampConnection` creates a connection with `remote_provider_name: "Carbon"`,
   then pushes the chart of accounts, the cost-center field and the project field.
   Every one of those needs `accounting:write`.
3. **Carbon codes with Carbon's identifiers.** `buildLineCodingSelections` emits
   `field_option_external_id = account.id`, and `resolveOrCreateRampSpendVendor` writes
   `external_vendor_id = supplier.id`. Both are correct only while Carbon owns the
   accounting connection. Under Rillet they are identifiers Rillet has never seen.
4. **Nothing suppresses Carbon's AP push.** `syncConfig.entities.bill.enabled` exists
   and is honoured at four layers, but has no UI and no writer; `families.ap` has a UI
   but does not gate the bill document push. Each alone is wrong — see Design
   Decisions.

There is also **no exclusivity mechanism of any kind**: the descriptor expresses no
domain or conflict, and the schema permits several active accounting integrations per
company.

## Proposed Solution

### 1. Provider roles and exclusivity

Add a typed, optional `providerRole?: "accounting" | "spend"` to `IntegrationConfig`
(`packages/ee/src/types.ts`). `category` stays a display string — it is used for badges
and, in one place, as a behavioural test that this replaces.

`providerRole` becomes the single answer to four questions currently answered five
different ways:

| Question | Today | After |
|---|---|---|
| Which integrations are accounting providers? | `Object.values(ProviderID)` (jobs), `ACCOUNTING_SYNC_INTEGRATION_IDS` (`accounting.service.ts:2938`), an inline `["xero","quickbooks","rillet"]` (`x+/accounting+/_layout.tsx:51`), `category === "Accounting"` (`integrations.$id.tsx:647`) | `providerRole === "accounting"` |
| Which are spend providers? | `.eq("id", "ramp")` (`ramp-sweep.ts:23`, `ramp-sync.ts:68`) | `providerRole === "spend"` |
| Which produce sync operations? | `isAccountingInstalled \|\| integration.id === "ramp"` (`integrations.$id.tsx:656`) | `providerRole != null` |
| Which are mutually exclusive? | nothing | same role ⇒ exclusive |

**Exactly one active integration per role per company**, enforced in the database
because there are too many write paths to guard in application code
(`upsertCompanyIntegration`, the `upsert_company_integration_patch` RPC, and each OAuth
callback, several under service-role).

### 2. Spend provider descriptor and install modes

New package area `packages/ee/src/spend/`, parallel to `packages/ee/src/accounting/`:

```ts
export type SpendSyncMode = "provider" | "push-only";

export type SpendCapabilities = {
  /** Bills reach the GL through this platform, not through Carbon. */
  ownsPayables: boolean;
  /** Carbon pushes the chart of accounts and dimension fields as coding options. */
  pushesCodingMasters: boolean;
  /** Carbon creates and owns the platform's accounting connection. */
  ownsAccountingConnection: boolean;
  inbound: Record<SpendInboundFamily, boolean>;
  outbound: Record<SpendOutboundEntity, boolean>;
};

export type SpendProviderDescriptor = {
  id: SpendProviderID;
  modes: Record<SpendSyncMode, { scopes: string[]; capabilities: SpendCapabilities }>;
};
```

Every branch in the integration reads capabilities, never a mode literal and never an
id. `convergeRamp` becomes:

```ts
if (caps.ownsAccountingConnection) await ensureRampConnection(...);
if (caps.pushesCodingMasters) { await pushChartOfAccounts(...); await pushCostCenters(...); await pushProjects(...); }
```

`isRampInboundFamilyEnabled(family, sync, caps)` gains the capability as a **hard**
gate: `caps.inbound[family] && sync[flag]`. Capability-off wins regardless of the
stored toggle — defaulting the toggles off would let a settings save silently
re-enable a pull and recreate the double-count fixed on 2026-09-10.

Required-account validation and the healthcheck derive from capabilities too:
`cardLiabilityAccountId` is required only when `caps.inbound.transactions` is true, so
a push-only install is healthy without it.

**Mode is immutable after install.** Changing it means uninstall and reinstall.
Uninstall must **revoke the grant**, not merely drop Carbon's row: Google's grant does
not shrink by requesting fewer scopes (revoke plus `prompt=consent` is the documented
path) and Slack's scopes are purely additive; whether Ramp narrows on re-authorization
is unverified. Without a revoke, a reinstall "in push-only" could still hold
`accounting:write` while the UI says otherwise. Precedent for stating the constraint
rather than offering a migration: Stripe connected-account type, Shopify's QuickBooks
Desktop sync mode, BILL's 2-way bill sync.

`rampOnUninstall` must **not** delete the accounting connection when
`caps.ownsAccountingConnection` is false — that connection belongs to the accounting
provider.

### 3. OAuth: mode chosen before consent

The authorize URL carries the scopes, so the mode must be chosen before the redirect.
Today `IntegrationCard.handleInstall` builds that URL in the browser from
`integration.oauth.scopes` and a state pre-issued by the integrations-list loader.

Replace that, for integrations declaring `modes`, with a server resource route
`GET /api/integrations/:id/connect?mode=…` that:

1. runs `requirePermissions(request, { update: "settings" })`,
2. rejects the connect when the role already has an active member (§1),
3. issues the OAuth state with `mode` in the **signed cookie payload**
   (`OAuthStatePayload` gains `mode?: string`),
4. redirects to the provider's authorize URL built server-side from that mode's scope
   set.

The callback's `consumeOAuthState` returns the stored payload so the mode can be
stamped onto metadata before `onInstall`. This removes the `integration.id === "ramp"`
special case in `IntegrationCard` and the `oauthStates` map in the integrations loader.

**Scope sets** (grounded in the per-endpoint `security` blocks of
`docs.ramp.com/openapi/developer-api.json`):

| | provider mode | push-only mode |
|---|---|---|
| `accounting:write` | ✅ | ❌ — the seat belongs to the accounting provider |
| `accounting:read` | ✅ | ✅ — enumerates the active provider's coding surface |
| `transactions:read`, `transfers:read`, `cashbacks:read`, `statements:read`, `receipts:read`, `reimbursements:read` | ✅ | ❌ |
| `bills:read` | ✅ | ✅ — bill payments and `BILL_SYNCED` |
| `bills:write`, `vendors:read`, `vendors:write`, `purchase_orders:read`, `purchase_orders:write`, `entities:read`, `business:read` | ✅ | ✅ |
| `item_receipts:write` | ✅ | ✅ (new) |

Per RFC 6749 §3.3 the authorization server may issue narrower scope than requested, so
**read the `scope` back from the token response and store it**; do not assume the
request was honoured. The Developer Console's configured list stays the superset of
both modes (Ramp's `invalid_scope` → "Requested scope not configured for app" enforces
this).

**Post-connect verification.** `GET /accounting/all-connections` needs only
`accounting:read` and returns `is_active` and `remote_provider_name` per connection.
Immediately after the callback, a push-only install confirms that another provider
holds the seat and records its name. If nobody holds it, or Carbon does, the
integration reports unhealthy with that reason rather than discovering it three bills
later.

Ramp does not *name* this role the way Brex (`ACCOUNTING` vs `ERP` field group), BILL
(AP & AR sync token) or Coupa (`third_party_partner`) do, and no surveyed product asks
for integration mode before OAuth consent at all. The setting copy says so plainly.

### 4. External identity resolution

One interface, in `packages/ee/src/accounting/core/external-identity.ts`:

```ts
export type ExternalIdentityKind = "account" | "vendor" | "costCenter" | "project";

export interface ExternalIdentityResolver {
  resolve(kind: ExternalIdentityKind, carbonId: string): Promise<string | null>;
  resolveMany(kind: ExternalIdentityKind, carbonIds: string[]): Promise<Map<string, string>>;
}
```

Two implementations, selected by **payables ownership** (§5) — never by provider id,
and never by mode directly:

- `CarbonIdentityResolver` — returns the Carbon id. Used whenever Carbon owns
  payables, i.e. today's behaviour, unchanged.
- `DelegatedIdentityResolver` — returns the accounting provider's identifier for that
  Carbon entity, read from `externalIntegrationMapping`.

The only per-provider knowledge is a declaration on the existing `ProviderCapabilities`
(`core/types.ts:90`), which already carries `transport` / `supportsWebhooks` /
`maxJournalDimensionSlots` and is the established extension point:

```ts
externalAddressing?: Partial<Record<ExternalIdentityKind, "id" | "code">>;
// rillet: { account: "code", vendor: "id" }
// xero:   { account: "code", vendor: "id" }
// qbo:    { account: "id",   vendor: "id" }
```

`"code"` reads the mapping's `metadata.externalCode`; `"id"` reads the `externalId`
column. Both already exist on every account-mapping row. This collapses the three
sibling loaders that differ only in which field they read — `loadAccountCodesById`
(Xero), `loadRilletAccountCodesById`, `loadQboAccountRefsById` — into one.
**Xero deliberately declares no `capabilities` at all**, so every read needs a
documented default (`"code"` for account, `"id"` otherwise) rather than an assumption.

**What is swapped and what is not.** Only *coding* identifiers — the GL account on each
line, and the vendor link. Carbon's own document identity stays Carbon's. This matters
concretely: Ramp's `remote_id` on a bill is documented as the id identifying the bill
on the **accounting-connection owner's** side, so in push-only mode Carbon must omit
it. That removes the current echo guard and bill-match key; replace with Ramp's own
documented bill dedupe, **vendor + `invoice_number`**, plus the Carbon-side mapping row
on the returned Ramp bill id.

**Vendors link through `accounting_vendor_remote_id`, not `external_vendor_id`.** Ramp
documents `external_vendor_id` as "independent of accounting system remote IDs" — a
caller's private handle, which is exactly what Carbon uses it for today and continues
to use it for. The field that lands a bill on the right GL vendor downstream is
`accounting_vendor_remote_id`, set via `PATCH /vendors/{id}`, pointing at the
*accounting vendor* the accounting provider created. Ramp's own guide calls confusing
Merchant / Vendor / Accounting Vendor "the most common integration error".

**Accounts resolve against the live remote surface.** `GET /accounting/fields`,
`/accounting/field-options` and `/accounting/accounts` need only `accounting:read` and
return the active provider's options with their ERP-sourced `external_id`. Read them on
**every sync run**, not only at install — mappings rot because customers keep editing
the chart of accounts, and Codat is the only unified-API vendor that names this and
says to re-validate continuously.

**Drift handling.** Re-reading first means most drift self-heals. What remains is a
genuinely deleted option: **degrade that line to uncoded and record a Warning naming
the account**, cleared automatically when the mapping resolves. Never park a bill on an
account — an uncoded bill still carries vendor, amount and invoice number, and a human
reviews the draft in Ramp regardless. The honest cost, which belongs in the Warning
copy: **coding is a creation-time affordance and cannot be fixed afterwards** —
`POST /accounting/codings` requires `accounting:write` and its `object_type` enum
contains only `TRANSACTION`, so it cannot code a bill at all. Vendors take the opposite
rule (§8): a wrong account is a bookkeeping correction, a wrong vendor is a duplicate
in the GL.

### 5. Payables ownership

```ts
type PayablesOwnership = { owner: "carbon" } | { owner: "spend"; providerId: SpendProviderID };
```

Derived from the installed spend integration: delegated when it is active and its mode
capabilities declare `ownsPayables`. The §1 exclusivity constraint is what makes this
unambiguous — two spend providers could otherwise disagree.

When delegated it forces **both**:

- `syncConfig.entities.bill.enabled = false` — stops the Bill document push
  (`reconcileDocument` returns `nothing` on `entityPushEnabled` false), and
- `postingSync.families.ap = "none"` — the AP journals (`Purchase Invoice`,
  `Debit Memo`, `Purchase Return`, and AP-side `Payment`) record `FAMILY_OFF`.

Each alone is wrong. `families.ap = "none"` alone does **not** stop the bill push —
`reconcileDocument` never reads `families`, only `entityPushEnabled`. And
`entities.bill.enabled = false` alone parks a `DOC_SYNC_DISABLED` Warning on every
posted purchase invoice forever (`posting.ts:370`).

`families.ap = "none"` also disables payment syncback, which only runs in `documents`
mode — correct, since Carbon now learns about payment from the spend platform.

**Enforcement is a required argument, not a hidden overlay.** `resolveSyncConfig` and
`resolvePostingSyncSettings` gain a required `PayablesOwnership` parameter, making every
one of their ~12 call sites a compile error until it supplies one. Same "omission is a
compile error" idiom as `POSTING_POLICY`'s exhaustive `Record<>`. An overlay buried in
one loader would be silently missed by the call sites that read `row.metadata` from a
batch query.

An explicit manual override stays available in the Posting tab for customers who handle
AP elsewhere for reasons unrelated to a spend platform; when delegation is active the
control renders locked with the reason.

### 6. GR/IR

`post-receipt` credits `accountDefault.goodsReceivedNotInvoicedAccount`;
`post-purchase-invoice` clears it. **Carbon keeps posting the purchase invoice
locally, unchanged.** That is load-bearing twice over: it clears Carbon's own GRNI, and
it is where the outbound bill coding comes from — `loadBillCostingLines` replays the
posted "Purchase Invoice" journal because `purchaseInvoiceLine.accountId` is null for
item lines, and an invoice with no posted journal already fails the push today with
`UNMAPPED_ACCOUNTS`.

GRNI then clears in **both** ledgers independently:

- **Carbon** — the ordinary way, unchanged.
- **The GL** — it receives Carbon's `Purchase Receipt` journal (credit GRNI; still
  forwarded, since `families.ap = "none"` suppresses only AP *document* types, not
  journal-represented ones) and the spend platform's bill (debit GRNI, because Carbon
  coded that bill's lines from its own posted journal, where item lines already carry
  the GR-IR account).

Nothing is double-counted and nothing dangles. The real exposure is **recoding**: the
draft is editable in Ramp, so a human can move a line off GR-IR and the GL's GRNI never
clears. Detection: read the bill back once it reaches `BILL_SYNCED`, compare its coding
to what Carbon pushed, and raise a Warning on divergence. This is the reconciliation
signal, not a posting trigger.

No vendor documents a split GR/IR — every integration studied avoids it by keeping both
legs in one ledger — so this is Carbon's own position and the spec owns it.

### 7. Item receipts

`POST /developer/v1/item-receipts` needs only `item_receipts:write` and takes
`purchase_order_id`, `item_receipt_number`, `received_at`, and
`item_receipt_line_items[].purchase_order_line_item_id`. Carbon owns receiving and the
GL does not; Ramp's three-way match is "bill, PO and item receipt reference the same
line items". Pushing PO + item receipt makes that match work against real manufacturing
receipts — a capability neither platform can produce alone, and the industry-standard
answer to the GR/IR problem (Coupa → SAP works because the receipt event reaches the
system that posts both legs). The `receipt` table already has an event trigger.

### 8. Master data: one resolution ladder, and a sweep

**The bug this fixes.** `RilletVendorSyncer.upsertRemote` has no name-matching lookup
before create — its own header says so. Its duplicate guards are the `carbon` external
reference and an idempotency key on `(companyId, "vendor", localId)`, both of which
prevent *Carbon* creating the same vendor twice and neither of which prevents Carbon
creating a vendor the provider already has. Only the *pull* path has a match ladder. So
a naive master-data sweep would mint a duplicate for every supplier a human already
created in the GL.

**Layer 1 — a shared counterpart-resolution ladder.** Hoist the ladder out of the pull
path into `resolveOrCreateRemoteCounterpart(kind, localEntity)`, run by the push path
*before* creating: mapping row → provider-side Carbon reference → unique strong key
(tax id, email) → unique exact name → create. **Ambiguity creates, never guesses** — a
duplicate is recoverable by merging, a wrong link silently posts one company's bills
against another company's vendor. `resolveOrCreateRampSpendVendor` already implements
exactly this ladder including the ambiguity rule, which is the sign it belongs in core.

Once both directions share the ladder, **ordering stops mattering**: whichever runs
first links rather than duplicates, and the import action becomes a convenience rather
than a precondition.

**Layer 2 — master data joins the outbound sweep.** `accounting-outbound-sweep`
(cron `15,45`) pages journals, purchase invoices, sales invoices, payments and charges
and no master data at all; the weekly reconciliation is posting-sync only. Master data
therefore has **no correctness guarantee** — a supplier predating the install, or whose
event was dropped, is never pushed. Add `customer` / `supplier` / `item`, driven by
**unmapped ∪ changed-since-cursor**:

- *unmapped* — `getUnsyncedEntityIds(entityType, tableName, integration, limit)` already
  exists on the mapping service; this set drains to zero and stays there;
- *changed since cursor* — the keyset cursor the document pages already use.

`reconcileMasterData`'s existing "unchanged since the last successful sync" check makes
steady state nearly free. Gated by the existing `isEntityPushEnabled`, so it is
provider-agnostic as written. Master data gets its own cadence (hourly; daily for
`item`, which can be six figures of rows where suppliers are hundreds).

**Layer 3 — one parameterized action.** `accounting-backfill` (push, wired only to a
Xero route) and `rillet-import-contacts` (pull, Rillet-only) collapse into one
`accounting-master-sync` taking `{ provider, entityTypes, direction }`, surfaced through
the `IntegrationAction` field the descriptor already supports so each provider declares
which directions it offers. QuickBooks and Xero gain the import button for free.

Per-provider declaration is only the search primitives:

```ts
findRemoteCandidates(kind, { name, taxId, email }): Promise<RemoteCandidate[]>;
supportsMasterDataImport?: AccountingEntityType[];
```

**Out of scope, noted:** deletes and archived remote records (nothing handles those
today either), and merging existing duplicates — this stops new ones, it does not clean
up what exists.

### 9. Decoupling: no cross-engine synchronous calls

The spend engine must never block on the accounting provider's HTTP round-trip: it
would inherit that provider's failure modes and rate limits and merge two retry
policies into one. The pull side already has the decoupled pattern — `dependsOnMapping`
lets a remote change declare the local mapping its processing depends on, and the sweep
silently skips it while that mapping is absent, picking it up once it appears. The
outbound path simply never got the equivalent.

**Precondition-and-defer.** The spend push checks whether the required mapping exists.
If not it enqueues the accounting-side push as an ordinary ledger operation, records a
Warning (`AWAITING_VENDOR_MAPPING`), and does not advance its own document. The two
engines communicate only through `externalIntegrationMapping` and the operation ledger —
which is how they already communicate for everything else.

**Differentiate by document.** A **purchase order** does not post to a GL, so it pushes
with the vendor link absent and is patched when the mapping appears. A **bill** waits,
because an unlinked spend vendor is precisely the duplicate-in-the-GL failure being
avoided. The common case never blocks.

**React to the mapping write.** When `externalIntegrationMapping` gains a
`(vendor, X, <accounting provider>)` row, re-reconcile the spend-pushable documents for
that entity. Turns "next sweep" into seconds.

`ensureDependencySynced` is lifted off `BaseEntitySyncer` into a free
`ensureEntitySyncedToAccounting(...)` over the public
`SyncFactory.getSyncer(...).pushToAccounting(...)` — used by the *deferred* enqueue path,
not as an inline call, and retiring the `(syncer as any).getRemoteId` cast.

### 10. Outbound moves onto the event engine

The spend integration's outbound half moves from cursor-driven paging to the shared
event pipeline (`attach_event_trigger` → `eventSystemSubscription` → `event-handler-sync`
→ `reconcile*` → operation ledger → `drainSyncOperations` → syncer). Inbound stays on
`ramp-sync` — its families key off the platform's own `SYNC_READY` status and confirm
protocol, with no Carbon row event to hang them on. That split is already the house
pattern: Xero, QuickBooks and Rillet all run events-out and `accounting-pull-sweep`
(cron `*/30`) in.

What it buys: deletes the bespoke `purchaseOrderPushUpdatedAt` /
`invoicePushUpdatedAt` keyset cursors (JSON-encoded `[updatedAt, id]` advancing only
across a contiguous successful prefix); reuses claim/retry semantics and the Sync
Activity inbox the spend integration already writes to; latency of seconds rather than
≤1h; and — the decisive part — the spend provider exposes `getSyncConfig(entity)`
derived from its mode capabilities and toggles, so push-only gating flows through the
**same `isEntityPushEnabled`** the accounting side uses. No parallel gate.

The work is widening `SyncContext.provider` off the closed `AccountingProvider` union
onto the `BaseProvider` shape (which mandates only `id`, `getSyncConfig`, `validate`,
`authenticate`), keying `SyncFactory` on a wider `SyncProviderID`, adding `itemReceipt`
to the entity union, and teaching `event-handler-sync` to resolve a sync provider rather
than specifically an accounting one. Each syncer keeps narrowing to its concrete
provider for its API client, as `this.rilletProvider` does today.

`purchaseOrder`, `purchaseInvoice` and `receipt` all already have event triggers, so
this is new subscription rows, not new triggers.

**Cost:** the outbound code is shared across modes, so this changes the shipped,
live-verified two-way integration too. PO push and draft-bill push were verified live on
2026-09-11 and are re-verified before merge.

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| One integration with modes, or two integrations | One, with install modes | A second id needs a registry row plus parameterising ~92 hard-coded `"ramp"` literals (save routing, sweep `.eq("id","ramp")`, mapping namespace, `charge.integration` default, nav gate, plan whitelist). That forks the subsystem to change a scope string. |
| Where the mode is chosen | Before consent, server-side resource route, mode in the signed OAuth state | The authorize URL carries the scopes. Requesting `accounting:write` and promising not to use it is the wrong trade when the whole point is that the customer wants another provider to own accounting. |
| Mode mutability | Immutable; uninstall (with revoke) to change | Re-authorizing with fewer scopes may union rather than narrow (Google, Slack); without a revoke the UI would lie about the granted set. Precedent: Stripe account type, Shopify QBD sync mode, BILL 2-way bill sync. |
| Which identifiers swap | Coding identifiers only (account, vendor); document identity stays Carbon's | `remote_id` belongs to the accounting-connection owner; overwriting Carbon's document identity would break the bill-payment round-trip. |
| Vendor link field | `accounting_vendor_remote_id`, not `external_vendor_id` | `external_vendor_id` is documented as independent of accounting remote ids. Carbon keeps using it as its own match key. |
| Account identifier source | Read the active provider's field options live from the spend platform each run | `accounting:read` returns ERP-sourced `external_id`s. Mappings rot as customers edit the chart of accounts. |
| Drift on a deleted option | Degrade line to uncoded + Warning; never park | Coding is creation-time only and cannot be repaired, but an uncoded bill still flows and a human reviews it. Parking holds real payables hostage to a bookkeeping edit. |
| Missing vendor mapping | Block the bill, defer, Warning; PO pushes unlinked | Unmapped is the *normal* state for pre-existing suppliers, not an edge case. A duplicate GL vendor is not recoverable without cleanup; a late bill is. |
| Payables suppression | Both `entities.bill.enabled = false` and `families.ap = "none"`, derived | Each alone is wrong (see §5). Derived cannot drift; a required resolver argument makes omission a compile error. |
| GR/IR | Keep local posting; stop forwarding AP; verify via `BILL_SYNCED` | Local posting is load-bearing for the outbound coding and clears Carbon's own GRNI. The GL's GRNI clears from the receipt journal plus the coded bill. |
| Cross-engine coupling | Precondition-and-defer via the ledger | Mirrors the shipped `dependsOnMapping` pull-side pattern; no engine inherits another provider's failure modes. |
| Exclusivity enforcement | DB trigger on `companyIntegration`, keyed on `providerRole` | Too many write paths (settings upsert, patch RPC, OAuth callbacks) to guard in app code, several under service-role. |
| **H1 Multi-tenancy** | No new tenant tables; `integration.providerRole` is registry-global, `companyIntegration` keeps its `("id","companyId")` PK | Nothing new is per-tenant. |
| **H2 Service shape** | New service functions take `client` first and return `{data, error}`; ee entitlement helpers keep their throw contract | Matches `conventions-services.md` and the existing ee split. |
| **H3 RLS** | No new tables ⇒ no new policies. `integration` is a global registry with existing policies | Verified: the change is one nullable column. |
| **H4 Permission scoping** | Connect route uses `requirePermissions(request, { update: "settings" })`, matching the existing callback | Same scope the OAuth callback already requires. |
| **H5 Form pattern** | The mode picker is a dialog that navigates to a resource route, not a `ValidatedForm` mutation; the posting/AP settings keep their existing `ValidatedForm` + zod validator | The mode is not persisted state at that point — it is a parameter of a redirect. |
| **H6 Module layout** | `packages/ee/src/spend/` mirrors `accounting/`; no ERP module gains a second service/models file | Ramp UI stays in `apps/erp/app/modules/invoicing/ui/Charge/`. |
| **H7 Backward compatibility** | `providerRole`, `externalAddressing`, `modes` and `supportsMasterDataImport` are all **optional** with documented defaults | Xero declares no `capabilities` at all; an integration with no `providerRole` is unconstrained. Existing installs read as `mode: "provider"` when unset. |

## Data Model Changes

No new tables. Two schema changes plus metadata-only additions.

```sql
-- 1. Declare the role on the registry, denormalized from the TS descriptors so a
--    trigger can read it without a join to application code.
ALTER TABLE "integration"
  ADD COLUMN IF NOT EXISTS "providerRole" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'integration_providerRole_check'
  ) THEN
    ALTER TABLE "integration"
      ADD CONSTRAINT "integration_providerRole_check"
      CHECK ("providerRole" IS NULL OR "providerRole" IN ('accounting', 'spend'));
  END IF;
END $$;

UPDATE "integration" SET "providerRole" = 'accounting'
  WHERE id IN ('xero', 'quickbooks', 'rillet') AND "providerRole" IS DISTINCT FROM 'accounting';
UPDATE "integration" SET "providerRole" = 'spend'
  WHERE id = 'ramp' AND "providerRole" IS DISTINCT FROM 'spend';

-- 2. One active integration per role per company. Fires only on INSERT and on a
--    false -> true transition, so an existing company already in violation is not
--    retroactively invalidated (it simply cannot activate a third).
CREATE OR REPLACE FUNCTION public.check_single_active_provider_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_conflict TEXT;
BEGIN
  IF NEW."active" IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."active" IS TRUE THEN
    RETURN NEW;
  END IF;

  SELECT "providerRole" INTO v_role FROM "integration" WHERE id = NEW."id";
  IF v_role IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT ci."id" INTO v_conflict
  FROM "companyIntegration" ci
  JOIN "integration" i ON i.id = ci."id"
  WHERE ci."companyId" = NEW."companyId"
    AND ci."active" IS TRUE
    AND ci."id" <> NEW."id"
    AND i."providerRole" = v_role
  LIMIT 1;

  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION
      'Only one active % integration is allowed per company; % is already active',
      v_role, v_conflict
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "companyIntegration_single_active_role" ON "companyIntegration";
CREATE TRIGGER "companyIntegration_single_active_role"
  BEFORE INSERT OR UPDATE OF "active" ON "companyIntegration"
  FOR EACH ROW EXECUTE FUNCTION public.check_single_active_provider_role();
```

Pre-existing violations are reported, not repaired:

```sql
SELECT ci."companyId", i."providerRole", array_agg(ci."id" ORDER BY ci."id")
FROM "companyIntegration" ci
JOIN "integration" i ON i.id = ci."id"
WHERE ci."active" IS TRUE AND i."providerRole" IS NOT NULL
GROUP BY 1, 2 HAVING count(*) > 1;
```

**Metadata additions** (no DDL — `companyIntegration.metadata`):

- spend integration: `syncMode` (`"provider" | "push-only"`, absent ⇒ `"provider"`),
  `grantedScopes` (string array read back from the token response),
  `accountingConnectionProvider` (the `remote_provider_name` observed post-connect),
  `cursors.billSyncStatusCheckedAt`.
- accounting integration: unchanged. Payables delegation is derived, never stored.

**Mapping rows** (`externalIntegrationMapping`, no DDL): the spend integration writes a
new `entityType: "accountingFieldOption"` scoped to its own `integration`, recording the
Carbon account/cost-center/project id against the active provider's option external id,
refreshed each run.

## API / Service Changes

**`packages/ee/src/types.ts`** — `IntegrationConfig` gains
`providerRole?: "accounting" | "spend"` and `modes?: Record<string, IntegrationInstallMode>`.

**`packages/ee/src/spend/`** (new) — `types.ts` (`SpendProviderID`, `SpendSyncMode`,
`SpendCapabilities`, `SpendProviderDescriptor`), `registry.ts`
(`SPEND_PROVIDERS`, `getInstalledSpendProvider(client, companyId)`),
`payables.ts` (`resolvePayablesOwnership`).

**`packages/ee/src/accounting/core/external-identity.ts`** (new) —
`ExternalIdentityResolver`, `CarbonIdentityResolver`, `DelegatedIdentityResolver`,
`resolveIdentityResolver(payables)`.

**`packages/ee/src/accounting/core/types.ts`** — `ProviderCapabilities` gains
`externalAddressing`; `SyncContext.provider` widens to `SyncProvider`;
`ensureDependencySynced` is extracted to a free function.

**`packages/ee/src/accounting/core/counterpart.ts`** (new) —
`resolveOrCreateRemoteCounterpart`, shared by both directions and the deferred JIT path.

**`packages/ee/src/accounting/core/service.ts`** — `resolveSyncConfig` and
`resolvePostingSyncSettings` gain a required `PayablesOwnership` argument; new
`getInstalledAccountingProvider(client, companyId)` replaces the four hard-coded id
lists.

**`packages/ee/src/ramp/`** — `scopes.ts` exports per-mode sets;
`config.tsx` declares `providerRole: "spend"` and `modes`; `hooks.server.ts` branches on
capabilities; `lib/spend.ts` gains `linkAccountingVendor`; `lib/coding.ts`
`buildLineCodingSelections` takes resolved option ids rather than pushed-id sets;
new `lib/item-receipts.ts`.

**`apps/erp/app/routes/api+/integrations.$id.connect.ts`** (new) — permission check,
exclusivity check, state issue with mode, redirect.

**`packages/auth/src/lib/oauth-state.server.ts`** — `OAuthStatePayload` gains
`mode?: string`; `consumeOAuthState` returns the stored payload alongside `{valid, cookie}`.

**`packages/jobs/.../accounting-outbound-sweep.ts`** — master-data pages.
**`packages/jobs/.../accounting-master-sync.ts`** (new) — replaces
`accounting-backfill` and `rillet-import-contacts`.
**`packages/jobs/.../events/sync.ts`** — resolves a sync provider, not only an
accounting one.

## UI Changes

- **Integrations list** — Install on a spend integration opens a mode dialog
  (two cards: "Carbon is my accounting system" / "Another system posts my ledger"),
  then navigates to the connect route. Install is disabled, with copy naming the
  incumbent, when the role already has an active member.
- **Integration details** — mode rendered read-only with an explanatory line naming the
  accounting provider observed at connect; a "Reconnect in a different mode" control
  that explains it requires uninstalling first. The Accounts group and the three
  inbound toggles are hidden in push-only mode (`visibleWhen`-style capability gating).
- **Posting tab** — the AP family select renders locked with "Payables are handled by
  <provider>" when delegated; the manual override remains for the non-delegated case.
- **Sync Activity** — new Warning reasons `AWAITING_VENDOR_MAPPING`,
  `CODING_OPTION_MISSING`, `BILL_RECODED_EXTERNALLY`, each clearing on resolution.
- **Invoicing nav** — Charges is hidden when the installed spend provider's
  capabilities declare no inbound transactions, replacing `integrations.has("ramp")`.
- **New i18n strings** run through `/translate` before merge.

## Acceptance Criteria

- [ ] With Rillet active, installing the spend integration offers a mode choice; choosing
      push-only opens an authorize URL whose `scope` omits `accounting:write` and includes
      `item_receipts:write`.
- [ ] After a push-only connect, `companyIntegration.metadata.syncMode` is `"push-only"`,
      `grantedScopes` reflects the token response, and no Ramp accounting connection was
      created (`GET /accounting/connection` still reports Rillet).
- [ ] Attempting to install QuickBooks while Rillet is active is blocked in the UI, and a
      direct `POST` that would activate it raises the trigger's exception.
- [ ] A purchase order for a supplier with no accounting-provider mapping pushes to Ramp
      **without** a vendor link, and the link is patched on the next run after the vendor
      mapping appears.
- [ ] A purchase invoice for that same supplier does **not** push until the mapping exists;
      it shows one `AWAITING_VENDOR_MAPPING` Warning, which disappears once it does.
- [ ] A pushed draft bill carries no `remote_id`, its vendor resolves through
      `accounting_vendor_remote_id`, and each line's `field_option_external_id` equals the
      Rillet-sourced option id — not the Carbon `account.id`.
- [ ] Posting that purchase invoice creates a Carbon journal as before, produces **no**
      Rillet Bill, and records the AP journal as `Excluded / FAMILY_OFF` rather than a
      `DOC_SYNC_DISABLED` Warning.
- [ ] Deleting the coded account in Rillet makes the next push emit that line uncoded with
      a `CODING_OPTION_MISSING` Warning; the bill still reaches Ramp.
- [ ] A supplier created before the integration was installed is picked up by the
      master-data sweep and linked — not duplicated — to the identically-named Rillet vendor.
- [ ] Running the import action twice produces no duplicate suppliers or customers.
- [ ] Receiving against the PO pushes an item receipt referencing the PO's line items.
- [ ] Recoding a line in Ramp away from GR-IR raises `BILL_RECODED_EXTERNALLY` after the
      bill reaches `BILL_SYNCED`.
- [ ] Paying the bill in Ramp settles the Carbon purchase invoice, matched on vendor plus
      invoice number.
- [ ] In **provider** mode every behaviour above is unchanged from today: Carbon ids are
      coded, `remote_id` is sent, all inbound families run, charges appear in the nav.
- [ ] `pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp`,
      `pnpm run lint`, `pnpm run test` all pass; `pnpm db:check:datasets` and
      `pnpm db:check:backups` pass.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Ramp silently drops an unrecognised `field_option_external_id` → uncoded bills with no error | High | Sandbox-verified before build (gate 1). If it drops silently, validate every option against the live read and refuse to send unknown ones. |
| A non-provider app cannot read `/accounting/field-options` at all | High | Sandbox-verified (gate 2). If blocked, fall back to resolving from Carbon's own accounting-provider mapping and accept the extra unverifiability. |
| Moving outbound to the event engine regresses the shipped two-way integration | High | Re-run the 2026-09-11 live verification for PO push and draft-bill push before merge; capability-gated so provider mode's behaviour is unchanged by construction. |
| Widening `SyncContext.provider` touches a load-bearing type across three providers | Medium | Widen to the existing `BaseProvider` shape rather than inventing one; each syncer keeps narrowing to its concrete provider, as today. |
| Master-data sweep pushes duplicates | Medium | The shared ladder (§8 layer 1) lands **before** the sweep (§8 layer 2); enforced by task ordering in the plan. |
| `accounting_vendor_remote_id` uniqueness collides with a link the provider already made | Medium | Sandbox-verified (gate 4). Treat a collision as "already linked" and adopt it rather than failing. |
| Item-master sweep is expensive at six-figure row counts | Low | Unmapped set drains to zero; changed-set rides a cursor; `item` runs daily, not on the 30-minute beat. |
| A company already has two active accounting integrations | Low | The trigger only guards new activations; a report query identifies existing violations for manual cleanup. |

## Open Questions

> Resolved with the user before this spec was written. Recorded as the audit trail.

- [x] Should push-only bills be uncoded, or coded with the accounting provider's ids? —
      **Answer:** coded with the accounting provider's ids, resolved through
      `externalIntegrationMapping`, with a generalized abstraction and no per-provider
      branching.
- [x] How does Carbon learn a bill was paid? — **Answer:** pull bill payments from the
      spend platform, not from the accounting provider.
- [x] Is the mode switchable after install? — **Answer:** no; uninstall and reinstall.
- [x] Are purchase orders still pushed in push-only mode? — **Answer:** yes.
- [x] Does Carbon still receive reimbursements? — **Answer:** no; they go spend → GL
      directly and Carbon never sees them.
- [x] Is the AP-off setting Rillet-specific or general? — **Answer:** general across all
      accounting providers, and automatically applied when any spend integration is in
      push-only mode.
- [x] Should the spend and accounting settings be coupled? — **Answer:** yes, through the
      abstraction — derived, never hard-coded per provider pair.
- [x] What happens when a mapping is missing? — **Answer:** vendor blocks and defers;
      account degrades to uncoded.
- [x] Derived or stored payables delegation? — **Answer:** derived, with a required
      resolver argument so no call site can miss it.
- [x] GR/IR treatment? — **Answer:** keep the accrual and verify against `BILL_SYNCED`;
      refined during design to keep Carbon's local AP posting, which is load-bearing for
      the outbound coding.
- [x] Drift when the chart of accounts changes? — **Answer:** re-read before every push;
      degrade to uncoded with a Warning; never park a bill on an account.
- [x] Master-data catch-up? — **Answer:** in scope, plus generalizing the existing
      Rillet-only import action to every accounting provider.
- [x] Should outbound move to the event engine? — **Answer:** yes, for all modes;
      inbound stays on the sweep.
- [x] Cross-engine coupling? — **Answer:** precondition-and-defer, POs push unlinked,
      re-reconcile on mapping write. No synchronous calls.
- [x] Exclusivity? — **Answer:** exactly one active accounting integration and one active
      spend integration per company.

### Verification gates — sandbox before build

Two unknowns gate the coding half and are sequenced first in the plan. Neither gates the
vendor half or the payables-suppression half, which can proceed regardless.

1. Does Ramp **validate** `field_external_id` / `field_option_external_id` against the
   active connection's options, and what happens on a miss — reject, silent drop, or
   accept?
2. Can an app that does **not** own the accounting connection read
   `GET /accounting/fields`, `/accounting/field-options` and `/accounting/accounts`?
3. Is `sync_status` / `BILL_SYNCED` readable with `bills:read` by a non-provider app?
4. Can a caller with only `vendors:write` set `accounting_vendor_remote_id` pointing at
   an accounting vendor another app created, and what happens when it is already linked?
5. Does omitting `remote_id` on a draft bill change anything in Ramp's export downstream?

## Changelog

- 2026-09-23: Created. Research in `.ai/research/spend-management-one-way-push.md`;
  all open questions resolved with the user before writing.
