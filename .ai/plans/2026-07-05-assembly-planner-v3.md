# Assembly Planner v3 — Reason From Contact Geometry, Not Axis Lists

Status: in progress
Supersedes the earlier assembly-through-disassembly refactor plan (deleted).
Everything that plan shipped stands: flagged-fade-in viewer semantics,
precedence DAG + forward verification, rigid merge, subassembly groups,
joint edges, structural scoring, the BVH-cache perf pass, and step
generation v2 with Regenerate. v3 fixes what the real model exposed.

## Ground truth to reason against

Expected seat-rail order (from Brad), abstracted to its causal skeleton:

```
rail                → the skeleton
slider, slider      → corridor riders: must travel the rail while it's empty
part 7              → mounted component, placed before it is fastened
torx ×4             → its fasteners, entering THROUGH the holes (tilted bore axes)
knob ×3             → adjusters: thread in, clamp nothing → after the structure
marketing badge     → cosmetic, shallow attachment
washer, screw       → the badge/clamp's fastener stack, washer first, screw last
```

Nothing here is seat-rail-specific. The generating principles:

1. Skeleton first (big, central).
2. A part whose insertion sweeps a long corridor goes while the corridor is
   empty (hard: precedence edges; soft: do it early even when not forced).
3. A mounted component precedes its fasteners; its securing fasteners follow
   it immediately, entering along their bore axes through the holes.
4. Mate-only fasteners (knobs, set screws) are accessories — ordinary small
   structure, no priority jump.
5. Cosmetics late; their own fastener stacks (washer → screw) come right
   after them, last.

P6 already encodes 1, 3(ordering), 4, 5. The seat-rail run exposes what's
still wrong underneath.

## Evidence from the latest run (52.7s local, all P6 changes active)

```
tiers={linear:19, group:2, flagged:6}  verified=24/30
flagged: Torx M6 ×4, Part 7, clamping knob #1
sequence: rail, [badge+clamp group], knob, Part7(flagged), [screw+washer g],
          knob(flagged), slider, torx(flagged)×2, slider, torx(flagged)×2,
          HRKN ×16 …
```

Three distinct root causes, none of them "needs more heuristics":

**RC1 — The Torx bolts have no discoverable axis, so they never get the
hole path.** The assembly plane is tilted (sliders travel [0.34, 0, 0.94]).
The Torx bore axes are tilted too. A stubby flange-head bolt defeats the SVD
axis (near-cubic), defeats the bbox axis (a tilted bolt's AABB is a diagonal
cube), and — if its tapped hole is modeled at clearance — has no deep thread
contacts for the contact-ring fit. Result: candidate directions collapse to
the six world axes, and a tilted bore can never be exited along a world
axis. Flagged. Part 7 then deadlocks behind its own unresolvable bolts.
The information that WAS available and unused: the bolt's seated surface
contacts (the flange's under-head ring on Part 7) — a planar ring whose
normal IS the bore axis, at any contact depth including zero.

**RC2 — Travel semantics are "exit the assembly AABB", which is wrong for
parts that point inward.** The cheese screw's bore points into the assembly;
AABB-exit along its axis is 606mm (the 1.5×diagonal cap). Real removal is
"back out of the hole into free space" (~20–30mm). Consequences compound:
absurd travels read badly, they sweep across the whole model creating
spurious precedence edges, they waste collision samples, and the 606mm
"travel" made a fastener group look like a corridor-sweeper and jump to
step 6.

**RC3 — Greedy takes the FIRST clear direction, not the LEAST-ENTANGLING
one.** The badge+clamp group went +Z at greedy time; if that sweep crosses
where a slider seats, it manufactures `group ≺ slider` and drags the whole
clamp stack to step 2. When several directions are collision-free at
disassembly time, the choice among them decides the constraint graph — and
we currently don't choose, we take the first hit.

Plus the pipeline gap: **the app never runs the new planner.** Generate
Steps consumes the STORED plan.json; the geometry service container still
runs the old code. Every in-app impression so far is of the v1 planner.

## Redesign

### D1. Candidate directions come from contact geometry (fixes RC1)

Collect, in the one seated broadphase pass we already do, per part: contact
points AND contact normals with every neighbor (any depth — surface touches
included; fcl contacts carry normals).

Axis/direction discovery becomes a cascade over evidence, strongest first:

1. Thread-mate contact band (exists) — cylinder fit.
2. **All-contact ring/normal fit (new):** fit the cylinder/ring axis over
   the part's full seated contact cloud; for a flange bolt in a clearance
   hole this is the under-head ring → bore axis, tilted or not.
3. **Contact-normal clusters (new, all parts, not just fasteners):** dedup
   contact normals (dot > 0.95), take the top 2–3 clusters by support, add
   ± as candidate directions after the symmetry axis and before world axes.
   A box on a plate offers +Z; a dovetailed slider offers the rail
   direction; a tilted bolt offers its bore axis. This is "ask the mating
   surfaces how the part comes apart" — the general form of every special
   case we've hand-coded.
4. World axes last, as today.

Named fasteners stay bore-axis-restricted (now with a real axis to
restrict to), sense ordered away-from-mate (exists).

### D2. Travel = reach free space, not exit the world (fixes RC2)

Redefine removal travel: sample along the direction (bounded by AABB
separation as today, so clearance of the tail is still proven), record the
LAST touching sample; travel = last_contact + margin + one part-extent for
readability. The remaining path to separation must still verify clear —
semantics unchanged for soundness, only the recorded animation distance and
the swept-edge footprint shrink. Fastener insertions become hole-length
travels; precedence edges stop being manufactured by phantom cross-assembly
sweeps; the corridor-exposure signal becomes honest (a 250mm slider ride is
a corridor; a 25mm screw backing out is not).

### D3. Direction choice minimizes entanglement (fixes RC3)

When more than one direction is collision-free at greedy time, score each
CLEAR candidate by its blocker count against the FULL seated assembly (the
sweep we already run for the DAG, just earlier) and pick
(fewest-full-set-blockers, shortest travel). The bolt "takes the path
through the holes" because the hole path has zero full-set blockers; the
clamp group stops choosing a direction that flies over the slider seat.
Bounded cost: ≤ a handful of extra sweeps per part, only when several
directions clear, and D2 just made sweeps short.

### D4. Ordering polish (small, after D1–D3)

- Corridor/exposure bucket applies to structure only — never fastener or
  fastener-group units (their place comes from joint edges + securing
  class).
- Group units inherit fastener-ness when any member is a fastener (the
  washer+screw pair is a fastener stack, not a corridor part).
- Everything else in P6 stands: joint edges, securing-vs-accessory,
  structural key, runs, base.

### D5. Close the app loop (fixes "nothing changed")

- Rebuild/restart the local geometry service with the new code and confirm
  the running container's plan.py matches the working tree (how it mounts
  is task 1 — verify, don't assume).
- Add "Re-run motion planning" to the assembly editor (triggers the
  assembly-plan job; the poll/refresh UX from the lazy-conversion work
  already handles the wait), so a stale plan.json is a one-click refresh —
  today the only path is deleting artifacts or the retry-on-failure button.
- Then: re-plan → Regenerate from Plan → watch in the browser.

## Experiment protocol (the scratch loop)

Harness: extend `/tmp/replan.py` into `services/geometry/scratch/explain.py`
(gitignored or scratch — throwaway):

- `--explain "<name substr>"`: for each matching part, print classification
  (which cascade stage produced the axis), mates, joint set, every candidate
  direction tried with its first blocker and depth, and the chosen motion.
- `--sequence`: the final order annotated with tier/travel/verified plus,
  per unit, WHICH preference class placed it (base / run / securing /
  corridor / structural) — makes ordering disputes decidable in one read.
- Fast loop: tessellation is cached after the first run (~8s), planning
  ~50s → sub-minute iterations.

Experiments, in order (each is a falsifiable question):

- E1: `--explain Torx` on the current code — confirm RC1 (no axis → world
  axes only). This is the baseline record.
- E2: D1 stage-2 (all-contact ring fit) alone — do the Torx bolts get a
  tilted axis and a linear motion? Does knob #1 resolve? Does Part 7
  unflag once its bolts do?
- E3: D2 travels — cheese screw travel drops from 606mm to O(30mm); count
  of derived precedence edges drops; no new verification failures.
- E4: D3 choice — badge+clamp group stops preceding the sliders; sliders
  land immediately after the rail.
- E5: full acceptance (below) + fixture suite (18 tests) + determinism.

## Acceptance (generalized from the expected order — constraints, not a
literal transcript)

On the seat rail, all of:
1. `sequence[0]` = Seat Rail; flagged = 0 (or only parts we can defend
   geometrically, by name, with blockers).
2. Sliders precede every knob/stop/clamp that sits in their corridor, and
   appear in the first quarter of the sequence.
3. Part 7 precedes all four Torx bolts; the Torx bolts are LINEAR along a
   tilted (non-world) axis, consecutive, verified.
4. Every fastener follows every member of its joint; washer precedes its
   screw; the washer+screw stack sits after the badge/clamp it secures.
5. Knobs appear after the structure they thread into, never before a
   mounted component they don't touch… and never via a priority jump.
6. All non-flagged parts verified; planMs within 2× of today's 53s; two
   consecutive runs byte-identical.

And in the app (D5): fresh plan.json → Regenerate → the browser playback
shows bolts entering through holes, no fly-through, fade-in only for
defensible flags.

## Tasks

- [ ] T1 (D5a): find how the local geometry service runs (image vs mount),
      rebuild/restart with current code; verify `/health` + a plan request
      uses PLAN_VERSION 2. Document the loop in the plan doc.
- [ ] T2 (harness): `--explain` / `--sequence` scratch runner; record E1
      baseline for Torx/knob/Part 7.
- [ ] T3 (D1): contact-cloud collection (points+normals per part) → ring
      fit stage 2 → normal-cluster candidates stage 3; fixtures: tilted
      stubby bolt in a tilted plate (must exit along the tilted bore),
      box-on-plate normal candidate.
- [ ] T4 (D2): last-contact travel semantics + margin; adjust
      `_exit_travel` callers, DAG derive, verify; fixtures: inward-pointing
      screw gets O(hole) travel; existing 18 tests stay green (travel
      asserts may need updating — assert direction, not magnitude).
- [ ] T5 (D3): least-entanglement direction choice; fixture: part with two
      clear exits, one crossing another part's seat — must pick the empty
      one (assert via derived-edge count).
- [ ] T6 (D4): exposure = structure-only; groups inherit fastener-ness.
- [ ] T7: E5 acceptance run; update contracts doc ordering paragraph;
      lessons entry (contact geometry > axis lists; travel = free space).
- [ ] T8 (D5b): "Re-run motion planning" action + button (assembly editor),
      then in-app E2E: re-plan → regenerate → browser verify.

## Risks / notes

- Contact-normal candidates add directions; direction count stays bounded
  (≤ symmetry 2 + clusters 6 + world 6) and D2 makes each test cheaper.
- Ring fits on noisy tessellation: keep the cylinder-fit quality gate
  (radial std) and fall through to the next stage rather than guessing.
- The HRKN M8 rail bolts were absent from the expected list; treat their
  position as unconstrained beyond "after the rail, grouped, verified" —
  do not tune for them.
- Fixture travels asserted by magnitude will need loosening after D2 —
  assert direction and verified-ness instead.

## Execution log (running)

- E1 (baseline): Torx flagged NOT for tilted axes — bores are world-Y; blocked
  at 0.17–0.35mm by their own joint through-part (Part 7's snug counterbore).
  Root: tolerance below tessellation noise; fix: `_mesh_tolerance` =
  max(0.15, 2.5 × linearDeflection), plus **joint-sliding allowances** — along
  its bore axis a fastener may keep sliding contact with its joint members.
  Result: all 4 Torx linear through the holes, verified. (rtree was missing
  from the venv, silently disabling every containment test — added to deps.)
- D2 (reach-free-space travels): cheese screw 606→49mm, HRKN 127→21mm,
  sliders keep their honest 131mm ride. Spurious "corridor" classifications
  and cross-assembly sweep edges gone.
- D3 (least entanglement): tie-break by candidate order, not travel (travel
  broke natural-axis preference for loose rods).
- Ordering evidence (topo pick traces): XY-centrality buckets ranked mid-rail
  hardware above off-center sliders — centrality is meaningless along a
  linear assembly; bbox volume lied 5× for tilted bolts and worse for
  wrap-around/text parts. Now: **mesh volume** (watertight, else sum of
  watertight split bodies, else bbox) ranks structure big→small; centrality
  demoted to tiebreak; corridor slot removed (redundant).
- New hard edges that made the expected order emerge:
  - **Support/stacking**: mostly-vertical seated contact between structure
    parts ⇒ lower before upper.
  - **Joint-stack**: a joint's members order by WHERE they engage the shank
    (ring-test projection), tip → head, head end = the fastener's widest end
    (immune to snug-counterbore mate misclassification). The bolt clamps the
    head-side part onto the tip-side part — works across CAD air gaps.
- Current seat rail: 40s, forced 0, flagged 3 (Part 7 + 2 clamping knobs —
  explains in flight), sliders each immediately followed by their Torx pair.

## Final state of this pass (seat rail, local)

```
 1. Seat Rail (base)                 expected: 1 ✓
 2. Seat Rail Slider                 expected: 2 ✓
 3. Seat Rail Slider                 expected: 3 ✓
 4. Part 7                           expected: 4 ✓
 5-8. Bolt M6 Torx ×4 (thru holes)   expected: 5-8 ✓
 9-10. badge + clamp (group)         expected: 12   (variance)
11-12. cheese screw + washer (group) expected: 13-14 (variance)
13. clamping knob (radial, planned)  expected: 9-11 (variance)
14-15. knob variant pieces (flagged) — stacked CAD duplicates, fade in
16-31. HRKN M8 rail bolts ×16        (omitted from expected list)
tiers: 24 linear, 2 group, 2 flagged, 0 forced · verified 29/31
```

What landed beyond the original D1–D5: mesh-scaled tolerance; joint-
sliding allowances (the "through the holes" fix); geometric head-end
detection; joint-stack (tip→head) and support (lower≺upper) hard edges;
material-volume structural ranking (split-body volumes for text/logo
soups); evidence-based rigid merging (single-real-blocker) replacing all
depth/coincidence heuristics; classification cascade extended to the full
contact cloud and dominant normals; real-sweep blockers for merge/flag
decisions; group growth deprioritizes deep-bitten members.

Known remainders:
- Two knob variant pieces still flag (M12 + the rail-bitten -6-3): the
  pair-group that would extract them cleanly loses its test budget to the
  bitten sibling. Honest fade-in with named blockers; refine later.
- planMs ~170s local (was 24s before the stuck-round merge-scan; the
  scan's escape sweeps dominate). Optimize when it matters — the plan job
  is async.
- In-app loop not yet exercised: uvicorn --reload already runs this code;
  next step is Re-run Motion Planning → Regenerate from Plan → browser.
