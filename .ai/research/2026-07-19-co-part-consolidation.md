# ECO Modeling in PLM/ERP: Change Types, New Parts, BOM Consolidation & Supersession

Research date: 2026-07-19
Purpose: ground a Carbon change-order (ECO) spec — specifically (a) renaming the
1:1-supersession change type from **"New Part"** to **"Replacement Part"**,
(b) adding a net-new **"New Part"** with no predecessor, and (c) modeling an
N→1 consolidation as a **parent-assembly BOM change** rather than a supersession.

Systems surveyed: Arena PLM, PTC Windchill, Siemens Teamcenter, Oracle Agile PLM,
Oracle Fusion Cloud PLM, SAP Engineering Change Management (LO-ECH), NetSuite,
Odoo PLM, Fishbowl, Duro, OpenBOM.

Carbon-today baseline (from `apps/erp/app/modules/items/items.models.ts`
`changeOrderChangeTypes`): the per-affected-item change type is
`Version | Revision | New Part`, where **"New Part"** today already means a **new
P/N derived from + auto-superseding the affected part** (a 1:1 supersession), and
there is currently **no** net-new-with-no-predecessor path. That is the naming
collision this research is meant to resolve.

---

## Q1. Change scope / disposition types — how systems categorize what an ECO does to an item

**The dominant industry pattern is a "before → after" split on the change object,
plus a distinction between "revise in place" (same number, new rev) and "replace
with a different number."**

- **PTC Windchill** — separate **Affected Objects** (the existing "before" items)
  and **Resulting Objects** (the "changed or new objects to be released") tables on
  the Change Task. Revise-in-place vs replace is an *action* on the affected object:
  **Revise** (same part, new revision) vs **Supersede** / **Save As** / **New** (a
  different part number). Inventory **Disposition** (On Order / WIP / Finished) is a
  separate axis about existing stock, not part identity.
  [Affected/Resulting Objects](https://support.ptc.com/help/windchill/r13.1.2.0/en/Windchill_Help_Center/changemanagement/ChgMgmtAffectedAffectedObjResulting.html),
  [Superseding Parts](https://support.ptc.com/help/windchill/r12.1.2.0/en/Windchill_Help_Center/parts/PMPartSupersedeOview.html)
- **Siemens Teamcenter** — relation folders **Impacted Items** (before) →
  **Solution Items** (after), plus **Problem/Reference Items**; a **Change lineage**
  relation ties impacted→solution. Revise = new Item Revision under the **same Item
  ID**; a new **Item ID** is created only when the part number changes.
  Teamcenter explicitly notes supersedure "**cannot track a pure revision change**"
  — that is the dividing line between a revise and a replacement.
  [Change relation folders](https://www.linkedin.com/pulse/what-change-manager-teamcenter-active-workspace-anant-bramhankar-im4ff),
  [Supersedure](https://tcplmbasics.com/2018/06/07/supersedure-in-teamcenter/)
- **Oracle Agile PLM** — change *classes* carry the semantics: **ECR** (request),
  **ECO** (creates a new revision — same item number), **MCO** (mfg data change, no
  rev bump), **SCO** (site-only), **Deviation**, **Stop Ship**. **Affected Items**
  rows carry Old Rev → New Rev. A different part number = a new item redlined into
  consuming BOMs (no built-in supersede-by-renumber operation).
  [PC User Guide Ch.7 Changes](https://docs.oracle.com/cd/E50306_29/otn/pdf/user/html_agaad/output/chapter_7.htm),
  [Ch.8 Affected Items](https://docs.oracle.com/cd/E50306_29/otn/pdf/user/html_agaad/output/chapter_8.htm)
- **Oracle Fusion Cloud PLM** — predefined change types (**Engineering Change
  Order**, **Change Order without revision control**, **Change Request**,
  **Deviation**, **Commercialization Change Order**, plus Problem Report / Corrective
  Action). Objects changed = **affected objects**; markup = **redlines** with record
  types **ADD / DELETE / CHANGE**. Revise-in-place is primary; new-part replacement
  is a separate **Replace** action + **Obsolete** lifecycle phase.
  [Understand Change Types](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26a/faipr/understand-change-types.html)
- **SAP ECM (LO-ECH)** — a **Change Master + Change Number** (CC01) time-slices an
  object's state via **valid-from date**; **ECR vs ECO** is a status-managed change
  master (CC31/CC32) that **must be approved and converted ECR→ECO** before any
  object can change. SAP does **not** model revise-vs-new as distinct disposition
  types — both just reference the same change number (changed state vs created state).
  [LO-ECH overview](https://help.sap.com/doc/saphelp_me151/15.1.3VERSIONFORSAPME/en-US/da/6cb953495bb44ce10000000a174cb4/content.htm?no_cache=true),
  [ECR/ECO](https://help.sap.com/doc/saphelp_me151/15.1.3VERSIONFORSAPME/en-US/75/25bd534f22b44ce10000000a174cb4/content.htm?no_cache=true)
- **Arena PLM** — **revision-centric, not renumber-centric**: the Change Affected
  Item object has `newRevisionNumber` / `newLifecyclePhase` but **no "new part
  number" field**. "SUPERSEDED" is a *revision status*, not a part-to-part link.
  Categories: ECR → ECO → ECN, plus **Deviation** (temporary effectivity).
  [create change](https://raw.githubusercontent.com/ptc-arena/arena-restapi-doc/main/Arena%20REST%20API/Endpoints/Change/endpoint_create_change.md),
  [modified item object](https://raw.githubusercontent.com/ptc-arena/arena-restapi-doc/main/Arena%20REST%20API/Objects/object_change_modified_item.md)
- **Duro** — supersession expressed via **Effectivity**: "the old is superseded by
  either a new **CPN** or a new **revision** of an existing CPN" — so a *replacement*
  (new CPN) and a *revision* (same CPN) are explicitly the two supersession flavors.
  [Effectivity](https://duro.zendesk.com/hc/en-us/articles/10159748251924-Effectivity)
- **OpenBOM** — **CR → CO → Revision** (a Revision = immutable copy, same part
  number). **No supersession/replacement disposition** in the change model;
  interchangeability handled separately via Alternates/Substitutes.
  [Change management](https://www.openbom.com/blog/change-management-in-openbom-revision-change-request-and-change-orders)
- **NetSuite / Odoo / Fishbowl (mid-market)** — NetSuite's native ECO acts on
  assembly items + BOM revisions via **Add / Remove / Replace** actions; no
  item-revision disposition type. Odoo ECOs version a **BoM** (V2, V3…) with a
  color-coded diff; it never "creates a new product" from a BoM change. Fishbowl has
  **no ECO/change-control object at all** (just a free-text Revision label).
  [NetSuite ECO](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_1531288763.html),
  [Odoo ECO](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/plm/manage_changes/engineering_change_orders.html)

**Consensus:** "revise in place" = **same part/item number, new revision**;
"replace" = **a different part number** — this line is universal, and Teamcenter
even codifies it ("supersedure cannot track a pure revision change"). The
before/after split (Affected→Resulting, Impacted→Solution, Old Rev→New Rev) is the
near-universal representation.

**Divergence:** terminology for "replace with a new number" varies widely —
**Supersede** (Windchill, Teamcenter, Duro), **Replace a Component** (Fusion,
NetSuite), redline-in-a-new-item (Agile). Arena and OpenBOM have **no first-class
renumber/supersede disposition** at all (pure revision models). "Disposition" is
overloaded: in Windchill/Agile/Arena it means **existing-inventory handling** (On
Order / WIP / Stock / Field), *not* part identity.

---

## Q2. Introducing a brand-new part under an ECO (no predecessor)

**The enterprise PLM/PLM-grade systems all let a genuinely new part be created and
released *by* the change; the mid-market ERPs generally do not.**

- **Windchill** — a **New** object (no predecessor) is added to the **Resulting
  Objects** table; the Change Notice workflow "sets all Resulting Objects to
  **Released**," promoting the new **In Work** part.
  [Adding objects to Change Task](https://support.ptc.com/help/windchill/plus/r12.0.2.0/en/Windchill_Help_Center/CADxFileMenuAddToChangeTask.html)
- **Teamcenter** — a new Item (no predecessor) is attached as a **Solution Item**;
  new revisions are "working" (no Release Status) until a workflow action handler
  applies release status.
  [What's new 2312](https://blogs.sw.siemens.com/teamcenter/whats-new-in-teamcenter-2312/)
- **Agile PLM** — "Items are not released to production directly. Rather, a change
  (an ECO) is created against the item, and that change is released." A new item
  starts at the **Introductory** rev / **Preliminary** phase; releasing the ECO
  assigns rev **A**.
  [PC User Guide 9.3.4 Ch.2 Items](https://docs.oracle.com/cd/E60149_28/otn/pdf/user/html_agaad/output/chapter_2.htm)
- **Oracle Fusion** — a new item is **added as an affected object** and released
  through the change; lifecycle phases Design → Preproduction → Production → Obsolete.
  A separate **New Item Request (NIR)** workflow also exists.
  [Create a Change Order](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/faupd/create-a-change-order-and-submit-it-for-approval.html)
- **SAP** — a genuinely new material (no predecessor) can be created under a change
  number by entering it on **MM01**; the initial state is stamped with the change
  master's valid-from (future-dating allowed for series start).
  [MM01 change number](https://community.sap.com/t5/enterprise-resource-planning-q-a/mm01-change-number/qaq-p/7815278)
- **Arena** — **yes**: add the new item's working revision to the change and set
  `newLifecyclePhase`; on approval it transitions PRELIMINARY → DESIGN → PRODUCTION.
  [release item revision](https://raw.githubusercontent.com/ptc-arena/arena-restapi-doc/main/Arena%20REST%20API/Endpoints/Item%20Lifecycle%20Phase%20Change/endpoint_release_item_revision.md)
- **Duro** — new components start in **Design** (edits don't need a CO); promotion
  to Prototype/Production "**creates a change order and attaches all components**…
  must be approved before the part is released." So new parts are *born* outside
  change control but *released* through it.
  [Lifecycle Status](https://duro.zendesk.com/hc/en-us/articles/360029931491-Lifecycle-Status)
- **NetSuite / Odoo / Fishbowl** — **NO.** NetSuite ECO Add/Replace requires an
  *existing* item (create in item master first). Odoo: "A Product must be selected
  before Bill of Materials options is available" — the new part is created as a
  normal product record *outside* the ECO, then referenced. Fishbowl has no ECO.
  [NetSuite creating ECOs](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_1531291168.html),
  [Odoo forum (Ray Carnes)](https://www.odoo.com/forum/help-1/using-engineering-change-orders-when-does-odoo-rev-the-version-of-a-product-and-when-does-it-rev-the-version-of-a-bill-of-materials-253157)

**Consensus:** All the *PLM-grade* systems (Windchill, Teamcenter, Agile, Fusion,
Arena, Duro, and SAP via a change number) support a **brand-new part reviewed and
released as part of the change** — typically the new part is added to the "resulting/
solution/affected" set, starts in an unreleased lifecycle state (In Work / Working /
Preliminary / Introductory / Design), and the change's completion promotes it to
Released/Production. This validates adding a net-new "New Part" disposition in Carbon.

**Divergence:** The mid-market ERPs (NetSuite, Odoo, Fishbowl) **cannot mint a new
part inside the ECO** — the part must pre-exist and is merely referenced. So a
new-part-that-a-parent-consumes is inherently a two-step, ordering-dependent flow
there. Carbon's ability to mint a placeholder/new item *inside* the CO puts it in
the PLM-grade camp, not the mid-market camp.

---

## Q3. BOM redlines / restructuring — add/remove/replace lines, and the N→1 consolidation

**Unanimous: a consolidation ("3 parts become 1") is modeled as a change to the
PARENT assembly's BOM (remove 3 child lines, add 1 child line), NOT as part-level
supersessions.** Every system with a BOM diff renders it as line-level add/remove/
change on the parent.

- **Windchill** — explicit **BOM Redline** (Structure Redlining): a redline
  structure browser with a **Change Indicator** column; add / remove / **Replace** /
  quantity-change of part-usage links, with **Revert**. Merges into the parent's next
  revision on completion. 3→1 = redline the **parent** (remove 3 usages, add 1).
  [Redline Process](https://support.ptc.com/help/windchill/plus/r12.0.2.0/en/Windchill_Help_Center/ChgMgmtRedlineProcess.html)
- **Teamcenter** — **BOM markup/redlining** (old rev red strikeout, new rev green);
  restructure via the **Supersedure** environment's **Adds folder** / **Cancels
  folder** on the parent. 3→1 = cancel three child occurrences + add one, on the
  parent — multiple Solution Items against the single Impacted (parent) Item.
  [Design BOM tracking](https://blogs.sw.siemens.com/teamcenter/design-bom-tracking-use-active-change/)
- **Agile PLM** — **Redline BOM** on the ECO's affected item: **Add / Remove / Undo
  Redlines** (no single-row Replace — a swap is remove-old + add-new). 3→1 = on the
  **parent's** Redline BOM, remove 3 rows and add 1. (All redlines render red in
  9.3.x — no green-for-add.)
  [Ch.5 Bills of Material](https://docs.oracle.com/cd/E50306_29/otn/pdf/user/html_agaad/output/chapter_5.htm)
- **Oracle Fusion** — structure redlines on the parent's Structure tab: **ADD**
  (green), **DELETE** (red), **CHANGE/qty** (yellow); plus a first-class **Replace a
  Component** action (original shown in a **Replaces** column). 3→1 = one redline set
  on the parent (3 DELETE + 1 ADD).
  [24D What's New](https://docs.oracle.com/en/cloud/saas/readiness/scm/24d/plm24d/24D-plm-wn-f34326.htm),
  [Replace a Component](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25d/faupd/replace-a-component.html)
- **SAP** — BOM change under a change number (CS02): removing a component sets an
  **item deletion indicator** at the valid-from (row persists in STPO for history);
  add the new component with the same valid-from. 3→1 = **one change header on the
  parent material's BOM** (3 deletions + 1 addition, same valid-from).
  [BOM item deletion indicator](https://community.sap.com/t5/enterprise-resource-planning-q-a/how-to-use-deletion-indicator-of-bom-item/qaq-p/8642915)
- **Arena** — line-level Create / Update / Delete BOM Line on the parent's working
  rev; on approval "its release automatically incorporates all BOM redlines." 3→1 =
  parent BOM change (delete 3, add 1) + add the new part as its own affected item.
  [Manufacturing ECO guide](https://www.arenasolutions.com/resources/articles/guide-manufacturing-engineering-change-orders/)
- **Duro** — **Compare Revisions** (green = new, red = old): "components added to
  production, components removed from production, alterations to the BOM assembly."
  3→1 = edit the **parent's Assembly** tab (add new child / remove old).
  [Compare Revisions](https://duro.zendesk.com/hc/en-us/articles/360050079871-Compare-Revisions)
- **OpenBOM** — **BOM Compare** (added / removed components, qty/property diffs).
  3→1 = edit the **parent** in Latest State (remove 3, add 1).
  [BOM Compare](https://help.openbom.com/my-openbom/bom-compare/)
- **NetSuite** — ECO change lines on the **Product Changes** subtab, each an
  **Action = Add / Remove / Replace** against a named Assembly Item + BOM + Revision.
  [NetSuite creating ECOs](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_1531291168.html)
- **Odoo** — **BoM Changes** tab is a color-coded diff: **blue = added, black =
  shared/updated, red = removed** components. 3→1 = three red lines + one blue line
  on the **parent BoM**, in one ECO. Not part-level supersession.
  [Odoo ECO](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/plm/manage_changes/engineering_change_orders.html)
- **Fishbowl** — direct BOM edit, no diff/redline. Add/remove lines and save.
  [Fishbowl BOM](https://www.fishbowlinventory.com/manufacturing/bill-of-materials)

**Consensus:** N→1 consolidation is **always a parent-BOM restructure** (add/remove
component lines on the parent), never modeled as N part-level supersessions. Diff
UIs are near-universal (green/red add/remove) and are the natural place to surface
it. Windchill / Fusion / SAP / NetSuite additionally offer a **single-line Replace**
primitive; Agile / Arena / Odoo / Duro / OpenBOM express a swap as remove-old +
add-new (no dedicated Replace primitive).

**Divergence:** only whether "Replace one component" is a first-class BOM operation
(Windchill/Fusion/SAP/NetSuite) or expressed as delete+add (the rest). Either way,
consolidation lives on the parent's BOM, not on a part-to-part relationship.

---

## Q4. Replace vs. supersession — GLOBAL (everywhere) vs LOCAL (one BOM)

**Two distinct scopes exist and are named differently. The clean split: a
LOCAL swap changes one parent's component reference; a GLOBAL supersession/where-used
replace changes the successor everywhere the predecessor is used.**

- **Windchill** —
  - LOCAL: **Replace** action swaps a single part usage in one structure; **Substitutes**
    are also local ("a substitute can replace the part only in a specific part structure").
  - GLOBAL: **Mass Change Operations** under a Change Notice — **Replace Existing Part**
    replaces a part across all where-used BOMs matching the **Current Part Number**
    ("10's, 100's, or even 1000's of BOMs").
  - Interchangeability: **Alternates** = global ("applies globally, to all assemblies
    that use the part"); **Substitutes** = local. **Supersede / Superseded By** = a
    global successor/obsolescence link (1:1, 1:many, many:1), typically driving the old
    part to **Obsolete**.
  [Mass Change Replace](https://support.ptc.com/help/windchill/r12.1.2.0/en//Windchill_Help_Center/changemanagement/ChgMgmtMassChangeReplace.html),
  [Superseding Parts](https://support.ptc.com/help/windchill/r12.1.2.0/en/Windchill_Help_Center/parts/PMPartSupersedeOview.html)
- **Teamcenter** —
  - LOCAL: **Replace** one occurrence in one assembly (absolute-occurrence edit).
  - GLOBAL: **mass update / mass-replace** "across multiple impacted assemblies at once,"
    driven off where-used (2312 adds single-action mass-replace across all impacted BOMs).
  - Interchangeability: occurrence-level **Substitutes** (local) vs item-level **Global
    Alternates** (interchangeable "regardless of where used"). **Supersedure** (Adds/Cancels
    relation) documents part-number/qty changes; **Transfer Supersedure** for a component
    moving between assemblies.
  [What's new 2312](https://blogs.sw.siemens.com/teamcenter/whats-new-in-teamcenter-2312/),
  [Alternates vs substitutes](https://teamcenter-open-gate.blogspot.com/2016/11/teamcenter-unified-architecture-manage.html)
- **Agile PLM** — default is **per-parent, local** redlines. The closest to global is
  the **BOM Bulk Change wizard** (ECO-only): "Add an item to multiple assemblies,"
  "Replace an item in **all/some assemblies** that use the item, and automatically
  redline the BOM." But there is **no global successor object** — the wizard fans out
  a per-parent redline (each parent gets its own new rev). Candidates come from **Where
  Used**.
  [Ch.8 Affected Items](https://docs.oracle.com/cd/E50306_29/otn/pdf/user/html_agaad/output/chapter_8.htm)
- **Oracle Fusion** — **Replace a Component** is deliberately **single-structure**
  ("a single component replacement action, not a global mass-change"). There is **no
  native cross-BOM where-used replace** ECO primitive (Cloud Customer Connect threads
  confirm the gap); item-level **Mass Changes** are attribute-only.
  [Replace a Component](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25d/faupd/replace-a-component.html),
  [community: mass replace gap](https://community.oracle.com/customerconnect/discussion/565406/mass-update-or-replacement-of-component-on-bill-of-material)
- **SAP** —
  - LOCAL: delete/expire old + add new in CS02 under a change number (one BOM).
  - GLOBAL: **CS20 "Mass Change: BOMs"** replaces a component across all where-used
    BOMs in one run (also CEWB / Fiori "Replace material"). Driven off where-used (CS15).
    SAP has **no formal "supersession" object** for BOM structure — the native concept
    is CS20 mass change + where-used.
  [CS20 mass change](https://community.sap.com/t5/enterprise-resource-planning-q-a/how-to-change-bom-components-in-mass/qaq-p/10006909)
- **Arena** — **no global supersede relationship**; replacement is a **local per-BOM
  edit** (delete A, add B on each parent). Where-Used scoping *notifies* you of other
  assemblies and offers to pull them onto the ECO, but each is still a local edit.
  [Where used in BOMs](https://www.arenasolutions.com/blog/where-used-in-boms-arena-excel/)
- **Duro** — supersession = **Effectivity** date ranges (old CPN+rev → new CPN/rev).
  Physical BOM changes are **local** per-assembly edits; **no one-click replace-in-all-
  where-used**.
  [Effectivity](https://duro.zendesk.com/hc/en-us/articles/10159748251924-Effectivity)
- **OpenBOM** — **Alternates** (item-level = "replacement in all situations" → global
  data) vs **Substitutes** (BOM-line level = "for a specific bill of material" → local
  data). These are *acceptable-replacement definitions*, **not** automated supersession.
  [Alternates & substitutes](https://www.openbom.com/blog/how-to-model-alternate-and-substitute-bom-components-in-openbom)
- **NetSuite / Odoo / Fishbowl** — **LOCAL only.** NetSuite Replace is per-assembly/
  per-BOM/per-revision (no global switch, no where-used mass-replace). Odoo scopes each
  ECO to one BoM. Fishbowl has neither.
  [NetSuite Component Where Used](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1511882961.html)

**Consensus on terminology:** the LOCAL scope is called **"Replace (component)"** or
a **Substitute**; the GLOBAL scope is a **where-used / mass replace** and/or a
**Supersede / Supersedure** relationship (and **Alternates** for global
interchangeability). The two are genuinely distinct concepts everywhere.

**Divergence:** only the *high-end* PLM/ERPs (Windchill, Teamcenter, SAP) ship a true
**global where-used mass replace**. Agile fakes it with a wizard that fans out
per-parent redlines. **Fusion, Arena, Duro, OpenBOM, NetSuite, Odoo, Fishbowl have no
one-click global replace** — replacement is per-BOM. Where a global part-to-part
successor relationship exists, it's called **Supersede/Supersedure** (Windchill,
Teamcenter) or **Effectivity** (Duro); SAP has no supersession object, only mass
change; OpenBOM's "Alternates" is interchangeability data, not a supersession event.

---

## Q5. Effectivity & where-used impact

**Where-used is the universal impact tool; effectivity (usually date-based) sequences
when a change takes effect. "Obsolete only if now unused" is nowhere automatic — it's
a manual, where-used-guided decision.**

- **Windchill** — impact via **Affected End Items** + where-used/Mass Change
  enumeration. Effectivity types **Date / Lot / Block / Unit(Serial)**, set as
  *pending* effectivities on the Change Notice and copied to *actual* on approval.
  [About Effectivity](https://support.ptc.com/help/windchill/plus/r12.0.2.0/en/Windchill_Help_Center/ChgMgmtEffectivityAbout.html)
- **Teamcenter** — **Where Used** report (vs Where Referenced for datasets); change
  impact analysis viewable per problem item. Effectivity object supports **Date** and
  **Unit-number (serial/lot)** cut-in/cut-out; **Incremental Change (IC)** collects
  add/cancel structure changes. States **Obsolete** / **Released_Superseded**.
  [Occurrence effectivity](https://tcplmbasics.com/2018/03/14/teamcenter-occurrence-effectivity/)
- **Agile PLM** — **Where Used** tab auto-lists all consuming assemblies. Effectivity
  is **date-based only** (Effective Date / Obsolete Date, site-specific); serial/unit
  effectivity lives in the separate EBS product. Obsolescence via **Inactive** /
  **Obsolete** phases.
  [Ch.2 Items](https://docs.oracle.com/cd/E60149_28/otn/pdf/user/html_agaad/output/chapter_2.htm)
- **Oracle Fusion** — **Where-used** is first-class (uses a reference date; excludes
  future-effective parents; can view obsoleted components); related **Impact Analysis**
  checks on-hand/POs/work orders. Date effectivity with **Start/End Date**; on Replace,
  the original's end date becomes the replacement's start date; **Use-Up Date** from
  Supply Planning. **Obsolete** is a manual lifecycle transition — **no auto
  obsolete-if-unused**.
  [Effective Date and Revision](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26a/faupd/effective-date-and-revision-for-affected-objects.html)
- **SAP** — where-used via **CS15** (single/multi-level) / **CS15M** (many materials).
  Effectivity by change-number **valid-from date**, or **parameter effectivity**
  (DATE / SERNR serial / MATNR). Obsolescence = **deletion indicator**; physical
  removal only via archiving (SARA / PP_BOM).
  [parameter effectivity](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/engineering-change-management-parameter-effectivity/ba-p/13419368)
- **Arena** — **Where Used** lists all assemblies including the part. Three change
  effectivity types (on-approval / on-date / temporary) + per-item material effectivity
  datetime. **No auto obsolete-if-unused** — Where-Used is the manual guard.
  [Where used in BOMs](https://www.arenasolutions.com/blog/where-used-in-boms-arena-excel/)
- **Duro** — dedicated **Where Used Tool / Table** (every occurrence + direct parent,
  rolled-up qty). **Has Effectivity** (start/end dates on the CO). A single Obsolete
  child **invalidates** the whole assembly (surfaces a validation error up the tree) —
  flags, doesn't auto-clean.
  [Where Used Tool](https://duro.zendesk.com/hc/en-us/articles/10034398880276-Where-Used-Tool)
- **OpenBOM** — **Where Used** (graph nav) "shows every BOM affected when a part needs
  to be replaced." Effectivity via user-defined properties/configurations (not enforced
  date-effective lines). No auto obsolete-if-unused.
  [Where Used graph](https://help.openbom.com/get-started/where-used-graph-navigation/)
- **NetSuite** — **Component Where Used Inquiry** (multi-level, qty per assembly,
  effective/obsolete dates). Two effectivity models: **Revision Control BOM** (rev
  effective start/end) and **Effective Date BOM** (per-component dates). No auto-obsolete.
  [Component Where Used](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1511882961.html)
- **Odoo** — **date-based** effectivity per ECO ("As soon as possible" / "At Date");
  a BoM's ECO smart button lists done ECOs. **No where-used view** (ECO scope is
  per-BoM). Obsoleting = **archiving** (not delete).
  [Version control](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/plm/manage_changes/version_control.html)
- **Fishbowl** — **no effectivity dates, no native where-used**; obsolete = uncheck the
  **Active** flag.
  [Fishbowl BOM CSV spec](https://fishbowlhelp.com/files/csv/exportBOM.html)

**Consensus:** Where-used is the standard way to surface broader impact before a "local"
change; date effectivity is the baseline sequencing mechanism (higher-end systems add
serial/unit/lot/parameter). **No system auto-obsoletes a removed part "only if now
unused"** — it is always a manual decision informed by where-used (Duro even blocks the
parent if any child is Obsolete). This means Carbon should treat "obsolete the removed
part" as an explicit, where-used-guided user action, not an automatic side effect of a
consolidation.

---

## Q6. Release ordering — new part must exist/release before the parent references it

**Every system's practical answer is the same: put the new part and the parent
restructure on the SAME change so they release together at one effectivity. Hard
dependency validation ("child released before parent") ranges from enforced (Duro,
SAP existence check) to workflow/rule-driven (Windchill, Teamcenter) to absent (Agile,
Arena, OpenBOM, NetSuite, Odoo).**

- **SAP** — a **hard existence constraint**: a component **must exist and be extended
  to the plant** before it can go on a BOM (CS01/CS02 error "Material not maintained in
  plant"), so MM01 the new material first. Beyond existence, no separate "release child
  then parent" gate — both carry the same change-number valid-from and go effective
  together.
  [material must exist in plant](https://community.sap.com/t5/enterprise-resource-planning-q-a/error-material-doesn-t-exist-in-plant/qaq-p/2803881)
- **Duro** — an **enforced validated rule**: "for a parent assembly to be at
  Prototype/Production, all child components must be at the same status level or
  higher," checked via a **Validate** button (blocking errors vs warnings). New child +
  parent are rolled into one atomic CO and validated together.
  [Lifecycle Validations](https://duro.zendesk.com/hc/en-us/articles/360044348651-Lifecycle-Validations-and-Updates)
- **Windchill** — new child + revised parent are both **Resulting Objects** released
  atomically ("sets all Resulting Objects to Released"); dependency ordering is
  delivered via configurable **Business Rules** ("validate that the children… are at an
  appropriate state to release the parent"). No single hard built-in child-before-parent
  lock beyond atomic release + rules.
  [Business Rules](https://support.ptc.com/help/windchill/cloud/r12.0.2.0/en/Windchill_Help_Center/BusRules.html)
- **Teamcenter** — workflow/EPM handlers (`EPM-attach-assembly-components`) release an
  assembly with its components, but only *skip* components already in-workflow — correct
  child-first ordering is a **workflow-design responsibility**, not an OOTB guarantee.
  [Workflow handlers](https://globalplm.com/teamcenter-workflow-handlers/)
- **Agile / Arena** — release all affected items on **one change simultaneously**;
  neither documents an explicit child-before-parent validation. Ordering is achieved by
  bundling child + parent onto one ECO. (Arena tracks cross-ECO pending work via
  `futurechanges`.)
  [Agile Ch.8](https://docs.oracle.com/cd/E50306_29/otn/pdf/user/html_agaad/output/chapter_8.htm)
- **Oracle Fusion** — status pipeline **Open → Approval → Scheduled → Completed**; a
  future-effective rev from a Scheduled change can be selected as a source on a later
  change. No explicit child-before-parent rule documented; bundling + effective dates
  drive ordering.
  [Change Order Statuses](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/24a/faipr/understand-change-order-statuses.html)
- **OpenBOM** — **flat/batch**: "once all CRs are approved, a revision for all items is
  created" — all affected items revise together, no enforced child-before-parent order.
  [Change management](https://www.openbom.com/blog/change-management-in-openbom-revision-change-request-and-change-orders)
- **NetSuite / Odoo** — **no dependency sequencer**; ordering is governed by **date
  effectivity** (NetSuite) and by the part existing first + per-ECO Effective Date
  (Odoo, since each ECO targets one BoM — new-part-plus-parent is inherently two ECOs).
  [NetSuite implementing ECOs](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_1531291499.html)

**Consensus:** The universal pattern is **one change, atomic release, single
effectivity** — the new part and the parent that consumes it ride the same CO and go
live together. This is exactly what a good "new part + parent consolidation on one CO"
flow should do.

**Divergence:** enforcement strength — **Duro strictly validates** parent-status ≤
child-status; **SAP enforces existence-in-plant**; **Windchill/Teamcenter rely on
configurable rules/workflow**; **Agile/Arena/Fusion/OpenBOM/NetSuite/Odoo enforce
nothing beyond bundling + effectivity**. A minimal-but-correct Carbon rule is: within
one CO, if a new part is consumed by a restructured parent, release the new part's
draft *before* activating the parent's method (or activate both atomically).

---

## Implications for Carbon

Carbon today (`changeOrderChangeTypes = Version | Revision | New Part`) uses **"New
Part"** to mean a *new P/N that supersedes the affected part 1:1* — which industry
practice would call a **replacement/supersession**, not a net-new part. That naming
should change. The three proposed model choices are each well-supported:

**(a) Rename the 1:1-supersession change type from "New Part" → "Replacement Part".**
STRONGLY SUPPORTED. Across the industry, "new part with a predecessor that it takes
over from" is universally a **replace / supersede / supersession**, never "new part":
Windchill/Teamcenter **Supersede/Supersedure**, Fusion/NetSuite **Replace a
Component**, Duro **Effectivity supersession**, Agile redline-into-consuming-BOMs. The
word **"New Part"** everywhere means a part with **no predecessor** (Q2) — so Carbon's
current usage is actively misleading. **"Replacement Part"** is a clear, industry-legible
name for the 1:1 predecessor→successor semantics Carbon already implements
(affectedPart → newPart `itemSupersession` at release). (If a shorter label is wanted,
**"Replacement"** or **"Supersession"** are the other industry-standard options;
"Replacement Part" reads best as a per-item disposition.)

**(b) Add a net-new "New Part" (no predecessor) released with the CO.** SUPPORTED and
squarely in the PLM-grade camp. Windchill (Resulting Object = New), Teamcenter (Solution
Item), Agile (Introductory→A on ECO release), Fusion (affected object / NIR), Arena
(PRELIMINARY→PRODUCTION on approval), Duro (promotion creates the CO), and SAP (MM01
under a change number) all let a **predecessor-less** part be reviewed and released
through the change — the part is born in an unreleased lifecycle state and the CO's
completion promotes it. This is *distinct* from the renamed "Replacement Part" precisely
by having **no supersession** written at release (it just reveals/activates the new item,
like Carbon's Revision/New-Part release path minus the `itemSupersession` write). The
mid-market ERPs (NetSuite/Odoo/Fishbowl) can't do this at all, so shipping it puts Carbon
ahead of that tier. Recommended lifecycle: mint the item inactive (Carbon already does
this via `mintPlaceholderPart` / `copyItem`), reveal + activate at release, but write
**no** `itemSupersession`.

**(c) Model N→1 consolidation as a parent-assembly BOM change, not a supersession.**
STRONGLY SUPPORTED — this is unanimous across all 11 systems (Q3). "3 parts become 1" is
always a **restructure of the PARENT's BOM** (remove 3 component lines, add 1), surfaced
in a green/red add-remove **BOM diff**, and released with the parent's new
method/revision. It is **never** modeled as N part-to-part supersessions. Concretely for
Carbon: the consolidation is authored on the **parent** affected item's draft
`makeMethod` (remove the 3 `methodMaterial` rows, add the 1 new component) — which
Carbon's existing per-affected-item draft-method + `diffMethod` engine already
represents. The new consolidated component, if net-new, is a separate **"New Part"**
affected item on the **same CO** (Q6: one CO, atomic release). Do **not** auto-create
supersessions for the 3 removed parts; removal from a BOM ≠ obsolescence. If the removed
parts should be retired, that is a **separate, explicit, where-used-guided** decision
(Q5: no system auto-obsoletes-if-unused) — Carbon's **Impact panel / where-used** is the
right place to surface "these removed parts are still used in N other assemblies" before
anyone obsoletes them.

**Cross-cutting terminology recommendation for the spec.** Adopt the industry-consensus
vocabulary Carbon is already partway to:
- **Revision** — same part number, new rev (matches everyone). Keep.
- **Version** — Carbon-specific (new make-method version, same item, no supersession);
  no industry analog, but harmless and internally clear. Keep.
- **Replacement Part** — new P/N that **supersedes** a predecessor 1:1 (the renamed type).
- **New Part** — new P/N with **no predecessor**, released with the CO (the new type).
- **Consolidation / BOM restructure** — a parent-BOM change (add/remove components),
  expressed through the parent affected item's diff, *not* a change type of its own.
- Reserve **Supersession** for the predecessor→successor *relationship* Carbon writes at
  release (`itemSupersession`), which "Replacement Part" produces and "New Part" does not.

### Consensus vs. divergence at a glance

| Question | Consensus | Divergence |
|---|---|---|
| Q1 disposition | revise-in-place (same #) vs replace (new #); before→after split | names for "replace"; Arena/OpenBOM have no renumber disposition |
| Q2 new part in ECO | PLM-grade systems release a predecessor-less part via the change | mid-market ERPs (NetSuite/Odoo/Fishbowl) can't mint a part in the ECO |
| Q3 N→1 consolidation | always a **parent-BOM** add/remove; green/red diff | only whether single-line "Replace" is a primitive |
| Q4 replace scope | LOCAL swap vs GLOBAL where-used/supersede are distinct concepts | true global mass-replace only in Windchill/Teamcenter/SAP |
| Q5 effectivity/where-used | where-used surfaces impact; date effectivity; **no auto obsolete-if-unused** | serial/unit/lot/parameter effectivity only in high-end systems |
| Q6 release ordering | one CO, atomic release, one effectivity | enforcement: Duro/SAP enforce, others rely on bundling |

---

## Sources (primary references)

- PTC Windchill Help — [Change Mgmt](https://support.ptc.com/help/wnc/r12.0.0.0/en/Windchill_Help_Center/ChgMgmtAbout.html), [Redline Process](https://support.ptc.com/help/windchill/plus/r12.0.2.0/en/Windchill_Help_Center/ChgMgmtRedlineProcess.html), [Mass Change Replace](https://support.ptc.com/help/windchill/r12.1.2.0/en//Windchill_Help_Center/changemanagement/ChgMgmtMassChangeReplace.html), [Superseding Parts](https://support.ptc.com/help/windchill/r12.1.2.0/en/Windchill_Help_Center/parts/PMPartSupersedeOview.html)
- Siemens Teamcenter — [Supersedure](https://tcplmbasics.com/2018/06/07/supersedure-in-teamcenter/), [Design BOM tracking / Active Change](https://blogs.sw.siemens.com/teamcenter/design-bom-tracking-use-active-change/), [What's new 2312](https://blogs.sw.siemens.com/teamcenter/whats-new-in-teamcenter-2312/)
- Oracle Agile PLM 9.3.x — [Ch.7 Changes](https://docs.oracle.com/cd/E50306_29/otn/pdf/user/html_agaad/output/chapter_7.htm), [Ch.8 Affected Items](https://docs.oracle.com/cd/E50306_29/otn/pdf/user/html_agaad/output/chapter_8.htm), [Ch.5 BOM](https://docs.oracle.com/cd/E50306_29/otn/pdf/user/html_agaad/output/chapter_5.htm), [Ch.2 Items](https://docs.oracle.com/cd/E60149_28/otn/pdf/user/html_agaad/output/chapter_2.htm)
- Oracle Fusion Cloud PLM — [Change Types](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26a/faipr/understand-change-types.html), [Replace a Component](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25d/faupd/replace-a-component.html), [Effective Date & Revision](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26a/faupd/effective-date-and-revision-for-affected-objects.html)
- SAP LO-ECH — [ECM overview](https://help.sap.com/doc/saphelp_me151/15.1.3VERSIONFORSAPME/en-US/da/6cb953495bb44ce10000000a174cb4/content.htm?no_cache=true), [ECR/ECO](https://help.sap.com/doc/saphelp_me151/15.1.3VERSIONFORSAPME/en-US/75/25bd534f22b44ce10000000a174cb4/content.htm?no_cache=true), [CS20 mass change](https://community.sap.com/t5/enterprise-resource-planning-q-a/how-to-change-bom-components-in-mass/qaq-p/10006909)
- Arena PLM — [ECN article](https://www.arenasolutions.com/resources/articles/engineering-change-notice/), [REST API create change](https://raw.githubusercontent.com/ptc-arena/arena-restapi-doc/main/Arena%20REST%20API/Endpoints/Change/endpoint_create_change.md), [Where used in BOMs](https://www.arenasolutions.com/blog/where-used-in-boms-arena-excel/)
- Duro — [Change Orders](https://duro.zendesk.com/hc/en-us/articles/360029600032-Change-Orders), [Effectivity](https://duro.zendesk.com/hc/en-us/articles/10159748251924-Effectivity), [Lifecycle Validations](https://duro.zendesk.com/hc/en-us/articles/360044348651-Lifecycle-Validations-and-Updates), [Compare Revisions](https://duro.zendesk.com/hc/en-us/articles/360050079871-Compare-Revisions)
- OpenBOM — [Change management](https://www.openbom.com/blog/change-management-in-openbom-revision-change-request-and-change-orders), [Alternates & substitutes](https://www.openbom.com/blog/how-to-model-alternate-and-substitute-bom-components-in-openbom), [BOM Compare](https://help.openbom.com/my-openbom/bom-compare/)
- NetSuite — [ECO](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_1531288763.html), [Creating ECOs](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_1531291168.html), [Component Where Used](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1511882961.html)
- Odoo — [Engineering Change Orders](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/plm/manage_changes/engineering_change_orders.html), [Version control](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/plm/manage_changes/version_control.html)
- Fishbowl — [Bill of Materials](https://www.fishbowlinventory.com/manufacturing/bill-of-materials), [BOM CSV spec](https://fishbowlhelp.com/files/csv/exportBOM.html)

*Sourcing caveats carried from research: Duro/Fishbowl help portals block automated
fetch (claims grounded in official articles surfaced via search); a few Teamcenter
effectivity/field names are corroborated via partner/community sources; Agile PLM PC is
date-effectivity-only (serial/unit effectivity is the separate EBS product); "disposition"
in Windchill/Agile/Arena means inventory handling, not part identity.*
