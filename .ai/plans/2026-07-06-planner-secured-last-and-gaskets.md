# Planner refactor: explicit "least-secured last" + compliant sandwiched parts

## Context

The SA-BCU expected order exercise (seat rail BCU, 11 steps) showed the v3 planner gets the right answer in two places for reasons that won't generalize:

1. **Snap-on clips (TPF119) assemble last only because they're small.** `removal_priority` and the topo `sort_key` rank structure purely by material volume + centrality. A *large* snap-on part (e.g. a big slide-on cover panel) would wrongly assemble early. The real principle: parts held only by friction/snap — nothing clamps them, nothing depends on them — assemble as late as their constraints allow.
2. **Gaskets/seals have no handling at all.** A thin compliant part sandwiched between two flanges (SA-BCU: box rim → gasket → lid) currently risks: (a) missing/wrong support edges (bbox z-center comparison degenerates for thin parts), (b) if modeled with seated interference, becoming unremovable → `flagged` → **zero precedence edges** (topo can place it anywhere), (c) spurious blocker edges on neighbors sweeping past it, and (d) silent single-blocker rigid merge into its flange. This is very likely the root cause of the T6 caveat where the merged PCB/Box units flag ("no collision-free insertion into the sealed enclosure").

Target file: `services/geometry/app/plan.py` (planner v3, 2858 lines). No API/schema changes; plan.json shape unchanged.

On execution start, copy this plan to `.ai/plans/2026-07-06-planner-secured-last-and-gaskets.md` (project convention).

## Design

### A. Weakly-secured parts assemble last (explicit principle)

New per-part signals, computed in `_plan_parts` from data that already exists:

- `fastened: set[str]` — every unit appearing as a member of any `joints[f]` (mates + through-parts), built by inverting `joints` after the merge remap (plan.py:406-427).
- `contact_count: dict[str, int]` — number of non-fastener seated pairs per unit, from `pair_depths` keys remapped through `merged_into`.

**Definition (topo sort, the one that decides final order):**
`weakly_secured(p)` = `p ∉ fasteners` ∧ `p ∉ fastened` ∧ `edges[p] == ∅` (p must-precede nothing: no sweep/joint/support edge out of it) ∧ `contact_count[p] ≤ 1`.

The `edges[p] == ∅` term is what makes this safe: the seat rail sliders have an outgoing sweep edge (their insertion is blocked by Part 7's seated body), so they are *not* demoted; TPF119 clips, the marketing badge, and any glued-on terminal part have no outgoing edges and exactly one seated neighbor, so they are.

Edit points:

- `_preference_topo_sort` sort_key (plan.py:1005-1018): insert a `1 if weakly_secured(node_id) else 0` term between `is_securing` and `_structural_key`. Weakly-secured parts rank after everything else that's available; among themselves they still sort big→small.
- `removal_priority` closure (plan.py:1753-1769): edges don't exist yet at greedy time, so use the pre-greedy approximation `p ∉ fastened ∧ contact_count[p] ≤ 1` as tier 0 (removed before fasteners — outermost off first), fasteners tier 1, structure tier 2. Greedy order is only a witness; the topo sort owns the final order, so the approximation being looser here is fine.
- Thread `fastened` + `contact_count` into `_greedy_disassembly` (call site plan.py:444-455) and `_preference_topo_sort` (call site plan.py:482-495) as new keyword args with safe defaults (empty), so `.ai/scratch/geometry-explain.py`'s direct imports keep working.

### B. Sandwiched compliant parts (gaskets/seals)

New detection function `_sandwiched_parts(parts, pair_depths, fasteners, merged_into) -> dict[unit_id, _SandwichInfo]`, called in `_plan_parts` after the joints remap:

- Candidate: non-fastener, non-proxy unit with ≥2 seated partners.
- Sandwich axis: principal axis of the pairs' contact structure tensors (already stored per pair in `pair_depths` — winding-invariant Σn·nᵀ); pairs must agree on the axis (|dot| > ~0.9).
- Sandwiched: partners' mean contact positions fall on *both* sides of the part's centroid along that axis. Uses contact-point positions, never normal signs (FCL normals follow winding) and never bbox z-centers (thin-part degeneracy).
- Thin: extent along the sandwich axis ≤ ~0.3 × max lateral extent (module-top constant next to the other tolerances).
- `_SandwichInfo` = `{axis, side_a: set, side_b: set, allowance: dict[partner_id, depth]}` where allowance = observed seated pair depth + `MATE_DEPTH_MARGIN_MM`, granted only to sandwich partners. Rationale mirrors the thread-mate precedent: the *seated state itself* proves the interference is intentional (compliant squish); the planner still never fabricates motion through parts it doesn't touch when seated.

Four consumers:

1. **Precedence edges** — new `_add_sandwich_edges(...)` called alongside `_add_joint_edges`/`_add_support_edges` (plan.py:480-481), same cycle-guard pattern: the side with larger total part volume (the enclosure) precedes P; P precedes the other side (the compressor/lid). Ambiguous volume tie → skip + warn.
2. **`_add_support_edges`** (plan.py:831-899) — skip pairs involving a sandwiched part; sandwich edges own them (avoids the z-center degeneracy creating a contradictory edge that the cycle guard would resolve arbitrarily).
3. **Seated-interference allowance** — thread a `seated_allowance: dict[str, dict[str, float]]` (symmetric: both `gasket→lid` and `lid→gasket`) through `_greedy_disassembly` → `_plan_removal`/`_plan_escape`/`_escape_blockers` → merged into the exempt dict next to `_mate_exempt` output (pattern at plan.py:677-679), and into `_derive_precedence`'s `_path_blockers` call via `extra_exempt` (plan.py:727-735). This stops the seated gasket from (a) being unremovable itself and (b) showing up as a spurious blocker of the lid's sweep.
4. **Merge protection** — sandwiched units are skipped by the stuck single-blocker rigid merge (plan.py:1833-1891) and removed from `deep_bitten` (plan.py:432-440); a compliant part must never silently fuse into its flange.

### Version bump (recommendation — veto here if unwanted)

Bump `PLAN_VERSION` 3→4 in plan.py and `CURRENT_PLAN_VERSION` in `packages/viewer/src/plan.ts` (re-exported via `packages/viewer/src/steps.ts`; the jobs worker refuses stale plans and re-plans on next Generate Steps). Same precedent as the v3 bump: ordering heuristics changed, stored plans should regenerate. Two constants, no schema change.

## Tasks

1. Copy plan to `.ai/plans/2026-07-06-planner-secured-last-and-gaskets.md`.
2. **Goal A**: build `fastened`/`contact_count` in `_plan_parts`; extend `removal_priority` tuple + topo `sort_key`; thread new kwargs (defaulted) through `_greedy_disassembly`/`_preference_topo_sort`. Update both functions' docstrings/comments (they state the principles verbatim).
3. **Goal B**: `_SandwichInfo` dataclass + `_sandwiched_parts()` + `_add_sandwich_edges()`; support-edge skip; `seated_allowance` plumbing through the removal/escape/blocker call chain; merge/deep-bitten protection. New module-top constants beside `PENETRATION_TOLERANCE_MM`.
4. **Tests** (`services/geometry/tests/test_plan.py`, synthetic trimesh like existing tests):
   - `test_large_snap_on_clip_assembles_last` — base + small screwed-down bracket + a *larger* slide-on clip touching only the base → clip last despite bigger volume (kills the volume coincidence).
   - `test_part_with_blocked_insertion_is_not_demoted` — slider-like part touching only the base but whose insertion path is blocked by a later part → stays early (guards the seat-rail slider case).
   - `test_sandwiched_gasket_orders_between_flanges` — box + thin gasket + lid + screws, clean contact → sequence box < gasket < lid < screws.
   - `test_interfering_gasket_still_plans` — same with ~0.3mm seated interference → 0 flagged, gasket not rigid-merged, same order.
5. Version bump (plan.py + `packages/viewer/src/plan.ts`).
6. Sync the heuristics prose in `.ai/specs/2026-07-04-animated-work-instructions-contracts.md` (and its `docs/specs/` mirror if present) — the ordering-preferences paragraph and the tolerance/allowance paragraph.

## Verification

```bash
cd services/geometry && .venv/bin/python -m pytest -q          # 45 existing + 4 new, all green
```

Seat-rail acceptance (constraints from `.ai/plans/2026-07-05-assembly-planner-v3.md:180-199` — rail first, sliders in first quarter, Part 7 before its 4 consecutive Torx, washer before screw, flagged ≤ 2, determinism):

```bash
cd services/geometry
.venv/bin/python ../../.ai/scratch/geometry-explain.py --sequence   # run twice, byte-identical
.venv/bin/python ../../.ai/scratch/geometry-explain.py --edges slider
```

SA-BCU spot check (slow, leaf-soup without units — optional now; the authoritative check is the in-app "Re-run plan" after merge, which needs the stack + OPENAI key):

```bash
.venv/bin/python ../../.ai/scratch/geometry-explain.py --step "/Users/barbinbrad/Downloads/SA BCU.step" --sequence
```

Expected on SA-BCU: gasket ordered box < gasket < lid, clips last, and (if gasket interference was the cause) the previously-flagged enclosure parts get real motions.

TS side (only if version bump lands):

```bash
pnpm --filter @carbon/viewer test
pnpm exec turbo run typecheck --filter=@carbon/viewer --filter=@carbon/jobs
```

## Risks

- **Seat-rail regression** is the main one; the `edges[p] == ∅` term is the mitigation, and the harness run is the gate. If sliders still demote, tighten `weakly_secured` (drop the greedy-side demotion, keep topo-side only) before touching anything else.
- **Sandwich false positives** (e.g. a rigid spacer plate): gets ordering edges (harmless — they're correct for spacers too) but an allowance only if seated interference is actually observed, so no motion is fabricated through truly rigid geometry.
- **Harness compatibility**: all new params are keyword-defaulted; no renames of the `_private` symbols `geometry-explain.py` imports.
- planMs: detection is one pass over `pair_depths` (cheap); allowance adds dict lookups inside existing sampling loops. No new collision passes.

---

## Result (2026-07-06)

All tasks complete except the version bump, which Brad vetoed mid-run
("we don't need to maintain plan versions like this; we are on v1 for the
foreseeable future") — `PLAN_VERSION`/`CURRENT_PLAN_VERSION` stay at 3 and
heuristic changes are NOT version events. Stored plans persist until
manually re-planned.

- Goal A + B landed in `services/geometry/app/plan.py`; two definition
  refinements emerged during implementation:
  - weakly-secured requires contact_count == 1 exactly (zero structural
    contacts = fastener-positioned cover, regular structure), and the
    largest remaining part is exempt in greedy so fastener-less stacks
    keep their base.
  - seated allowances live on `_Part.seated_allowance` (consulted inside
    `_path_is_clear`/`_path_blockers`/`_group_exempt`) instead of threading
    a new parameter through six signatures.
- Tests: 47 passed, 2 env-skipped (4 new ordering tests).
- Seat rail: byte-identical to the accepted v3 baseline across two runs —
  tiers 24 linear / 2 group / 2 flagged / 0 forced, verified 29/31,
  sequence unchanged (~125s). Sandwich detector fired on the rigid Part 7
  clamp stack; cycle guard correctly skipped the conflicting edges
  (warnings only, no behavior change).
- SA-BCU end-to-end re-plan (in-app, needs stack + OPENAI key) not run —
  follow-up when the stack is up.
