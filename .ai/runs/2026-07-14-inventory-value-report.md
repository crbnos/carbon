# Feature run: Interactive inventory value report (by location, by item)

- Date: 2026-07-14
- Mode: approval-per-phase
- Request: "we need to be able to create an interactive report for inventory that allows us to look at the value by location, and by item. let's use the /feature skill"
- Phase plan: research [run — ERP-domain logic (inventory valuation), force-included] · spec [run — new report surface, crosses inventory module + UI] · plan [run] · execute [run] · test [skip — user opted out at phase selection] · self-review [skip — user opted out at phase selection]

## Decisions
<!-- approval mode — gates are human; none auto-resolved -->
- Grill Q1 — valuation basis (Brad, 2026-07-14): **method-faithful carrying cost.** FIFO/LIFO = remaining layer value incl. `appliesToCostLedgerId` children (fallback unitCost when no layers); Average = unitCost; Standard = standardCost. Per-location value = locationQty × company-level effective unit cost. Ties to subledger; matches completeness-spec carrying math.
- Grill Q2 — status scope (Brad, 2026-07-14): **value ALL physical on-hand (incl. On Hold + Rejected), with On Hold / Rejected breakdown columns.** SAP MB52 stock-bucket precedent; rejected stock stays an asset until written off, so totals tie to the books.
- Grill Q3 — as-of-date (Brad, 2026-07-14): **IN for v1, approximate + labeled** (overrode the defer recommendation). Historical qty exact via itemLedger.postingDate ≤ asOfDate; cost = today's effective unit cost; UI carries a permanent semantics label (SAP Fiori precedent). Caveats to label: snapshot matview unusable for dated queries (raw ledger aggregation); status breakdown reflects current tracked-entity statuses even at past dates.
- Grill Q4 — GL tie-out (Brad, 2026-07-14): **IN for v1** (overrode the defer recommendation). Per-account tie-out (MB5L shape): rawMaterialsAccount + finishedGoodsAccount (resolveInventoryAccount, `20260713190909` split) — subledger value vs GL balance per account + total; accountingEnabled companies only; WIP excluded; known-noise caveat (unposted cycle-count adjustments) surfaced in the panel copy until completeness-spec §4 lands.
- Grill Q5 — old RPC (Brad, 2026-07-14): **keep `get_inventory_value_by_location` (deprecated)**, don't drop. New `get_inventory_valuation` ships alongside; zero API-breakage risk accepted over surface cleanliness.
- Grill Q6 — permissions (Brad, 2026-07-14): **accounting_view gates the whole report** (strictest option). Lives in Inventory nav but entry renders only for users with accounting view; costs never reach ops-only roles.
- costLedger.locationId: NOT added for this feature (user question, resolved 2026-07-14). Layer consumption in calculateCOGS is company-wide, transfers write no cost entries, revaluations are company-scoped — a stamped column would never balance per location. v1 = per-location qty × company-level unitCost; true per-location costing (industry-validated: SAP per-plant, NetSuite MLI) deferred to its own spec. Details in research addendum.

## Phase log
- Plan: written — `.ai/plans/2026-07-14-inventory-value-report.md` (7 tasks; awaiting approval gate). Revised 2026-07-14 per Brad: types ARE regenerated + committed normally (`pnpm db:migrate`); the "cloud-generated types, use casts" memory was wrong and has been deleted/corrected; services use fully typed rpc calls + Awaited<ReturnType> row types.
- Spec: done — `.ai/specs/2026-07-14-inventory-value-report.md`. All 6 grill questions + costLedger.locationId decision resolved by Brad before writing; spec written with resolutions baked in. Gate satisfied: zero unresolved open questions.
- Research: done — `.ai/research/inventory-value-report.md`. Surveyed SAP (S/4HANA + B1), NetSuite, Dynamics BC, Fishbowl, Odoo + explored Carbon internals. Key internal finding: `get_inventory_value_by_location` RPC exists (migration 20260325031223) but has zero app callers — dead code this feature will supersede.

- Execute: done — 7/7 tasks, 6 commits on feat/inventory-report. RPC math proven by rolled-back psql validation (7/7 asserts, incl. one real bug caught: account is companyGroup-scoped). 156 translations filled. Browser verification was deselected by Brad at phase selection — verify manually: open /x/inventory/valuation as an accounting-view user on the running stack; check group toggle, as-of label, tie-out popover, CSV download, and that a non-accounting user sees no nav entry + 403.

## Outcome
- Implementation complete on feat/inventory-report (not pushed — branch upstream is origin/main, pushing would target main). PR creation left to Brad.
