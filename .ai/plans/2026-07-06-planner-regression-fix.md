# Fix: planner regression from weakly-secured + sandwich changes

## Context

The 2026-07-06 ordering refactor (weakly-secured-last + sandwiched-gasket handling in `services/geometry/app/plan.py`) made real-model planning slower with worse results (observed on the SA Seat Rail / SA Mando & Battery Harness in-app jobs). Three first-principles causes, in likelihood order:

1. **Greedy priority inversion**: `removal_priority` now tries "weakly-secured" parts first. On real models those are often the interlocked ones (cables, clips); each failure burns full tier-1+tier-2 sweeps, re-tried at the front of every scan. The greedy priority is not a preference — it schedules expensive attempts and picks flag/merge victims.
2. **Weak-tier proxy explodes on real CAD**: fastener detection is name-only and clearance fits produce no contact pairs, so "unfastened ∧ contact_count==1" matches a large fraction of a harness. The special case becomes the common case in both greedy and topo.
3. **Sandwich false positives corrupt collision truth**: detection matches rigid plate stacks (seen on seat-rail Part 7); each false positive grants an *isotropic* seated allowance (observed depth + 0.3mm, uncapped) to itself and partners — tunneling through a side door — and loses its support edges.

Fix philosophy: keep the two principles but move all risk out of hot paths and gate everything on evidence. The topo-side preference is inert (reorders only among already-legal choices) — keep it, tightened. The greedy-side change and the isotropic/uncapped allowance are the dangerous parts — revert/gate them.

Target file: `services/geometry/app/plan.py` (+ tests, spec prose). No schema/version changes (PLAN_VERSION stays 3 per Brad).

On execution start, copy this plan to `.ai/plans/2026-07-06-planner-regression-fix.md`.

## Changes

### 1. Revert the greedy-side weak tier entirely (theory 1)

`removal_priority` in `_greedy_disassembly` goes back to the pre-refactor tuple: fasteners first (0), structure (1), negated `_structural_key`, nodeId. Delete `removal_tier`, the per-call `largest_id` max, and the now-unused `fastened`/`contact_count` params from `_greedy_disassembly`'s signature and call site. Keep the `sandwiched` param (merge protection stays). Greedy order is only a witness — the topo sort owns the final order, so nothing of the "clips last" outcome is lost.

### 2. Tighten `is_weakly_secured` in `_preference_topo_sort` (theory 2)

Demotion additionally requires removability *evidence*:
- `entry.tier == "linear"` (clean tier-1 straight-line removal — a terminal snap-on slides off; cable spaghetti that happens to read one contact needs L/escape/flag and is excluded)
- `not unit.is_proxy` (bbox-proxy parts have fake contact data)

Existing conditions stay: not a fastener unit, not in `fastened`, `edges[p]` empty, contact_count == 1 (group members aggregated as today). Update the docstring.

### 3. Defang sandwich handling (theory 3)

In `_sandwiched_parts` / consumers:

- **Absolute thickness cap**: new constant `SANDWICH_MAX_THICKNESS_MM = 6.0` beside the ratio — a candidate must satisfy BOTH `thickness ≤ 0.3 × max_extent` AND `thickness ≤ 6mm`. Gaskets/seals/shims qualify; brackets and PCBs in rigid stacks don't.
- **Squish cap**: new constant `SANDWICH_MAX_SQUISH_MM = 0.6`. If any partner pair's observed depth exceeds it, the candidate is NOT classified (no edges, no allowance, no merge exemption) — deep bites are press fits or bad CAD, not compliant squish. Real gaskets compress a few tenths.
- **Axis-gate the allowance** (mirror `_mate_exempt`'s bore-axis gating): store the sandwich axis per partner (`_Part.seated_allowance_axes: dict[str, np.ndarray]` alongside the depth dict). In `_path_is_clear`, `_path_blockers`, and `_group_exempt`, merge a partner's allowance only when `abs(dot(direction, axis)) > 0.99`. Lateral motion is judged strictly — no more isotropic pass-through.
- **Restore support edges**: remove the `sandwiched` skip param from `_add_support_edges`; instead call `_add_sandwich_edges` BEFORE `_add_support_edges` in `_plan_parts`. The existing cycle guard then rejects a wrong-direction support edge (sandwich edge already establishes gasket→lid), and correct support edges are no-ops. False positives keep their support edges — no constraint loss.

### 4. Tests (`services/geometry/tests/test_plan.py`)

- Existing 4 refactor tests must still pass (clip-last is now topo-only; gasket bites 0.4 ≤ 0.6 cap; gasket/lid motions are axis-aligned so allowances still apply).
- New unit tests for the detection gates (call `_sandwiched_parts` directly, no planning):
  - `test_thick_stack_is_not_a_sandwich` — 15mm plate seated between two bodies → `{}`.
  - `test_deep_bite_is_not_a_sandwich` — thin ring with 1.5mm interference → `{}`.
- New: `test_sandwich_allowance_is_axis_gated` — assert lateral direction doesn't receive the exemption (direct call to the merge helper or via `_path_blockers` on a gasket scenario with a lateral segment).

### 5. Diagnostics + real-model verification

- Write a **classification-only probe** at `.ai/scratch/geometry-probe.py` (same import style as `.ai/scratch/geometry-explain.py`): tessellate a STEP, compute pair_depths/fasteners/joints/sandwiches/contact_count, print: part count, fastener count, `fastened` size, weak-cohort size (old vs new definition), sandwich count with per-part thickness/depths/axis. No greedy — runs in ~1–2 min even on the harness model.
- Run the probe on `~/Downloads/SA Mando & Battery Harness.step` BEFORE the fix (current working tree) to confirm theories 2/3 numerically, and AFTER to show the cohorts collapse.
- Full pytest suite.
- Seat-rail harness (`geometry-explain.py --sequence` twice): tiers/sequence must match the accepted baseline (24 linear / 2 group / 2 flagged, verified 29/31); the two "sandwich preference … skipped" warnings should disappear (Part 7 stack now excluded by thickness/squish caps).
- Timed solo run of the harness model (`--step ~/Downloads/"SA Mando & Battery Harness.step" --sequence`) post-fix; sanity-check flags/tiers and wall time. (A pre-fix A/B run is optional — 20–30 min — only if the probe numbers don't already tell the story.)

### 6. Docs

- Re-sync the two paragraphs I added to `.ai/specs/2026-07-04-animated-work-instructions-contracts.md` (weak-secured description gains the tier-linear/non-proxy gates and loses the greedy-side claim; sandwich paragraph gains thickness/squish caps and axis gating).
- Append to the plan artifact and add a lesson to `.ai/lessons.md`: scale-dependent ordering heuristics must be gated on a large noisy model, not just the 31-part seat rail; greedy priority changes are schedule changes (cost + flag/merge victims), not preferences.

## Verification summary

```bash
cd services/geometry
.venv/bin/python ../../.ai/scratch/geometry-probe.py --step ~/Downloads/"SA Mando & Battery Harness.step"   # before + after
.venv/bin/python -m pytest -q                                             # all green
.venv/bin/python ../../.ai/scratch/geometry-explain.py --sequence         # ×2, baseline-identical, no sandwich warnings
.venv/bin/python ../../.ai/scratch/geometry-explain.py --step ~/Downloads/"SA Mando & Battery Harness.step" --sequence  # timed solo
```

Then re-run the two in-app jobs (user-triggered) to confirm end-to-end.

## Risks

- The tier-linear gate could un-demote a legitimate clip that needs a slide (tier L) — e.g. TPF119 "slide in to avoid collision". If SA-BCU clips plan as tier 2, they'd no longer demote. Mitigation: accept for now (they're still ordered late by small volume) or extend the gate to `tier in ("linear", "L")` — decide from the probe/SA-BCU evidence, default to including "L" since both tiers are verified collision-free motions. (Plan: gate on `tier in ("linear", "L")`, exclude escape/group/flagged.)
- Axis-gating uses one axis per partner; a part sandwiched along two axes keeps only per-partner axes, which is correct since allowances are per-partner.
- Seat-rail baseline must stay byte-identical — it's the regression gate before any real-model timing.

---

## Result addendum (2026-07-06, same session)

**Regression fix verified end-to-end**, then two follow-on changes landed on top:

1. **Performance (the "3 minutes" question):** profiled the seat rail — 86% of
   time was pass-through contact enumeration in `_path_blockers` (53M contact
   objects). Fixes: park discovered blockers out of the broadphase for the rest
   of the sweep (the real win) + unregister the moving part during its own
   sweeps (kills the synthetic-test self-flood). Seat rail 191–211s → **20–26s**
   byte-identical; harness >30min (killed, unfinished) → **557.7s**; pytest
   suite ~53s → ~6s.
2. **Dependency-spine ordering + corridor-gated steps** (Brad's expected order):
   one topo sort_key term (`0 if edges.get(node_id) else 1` after the securing
   jump) yields rail → sliders → Part 7 → Torx 2+2 exactly, with the badge
   group and washer+screw deferred to the tail; `buildAssemblyStepGroups`
   (viewer) now merges simultaneous steps only when swept corridors are
   AABB-disjoint — side-by-side screws share a step, in-line TPF119-style
   clips each slide in on their own step.

Gates: geometry pytest 30/30 (plan) + full suite green; viewer 67 tests +
typecheck green; seat rail deterministic with tiers unchanged (24/2/2,
verified 29/31). Known non-goal: harness flags 53/115 — cable interlock needs
BOM unit collapsing, not ordering heuristics.
