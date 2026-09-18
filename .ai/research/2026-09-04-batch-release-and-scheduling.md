# Batch Release & Batch Scheduling — Confirmatory Research

Date: 2026-09-04
Purpose: Ground the Carbon job-operation-batching design against how leading
ERP/MES/APS systems model (1) releasing a batched set of operations
independently of the parent order, and (2) simultaneous vs sequential batch
processing in scheduling.

**Bottom line: every one of the four decided design choices has clear industry
precedent. Nothing contradicts them.** Terminology to adopt is noted inline.

---

## Topic 1 — Independent release of a batched/grouped set of operations

### SAP process orders (PP-PI): release is multi-level, phase is the unit

An operation in a master recipe is subdivided into **phases** — "an independent
subdivision of an operation" and the *main planning object* of the recipe. SAP
determines dates, **capacity requirements, and process costs at the phase
level**, not the order header.

Crucially, **release is granular**: you can release a process order at header,
operation, OR phase level.

- Release at header → all operations and phases release.
- Release at operation → all its phases release.
- **Release a phase individually** → only that phase becomes executable, and its
  control recipe/process instructions go to the floor (PI sheet).

So SAP already treats "make this sub-unit of work executable" as a **gate
separate from the order being released as a whole**. A phase that has not been
released does not produce a live control recipe on the floor. This is direct
precedent for **choice (a): batch release as a floor-visibility gate separate
from order release**, and for **choice (b): the executable sub-unit is governed
by its own release state, not solely the order's.**

### MES / APS: campaigns pool operations across orders and dispatch as a unit

APS tools (Siemens Opcenter APS, formerly Preactor) model **campaigning** — an
optimization/sequencing rule that pools like operations (same setup family,
same resource) drawn from **multiple orders** into one run to minimize
changeovers. The campaign is scheduled and dispatched to the resource **as a
single block**; the member operations are "spoken for" by it. The order each
member belongs to still carries its own order-level release/status — the
campaign is a *second*, cross-order dispatch object layered on top. This is the
"batch spans multiple orders and is dispatched as a unit" pattern the design
assumes.

### The "spoken for, not loose" pattern — how double-dispatch is avoided

The general mechanism across these systems: once an operation is assigned into a
campaign/batch (or a phase into a control recipe), it **stops appearing as a
loose, independently dispatchable operation** — the batch object owns it. The
floor sees the *batch* as the dispatchable unit, and the member is reachable
only through it until the batch is released. That is exactly Carbon's intended
model: **an op in a batch does not surface on the floor as a free operation; the
batch's release state governs its visibility (choice b).** Double-dispatch is
prevented structurally by there being one owner of the op (the batch), not by a
lock or a race check.

> Note where systems differ: SAP's phase release is *hierarchical* (a
> sub-division of ONE order's operation), whereas an APS campaign is *lateral*
> (pools ops from MANY orders). Carbon's batch is the lateral kind, but borrows
> SAP's "release is its own gate" semantics. No system releases a pooled
> campaign automatically when a member order releases — the campaign/batch has
> its own release, which confirms (a) and (b).

---

## Topic 2 — Simultaneous vs sequential batch processing

### The standard terminology: **p-batch vs s-batch** (parallel vs serial batch)

This is the textbook term of art in the scheduling literature and the cleanest
name for **choice (c) — the distinction is a property of the process/resource**:

| Regime | Term | Members processed | Batch duration |
|---|---|---|---|
| **Simultaneous** (furnace, oven, heat-treat, plating) | **parallel batch / p-batch** — a "batch processing machine" (BPM) | all at once, same completion time | ≈ fixed cycle time, independent of load size up to capacity. In pure theory, the **max** of member times; in practice a fixed cycle (preheat + soak) driven by the largest/heaviest member, not the count |
| **Sequential** (saw, laser table, cutting) | **serial batch / s-batch** | one after another | shared setup **+ the SUM of member run times** |

Both are described explicitly as machine **properties**: "a p-batching machine
allows several jobs to be processed simultaneously… all jobs have the same
completion time"; "on an s-batching machine, the processing time of a batch is
the sum of the processing times of all jobs." The regime lives on the resource,
not on the item or the routing step — matching the design's decision to put a
capability/regime flag on the process/resource.

Heat-treat is the canonical p-batch example in the literature ("very long
processes such as diffusion in semiconductor manufacturing or heat treatments in
metal fabrication are executed on BPMs"). Real furnace models make the cycle a
function of cumulative weight (preheat) and max part size (soak) rather than of
member count — useful nuance if Carbon later refines the fixed-cycle assumption,
but the fixed-cycle-up-to-capacity model is the standard first-order
approximation.

### How capacity is reserved

- **p-batch**: ONE capacity block on the resource for the whole batch's cycle
  time, sized by capacity (weight/volume/count) not by summed time. Members load
  in parallel and share the single block.
- **s-batch**: ONE block spanning setup + summed run time; members occupy it
  serially.

In both regimes the resource is reserved as **a single contiguous block for the
whole batch**, which is what the design intends (one schedule block, not N
overlapping operation reservations).

### How cost/time is attributed back to each order/member

SAP's **joint production / co-products** settlement is the closest ERP analogue
to splitting one shared run across members. Cost is apportioned by
**equivalence numbers** — proportional weights (e.g. 30:30:20:20). The default
and simplest equivalence basis is **output quantity**, i.e. split the shared
process cost **proportionally to each member's quantity**. That is precisely
**choice (d) — proportional-to-member-quantity cost split** — and it is the
mainstream ERP practice, not an invention. (SAP allows arbitrary equivalence
weights as an override; Carbon's proportional-by-quantity default is the
industry default, with room for the same override later if ever needed.)

Time attribution follows the same logic:
- p-batch: the cycle time is shared; each member is "charged" a proportional
  slice (by quantity/weight) of the single cycle — you do NOT multiply the cycle
  by member count.
- s-batch: each member is charged its own run time; only the shared **setup** is
  split proportionally.

---

## Contradiction check against the four decided choices

| Design choice | Verdict | Precedent |
|---|---|---|
| (a) Batch release is a floor-visibility gate separate from order release | **Confirmed** | SAP phase-level release; APS campaign dispatch is its own object |
| (b) An op in a batch is governed by the batch's release state, not the order's | **Confirmed** | Phase/control-recipe gate; campaign "owns" pooled ops so they aren't loose |
| (c) Simultaneous/sequential is a property of the process/resource | **Confirmed** | p-batch vs s-batch is a *machine* property in the scheduling literature |
| (d) Cost split proportional to member quantity | **Confirmed** | SAP co-product equivalence numbers; quantity is the standard basis |

**No contradictions found.** The only refinements worth noting (not blockers):
p-batch duration in the literature is technically max(member times) / a
weight-and-size-driven cycle rather than a flat constant; and SAP permits
non-quantity equivalence weights as an override on the proportional default.
Both are *supersets* of the decided design, not conflicts.

---

## Sources

- [Releasing Process Orders — SAP Learning](https://learning.sap.com/courses/implementing-sap-s-4hana-cloud-public-edition-manufacturing/releasing-process-orders) (header/operation/phase release levels)
- [PP-PI Phase — SAP Community](https://community.sap.com/t5/enterprise-resource-planning-q-a/pp-pi-phase/qaq-p/6779389) (phase = independent subdivision, planning object)
- [Siemens Opcenter (Preactor) APS](https://www.plm.automation.siemens.com/global/en/products/manufacturing-operations-center/preactor-aps.html) and [ATS Preactor Advanced Scheduling](https://lean-scheduling.com/products/preactor-advanced-planning-scheduling/preactor-advanced-scheduling/) (campaigning / changeover minimization across orders)
- [A survey of scheduling with parallel batch (p-batch) processing — ScienceDirect](https://www.sciencedirect.com/science/article/pii/S037722172100518X) (p-batch definition; heat-treat as canonical BPM)
- [Scheduling parallel serial-batch processing machines — IJPR](https://www.tandfonline.com/doi/full/10.1080/00207543.2021.1951446) and [Mixed batch scheduling — Journal of Scheduling](https://link.springer.com/article/10.1007/s10951-019-00623-9) (s-batch = sum of member times; furnace preheat/soak cost model)
- [Joint Production in Product Costing — SAP Community](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/joint-production-in-product-costing-in-sap-s-4hana-cloud-public-edition/ba-p/14277639) and [Equivalence number method — Wikipedia](https://en.wikipedia.org/wiki/Equivalence_number_method) (proportional cost apportionment by equivalence number / quantity)
