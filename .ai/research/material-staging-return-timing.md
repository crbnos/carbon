# Material Staging Return Timing Research: Best Practices Survey

## Summary

Surveyed how SAP (ECC WM + S/4HANA EWM), Dynamics 365 SCM, NetSuite, Katana,
Fulcrum, ProShop, Epicor Kinetic, and Fishbowl handle staged/picked production
material and the return of the unconsumed remainder to the warehouse — with
focus on WHEN the return happens (operation completion vs order/job completion
vs manual) and how backflush interacts. Key finding: **no surveyed system
auto-returns staged material at operation completion.** The market splits into
(a) manual-return-only (SAP, D365, NetSuite, Epicor, Fishbowl, Fulcrum) and
(b) automatic return at **order completion** (Katana — the only auto-return
found, matching Carbon's current behavior). The industry's actual policy lever
is **consumption timing** (D365 flushing principles, Epicor per-operation
backflush), not return timing. Epicor is a direct counter-signal to
per-operation return: since 2022.2, completing an operation *forfeits*
returnability (WIP assumed fully consumed). SAP's answer to leftover staged
stock is structural: cross-order staging (remainder stays at the PSA, netted
by the next order's staging run) plus an explicit "Clear Production Supply
Area" transaction run after the order finishes.

## Competitors Surveyed

- **SAP ECC WM / S/4HANA EWM** — enterprise reference; richest staging model (PSA, control cycles, PMR)
- **Dynamics 365 SCM** — production input locations + the flushing-principle policy vocabulary
- **NetSuite (WMS + WIP/Routings)** — WIP bins, pick reversal, per-operation backflush
- **Epicor Kinetic** — job-shop reference; explicit Issue/Return Material transactions
- **Katana MRP** — the only system with automatic return-at-completion
- **Fulcrum** — modern MES-first; pick = immediate consume
- **Fishbowl** — pick = relocate to manufacturing location (closest to Carbon's lineside model)
- **ProShop ERP** — public docs too thin to confirm transaction mechanics

## Key Consensus Patterns

### 1. Staged material stays on-hand; consumption is a separate later event

- **SAP**: WM 319 moves stock to interim storage type 100 / PSA bin — WM-internal only, no IM posting; still unrestricted, valuated, on-hand. Consumption = 261 at confirmation/backflush.
- **D365**: raw-material-picking work moves stock to the production input location with status Picked — still on-hand until a picking-list journal posts (exception: "Available at location" flushing principle, where arrival = consumption).
- **NetSuite**: WMS work-order picking is a bin transfer into a WIP bin — on-hand until Work Order Issue/build.
- **Fishbowl**: pick relocates to the WO's "manufacturing location"; finish consumes.
- **Counter-model**: Fulcrum (pick = immediate issue) and Epicor (Issue Material = STK-MTL into WIP cost bucket, off inventory).
- **Rationale**: keeping staged stock on-hand keeps returns cheap (a reverse transfer) and inventory truthful. Carbon's pick-as-Transfer-to-lineside matches the majority model.

### 2. No system auto-returns at operation completion; only Katana auto-returns at order completion

- **SAP**: no automatic return at operation confirmation, order confirmation, or TECO. EWM "Clear Production Supply Area" is run explicitly after the PMR completes AND no other PMR needs the product.
- **D365**: no return mechanism at RAF/End at all; community workaround = manual unpick + inventory movement.
- **NetSuite**: "Reverse Picks" any time before consumption — operator-initiated.
- **Epicor**: manual Return Material Entry (MTL-STK); and since 2022.2.3 an operation marked complete CLEARS its WIP — returns after op completion are blocked ("not enough qty in WIP"). Op completion is treated as "everything issued was consumed."
- **Katana**: automatic — "returns unused ingredients to inventory when the MO is marked Done."
- **Rationale**: at operation completion the system generally cannot know the remainder is surplus — later operations, rework, or the next order at the same line may need it. Order completion is the first moment "unconsumed" provably means "unneeded."

### 3. The configurable policy point is consumption timing, not return timing

- **D365**: flushing principle per BOM line — Start / Finish (order RAF or the tied operation's completion) / Available-at-location (pick = consume) / Manual.
- **Epicor**: per-material backflush flag; backflush fires per-operation at labor/qty reporting, at standard quantities.
- **NetSuite**: issue-then-complete vs completion-with-backflush; components tied to an operation backflush when that operation reports.
- **SAP**: staging type per control cycle (pick parts = exact order qty → minimal leftover; crate/release-order parts = intentional over-staging).
- **Rationale**: tightening consumption timing shrinks the staged-unconsumed window, making return timing mostly moot. A return-timing policy is unusual — Carbon adding one is ahead of the market (precedent: Katana's fixed-at-completion, made configurable).

### 4. Leftover-remainder handling is quantity-netting or structural, not per-op sweeps

- **SAP**: over-staged remainder stays at the PSA; the next staging run (MF60 / WM staging) NETS existing PSA stock against the new requirement — leftover gets consumed by the next order without a return trip. Cross-order staging is the recommended pattern when leftovers are common; single-order staged stock requires a reference-release step before reuse.
- **S/4 2020+**: partial quantity of single-order staged stock can be re-assigned to another order WITHOUT physically moving it back.
- **D365**: excess just sits at the input location as on-hand (community calls unreturned leftovers "shop floor inventory" — the anti-pattern name).
- **Rationale**: physical return trips are waste if the same line will need the item again soon; netting/reassignment beats round-tripping.

## Answers to Research Questions

1. **When does unconsumed staged material return?** — Manual everywhere except Katana (auto at MO Done). Never automatically at operation completion in any surveyed system. SAP/EWM formalizes the "after order finishes" moment with the Clear PSA transaction gated on "no other PMR needs the product."
2. **Industry terminology** — "return to stock", "material return" (Epicor: Return Material Entry), "pick reversal" (NetSuite), "unpick" (D365 "Stop and unpick"), "Clear Production Supply Area" / "de-staging" (SAP EWM), "reintegration" (Sage X3). For the staging place: PSA (SAP), production input location (D365), WIP bin (NetSuite), manufacturing location (Fishbowl) — Carbon's "lineside" fits.
3. **Backflush interaction** — backflush consumes FROM the staging location (SAP 261 from PSA; Epicor from backflush bin hierarchy incl. resource input warehouse; D365 Finish-principle proportional to reported qty). Nobody returns remainder as part of backflush; remainder stays staged. Epicor's post-2022.2 behavior (op completion clears WIP) is the sharpest edge: returning at op completion and backflushing at completion are in direct tension unless the return runs strictly AFTER all consumption for that operation is final.
4. **Return automatic or manual? Policy?** — Manual, except Katana. No system exposes a return-timing config. D365's flushing principles are the closest policy analog and are per-BOM-line, not global.
5. **Shared staging areas** — SAP explicitly supports shared PSAs across work centers/orders (cross-order staging = shared pool, no per-order reference). Netting handles contention. Single-order staging ring-fences stock at the price of a release step. Carbon's per-work-center lineside bin ≈ a shared PSA: per-operation return must not yank stock another job/operation at the same work center still needs.
6. **Partial consumption / batch splits** — SAP EWM supports partial-HU consumption and re-assignment without physical moves; batch staged stock consumed FIFO (BAdI-overridable). Carbon's split-lineage walk (`returnPickedRemainder`) is the equivalent mechanism.

## Competitor-Specific Details

### SAP
- PSA is master data (PK05), mapped to storage-location/bins; control cycles (LPK1) per material+PSA choose staging type 1 (pick parts, exact qty), 2 (crate), 3 (release-order), 4 (manual).
- 319 = staging transfer (no IM posting), 261 = consumption, 262 = return of issued-but-unused (works even after TECO), 311 = IM staging return path. 531 is by-product receipt — unrelated.
- KBA 3305001: EWM Post Consumption app allows consumption/reversal even at TECO — documented PP↔EWM status inconsistency.
- Leftover staged stock stays count-relevant (cycle counting on PSA slocs); guidance says clear PSAs before period-end.

### D365
- Flushing principles: Start (proportional to started qty; with MES can fire at operation start), Finish (proportional to RAF qty; fires at order RAF or tied operation's completion), Available at location (pick = consume, batch-posted picking list), Manual.
- "Stop and unpick" reverses Picked transactions but leaves material AT the input location — physical return is a separate mobile-device movement.
- Over-picking is a threshold-gated WMS feature with no downstream disposition handling.

### NetSuite
- WIP bins ("Use Bin in Manufacturing Mobile") stage picked components including excess, still on-hand.
- Reverse Picks: per-task reversal auto-creating a bin transfer back to source bins; any time before consumption.
- After issue: edit/delete the Work Order Issue (open period, order not closed). After build: Assembly Unbuild. WO Close is the hard lock.

### Epicor Kinetic
- Issue Material (STK-MTL) / Return Material Entry (MTL-STK), operator picks target warehouse/bin.
- Since 2022.2.3: operation completion clears that operation's WIP — Return Material afterward fails; Epicor calls it intended. Users work around by returning BEFORE completing the op.
- Backflush per-operation at labor/qty report, standard quantities only, not for lot/serial parts.

### Katana
- Picking = soft reservation (no location move). Consumption at MO Done from actuals.
- Auto-return: unused ingredients return to inventory at MO Done, linked to the MO for traceability. Over-consumption flips MO back to Partially picked.

### Fulcrum
- Pick = immediate inventory decrement + actual cost to job. Remnant return is a manual operator transaction (remnant sizes for sheet/bar).
- "Auto-pick material on job completion" setting = backflush-at-job-completion analog; skips materials with any existing pick.

### Fishbowl
- Pick moves stock to the WO's manufacturing location (on-hand); finish consumes; "any unused quantities remain in the manufacturing location and can either be moved back into their respective inventory locations or scrapped" — manual.

### ProShop
- Soft allocation to work orders documented; no public evidence of staging locations, return transactions, or backflush config. Unconfirmed.

## Recommended Approach for Carbon

1. **Keep return-at-job-completion as the default** (Katana pattern, Carbon's current behavior). It is the only proven auto-return timing; every enterprise system treats order-finish as the first safe "surplus is surplus" moment.
2. **Offer per-operation return as an opt-in company policy**, not the default — no competitor does it automatically, and Epicor actively forbids returns after op completion, so this is novel surface; gate it carefully. Model the setting on the existing `incompletePickingListPolicy` precedent.
3. **Guard the per-operation sweep with a "no remaining demand" check** (SAP Clear-PSA's "no other PMR needs the product" gate): only return a line's remainder when no other open operation/job at the same work center still requires that item, or scope strictly to the line's own picked-minus-consumed quantity — never sweep bin on-hand (Carbon's lineside bin is per-work-center = a shared PSA).
4. **Sequence return strictly after consumption is final for that operation** (Epicor tension): per-operation return must run after the operation's backflush/issues post, and job-completion backflush (`backflush_job_materials` top-up) must be accounted for — returning material the completion-time backflush still needs would break job costing. Restrict per-operation return to lines whose material is fully issued, or make completion-time backflush re-pull.
5. **Quantity attribution from line quantities, not bin stock** (SAP netting insight): untracked remainder = line `quantityPicked` − attributable consumption, clamped ≥ 0; tracked remainder = split-lineage lineside on-hand (existing `returnPickedRemainder` mechanism).
6. **Terminology**: "return to stock" / "material return" for UI copy; avoid inventing new terms.

## Sources

### SAP
- https://learning.sap.com/courses/production-integration-with-sap-s-4hana-ewm/clearing-the-production-supply-area
- https://learning.sap.com/courses/processes-in-sap-s-4hana-ewm/executing-the-production-supply-process
- https://help.sap.com/docs/SAP_EXTENDED_WAREHOUSE_MANAGEMENT/3d97bec9bf1649099384bb8167df3cf2/019deb535cbb5d1ee10000000a441470.html
- https://help.sap.com/docs/SAP_EXTENDED_WAREHOUSE_MANAGEMENT/3d97bec9bf1649099384bb8167df3cf2/8969c21268d2466985f0c810fae7e9a8.html
- https://help.sap.com/docs/SAP_ERP_SPV/e4d7eb053c62465885b669e169116aa6/ae5fbd534f22b44ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_EXTENDED_WAREHOUSE_MANAGEMENT/3d97bec9bf1649099384bb8167df3cf2/911b39b24cce43cd82002d59df55279b.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/b2dee5e83e2446149294f9860a7c08f0/f48fc95360267214e10000000a174cb4.html
- https://userapps.support.sap.com/sap/support/knowledge/en/3305001
- https://www.saplogisticsexpert.com/sap-ewm-pp-integration-master-guide-to-production-staging-and-shopfloor-mapping/
- https://www.saplogisticsexpert.com/material-staging-for-production/
- https://itpfed.com/understanding-ewm-advanced-production-integration/
- https://community.sap.com/t5/enterprise-resource-planning-q-a/movement-types-involved-in-wm-pp/qaq-p/8956335
- https://community.sap.com/t5/enterprise-resource-planning-q-a/return-of-parts-after-teco/qaq-p/11744384
- https://community.sap.com/t5/supply-chain-management-q-a/ewm-clear-production-supply-area/qaq-p/12309402
- https://community.sap.com/t5/supply-chain-management-blogs-by-members/release-partial-quantity-of-single-order-staged-stock-enhancements-to/ba-p/13499790
- https://community.sap.com/t5/enterprise-resource-planning-q-a/storage-type-for-production-line-staging/qaq-p/11008093
- https://community.sap.com/t5/enterprise-resource-planning-q-a/movement-261-and-262/qaq-p/3579620

### D365
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/flushing-principles
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/warehouse-work-policies
- https://www.loganconsulting.com/blog/understanding-over-picking-in-d365-supply-chain-management/
- https://community.dynamics.com/forums/thread/details/?threadid=ad55174e-1b7b-4581-b23b-884fda8ea459
- https://dynamicsuser.net/ax/f/users/80545/posting-negative-picking-list
- https://learn.microsoft.com/en-us/answers/questions/1348909/
- https://www.sikich.com/insight/using-dynamics-365-work-policies/

### NetSuite
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_164251896831.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_164251905118.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_0208122806.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_155993390806.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2321882.html
- https://netsuitechangelog.com/articles/pick-reversal-capabilities-in-netsuite-20232/
- https://www.anchorgroup.tech/blog/netsuite-wms-manufacturers

### SMB / point solutions
- https://support.katanamrp.com/en/articles/11172448-picking-ingredients-for-a-manufacturing-order-mo
- https://support.katanamrp.com/en/articles/5914331-completing-a-manufacturing-order-mo
- https://katanamrp.com/blog/ingredient-picking/
- https://fulcrumpro.com/manufacturing-software/job-tracking
- https://fulcrumpro.com/article/streamlining-real-time-inventory-capture-with-fulcrum
- https://docs.biscit.com/epicor-kinetic-warehouse/epicor-kinetic-warehouse-user-guide/issues-and-returns
- https://www.epiusers.help/t/return-material-from-job-not-enough-wip/95470
- https://www.mayantechs.com/post/backflush-in-epicor-kinetic-benefits-limitations-and-best-practices
- https://help.epicor.com/erp/102700/enu/standard/FeaturesSupplyChain/inv_materialbackflush.html
- https://help.fishbowlinventory.com/advanced/s/article/Work-Order
- https://help.fishbowlinventory.com/advanced/s/article/Picking
- https://proshoperp.com/erp-modules/inventory-management/
- https://communityhub.sage.com/us/sage_x3/b/sageerp_x3_product_support_blog/posts/is-it-possible-to-return-not-used-material-back-to-stock
