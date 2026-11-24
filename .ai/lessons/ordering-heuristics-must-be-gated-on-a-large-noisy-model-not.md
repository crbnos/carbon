---
paths: []
triggers: []
promoted: null
---
# Ordering heuristics must be gated on a large noisy model, not just the seat rail

**Context:** The weakly-secured-last + sandwich-gasket refactor validated green on 47 unit tests and a byte-identical 31-part seat-rail baseline, then made real planning slower with worse results. A 20-line classification probe on the 118-part SA Mando & Battery Harness immediately showed why: 4 sandwich detections — ALL false positives, including a 33mm "thin" part (ratio-only thinness cap) and two 10.4mm isotropic pass-through allowances (uncapped observed depth granted as "compliant squish").

**Problem:** The seat rail is a best-case model: named fasteners, clean contacts, no ambiguous plate stacks. Proxy signals calibrated there (name-only fastener detection, contact counts, thinness ratios) explode on models with unnamed hardware, clearance fits, and interpenetrating CAD. Two failure classes: (1) a *preference* wired into the greedy removal priority is not a preference — that ranking schedules expensive removal attempts and picks flag/merge victims, so fronting hard-to-remove parts multiplies failed sweeps (slower); (2) any heuristic that grants collision allowances fails open — one false positive corrupts collision truth for every sweep it touches (worse).

**Rule:** Before shipping a planner ordering/allowance heuristic: (a) run the classification-only probe (`.ai/scratch/geometry-probe.py`) on a large noisy model (harness/BCU class) and eyeball every cohort member and every allowance value — a 10mm "squish" is a bug, not a gasket; (b) keep display preferences in the topo sort only, never in `removal_priority`; (c) cap and axis-gate anything that relaxes collision tolerance, and prefer fail-closed (reject classification) over fail-open (grant allowance) when evidence is out of range.

**Applies to:** `crates/planner/src` ordering preferences, `_sandwiched_parts`-style classifiers, any future exempt/allowance mechanism.
