# Ramp Card-Transaction Merchant Modeling

> Status: draft
> Author: Brad Barbin (with Claude)
> Date: 2026-09-17

## TLDR

Carbon currently auto-creates **one AP `supplier` per distinct Ramp card merchant**
(`resolveMerchantSupplier`), tagged with a `"Card Merchant"` `supplierType`. A company
with an active card program accumulates **hundreds of one-off merchant suppliers** that
pollute the vendor master. Competitor research
([`.ai/research/card-transaction-merchant-modeling.md`](../research/card-transaction-merchant-modeling.md))
shows this is the minority behavior: SAP, NetSuite, Intacct, and QBO all treat the card
merchant as *transaction metadata* and post to a card GL account; the merchant becomes a
real vendor only when it's a genuine AP counterparty. Spend platforms (Airbase, Ramp's own
default-vendor pattern) collapse the one-off tail to a **single catch-all vendor**. This
spec changes `resolveMerchantSupplier` to: **mapping-first → match an existing real supplier
by exact name → fall back to ONE auto-created "Card Merchant" house supplier per company** —
never a new supplier per merchant. Because the merchant identity currently rides on the
provider charge object **only** through `vendor_id`, the change also pushes `merchantName`
onto the charge line description so identity survives the collapse. Shipped shared-only (no
toggle); a per-merchant "Merchant" GL dimension is a deferred follow-up.

## Problem Statement

`resolveMerchantSupplier` in `packages/ee/src/ramp/lib/suppliers.ts` resolves the merchant of
every Ramp card transaction to a Carbon `supplier`:

1. mapping-first (`externalIntegrationMapping`, entityType `"merchant"`, keyed by Ramp
   `merchant_id`),
2. case-insensitive exact `supplier.name` match,
3. **auto-create** a new supplier tagged `"Card Merchant"`.

Step 3 mints a brand-new AP supplier for **every distinct merchant** a card is ever used at.
The `ramp-sync-card.ts` family calls this before posting, setting `cardTransaction.supplierId`.
Concrete consequences:

- **Vendor-master pollution.** `getSuppliers` (`purchasing.service.ts:901`) can filter by
  `supplierTypeId` but does **not** exclude `"Card Merchant"` by default, so the vendors list,
  pickers, and reports show hundreds of gas stations, restaurants, and SaaS trials alongside
  real trade vendors.
- **It's the wrong default.** No surveyed ERP creates a vendor per card merchant. The one
  system that *forces* merchant→contact (Xero's mandatory Contact on a SPEND) is its
  most-complained-about card behavior — Carbon has independently reproduced it.
- **No benefit to the posting.** A card charge needs a card **GL account** and a coded
  expense line (both already present on `cardTransactionLine`); the per-merchant supplier row
  adds nothing to the journal.

The one place a vendor is genuinely required is the **provider charge object** the accounting
sync pushes (Rillet `charge`, QBO `Purchase`, Xero SPEND) — `isChargeBackedCardTransaction`
gates on `hasSupplier`, so a charge with no supplier falls back to a plain journal entry.

## Proposed Solution

Replace the per-merchant create with a **match-or-default** resolution that reuses an existing
real supplier when one matches and otherwise attributes card spend to a **single house
"Card Merchant" supplier per company** (the Airbase / Ramp default-vendor pattern). The
merchant name stays first-class on `cardTransaction.merchantName` and is additionally carried
on the provider charge object's line description so collapsing the vendor never loses merchant
identity.

New `resolveMerchantSupplier` behavior (shared-only):

1. **Mapping-first** — `externalIntegrationMapping`, entityType `"merchant"`, keyed by Ramp
   `merchant_id`. If mapped, reuse (idempotent, unchanged).
2. **Exact-name match to an existing supplier** — the current escaped-`ilike` match. If a
   supplier already exists with that name (i.e. the merchant is a real vendor you already
   trade with), use it **and** write the `"merchant"` mapping so it's stable. This links card
   spend to your real vendor.
3. **Catch-all house supplier** — otherwise resolve the company's single auto-created
   `"Card Merchant"` supplier (find-or-create, one per company, tagged the `"Card Merchant"`
   `supplierType`, modeled on the existing `resolveEmployeeSupplier` "Employee" pattern).
   **Do NOT write a per-merchant mapping for this fallback** — the catch-all is resolved by
   its stable identity every time, so the mapping table doesn't re-accumulate one row per
   merchant.

The per-merchant auto-create path is **removed entirely** — there are no existing installs to
preserve, so no toggle, migration, or compatibility path is needed.

Because merchant identity currently rides on the charge object **only** through `vendor_id`
(the Rillet charge line description uses `charge.memo`, not the merchant — verified in
`providers/rillet/entities/charge.ts:162`), the charge adapters must push `merchantName` onto
the charge line/description (falling back to `memo` when merchant is null) so the collapsed
catch-all vendor doesn't erase which merchant the spend was at.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Resolution strategy | mapping-first → match existing real supplier → single catch-all house supplier | Industry consensus (SAP/NetSuite/Intacct/QBO + Airbase default-vendor); reuses real vendors, bounds the tail to one row. Research §Recommended #1–2. |
| Catch-all identity | Auto find-or-create ONE `"Card Merchant"` supplier per company (Q1) | Zero-config, works on install; mirrors `resolveEmployeeSupplier`'s "Employee" pattern. No settings surface, no unset-config failure mode. |
| Ship a mode toggle? | No — shared-only, drop the per-merchant path (Q5) | No existing installs to preserve; less code + test surface; matches consensus. A toggle can be added later if a customer genuinely wants per-merchant. |
| Default / migration | Shared for all; no migration (Q2 — no existing installs) | Nothing in production to re-point or clean up. |
| Merchant as GL dimension | Deferred to a follow-up spec (Q3) | A real "Merchant" dimension (dimension entity + `journalLineDimension` + provider dimension mapping across 3 adapters) is its own sub-feature; v1 preserves identity via charge memo/description + `merchantName`. |
| Merchant on charge object | Push `merchantName` onto the charge line description (fallback `memo`) | Merchant identity currently rides only via `vendor_id`; collapsing the vendor would lose it otherwise. Required for the catch-all to be safe. |
| Merchant-less charge | Unchanged — `supplierId` null → posts as journal entry | A charge with no merchant name has no identity to represent; keep today's fallback (`isChargeBackedCardTransaction` needs `hasSupplier`). |
| Heuristic 1 (multi-tenancy) | No new table; `supplier`/`supplierType` already `companyId` + composite PK | Reuses existing masters; catch-all is a normal company-scoped `supplier` row. |
| Heuristic 2 (service shape) | `resolveMerchantSupplier` stays a service-role helper taking client + companyId; pure where possible | Matches `packages/ee/src/ramp/lib/suppliers.ts` conventions (no `{data,error}` wrapper — it's an internal resolver that throws on failure, like today). |
| Heuristic 3/4 (RLS/permissions) | Unchanged | No new table/route; writes stay under the Ramp sync's service-role path + existing `invoicing` RLS on `cardTransaction`. |
| Heuristic 5 (forms) | N/A | No new form (no toggle). |
| Heuristic 6 (module layout) | Change stays in `packages/ee/src/ramp/lib/suppliers.ts` + the 3 charge adapters + `card-charge-source.ts` | No new module/file scatter. |
| Heuristic 7 (back-compat) | No FROZEN/STABLE surface broken; `resolveMerchantSupplier`'s signature is internal to `@carbon/ee` | The `entityType: "merchant"` mapping convention is preserved. |

## Data Model Changes

**None.** No new tables or columns.

- The catch-all is an ordinary `supplier` row (composite PK `("id","companyId")`,
  `id('...')` default) created on demand, tagged with the existing `"Card Merchant"`
  `supplierType` (also found-or-created per company, as `resolveMerchantSupplier` already does
  via `ensureSupplierTypeId`).
- `cardTransaction.supplierId` / `cardTransaction.merchantName` already exist
  (migration `20260911150050_reconcile-ramp-card-transactions-forward.sql`).
- `externalIntegrationMapping` entityType `"merchant"` is unchanged; the catch-all fallback
  simply does not write one.

## API / Service Changes

**`packages/ee/src/ramp/lib/suppliers.ts`**

- `resolveMerchantSupplier(serviceRole, kyselyDb, companyId, merchant)` — rewrite the body:
  - Keep the `ensureSupplierTypeId(..., "Card Merchant")` call.
  - **New `resolveCardMerchantCatchAllSupplier(serviceRole, companyId, supplierTypeId)`** —
    find-or-create the single house supplier named `"Card Merchant"` (exact name +
    `supplierTypeId`) for the company, returning its id. Idempotent; concurrency-safe via the
    same find-then-insert pattern `ensureSupplierTypeId` uses (tolerate a unique-violation
    race by re-selecting).
  - Resolution order: mapping-first (unchanged) → exact-name match to an existing supplier
    (unchanged escaped-`ilike`; on hit, `mapping.link("merchant", supplierId, RAMP,
    merchant.id)`) → **catch-all** (no mapping write).
- **Remove** the per-merchant auto-create branch from the merchant path. `resolveRampSupplier`
  itself (used by bills/POs under entityType `"vendor"`) **keeps** its auto-create — only the
  merchant path changes. (Confirm `resolveMerchantSupplier` no longer routes through
  `resolveRampSupplier`'s create step; it calls the catch-all resolver instead.)
- A merchant with no `name` → caller still passes `supplierId: null` (unchanged in
  `ramp-sync-card.ts`).

**`packages/ee/src/accounting/core/card-charge-source.ts`**

- Already selects `cardTransaction.merchantName` + `memo`. Ensure the `CardChargeSource`
  exposes `merchantName` to the adapters (it does — line 13).

**Charge adapters** (`providers/{rillet,quickbooks-online,xero}/entities/charge.ts`)

- Set the charge line description to `merchantName ?? line.description ?? memo` (today Rillet
  uses `line.description ?? charge.memo`). This is the one behavioral requirement that makes
  the catch-all vendor safe — merchant identity must appear on the pushed charge.
- `vendor_id` continues to come from the (now usually catch-all) supplier's synced provider
  vendor via `ensureDependencySynced("vendor")` — unchanged mechanism, different supplier.

**No change** to `post-card-transaction`, the journal builder, cost-center/project dimensions,
confirm/idempotency, or the sync coordinator.

## UI Changes

**None required for v1.** No settings toggle (shared-only).

Optional (recommend as a tiny follow-up, not a blocker): default-exclude the
`"Card Merchant"` `supplierType` from the suppliers list's default view, or surface it as a
one-click filter. Not in this spec's scope — with the catch-all there is now at most **one**
such supplier per company, so the pollution the filter addressed is already gone.

## Acceptance Criteria

- [ ] Syncing 50 card transactions across 40 distinct merchants (none matching an existing
      supplier) creates **exactly one** new supplier — the `"Card Merchant"` house supplier —
      and all 50 `cardTransaction.supplierId` values point at it.
- [ ] A card transaction whose `merchant_name` **exactly matches** an existing real supplier
      (e.g. "McMaster-Carr") resolves to that existing supplier, not the catch-all, and writes
      a `"merchant"` mapping for the Ramp `merchant_id`.
- [ ] Re-running the sync (idempotent replay) creates **no** additional suppliers and **no**
      additional `externalIntegrationMapping` rows for catch-all-resolved merchants.
- [ ] A card transaction with **no** `merchant_name` posts with `supplierId` null and syncs as
      a journal entry (unchanged).
- [ ] A Posted `Charge` with the catch-all supplier pushes to the provider as a **charge
      object** whose line description contains the **merchant name** (verified on the Rillet
      sandbox: the charge shows the merchant, not a blank/"memo-only" description), with
      `vendor_id` = the catch-all vendor.
- [ ] The per-merchant auto-create code path no longer exists in `resolveMerchantSupplier`
      (grep: no `insert` into `supplier` on the merchant path except via the catch-all
      resolver).
- [ ] `pnpm --filter @carbon/ee test` and `pnpm --filter @carbon/ee typecheck` pass; unit
      tests pin the new resolution order (mapping → name-match → catch-all) and the
      "no mapping written on catch-all" rule.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Merchant identity lost on the provider charge when all charges share the catch-all vendor | Med | Push `merchantName` onto the charge line description (design requirement + acceptance test on Rillet sandbox). |
| Exact-name match links a card charge to the *wrong* real supplier (name collision) | Low | Match is exact (case-insensitive) with `%`/`_` escaped — same guard as today; no fuzzy matching introduced. Collisions are rare and no worse than today's step 2. |
| Concurrent syncs race to create the single catch-all supplier | Low | Find-then-insert with unique-violation re-select (same pattern as `ensureSupplierTypeId`); the card family already serializes per company (`concurrency key companyId, limit 1`). |
| Losing per-merchant spend analytics some customer wanted | Low | Merchant stays on `cardTransaction.merchantName` and the charge description; a "Merchant" GL dimension is a scoped follow-up if demand appears. |
| Downstream code assuming one-supplier-per-merchant | Low | Grep shows the only consumers are the card sync (sets `supplierId`) and the charge syncers (carry it as `vendor_id`); both work with a shared supplier. |

## Open Questions

> All resolved with the user before this spec was written (2026-09-17).

- [x] **Catch-all supplier identity** — **Answer:** Auto find-or-create ONE `"Card Merchant"`
      house supplier per company (like `resolveEmployeeSupplier`). Zero-config; no settings
      picker in v1.
- [x] **Default behavior + existing installs** — **Answer:** There are **no existing installs**
      (unshipped branch), so default shared for everyone with **no** migration or cleanup path.
- [x] **Merchant as a GL dimension (per-merchant rollups)** — **Answer:** Deferred to a
      follow-up spec. v1 preserves merchant identity via `cardTransaction.merchantName` + the
      charge line description only.
- [x] **Match an existing real supplier before the catch-all?** — **Answer:** Yes —
      mapping-first → exact-name match to an existing supplier → catch-all. Reusing a real
      vendor is non-polluting; only the create-new-per-merchant step is replaced.
- [x] **Ship the per-merchant mode as an opt-in toggle, or shared-only?** — **Answer:**
      Shared-only, **no toggle**. Drop the per-merchant code path entirely (no installs to
      preserve; least code/test surface). A toggle can be added later if a customer wants it.

## Changelog

- 2026-09-17: Created. All open questions resolved with the user before writing. Grounded in
  `.ai/research/card-transaction-merchant-modeling.md`.
