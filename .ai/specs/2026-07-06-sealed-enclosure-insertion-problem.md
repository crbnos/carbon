# Decision needed: sealed-enclosure insertion order (SA-BCU)

Status: **open — needs a design call before more planner work**
Date: 2026-07-06

## The gap

Brad authored the correct SA-BCU order in the app (12 steps):

box → PCB → 4×4mm screws → connector → 4×2.5mm screws → seal → lid →
4×4mm screws → TPF119 ×4 (each its own step).

After tonight's ordering principles (dependency spine, securing jump,
sandwich, weakly-secured-last, corridor steps) **plus** clean units (R1 mapping
subtraction + R2 joint ejection), the planner still does **not** reproduce it.
Current output flags the box, both screw sets, and the clips; the 409-solid
merged PCB body single-blocker-merges into the box.

This is NOT another ordering heuristic to add. The ordering rules are right. The
blocker is upstream, and it splits into two distinct problems.

## Problem 1 (the real one): merged-unit collision fidelity

The planner collapses the 409-solid PCB into ONE concatenated collision mesh.
That merged mesh interpenetrates the enclosure's interior bosses/walls beyond
tolerance (component overhangs + tessellation artifacts). So greedy disassembly
can't find a collision-free removal for it → it flags → single-blocker merge
into the box → and every interior part that depended on the box being open
(screws, connector) flags in cascade.

The *physical* truth is simple: once the lid and seal are off, the PCB lifts
straight up. Reverse-disassembly already models "lid comes off first," so the
sequence logic is sound — it's the **collision geometry of the merged body**
that lies.

Options (each a real tradeoff, none free):

- **A. Representative-solid proxy** — plan the unit against its hub solid (the
  bare board) as the collision body, not the 409-mesh concatenation; the tiny
  components ride along for display and never independently collide. Principled
  (the board is what actually inserts), cheap, avoids phantom interpenetration.
  Risk: a unit whose *envelope* (not just its board) collides — e.g. a tall
  connector on the board hitting the lid — is under-modeled. Mitigate: proxy =
  convex hull of the unit, not just the hub.
- **B. Decimate/repair the merged mesh** before collision. Reduces artifacts,
  keeps concavity. Cost: mesh processing per unit; doesn't fully fix real
  component overhang.
- **C. Widen tolerance for merged units.** Rejected — this is the fail-open
  trap the sandwich regression already taught us; corrupts collision truth.
- **D. Author the order.** The escape hatch that already exists and that Brad
  used. Accept that deeply-enclosed multi-body units may need human authoring
  and make that ergonomic (it already is — authored steps are preserved).

Leaning **A (convex-hull proxy for merged units)** as the principled fix, with
**D** as the permanent fallback. A is a contained change to `_merge_units`
(swap the concatenated mesh for a hull) + the acceptance runner as the gate.

## Problem 2 (smaller): open-cavity insertion is only collision-free against the OPEN sub-assembly

Parts inserted into a cavity that a later part closes (PCB into the box before
the lid) are collision-free only against the sub-assembly *as it exists at that
step*, not against the finished closed model. The planner already gets this
right via reverse-disassembly (remove the closing part first, then the interior
is exposed). So Problem 2 is **already handled** — it only *appears* broken
because Problem 1 makes the interior body un-removable in the first place. Fix
Problem 1 and this resolves with it. No separate work expected; flagged here so
we don't mistake the cascade for two bugs.

## What is already done and NOT in question

- R1 (mapping subtraction) — a unit can't contain another BOM line's parts.
- R2 (joint ejection) — an outside fastener's clamped member leaves the unit
  (connector, LQFP, PCB board eject from the over-inclusive authored Board unit).
- All ordering principles. The seat rail is byte-stable and correct.

## Recommendation

1. Prototype option A (hull proxy) behind the acceptance runner
   (`.ai/scratch/geometry-bcu-acceptance.py`) — one contained change, measurable
   against the authored 12 steps.
2. If A doesn't clear the flags, fall back to D (authoring) as the shipped
   answer for enclosure-class assemblies and move on — not every finished-solid
   model can yield its build order from geometry alone, and that's an honest
   product boundary, not a planner bug.

Do NOT keep tuning ordering heuristics against this model — the order is not the
problem.
