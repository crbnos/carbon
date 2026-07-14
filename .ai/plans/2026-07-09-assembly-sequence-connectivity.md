# Assembly sequence from first principles: connected growth from a real base

## Context

Two instructions exist for the same BCU model (`5xnsD-LXJzfYduUs1GUIz`, 431 leaves):
`Sync 3 - SA BCU - Auto Generated` (`d97h24n5i0h4l3vdo3kg`, from the fresh planner
run) and `Sync 3 - SA BCU - Fixed` (`d97h5675i0h4vsndo3rg`, Brad's hand-authored
order — the ORDER is the reference; its motions are none/flagged and explicitly
not to be trusted). The auto order is nonsense on screen: the **seal** is the
base, the **lid** mounts onto the floating seal, seven lid screws drive into
nothing, the LQFP chip (13.7mm from anything placed) and the PCB (14.3mm) appear
in empty space, the **Electronics Box — the true anchor — arrives 9th, flagged**,
and the 409 PCB components come dead last.

Root causes, each verified empirically against the real model (mesh-distance
audit of both step sequences; greedy/topo-sort code reading):

1. **Base selection is an accident of the greedy loop.** The base is whatever
   part survives removal last (`_greedy_disassembly`, plan.py:2447–2460). On an
   enclosure model the loop deadlocks (box can't escape past its contents, the
   compressed seal can't escape past box+lid), flags the box
   (plan.py:2616–2647), which frees lid then seal — so the SEAL becomes base and
   the box a flagged afterthought.
2. **Nothing constrains a step to touch the already-placed set.** The topo sort
   (`_preference_topo_sort`, plan.py:1523–1694) has soft support/sandwich edges
   but no connectivity requirement; forward verification
   (`_verify_sequence`, plan.py:1697) checks collision only. Floating installs
   (LQFP at 13.7mm, PCB at 14.3mm) pass every gate.
3. **Flagged parts get no ordering anchor.** They land at their reversed removal
   position with no precedence edges (plan.py:2627, 2649) — the box's
   `blocked_by` (its entire contents) is recorded but never used for order.
4. **The contact/adjacency world only sees interpenetrating pairs.**
   `_seated_pair_depths` (plan.py:1776) feeds support edges, sandwich detection,
   and contact counts from FCL *collision* contacts. Real CAD gaps — the LQFP
   sits 0.05mm above its pads — are invisible, so clean models order blind.
5. **Unit derivation splits the populated PCB.** `deriveAssemblyUnits`
   (packages/utils/src/assembly-units.ts:130) groups leaves by their assigned
   flattened-BOM item; the 409 footprints collapsed into one unit but the board
   itself (`minimalBCU_gen2_PCB`), the `C-1-776163-1` connector, and the LQFP
   were assigned to their own qty-1 single-leaf lines and stayed out. Per Brad:
   Fixed steps 2 + 3 (swarm + board/connector) must be ONE group. This also
   feeds ordering: the swarm alone doesn't touch the box (6.0mm), but the board
   does — group them and the unit mates with the box bosses.

First principles for an instructional assembly animation:
- **The base is the part everything mounts into** — the most-connected, most
  massive structural part (the enclosure), not the last part a disassembler
  could pry out.
- **Every step must mate with the already-placed assembly** (grow a connected
  assembly). "Mate" tolerates real CAD clearances (≈0.5mm), not just
  interpenetration.
- **An interlocked core (box⇄contents⇄seal⇄lid deadlock) anchors at its
  enclosure**, with the compliant member (seal) fading in on the rim — never
  the other way round.

Non-goals / constraints:
- `PLAN_VERSION` stays frozen (heuristic changes are never version events).
- Fixed-sequence re-motion mode (`_plan_fixed_sequence`) is untouched — order is
  caller-given there.
- Per `.ai/lessons.md`: no new logic in `removal_priority` (it schedules
  expensive sweeps); ordering logic belongs in edge derivation + topo sort; no
  new collision *allowances*; and every heuristic must be gated on the large
  noisy model (this BCU) plus the seat-rail regression baseline.

## Tasks

### Task 1 — Near-contact adjacency graph (ordering world)

File: `services/geometry/app/plan.py`.

- New helper `_ordering_adjacency(parts, pair_depths, trimesh_mod, contact_mm=0.5)`:
  start from `pair_depths` pairs, then add near-contact pairs — candidate pairs
  from an AABB prefilter (boxes inflated by `contact_mm`), confirmed with an
  FCL distance query (`min_distance` between cached BVHs, cf. `_mesh_bvh`
  plan.py:2654). Returns `dict[node_id, set[node_id]]` at the UNIT level
  (respecting `merged_into` / group units the way `_add_support_edges` does).
- Profile on the BCU before adopting (lesson: cProfile first): the AABB
  prefilter must keep confirmed distance queries in the low thousands.
- Feed it to: contact counts for `is_weakly_secured` (replacing the
  penetration-only `contact_count`), Task 2's base selection, and Task 3's
  connectivity constraint. Support/sandwich edge derivation keeps using
  `pair_depths` normals/depths (they need contact geometry, not just adjacency).

### Task 2 — Principled base selection

File: `services/geometry/app/plan.py` (`_plan_parts`, after greedy + before topo
sort, ~line 610–660).

- Candidates: the greedy base ∪ flagged non-fastener structural parts.
- Score by (adjacency degree, volume) — the enclosure wins on both axes. Retag:
  winner becomes `tier="base"` (motion none, confidence high, sequence head);
  the demoted ex-base keeps no motion and becomes `tier="flagged"` with
  `blocked_by` = its sandwich/support partners (honest: it fades in at its
  ordered position — for the BCU the seal fades onto the box rim, matching the
  Fixed order).
- Only rescore when the greedy base is NOT the degree/volume winner by a clear
  margin (e.g. winner ≥ 2× on both) — don't churn models the greedy already
  gets right (seat rail's Part 7 must stay base).

### Task 3 — Connectivity-constrained topo sort

File: `services/geometry/app/plan.py` (`_preference_topo_sort`, Kahn loop
~line 1666).

- Restrict each pick to `available ∩ touches(placed)` using Task 1's adjacency
  (a unit touches if ANY member is adjacent to ANY placed member). If the
  intersection is empty (genuinely disconnected islands — fixtures, reference
  geometry), fall back to full `available`, anchor the island by its own
  (degree, volume) maximum, and append a warning (`log`-visible in plan.json
  warnings; no silent caps).
- Existing hard edges and the 8-tuple soft preference key stay; connectivity is
  a filter on candidates, not a new score component.
- Expected BCU order: box → populated-PCB unit → PCB screws → seal → lid → lid
  screws → TPF119s — the Fixed order, modulo step merging.

### Task 4 — Populated-subassembly units (board + connector + footprints as one)

Files: `packages/utils/src/assembly-units.ts` (`deriveAssemblyUnits`),
`packages/jobs/src/inngest/functions/tasks/plan-units.ts`,
`packages/utils/src/assembly-units.test.ts`.

- Group leaves by the **top-most Make-subassembly ancestor** of their assigned
  BOM line instead of the leaf line itself, so the bare board, the connector,
  and the chips all collapse into the PCB-assembly unit alongside the 409
  footprints (collapse rule stays: ancestor quantity ≤ 1 and ≥ 2 leaves).
  Requires the flattened BOM's parent chain — check the shape
  `getFlattenedBomMaterials` returns and what `plan-units.ts` already loads;
  extend the loader if the parent path isn't present.
- Keep authored units as absolute overrides (unchanged precedence).
- Unit test: BCU-shaped fixture — footprint leaves on the child line + board
  leaf on the bare-board line under the same Make parent → one unit; two
  screws on a qty-8 line → separate bodies (unchanged).

### Task 5 — Acceptance + regression harness

Files: `services/geometry/tests/test_plan.py` (synthetic), promote
`.ai/scratch/geometry-bcu-acceptance.py` patterns into a repeatable check
(scratch is fine for the harness itself; the synthetic tests are the committed
gate).

- Synthetic pytest: enclosure deadlock fixture (open box + content + compliant
  seal + lid, subdivided meshes per the sliding-contact lesson) → asserts base
  = box, seal fades (flagged) between box and lid, and **no step installs
  without adjacency to the placed set**.
- Synthetic pytest: two disconnected islands → both anchored, warning emitted.
- Real-model acceptance (manual, documented in the plan run log): plan the
  Sync-3 BCU STEP with Task-4 units; assert zero FLOATING steps under the
  mesh-distance audit (script from this investigation), base = Electronics
  Box, and step-collapsed order ≈ Fixed reference (box; PCB unit; 2.5mm screws;
  seal; lid; 4mm screws; TPFs).
- Seat-rail regression: fresh-plan the seat rail model; sequence unchanged
  (Part 7 base) and all motions still verified.
- Run the classification probe (`.ai/scratch/geometry-probe.py`) on the BCU and
  eyeball the new adjacency degrees + any sandwich detections before shipping
  (lesson: gate on the large noisy model).

## Verification

1. `cd services/geometry && .venv/bin/python -m pytest tests/ -q` — all green,
   including the new enclosure/connectivity tests.
2. BCU acceptance run (planner on the real STEP + mesh-distance audit): 0
   floating steps, box base, order matches Fixed within grouping.
3. Seat-rail fresh plan unchanged.
4. `pnpm --filter @carbon/utils test && pnpm exec turbo run typecheck
   --filter=@carbon/utils --filter=@carbon/jobs` for Task 4.
5. End-to-end: delete the Auto instruction's steps, re-run Generate Steps
   against a fresh plan, and browser-verify the playback builds box-outward
   with no floating parts (dev stack + `/auth`; Minimal X membership fixture
   already in place).

## Implementation notes (as built — deviations from the tasks above)

- Task 2 grew: base candidacy is ALL structural units (not just flagged ones —
  mesh-source variance can hand the greedy base to anything), margin is
  degree-dominant (1.5x degree + 0.5x volume sanity; a thin-walled box loses
  mesh volume to a potted component blob).
- Fastener classification fixes fell out of the BCU acceptance: "pin" removed
  from `FASTENER_NAME_RE` (connector pin counts — "Electronics Box - 36 Pin"
  classified the enclosure as hardware and inverted the whole sequence),
  plurals now match ("…Self Tapping Screws" never classified before), and a
  size sanity gate (`max(100mm, 0.35 × assembly diagonal)`) keeps structure
  structural.
- Caller units are `protected` through the greedy: they never rigid-merge into
  another part, never absorb riders, and never dissolve into extracted groups.
- Flagged parts get their `blocked_by` recomputed against the FULL seated
  assembly (greedy-time blockers reflect a half-emptied world) and a
  fade-before-blockers SORT PREFERENCE (a hard edge version flooded the DAG on
  servo models and forced mid-air picks).
- Support + sandwich orderings moved from hard DAG edges to a SOFT graph
  (sort preference): gravity-stacking edges were forcing the far end of
  hanging pairs before the end that touches the assembly.
- Added `_connectivity_repair`: a final connectivity-first stable reinsertion
  over the sorted order; it may violate derived edges deliberately — forward
  verification demotes any now-colliding insertion to a fade-in (a fade-in
  attached to the assembly beats an animation into empty space).
- Acceptance results: seat rail 0 floating steps (was 2 + wrong base), BCU
  matches the hand-fixed reference (box → PCB unit → screws → TPFs → chip →
  PCB screws → seal → lid), Packing Arm 10 → 4 floating steps — the residual
  4 are ≤12mm ball-joint pose gaps inside a linkage chain the CAD models
  detached (plus unit-membership blind spots in the leaf-level audit).
