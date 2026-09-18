# Job Operation Batching Research: Best Practices Survey

Researched 2026-08-31, against the `feat/job-operation-batching-v2` implementation
(batch builder, `jobOperationBatch` entity, signature-based suggestions, MES batch
mode, completion slicing). Question: what would make Carbon's batching genuinely
competitive with Steelhead, and how should the builder and auto-suggestion evolve.

## Summary

Surveyed Steelhead (metal finishing MES — the named competitor), SAP S/4HANA
(order combination / campaign planning / batch management), and job-shop peers
Fulcrum, Epicor Kinetic, and Plex. Three headline findings. (1) Carbon's
architecture is already the industry-consensus shape — a wrapper batch entity
that preserves member-order identity, executes once, and distributes results
back at completion is exactly SAP's MILL_OC combined order and Fulcrum's work
order; Epicor's irreversible whole-routing batching is the cautionary tale we
already avoid. (2) The biggest gap is a **capacity model**: every competitor
that batches to a physical vessel (Plex mixers, Steelhead racks, Fulcrum
sheets) carries a per-workcenter capacity number, and Carbon's `workCenter` has
none. (3) **Nobody ships a configurable compatibility-rule engine** — every
product either hard-codes the keys (Fulcrum: material+thickness+machine) or
leaves it to operator discipline (Epicor) — so per-process hard/soft rule
configuration is an open differentiator, and **auto-suggestion beyond Fulcrum's
filtered due-date list is essentially unclaimed territory**.

## Competitors Surveyed

- **Steelhead Technologies** — MES/ERP purpose-built for plating, anodizing,
  powder coat, heat treat job shops; the direct competitor named in the request.
  Sourced largely from Wayback captures of their (now offline) docs site.
- **SAP S/4HANA (PP, PP-PI, PP/DS, Mill Products)** — the enterprise reference:
  order combination, production campaigns, setup matrices, block planning.
- **Fulcrum** — modern job-shop MES; the best-documented auto-suggestion flow
  (nest planning) and proportional cost allocation.
- **Epicor Kinetic (Advanced Production)** — deepest practitioner detail on job
  batching, including its failure modes.
- **Plex (Rockwell)** — the reference model for vessel capacity (batch size per
  workcenter).

## Key Consensus Patterns

### 1. A batch is a wrapper; members keep their identity

- **SAP**: MILL_OC creates a *combined production order* — a real order that
  executes once; actual costs and confirmations collect on it, then settle back
  to the original orders via a Quantity Distribution step at final confirmation.
  Goods receipt, inspection lots, and material batches stay on the originals.
- **Epicor**: batch job consolidates selected jobs' operations/materials into a
  new parent job with demand links back — but batching is irreversible, must
  span the routing to one end of the BOO, leaves orphaned closed jobs, and
  flow-back of completed quantities is config-fragile.
- **Fulcrum**: a "work order" groups like operations across jobs into one
  schedulable unit with one timer and one completion.
- **Rationale**: execution is shared; accountability (GR, certs, costing,
  traceability) is per member order. Carbon's operation-scoped membership +
  dissolve + per-member event slicing already matches the good half of this
  pattern and avoids Epicor's traps.

### 2. Capacity is a per-workcenter vessel number

- **Plex**: workcenters carry **Capacity** and **Minimum Batch Size**; given a
  scheduled quantity the system computes batch count and last-batch size per
  vessel (e.g. 1,750 lbs → 3×250 on a 300-lb mixer + 2×500 on a 500-lb mixer),
  with component quantities auto-scaled per batch.
- **Steelhead**: Rack Types carry `Default Parts Per Rack` (whole pieces only)
  plus **Rack Type Occupancy** (how many racks of a type fit a station) and a
  per-part **Station Occupancy %** ("a 747 wheel occupies 30% of a block").
  Notably NO weight/surface-area/amp-hour capacity was found anywhere public.
- **SAP**: capacity categories per work center; base UoM can be pieces/kg/area
  when quantity-limited; PP/DS bucket capacity in quantities; campaign profiles
  cap **max orders per campaign**.
- **Fulcrum**: sheet capacity delegated to external nesting software; Fulcrum
  verifies sheet sizes and tracks **remnants** back into stock.
- **Rationale**: batching without a fill limit is grouping, not load building.
  Piece-count capacity covers most cases (even Steelhead ships only that).

### 3. Compatibility is enforced by hard keys — but never configurable

- **Steelhead**: three enforcement layers — parts with non-identical recipes are
  auto-split onto separate work orders ("can't be run together"); at rack time,
  spec-field param **ranges must overlap** to share a rack (e.g. thickness
  min/max intersection); node-level gates block movement on missing specs or
  inapplicable treatments. Cross-customer mixing on one rack is explicitly
  supported.
- **Fulcrum**: nest candidates filtered by machine + material + thickness +
  due date — fixed system filters.
- **Epicor**: no validation at all; the engine even copies the FIRST selected
  job's time standards onto the whole batch, silently corrupting estimates.
- **SAP**: combinability checked per operation on work center, UoM, activity
  type, control key; planning-side grouping keyed on **setup group keys** and
  characteristics (block planning: steel grade, width, color).
- **Rationale**: hard rules prevent scrap (wrong parts in the tank); but every
  vendor hard-codes *which* keys. A per-process hard/soft/ignore configuration
  over BOM/BOP dimensions exists nowhere surveyed.

### 4. Auto-suggestion: a filtered, due-date-ranked candidate list

- **Fulcrum** (the only real suggester): nest planning "recommends work to nest
  together taking into account due dates," pulls candidates across all open
  orders for a machine+material, and suggests additional parts to add to a
  started nest. Geometric fit is delegated to external nesting software —
  Fulcrum decides *which parts*, the nester decides *how they fit*.
- **SAP PP/DS**: the optimizer sequences to minimize weighted setup time +
  setup cost + delay cost + storage cost, reading a **setup matrix** (state →
  state transition durations/costs, wildcard fallbacks); campaign optimization
  groups same-setup-group orders into campaign bars with profile-driven caps
  and auto-created setup/clean-out orders.
- **Steelhead**: advisory only — "see all upcoming paint colors so you can
  easily batch them"; humans compose loads, the system validates. Custom
  scheduling logic is an escape hatch (Power Scheduling, user TypeScript).
- **Epicor**: explicitly none.
- **Rationale**: the shipped state of the art is modest — hard-filter, rank by
  due date, let a human commit. SAP's weighted-objective machinery shows the
  scoring dimensions that matter: setup saved vs delay cost vs (for Carbon)
  capacity waste.

### 5. Time/cost fan-out: proportional beats even, and the basis matters

- **Fulcrum**: machine time and material allocated per part from the parsed
  nest sheet (actual area/time), setup allocated automatically; "all times are
  proportionally allocated back to the different jobs' costs."
- **SAP**: combined-order actuals settle back to originals; quantity
  distribution at final confirmation; campaign fixed costs (setup/clean-out)
  distributed across member orders.
- **Steelhead**: default even split by part count, then **human-adjustable** —
  drag tools to redistribute ("80/20"), per-segment % billed, step one work
  order out of a running multi-WO timer without stopping the rest.
- **Epicor** (the pain case): without batching, an operator clocked into 5 jobs
  allocates all 5 hours to *each*; with it, co-part apportionment by quantity —
  and forums show persistent dissatisfaction with the split basis and no
  settled answer for scrap allocation.
- **Rationale**: Carbon's completion slicing proportional to
  `operationQuantity` matches SAP/Fulcrum. Steelhead's manual redistribution is
  the flexibility ceiling to aim at later.

### 6. Batch-level quality feeds per-member certs — never one load cert

- **Steelhead**: measurements attach to Part Transfer Accounts; operators enter
  specs for a grouped panel once, fanned to member parts; certs are generated
  per customer order from the shared data ("Certify Multiple"). **Coupons** —
  test panels racked alongside production parts, spawning their own work
  orders — are the batch-level QA instrument.
- **SAP**: inspection lots are per *order* (origin 03 at release), never per
  machine run.
- **Rationale**: the run is where data is captured once; the order is where
  compliance lives. Matches Carbon's traceability model.

## Answers to Research Questions

1. **Steelhead's load model** — There is NO first-class Load entity. Carriers
   are **Racks** (typed, QR-coded, nestable into Sub/Super racks ≈ flight
   bars), the true grouping atom is the **Part Transfer Account** (identical-
   state part group), and capacity is whole `parts per rack` + racks-per-
   station occupancy + per-part station-occupancy %. Lifecycle: rack (scan) →
   move rack node-to-node → unrack; recipes freeze once running. Weight/area/
   amp-hour capacity: not found.
2. **Steelhead compatibility** — Enforced, not advisory: identical-recipe
   work-order splitting at order entry, spec-param range-overlap checks at
   racking, spec/treatment gates at each node. Emergent from recipe identity +
   treatments + spec params — not a configurable rule engine.
3. **Certs fan-out** — Inverse of "one load cert": shared measurements captured
   per group, certs generated per customer order/account; coupons ride racks
   for destructive/batch tests. (Heat-treat charge certs not publicly
   documented.)
4. **SAP order grouping** — Four mechanisms: **combined orders** (MILL_OC /
   S/4HANA Cloud 2602 scope item 7TO; per-operation combinability checks;
   execute on wrapper, GR + settle back to originals), **collective orders**
   (vertical BOM networks — different thing), **PP-PI campaigns** (same-product
   process orders sharing setup/clean-out, fixed costs distributed), and
   **PP/DS campaign optimization / block planning** (setup-group keys, setup
   matrices, campaign profiles with max-order caps).
5. **Capacity units** — Pieces (Steelhead racks, SAP campaign order caps),
   weight/volume per vessel (Plex mixers/blenders), sheet geometry delegated to
   nesters (Fulcrum), time as SAP's default with quantity UoMs available.
   Piece-count is the lowest common denominator every vendor supports.
6. **Auto-suggestion algorithms** — Fulcrum: hard-filter (machine + material +
   thickness) → due-date-ranked candidate list → human selects → external
   optimizer packs. SAP: weighted-objective optimizer over a setup transition
   matrix, campaign grouping by setup group. Nobody scores soft compatibility,
   learns from history, or looks ahead to soon-ready operations.

## Competitor-Specific Details

### Steelhead
- Vocabulary: Rack/Rack Type/Super Rack, Flight bar, Process Node, **Recipe**
  (frozen per-WO process instance), **Treatment/Treatment Group** (finish
  options at order entry), Job Tag (they deliberately renamed "Traveler"),
  Received Batch (incoming lot), PTA, Workboard, Coupon, Spec Field Param.
- Shop-floor UX: Workboards (racking/super-rack/scanner variants), scan job
  tag → rack → QR-coded rack moves whole groups one click at a time; "Group
  Like Parts" organizes by "whether they can be moved together"; scanner lines
  enforce per-tank scans, dwell timers, wrong-load alerts.
- Timers run against Part Accounts / Racks / Stations / Sales Orders
  simultaneously; even split on stop, editable timeline with % billed.
- Line overhead rates capture utilities; Super Nodes collapse auto-line steps
  into one costed station.
- Docs site is offline (June 2025 Wayback snapshot is the source ceiling).

### SAP
- Setup matrix rows are (predecessor state → successor state, duration, cost),
  charged to the successor; wildcard fallbacks avoid N×N matrices.
- Campaign profile (selected via setup group): max orders per campaign,
  auto-created setup/clean-out orders, board display.
- "Batch" in SAP = material lot only; batch determination (FEFO etc.) picks
  consumed lots, batch derivation copies attributes sender→receiver per ORDER
  even when execution was shared — the linkage follows the document chain, not
  the machine run.
- Open question SAP couldn't answer publicly: whether a MILL_OC combined order
  carries its own in-process inspection lot.

### Fulcrum
- Does NOT nest geometrically — exports DXFs to SigmaNest/TRUMPF/Amada, then
  re-parses the returned setup sheet into per-part material usage, per-part
  machine time, setup count, and setup membership. Remnants become stock.
- Grouping is also used for bending, powder coat, paint — not only cutting.

### Epicor (cautionary tale)
- Batching is irreversible, whole-routing-direction only, copies the first
  job's time standards, doesn't reschedule the batch job, leaves closed-job
  litter, and flow-back is config-dependent. Practitioners resort to an
  intermediate-part workaround (a "processed sheet" part) where the
  intermediate part IS the compatibility contract.

### Plex
- Batch = one job's operation split into vessel-sized cycles (inverse of
  cross-job batching); workcenter carries Capacity + Minimum Batch Size; split
  types (Even), last-batch size computed; component quantities scale per batch
  with tolerance bands; deliberate over-scheduling to fill a vessel, excess
  packed off as WIP.

## Grounding update (2026-08-31, post-merge of main)

Main shipped **finite-capacity scheduling** (#1151, merged into this branch),
which changes the footing of several recommendations below:

- The scheduler now writes `jobOperation.projectedCompletionAt` (forward
  forecast) and `jobOperation.dueDate` (backward need-by target) every regen,
  plus `capacityReservation` rows per work center/employee. So:
  - **"Arriving soon" (rec 4) is now data-backed for free**: a candidate's
    predecessor op has a real `projectedCompletionAt` — no estimation needed.
  - **Due-slack scoring (rec 3) already has its input**: `op.dueDate` IS the
    demand-anchored need-by; slack = need-by minus projected finish, both
    stored. The suggestion score can read them directly.
  - The builder's WC picker "N in queue" can graduate to real load from
    `capacityReservation` spans instead of a count.
- Work centers now carry **operating hours** (`workCenterShift` / `alwaysOn`)
  and are finite (one op at a time) — but still have NO per-run load size, so
  rec 1 (`batchCapacity`) remains the gap; it composes cleanly since a batch
  already occupies the WC as one op.
- The schedule routes moved (`x/schedule/*` → `x/priority/*`); recurring load
  windows (rec above) could anchor on `workCenterShift` rows rather than a new
  schedule concept.

## Recommended Approach for Carbon

Ordered by leverage; each names the pattern it follows.

1. **Work-center capacity (Plex/Steelhead pattern).** Add optional
   `batchCapacity` (numeric) + `batchCapacityUnit` (pieces first; weight/area
   later) and optional `minimumBatchQuantity` to `workCenter`. Builder shows a
   fill meter per prospective batch against the selected WC; suggestions split
   oversized groups into multiple loads (Plex's batch-count computation).
   Piece-count only for v1 — that is all Steelhead ships, and it unlocks
   bin-packing.
2. **Per-process compatibility configuration (unclaimed differentiator).** A
   JSONB config on `process` marking each batching dimension (substance, form,
   grade, dimension, finish, item) as hard / soft / ignored. Hard mismatches
   are excluded or blocked (Steelhead's spec-overlap enforcement justifies
   hard rules existing); soft mismatches score down but stay visible. Keeps
   the current signature as the default config so nothing changes until a
   process opts in. No surveyed vendor lets users configure this.
3. **Suggestion algorithm v2 (Fulcrum list + SAP scoring).** Replace exact-
   signature buckets with scored groups: `score = setup minutes saved
   − w₁·soft-mismatch penalty − w₂·due-slack risk − w₃·capacity waste`.
   Rank candidates due-date-first inside a group (Fulcrum), pack greedily to
   WC capacity (EDD bin-packing), and surface near-matches as "compatible with
   caveat" rows instead of hiding them. SAP's delay-cost term is the model for
   due-slack: score the *earliest* member's slack (due minus remaining routing
   time), not the raw due spread.
4. **"Arriving soon" lane (nobody ships this).** Candidates whose predecessor
   operation is In Progress, with projected ready time — so the planner can see
   that waiting 2 hours doubles the load instead of running half-empty today.
   Fulcrum's "suggest additional parts for a started nest" is the nearest
   precedent; extending a not-yet-started Carbon batch is the same move.
5. **Co-occurrence ranking (no precedent needed — cheap and honest).** Rank
   signature pairs that were actually batched together historically (query past
   `jobOperationBatch` members) above theoretical matches. Encodes tribal
   knowledge with zero configuration; degrades gracefully to the score alone.
6. **Batch-level quality capture (Steelhead pattern, later).** One grouped
   spec-measurement entry fanned to member operations, and coupon-style test
   parts that ride a batch — mapping onto Carbon's existing quality module.
   Certs remain per member/customer order (unanimous across vendors).
7. **Keep and defend what already matches consensus.** Operation-scoped
   membership, dissolvable batches, one shared timer, and completion slicing
   proportional to operation quantity are exactly the SAP/Fulcrum shape —
   and each is a documented Epicor pain point. Worth stating in marketing.
   Future flexibility ceiling: Steelhead's manual redistribution of a recorded
   split (80/20 drag) if customers ask.
8. **Terminology check.** "Batch" is safe for job-shop execution grouping
   (Plex uses "Job Op Batches" literally); SAP reserves "batch" for material
   lots — Carbon already says "lot" for those, so no collision. Steelhead's
   "load" is informal even in their own product.

## Sources

Steelhead (Wayback captures of docs.gosteelhead.com, June 2025, + live marketing):
- https://web.archive.org/web/2025/https://docs.gosteelhead.com/docs/racks-1
- https://web.archive.org/web/2025/https://docs.gosteelhead.com/docs/workboards-1
- https://web.archive.org/web/2025/https://docs.gosteelhead.com/docs/processes-1
- https://web.archive.org/web/2025/https://docs.gosteelhead.com/docs/specs-and-certs-overview
- https://web.archive.org/web/2025/https://docs.gosteelhead.com/docs/received-batches-1
- https://web.archive.org/web/2025/https://docs.gosteelhead.com/docs/treatment-troubleshooting-1
- https://web.archive.org/web/2025/https://docs.gosteelhead.com/docs/part-labor-timers-1
- https://web.archive.org/web/2025/https://docs.gosteelhead.com/docs/super-nodes
- https://web.archive.org/web/2025/https://docs.gosteelhead.com/docs/product-updates-2025
- https://web.archive.org/web/2025/https://docs.gosteelhead.com/docs/margin-pricing-1
- https://gosteelhead.com/resource-library/redline-job-costing-steelheads-manufacturing-erp
- https://gosteelhead.com/resource-library/innovation-plating-and-anodizing-powered-steelhead
- https://gosteelhead.com/plating-anodizing-software
- https://gosteelhead.com/powder-coating-software
- https://gosteelhead.com/capacity-planning-and-scheduling
- https://finishingandcoating.com/index.php/new-technology/1761-steelhead-technologies-adds-nadcap-certification-scanner

SAP:
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/combined-production-orders-in-sap-s-4hana-cloud-public-edition/ba-p/14397369
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/combined-production-order-processing-dimp/ba-p/13266644
- https://help.sap.com/docs/SAP_ERP/3a6bcf3eafa7475e813c7b1ec2e0fe0d/5bcec353b677b44ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/4032610758dc437089f0c28320eec93f/09ccd8530439414de10000000a174cb4.html
- https://help.sap.com/docs/SAP_ERP/698b19fa88b846359bc611f11184c810/6f80bf53f106b44ce10000000a174cb4.html
- https://help.sap.com/doc/saphelp_scm700_ehp01/7.0.1/en-US/8e/4ec95360267614e10000000a174cb4/content.htm
- https://help.sap.com/doc/saphelp_snc70/7.0/en-US/cd/2a673b19f27654e10000000a114084/content.htm
- https://help.sap.com/doc/saphelp_snc70/7.0/en-US/d8/eb834014d26f1de10000000a1550b0/content.htm
- https://learning.sap.com/courses/exploring-advanced-production-planning-with-sap-s-4hana-pp-ds/exploring-the-usage-of-optimization-in-sap-s-4hana-pp-ds
- https://community.sap.com/t5/supply-chain-management-blog-posts-by-sap/product-definition-and-advanced-planning-in-the-mill-industries/ba-p/14271191
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/batch-derivation-in-production/ba-p/13261712
- https://community.sap.com/t5/enterprise-resource-planning-q-a/mill-oc-how-do-you-keep-the-costs-in-the-child-orders/qaq-p/590008
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/d1e58be39d884a0dbf75a7526a9acbf4/1f14c453f57eb44ce10000000a174cb4.html
- https://sapinsider.org/streamline-your-production-changeovers-in-sequence-using-the-setup-matrix/

Fulcrum / Epicor / Plex:
- https://fulcrumpro.com/manufacturing-software/grouped-work-and-nesting
- https://fulcrumpro.com/article/streamline-production-with-work-orders-in-fulcrum
- https://fulcrumpro.com/article/product-showcase-video-nesting-workflows-in-fulcrum
- https://fulcrumpro.com/product-update/nesting-work-orders---looking-for-beta-users
- https://fulcrumpro.com/article/fulcrum-for-fabricators-workflows-for-custom-sheet-metal-shops
- https://www.epiusers.help/t/automatic-operation-batching/41522
- https://www.epiusers.help/t/questions-on-job-batching-advanced-production-module/99221
- https://www.epiusers.help/t/batching-jobs-for-a-single-operation-not-the-entire-job-split-burden-labor/131811
- https://www.epiusers.help/t/batching-jobs/113153
- https://www.epiusers.help/t/job-batching-scrap/136845
- https://www.epiusers.help/t/job-batching-coparts/120726
- https://plex.rockwellautomation.com/content/dam/plex/legacy/2023-03/10331_Plex_Batch_Management_DS.pdf
- https://plex.rockwellautomation.com/en-us/resources/plex-batch-management-basics.html
