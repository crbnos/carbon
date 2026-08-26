# Intercompany Eliminations Research: Best Practices Survey

## Summary

Surveyed how best-in-class ERPs and the governing accounting standards handle
**intercompany elimination for group consolidation**, to feed a holistic design
for Carbon. Researched SAP S/4HANA Group Reporting, NetSuite OneWorld, Oracle
FCCS/EPM, Microsoft Dynamics 365 Finance, Sage Intacct, the QuickBooks/Xero SMB
tier (+ consolidation add-ons), and the canonical US GAAP (ASC 810) / IFRS 10
mechanics with textbook journal entries.

**The dominant finding is a universal *automatic-vs-manual gradient* that every
platform shares**, and it maps almost exactly onto complexity of realization:

| Elimination type | Auto in enterprise ERPs? | Carbon today |
|---|---|---|
| IC receivables/payables (due-to/due-from, loans, notes) | **Always automatic** | ✅ Done (`generateEliminationEntries`) |
| IC revenue ↔ COGS/expense (intragroup sales gross-up) | Auto-capable, **opt-in config** | ❌ Not eliminated |
| Unrealized profit in **inventory** | **Manual top-side everywhere** (SAP's IPI is the lone rule-based exception) | ❌ Not eliminated |
| Unrealized profit in **transferred fixed assets** (+ depreciation catch-up) | **Manual top-side everywhere** | ❌ Not eliminated |
| Investment-in-subsidiary / equity + **NCI** | Separate rules layer, ownership-% driven | ❌ Not modeled |

Carbon has already built the hard *infrastructure* (transaction-time IC partner
tagging, matched `intercompanyTransaction` pairs, a synthetic per-parent
elimination entity routed by lowest-common-parent) — the same primitives the
enterprise systems use and that QuickBooks/Xero conspicuously lack. What's
missing is the **elimination scope beyond the AR/AP control wash**. The
recommendation is a phased engine: complete the P&L (revenue↔COGS) elimination
now, add guided unrealized-profit-in-inventory next, and defer fixed-asset-gain
and investment/NCI to later phases (they are manual even in NetSuite/D365).

The single most important architectural idea to adopt from SAP: eliminations are
their own **classified ledger layer keyed by (unit, partner)**, never a mutation
of source documents — which Carbon already does. The second: **don't assume both
legs are trading-partner-tagged** (the buyer's COGS usually isn't), so support
**one-sided** elimination.

---

## Competitors Surveyed

- **SAP S/4HANA Group Reporting** (+ legacy EC-CS / SEM-BCS) — the enterprise
  reference; established the trading-partner + posting-level data model and the
  only mainstream *rule-based* unrealized-inventory-profit (IPI) automation.
- **NetSuite OneWorld** — closest architectural analog to Carbon: a flagged
  **elimination subsidiary** at the lowest common parent, account-level
  "Eliminate Intercompany Transactions" flag, period-close auto-elimination that
  reverses next period. Explicitly leaves unrealized inventory/FA profit manual.
- **Oracle FCCS / EPM** — the "consolidation-dimension overlay" camp (elimination
  is a cube member, not a journal); strong ownership-%/NCI rules model.
- **Microsoft Dynamics 365 Finance** — elimination *legal entity* + rule-based
  elimination journals (Source/Destination/Consolidated LE roles); due-to/due-from.
- **Sage Intacct** — cleanest SMB auto/manual line: auto-eliminates inter-entity
  AR/AP (IER/IEP mapping); everything else is opt-in account config.
- **QuickBooks / Xero + add-ons (Joiin, LiveFlow, Fathom)** — the SMB reality:
  no native elimination; report-layer overlays; account-name matching (no partner
  tag). Defines the *floor* Carbon should beat.
- **US GAAP ASC 810-10-45-1 / IFRS 10 B86** — eliminate intragroup items **in
  full (100%)** regardless of ownership; ownership % only splits *unrealized
  profit* between controlling interest and NCI (upstream vs downstream).

---

## Key Consensus Patterns

### 1. Eliminations are a separate, classified ledger layer — never posted to operating books

- **SAP**: consolidation journal entries in a totals table, stamped with two
  orthogonal classifiers — **posting level** (which consolidation step produced
  it: `00` loaded · `10` manual group · `20` two-sided unit-pair elimination ·
  `30` group-dependent C/I & NCI) and **document type** (method + number range,
  e.g. `2G`). Never touches the subsidiary FI ledger.
- **NetSuite**: elimination journals post **only** to the elimination subsidiary;
  operating subsidiaries' GLs are untouched.
- **D365 / Intacct**: post to a dedicated elimination legal entity / elimination
  account that only exists in the consolidated view.
- **Oracle FCCS**: not "posted" at all — written to a reserved `Elimination`
  Consolidation-dimension member computed on the fly.
- **GAAP/IFRS theory**: these are *worksheet entries*, re-derived every period
  from trial balances; they never persist in any legal entity's books.
- **Rationale**: audit trail + the single-economic-entity assumption. The group
  can't sell to / lend to / profit from itself, but the individual entities'
  standalone books must stay pristine for statutory/tax reporting.
- **Carbon already does this** — the synthetic `isEliminationEntity` company holds
  the elimination journal; operating companies are untouched.

### 2. Elimination entity sits at the lowest common parent of the transacting pair

- **NetSuite**: elimination subsidiary must be a direct child of the parent that
  has children; NetSuite walks up from both transacting subs to their nearest
  shared ancestor and uses that ancestor's elimination child. Multi-tier
  structures need one elimination sub per consolidation level. Locked to the
  parent's base currency; consolidated rate of 1 to its parent.
- **SAP**: posting level 20 (unit-pair) entries land on a "consolidation unit for
  elimination"; level 30 entries are specific to a group-hierarchy node.
- **Carbon already does this** — `findLowestCommonParent(a, b)` + the per-parent
  elimination entity (matches the project's `elimination_entity_lca` note).

### 3. Intercompany transactions are identified at transaction time by a partner tag — not reconstructed at close

- **SAP**: **trading partner** (Handelspartner) = counterparty company ID stamped
  on the source document; becomes the **partner unit** dimension in consolidation.
  Elimination does **not** require special IC accounts — the *partner dimension*
  is the criterion (IC accounts merely scope which items to consider).
- **NetSuite**: **Represents Subsidiary** links a customer/vendor to the sub it
  stands for → enables **Paired Intercompany Transactions** matching. Plus
  account-level **"Eliminate Intercompany Transactions"** flag.
- **D365 / Intacct**: due-to/due-from accounts auto-generated at posting + a
  trading-partner dimension / entity tag.
- **QuickBooks/Xero add-ons**: the *weak* model — match by account name/code
  across charts, no partner tag. This is exactly the gap SMBs pay to fill.
- **Carbon already does this well** — `customer/supplier.intercompanyCompanyId`,
  `journalLine.intercompanyPartnerId`, and matched `intercompanyTransaction`
  pairs. This is Carbon's biggest head start over the SMB tier.

### 4. The automatic-vs-manual gradient is identical across every platform

Ranked by how universally automated (see Summary table). AR/AP is always
automatic; revenue/expense is auto-capable but opt-in; **unrealized profit in
inventory and fixed-asset transfers is manual top-side everywhere** except SAP's
rule-based IPI; investment/NCI is a separate ownership-%-driven rules layer.
**Design consequence**: phase the engine along this gradient; don't try to
auto-detect unrealized profit on day one (nobody else does, except SAP).

### 5. Don't assume both legs carry the partner tag — support one-sided elimination

- **SAP** eliminates IC revenue **one-sided** because the seller records revenue
  *with* a trading partner but the buyer's **COGS is derived from inventory
  issue and usually carries no trading partner**. It reclassifies against a
  matching cost item rather than requiring both legs tagged.
- **Implication for Carbon**: the revenue↔COGS elimination can't rely on a
  matched `intercompanyTransaction` pair for the *COGS* side — the COGS on the
  buyer's books isn't an IC-tagged line. The seller's revenue line and its
  own COGS (on the seller's books) are the identifiable pair to eliminate.

### 6. Unrealized-profit eliminations are standing entries recomputed each period against current on-hand balances, backed by a carried opening balance

- **SAP**: IPI recomputed each period on current closing inventory; the eliminated
  profit sits in a balance-sheet inventory-writedown position that **carries
  forward** as an opening balance; realizes when goods leave the group.
- **GAAP theory (Entry G / \*G)**: Year 1 defers profit (Dr COGS / Cr Inventory);
  Year 2 realizes it as inventory sells externally (Dr **beginning** Retained
  Earnings / Cr COGS), then re-defers whatever is unsold at the new year-end. Net
  over two periods = zero; the profit is time-shifted to the period of the
  outside sale.
- **Fixed assets (Entry TA / \*TA / ED)**: full gain eliminated on transfer, asset
  restated to original cost/accum. depreciation, and the deferred gain
  **self-liquidates** via a recurring excess-depreciation reversal (Dr Accum.
  Dep / Cr Depreciation Expense) over the remaining life — or immediately on
  external sale/disposal.
- **Design consequence**: unrealized-profit eliminations need a **deferred-profit
  sub-ledger** keyed to the unsold inventory / undepreciated asset basis, with
  **realization triggers** (external sale, each depreciation period, disposal,
  deconsolidation) and a **beginning-RE snapshot** — this is fundamentally more
  than a per-period reversing journal.

### 7. Elimination differences split into "real" vs "currency" (FX residual → CTA)

- **SAP**: translate to group currency **first**, then eliminate. Two matched IC
  balances translated at different rates (B/S at closing, P&L at average) won't
  net to zero; the residual is split into a **real difference** (genuine mismatch
  → difference/P&L account) and a **currency difference** (FX → CTA / translation
  reserve, FS item 314800).
- **NetSuite**: a system **CTA-E** (Cumulative Translation Adjustment –
  Elimination) account absorbs the consolidation-rate FX residual between the
  original entry and its elimination.
- **Design consequence for Carbon**: Carbon's consolidation already translates
  per company and computes a CTA (`translateCompanyBalances` → `ctaByBucket`).
  Elimination in a multi-currency group needs a CTA-E-equivalent plug; **for a
  single-currency group (Carbon's common case) this is a no-op** and can be
  deferred, but the design should reserve the account.

### 8. Reversal timing: period-specific auto-reversing (balances) vs standing (profit deferrals)

- **NetSuite**: elimination journals are period-dated by the period-close task;
  balance-sheet IC lines **auto-reverse next period**; re-runnable (reverses prior
  + regenerates).
- **SAP**: balance carryforward rolls B/S closing → next-year opening; P&L is not
  carried (closes to RE) — which is *why* profit deferrals need the beginning-RE
  treatment.
- **Design consequence**: model AR/AP + revenue/COGS eliminations as
  **period-scoped, regenerable** entries (recompute on re-run, like Carbon's
  current pair-based generate); model profit deferrals as **carried** with
  explicit realization triggers.

---

## Answers to Research Questions

1. **What's the standard taxonomy, and which does a manufacturing SMB need?** —
   Five layers: (1) IC balances AR/AP/loans/notes, (2) IC revenue↔COGS, (3)
   unrealized profit in inventory, (4) unrealized profit in transferred fixed
   assets, (5) investment/equity + NCI. **SMB manufacturing needs 1–2 day one**
   (SAP/NetSuite/Intacct automate these); **3 is the manufacturing differentiator**
   (IC-transferred WIP/components — worth a *guided* entry, not full auto); **4–5
   are manual even in NetSuite/D365** and should be deferred/manual-journal-only.

2. **Where do eliminations post, and at what hierarchy level?** — A dedicated
   elimination entity/ledger layer (NetSuite/D365/Intacct/SAP) — never operating
   books — at the **lowest common parent** of the transacting pair for unit-pair
   eliminations (posting level 20); a **group-hierarchy node** for
   ownership-dependent entries (level 30). **Carbon already matches this.**

3. **How is unrealized profit in inventory/FA tracked and realized?** — Via a
   deferred-profit position carried on the balance sheet, **recomputed each
   period on current on-hand balances**, realized when: inventory is sold
   externally, a fixed asset depreciates (excess-depreciation reversal each
   period) or is disposed, or the sub is deconsolidated. Manual everywhere except
   SAP's rule-based IPI (Percent-from-Partner / standard % / actual group cost).

4. **How are IC transactions identified — auto vs manual?** — Transaction-time
   **partner tag** (SAP trading partner, NetSuite Represents Subsidiary, D365/
   Intacct due-to/due-from) + account-level IC flag. Auto-matched into pairs.
   Manual only in the QuickBooks/Xero tier (account-name matching). **Carbon is
   already in the "auto" camp.**

5. **Recurring vs one-time, and reversal at period roll?** — AR/AP + revenue/COGS
   = **recurring/regenerable, period-scoped** (NetSuite auto-reverses next
   period). Profit deferrals (inventory, FA) = **carried forward** until the
   underlying item leaves the group, re-made each period against current balances
   with a beginning-RE snapshot. Investment/goodwill allocation = **one-time
   measurement carried forward + amortized**.

6. **Multi-currency / CTA and partial ownership / NCI?** — Translate first, then
   eliminate in group currency; FX residual → CTA-E. **100% elimination
   regardless of ownership**; ownership % only splits *unrealized profit* between
   controlling interest and NCI, and only for **upstream** (sub→parent)
   transactions (downstream is 100% controlling, NCI untouched). NCI is a
   separate rules layer (SAP level 30 / FCCS NCI rules).

---

## Competitor-Specific Details

### SAP S/4HANA Group Reporting
- **Posting levels** (adopt as a classifier): `00` reported · `01` standardizing ·
  `10` manual group / rule-based goodwill · `20` two-sided unit-pair elimination ·
  `21/22` two-sided w/ group change · `30` group-dependent (C/I, NCI).
- **Document types** under levels (e.g. `2G` IC elimination) own number ranges =
  audit trail.
- **IPI feature** — the only mainstream rule-based unrealized-inventory-profit
  automation. Profit = inventory book value on hand − group COGM; writes inventory
  down to group cost (lower-of). Markup sources: **Percent from Partner** / fixed
  % / actual group cost. Guards: profit was recorded, both units in group, group
  still owns the asset.
- **ICMR** (Intercompany Matching & Reconciliation) — pre-close rule-based
  matching so elimination runs on reconciled data. Carbon's
  `matchIntercompanyTransactions` is a lightweight ICMR.
- **C/I tasks 2100/2101**; **Consolidation of Investments** with purchase vs
  equity method; first vs subsequent consolidation.

### NetSuite OneWorld
- **Elimination subsidiary** (flagged), lowest-common-parent placement, base-
  currency-locked, JE-only, free (not counted to the 250-sub cap).
- **Automated Intercompany Management** (⚠️ irreversible once enabled) adds the
  account-level "Eliminate Intercompany Transactions" flag, the journal-line
  **Eliminate** box, **Represents Subsidiary**, **CTA-E** account, and a
  period-close **"Eliminate Intercompany Transactions"** task.
- **Auto**: IC AR/AP, IC revenue/expense, IC FX revaluation. **Manual**: unrealized
  inventory profit, FA transfer gains, OCI reclass, NCI. Known gap: for
  arm's-length IC inventory transfers the automated task **does not zero the IC
  clearing accounts** — a manufacturing ERP that closes this is a differentiator.
- Balance-sheet IC eliminations **auto-reverse next period**; re-runnable.

### Oracle FCCS / EPM
- Elimination = a reserved **Consolidation-dimension member** + Data Source member;
  two entries (reversal + **Plug** to a clearing account) net to zero by
  construction. No ledger journal. Recomputed every consolidation (no reversal).
- Auto when: account flagged IC with a Plug account + valid ICP partner + common
  ancestor at >0%. **NCI is a separate rules layer** (required even at 100%).

### Microsoft Dynamics 365 Finance
- **Elimination legal entity** ("Use for financial elimination process"); roles
  Source / Destination / Consolidated LE. Rule-based **Elimination journals**
  (net-change or fixed amount) via **Elimination proposal**, or during
  **Consolidate online**. Match on source account (wildcards) + trading-partner
  dimension. Markup on IC sales explicitly called out as *your* problem (no
  auto profit-in-inventory).

### Sage Intacct
- Elimination entity/account per consolidation **book**. **Auto**: inter-entity
  receivable (IER) / payable (IEP) per the mapping. **Opt-in**: investment,
  inter-entity sales, IC loans, other IC income/expense (add the GL accounts to
  the elimination set). Due-to/due-from auto-generated at journal entry. Cleanest
  SMB model: **the account mapping *is* the config** (no pairwise rule authoring).

### QuickBooks / Xero + add-ons
- **No native elimination.** Add-ons (Joiin, LiveFlow, Fathom) do report-layer
  eliminations by account-name matching; Joiin supports %-ownership per entity.
  SMB threshold to adopt tooling: **~3+ entities / manual close / >1 day per
  period reconciling**. Below that, spreadsheet elimination of **IC AR/AP + IC
  revenue/expense only** is considered adequate; unrealized-profit and NCI are
  where SMBs stop.

### Canonical GAAP/IFRS entries (the mechanics to model)
- **Case 1 — AR/AP**: `Dr IC Payable / Cr IC Receivable`. Pure B/S wash, recurring.
  *(Carbon does this.)*
- **Case 2 — Revenue↔COGS**: `Dr Sales (IC) / Cr COGS` at full transfer price,
  recurring on each period's IC sales. If fully resold externally, this is the
  *only* entry.
- **Case 3 — Unrealized profit in ending inventory**: deferred profit = IC gross
  profit rate × transfer-price cost still in buyer's ending inventory.
  Year 1 `Dr COGS / Cr Inventory`; Year 2 realize `Dr beginning Retained Earnings
  (or Investment) / Cr COGS`. **Upstream** (sub→parent) splits the deferral with
  NCI in the ownership ratio; **downstream** is 100% controlling, NCI untouched.
  Elimination is always 100% either way.
- **Case 4 — FA transfer**: Year of transfer `Dr Gain, Dr Equipment / Cr Accum.
  Dep` (restate to original gross/accum) + `Dr Accum. Dep / Cr Depreciation
  Expense` (reverse current-year excess dep). Subsequent years `Dr beginning RE,
  Dr Equipment / Cr Accum. Dep` (shrinking RE debit) + the annual excess-dep
  reversal until fully depreciated/sold. Upstream shares with NCI.
- **Case 5 — Loans/interest**: `Dr Notes Payable / Cr Notes Receivable` +
  `Dr Interest Income / Cr Interest Expense`; accrued interest is a Case-1
  reciprocal. No profit deferral (unless interest was capitalized into an asset).
- **Case 6 — Investment/equity + NCI**: Entry S (eliminate beginning sub equity
  vs investment, set NCI), Entry A (fair-value step-ups + goodwill), recurring
  Entry I/D/E. Ownership-%-driven; largely one-time measurement carried forward.

---

## Recommended Approach for Carbon

**Adopt SAP's classifier + NetSuite's elimination-entity model (Carbon already
has both), and phase the scope along the industry auto/manual gradient.** Carbon's
infrastructure (transaction-time IC tagging, matched pairs, LCA-routed elimination
entity) is already the enterprise pattern — the work is scope, not re-architecture.

### Phase 0 — Foundation hardening (do alongside the display fixes already made)
1. **Classify elimination journals** with a posting-level-equivalent + method tag
   (SAP posting level / NetSuite document type). Today every elimination is
   `sourceType: 'Manual'` with description `IC Elimination: A ↔ B`. Add an
   explicit elimination **kind** (`balance` / `revenue-cogs` / `unrealized-inv` /
   `fixed-asset` / `investment`) so reports can show/audit the layer and
   re-runs can target one kind. This is the enabling refactor for everything else.
2. **Close the two grounded gaps** the Carbon investigation surfaced: (a) the
   buyer-side payment in `post-payment` does **not** relieve
   `intercompanyPayablesAccount` (only the AR side relieves its IC account);
   (b) `intercompanyTransaction.amount` is still `NUMERIC(19,4)` — violates the
   bare-`NUMERIC` convention. Both are small, independent, and worth fixing first.
3. **Make elimination re-runnable/idempotent per period** — reverse-and-regenerate
   (NetSuite semantics) rather than append, so re-matching after a correction is
   safe.

### Phase 1 — IC Revenue ↔ COGS elimination (the immediate correctness gap)
This is what makes the consolidated **income statement** correct (today it shows
$100 of phantom intragroup revenue). Model the **seller's** IC revenue line and
its matching COGS as the eliminable pair (one-sided per SAP — the buyer's COGS
isn't IC-tagged). Elimination entry on the LCA elimination entity:
`Dr IC Revenue / Cr COGS` at the full transfer amount. Drive it off the
`intercompanyPartnerId`-tagged revenue lines already stamped by
`post-sales-invoice`, extending `generateEliminationEntries` to sweep the revenue
(and seller COGS) lines — not just the receivable control line. Requires
account-default mappings for the IC revenue/COGS accounts (mirror
`intercompanyReceivablesAccount`).

### Phase 2 — Guided unrealized profit in inventory (the manufacturing differentiator)
NetSuite leaves this manual and even leaves IC clearing non-zero; SAP's IPI is the
gold standard. Carbon uniquely owns both the IC sale **and** the buyer's inventory
(`itemLedger`/`costLedger`), so it can compute the embedded margin on *still-on-hand*
IC-sourced inventory. Build a **deferred-profit sub-ledger** keyed to unsold
quantity, recomputed each period, realized as inventory sells externally
(Entry G / \*G). Ship it as a **guided/reviewable** entry first (surface the
computed margin, let the user confirm), not silent automation — matching how every
platform treats this as high-review-risk. **This is the highest-value net-new
capability** and where Carbon can beat NetSuite. Requires cross-company cost
visibility (today `costLedger` is per-company with zero IC awareness) — the main
new infrastructure.

### Phase 3+ — Defer (manual-journal-only for now)
- **Fixed-asset transfer gain** + depreciation catch-up (Entry TA/\*TA/ED) —
  manual even in NetSuite/D365; multi-year carryforward. Provide a guided manual
  elimination journal, not an engine.
- **Investment-in-subsidiary / equity + NCI** — over-engineering for SMB day one;
  needs an ownership-% model. A simple per-entity ownership % + manual investment
  elimination is the SMB-appropriate stopping point (Joiin/D365 pattern).
- **Multi-currency CTA-E** — reserve the account; no-op for single-currency groups
  (Carbon's common case), implement when a group spans currencies.

### Design principles to encode (from the consensus)
- Eliminations are a **classified ledger layer keyed by (unit, partner)**, on the
  LCA elimination entity, never mutating operating books. *(Carbon has this.)*
- **Don't assume both legs are partner-tagged** — support one-sided elimination.
- **100% elimination regardless of ownership**; ownership % only splits unrealized
  profit (upstream vs downstream) — encode a **direction flag** on every profit
  deferral even before NCI is built, so the data is right when NCI lands.
- **Profit deferrals carry forward** with explicit realization triggers + a
  beginning-RE snapshot; balance/revenue eliminations are period-scoped and
  regenerable.
- **Split elimination differences into real vs currency**; route FX residual to a
  CTA-E account.
- **Terminology to adopt**: *trading partner* (already `intercompanyPartnerId`),
  *interunit (IU) elimination*, *unrealized profit in inventory*, *elimination
  entity*, *posting level / elimination kind*, *upstream/downstream*,
  *non-controlling interest (NCI)*, *CTA-E*.

### Scope recommendation (headline)
**Phases 1 + 2 are the target for a holistic-but-SMB-right design.** Phase 1
fixes a real correctness bug (phantom IC revenue in consolidated P&L); Phase 2 is
the manufacturing differentiator no SMB competitor automates. Phases 3+ are
manual-journal-only until there's demand, matching where NetSuite/D365/Intacct
themselves draw the line.

---

## Open Questions (carry into the spec)

1. **Fixed-asset intragroup transfer** in Carbon currently flows through ordinary
   two-step disposal with no IC awareness — does the design intercept it at
   posting (tag the disposal gain) or handle it purely at elimination? (Affects
   whether Phase 3 needs edge-function changes.)
2. **Cross-company cost basis** for Phase 2: does Carbon introduce a shared/group
   cost layer, or compute the margin from the seller's `costLedger` at elimination
   time? (The latter is less invasive.)
3. **IC revenue/COGS account defaults**: add dedicated `intercompanyRevenueAccount`
   / `intercompanyCogsAccount` to `accountDefault` (mirroring the AR/AP pattern),
   or derive from the posted revenue lines' accounts?
4. **Ownership model**: is any Carbon group ever partially owned, or is 100%
   wholly-owned assumed (making NCI moot and Phase 3 investment-elimination
   trivial)? Determines whether the direction flag / ownership % is needed at all.
5. **Realization trigger for inventory**: Carbon knows external sales via
   `itemLedger`/shipments — is per-period recompute-on-current-on-hand (SAP IPI
   style) acceptable, or is lot-level FIFO tracing of which IC-sourced units left
   required?
6. **Re-run / period-close integration**: should elimination be a period-close
   checklist task (NetSuite/SAP) tied to `accountingPeriod`, with reverse-and-
   regenerate on re-run?

---

## Sources

### SAP
- https://learning.sap.com/learning-journeys/performing-consolidation-with-sap-s-4hana-cloud-for-group-reporting/outlining-intercompany-elimination-possibilities_e52d704e-44d0-4ea9-a630-73dc4529271e
- https://learning.sap.com/learning-journeys/performing-consolidation-with-sap-s-4hana-cloud-for-group-reporting/eliminating-intercompany-payables-and-receivables_de0d1447-34c8-47ef-8e05-112f40a604ab
- https://learning.sap.com/learning-journeys/performing-consolidation-with-sap-s-4hana-cloud-for-group-reporting/eliminating-intercompany-revenue-and-cost_bf0684be-4502-4f31-86ad-85dd3d2d04a2
- https://learning.sap.com/learning-journeys/implementing-sap-s-4hana-cloud-for-group-reporting/eliminating-intercompany-profit-in-inventory_e614ce07-fc6f-43c3-99a9-3f57a4d4fedd
- https://learning.sap.com/learning-journeys/implementing-sap-s-4hana-cloud-for-group-reporting/configuring-profit-in-inventory-elimination-methods_d6e948d8-07fe-4ba4-b360-5d0813e41040
- https://learning.sap.com/learning-journeys/performing-consolidation-with-sap-s-4hana-cloud-for-group-reporting/describing-posting-levels-and-document-types_ab40ffc2-fe6e-4116-a497-d4a0ba1ada4f
- https://help.sap.com/doc/eba6c6535e601e4be10000000a174cb4/700_SFIN20%20006/en-US/4b72e3a4a6b3584de10000000a42189c.html
- https://help.sap.com/doc/eba6c6535e601e4be10000000a174cb4/700_SFIN20%20006/en-US/3ea6c6535e601e4be10000000a174cb4.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/90c07e91c7a64f328be3fd6b48955b13/a8172f85383947bd8538bf778e771874.html (ICMR)
- https://learning.sap.com/learning-journeys/consolidating-investments-with-sap-s-4hana-cloud-for-group-reporting/defining-consolidation-of-investments
- https://blog.sap-press.com/intercompany-elimination-analysis-use-cases-in-sap-s4hana

### NetSuite
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N268759.html (Elimination Subsidiaries)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1498385.html (IC Elimination Overview)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1486610.html (Automated IC Management setup)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1486928.html (Intercompany Accounts)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1501565.html (Elimination via Automated IC Management)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1498982.html (IC Elimination multi-currency example / CTA-E)
- https://timdietrich.me/blog/netsuite-intercompany-transactions-eliminations/
- https://www.houseblend.io/articles/netsuite-intercompany-eliminations-guide
- https://suiterep.com/2023/11/01/the-netsuite-intercompany-framework-feature/

### Oracle FCCS / Dynamics / Intacct / QuickBooks-Xero
- https://docs.oracle.com/en/cloud/saas/financial-consolidation-cloud/agfcc/intercompany_eliminations.html
- https://docs.oracle.com/en/cloud/saas/financial-consolidation-cloud/toutorial-fcc-partner-elimination/index.html
- https://docs.oracle.com/cd/E41507_01/epm91pbr3/eng/epm/pgcs/task_DefiningNon-ControllingInterestRules-399848.html
- https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/elimination-rules
- https://learn.microsoft.com/en-us/dynamics365/finance/budgeting/consolidation-elimination-overview
- https://www.randgroup.com/insights/microsoft/dynamics-365/finance-operations/intercompany-accounting-in-dynamics-365-finance-setup-steps-common-errors-and-best-practices/
- https://www.intacct.com/ia/docs/en_GB/help_action/Multi-entity/Inter-entity_transactions/interentity-txn-overview.htm
- https://www.intacct.com/ia/docs/en_AU/help_action/Consolidations/Global_Consolidations/Consolidations/about-inter-entity-eliminations.htm
- https://www.intacct.com/ia/docs/en_US/help_action/Consolidations/Global_Consolidations/Book_setup/elimination-accounts-tab.htm
- https://liveflow.com/blog/intercompany-eliminations-what-they-are-how-they-work-and-how-to-automate-them
- https://liveflow.com/blog/best-multi-entity-consolidation-software-6-tools-compared
- https://www.joiin.co/features/intercompany-management/
- https://www.intuit.com/enterprise/blog/financials/intercompany-eliminations/

### GAAP / IFRS theory
- https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/consolidation_and_eq/consolidation_and_eq_US/chapter_8_intercomp_US/82_intercomp_tran_US.html
- https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/equity_method_of_accounting/Equity_method_account/chapter_4/42_elimination_of.html
- https://www.deloitte.com/us/en/services/consulting/articles/profit-in-inventory-elimination-intercompany-accounting.html
- https://www.accountingtools.com/articles/what-are-intercompany-eliminations.html
- https://www.becker.com/accounting-terms/intercompany-profit-fixed-assets
- https://fiveable.me/financial-accounting-ii/unit-14/intercompany-inventory-fixed-asset-transactions/study-guide/nMKk058IpxWCfvqY
- https://www.houseblend.io/articles/asc-810-intercompany-elimination-rules
- https://softledger.com/blog/intercompany-eliminations-noncontrolling-interest-guide
- Governing standards: FASB ASC 810-10-45-1; IFRS 10 para B86. Textbook frameworks: Hoyle/Schaefer/Doupnik *Advanced Accounting* Ch. 4–6; Beams *Advanced Accounting* Ch. 5–6.
