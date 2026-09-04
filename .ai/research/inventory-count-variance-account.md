# Inventory Count Adjustment GL Posting Research: Best Practices Survey

## Summary

Question: when posting the accounting journal for a physical/cycle inventory
count adjustment, should the offsetting entry go to a **dedicated inventory
variance / adjustment / shrinkage account**, or straight against the raw
material / finished goods (inventory asset) account?

Across every ERP surveyed — SAP S/4HANA, NetSuite, Dynamics 365 Business
Central, QuickBooks Online, and Fishbowl — the common pattern is the same: the
inventory asset account is **one** leg of the journal, and the recommended
**offset is a dedicated P&L (COGS-type) variance/adjustment account**, not a
second inventory-asset line. This is each product's default or recommended
configuration, not a hard-coded universal rule — the offset is typically a
configurable account (NetSuite exposes a transaction-level Adjustment Account;
Business Central resolves an Inventory Adjmt. Account through configurable
posting setups), and specific defaults/capabilities vary by product and version.
Routing the offset back into the inventory account would net the journal to zero
and destroy the ability to analyse shrinkage. **Carbon's own policy already
follows this pattern** — it posts DR/CR against the inventory asset
(`rawMaterialsAccount`/`finishedGoodsAccount`) and a dedicated
`inventoryAdjustmentVarianceAccount`. No change is required; this note documents
that Carbon's behaviour matches the common industry pattern and captures the one
genuine design choice (whether to split gains vs. losses).

## Competitors Surveyed

- **SAP S/4HANA (MM Inventory Management)** — reference enterprise pattern for
  automatic account determination.
- **NetSuite** — mid-market cloud ERP; closest analogue to Carbon's model.
- **Dynamics 365 Business Central** — posting-group-matrix account determination.
- **QuickBooks Online** — SMB baseline; adjustment posts to a selected
  (auto-created "Inventory Shrinkage") account. Desktop is not covered by the
  cited source.
- **Fishbowl Inventory** — inventory sub-ledger that syncs journals to QB/Xero;
  part-type + per-part account mapping, plus a distinct Scrap account.

## Key Consensus Patterns

### 1. Offset is a dedicated P&L variance account, NOT the inventory asset

Every system posts a **two-line balanced journal**: inventory asset on one side,
a dedicated variance/adjustment/shrinkage account (P&L, COGS-type) on the other.

- **SAP**: stock account (event key **BSX**, the raw-material / finished-goods
  GL account) vs. offset **GBB + general modification INV** —
  "expenditure/income from inventory differences," an explicit P&L account. Not
  PRD (price differences), not AUM (stock transfer).
- **NetSuite**: item's **Inventory Asset** account vs. a transaction-selected
  **Adjustment Account** — guidance says a dedicated expense account (Inventory
  Adjustment Expense / Shrinkage / Scrap), explicitly *not* the asset account.
- **Business Central**: **Inventory Account** (Inventory Posting Setup) vs.
  **Inventory Adjmt. Account** (General Posting Setup), set up as a COGS-type
  account.
- **QuickBooks**: **Inventory Asset** vs. **Inventory Shrinkage** (auto-created,
  COGS-adjacent).
- **Fishbowl**: **Inventory (asset)** vs. a mapped **Inventory Adjustment**
  account (and a separate **Scrap** account for scrapped goods).
- **Rationale**: the whole point of a count adjustment is to recognise a **loss
  or gain in the P&L**. If the offset were the inventory asset, the journal would
  self-cancel and no expense/income would ever be recognised. A dedicated account
  also makes shrinkage a first-class, analysable line — reportable, dimensioned,
  and separable by reason.

### 2. Gains vs. losses use ONE account by default; direction is the debit/credit sign

Every system uses a **single** variance account for both directions out of the
box and flips the debit/credit side based on the sign of the quantity delta.

- Gain / found stock (positive): **DR Inventory asset, CR Variance** (income/contra).
- Loss / short (negative): **CR Inventory asset, DR Variance** (expense).

Splitting gains and losses into separate GL accounts is available but opt-in:

- **SAP**: GBB/INV has separate Debit and Credit account slots in OBYC — same
  account by default, separable by configuration.
- **NetSuite**: commonly routed via reason codes to a "Gain / Other Income"
  account vs. an "Expense / Shrinkage" account, but not by default.
- **BC / QuickBooks / Fishbowl**: single account, direction by sign; no default
  gain/loss split.

### 3. Account determination is data-driven, keyed on the item — not hardcoded

None hardcode the accounts; each resolves them from configuration keyed (at
least partly) on the item.

- **SAP**: material's **valuation class** → OBYC → GBB/INV → GL account, scoped by
  valuation grouping code (plant/company).
- **NetSuite**: per-transaction Adjustment Account, optionally defaulted by
  **location** or a **reason code → account** map. Inventory asset comes from the
  item master.
- **Business Central**: **General Posting Setup** keyed on
  **Gen. Bus. Posting Group × Gen. Prod. Posting Group** (item carries the prod.
  group).
- **QuickBooks**: single per-transaction account with a default (auto-created
  Inventory Shrinkage).
- **Fishbowl**: **part-type default mapping** + optional **per-part overrides**,
  plus a distinct Scrap account.

## Answers to Research Questions

1. **Offset = dedicated variance account or the inventory asset?** — Dedicated
   variance/adjustment (P&L, COGS-type) account. Unanimous across SAP, NetSuite,
   BC, QuickBooks, Fishbowl. Never a second inventory-asset line.

2. **Is the offset ever the inventory asset itself?** — No. That would net to
   zero and recognise no gain/loss. Explicitly warned against in NetSuite guidance.

3. **How is the variance account configured?** — Data-driven, keyed on the item
   (valuation class / posting group / part type) and/or per-transaction
   selection, sometimes with reason-code or location defaults. Never hardcoded.

4. **Gains vs. losses — separate accounts?** — One account by default, direction
   by debit/credit sign. Separate gain/loss accounts are an opt-in configuration
   in every system (SAP's dual OBYC slots; NetSuite reason codes).

5. **Standard terminology?** — SAP: "inventory differences,"
   "expenditure/income from inventory differences." NetSuite: "Adjustment
   Account," "variance," "shrinkage." BC: "Inventory Adjmt. Account." QuickBooks:
   "Inventory Shrinkage." Common thread: **variance / adjustment / shrinkage**.

## Carbon — Current State (grounded in code)

**Carbon already implements the industry-standard model.** The shared write path
`shared/post-adjustment.ts` → `bookAdjustment()` posts a balanced two-line
journal for every valued count/adjustment movement (when `accountingEnabled` and
the movement has non-zero value):

- **Inventory asset leg**: `resolveInventoryAccount()`
  (`shared/get-posting-group.ts`) picks by the item's `replenishmentSystem` —
  `Make` / `Buy and Make` → `finishedGoodsAccount` (1220), else
  `rawMaterialsAccount` (1210).
- **Offset leg**: `inventoryAdjustmentVarianceAccount` (a dedicated variance
  expense account). Scrap/NCR/inspection write-offs override the offset to
  `scrapAccount` (falling back to the variance account).
- **Direction** (`isGain = quantity > 0`): positive → DR asset / CR variance;
  negative → CR asset / DR variance. Amount = carrying/COGS value of the delta.
- **Account source**: flat per-company `accountDefault` row (posting-group
  matrix was deliberately dropped in `20260229000000_drop-posting-groups.sql`,
  consistent with Carbon's "no matrix config" principle).
- Both `post-inventory-count` (one shared journal per count, snapshot-delta) and
  `post-inventory-adjustment` route through the same core, and each line is
  tagged with Item / ItemPostingGroup / Location dimensions.

Relevant files:
- `packages/database/supabase/functions/shared/post-adjustment.ts:348-388`
- `packages/database/supabase/functions/shared/get-posting-group.ts:18-34`
- `packages/database/supabase/functions/post-inventory-count/index.ts`
- `packages/database/supabase/functions/post-inventory-adjustment/index.ts:345-360`
- Schema: `20260713190909_raw-materials-finished-goods-accounts.sql`,
  `20260726012013_add_scrap_account.sql`

## Recommended Approach for Carbon

1. **Keep the current model — it is correct.** The offset already goes to a
   dedicated `inventoryAdjustmentVarianceAccount`, matching SAP's GBB/INV,
   NetSuite's Adjustment Account, BC's Inventory Adjmt. Account, and QuickBooks'
   Inventory Shrinkage. Do **not** change it to post the offset against
   raw material / finished goods — that would net to zero and recognise no
   gain/loss, and no surveyed ERP does that.

2. **The one genuine design choice: gain vs. loss split.** Carbon uses a single
   variance account for both directions, which is the default everywhere. If
   accountants ask to see inventory *gains* separately from *losses/shrinkage*,
   the standard move is an optional second account (e.g. keep
   `inventoryAdjustmentVarianceAccount` for losses, add an
   `inventoryAdjustmentGainAccount` selected when `isGain`). This is opt-in in
   every ERP — only add it if a customer requests it; the current single-account
   behaviour is fully standard-conformant. Follows SAP's dual-slot GBB/INV and
   NetSuite's gain/loss reason-code pattern.

3. **Scrap already has its own account** (`scrapAccount`), mirroring Fishbowl's
   distinct Scrap vs. Adjustment split and NetSuite's Scrap Inventory account —
   good, keep it.

4. **No posting-group matrix.** Carbon's flat `accountDefault` (item drives the
   asset-account split via `replenishmentSystem`) is the deliberate design and
   aligns with the project's "no matrix config" principle; BC's posting-group
   matrix is the more complex alternative and is not recommended here.

## Sources

- SAP — Accounting entries for movement types 701 & 702: https://community.sap.com/t5/enterprise-resource-planning-q-a/accounting-entries-for-movement-types-701-702/qaq-p/3408376
- SAP — Accounting entries during physical inventory count: https://community.sap.com/t5/enterprise-resource-planning-q-a/accounting-entries-during-physical-inventory-count/qaq-p/8204057
- SAP — Account determination (GBB/INV) in S/4HANA MM: https://blog.sap-press.com/cross-functional-customizing-in-sap-s4hana-mm-account-determination-configuration
- SAP — OBYC GBB general modification: https://community.sap.com/t5/enterprise-resource-planning-q-a/obyc-transaction-gbb-general-modification-how-to-create/qaq-p/3125701
- NetSuite — Inventory Adjustment: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_0817101055.html
- NetSuite — Inventory Count: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2296970.html
- NetSuite — Adjustment reason codes (RSM): https://technologyblog.rsmus.com/technologies/netsuite/how-to-set-up-inventory-adjustment-reason-codes-in-netsuite/
- NetSuite — Shrinkage: https://www.netsuite.com/portal/resource/articles/inventory-management/shrinkage.shtml
- Business Central — General Posting Setup inventory fields: https://usedynamics.com/business-central/finance/fields-for-inventory-in-the-general-posting-setup/
- Business Central — Count, adjust, reclassify inventory: https://learn.microsoft.com/en-us/dynamics365/business-central/inventory-how-count-adjust-reclassify
- QuickBooks — Adjust inventory quantity on hand: https://quickbooks.intuit.com/learn-support/en-us/help-article/inventory-quantity/adjust-inventory-quantity-hand-quickbooks-online/L6O3QhOEZ_US_en_US
- Fishbowl — inventory adjustments guide (TaraByte): https://blog.tarabyte.com/blog/oops-vs-ugh-a-guide-to-inventory-adjustments-for-fishbowl-inventory
- Fishbowl & QuickBooks Online integration: https://www.fishbowlinventory.com/integrations/quickbooks-online
