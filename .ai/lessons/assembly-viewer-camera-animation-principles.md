---
paths: []
triggers: []
promoted: null
---
# Assembly viewer camera + animation principles

**Context:** Camera transitions and part-motion animation in the assembly instruction viewer (`packages/viewer`).

**Problem:** Per-step re-zooming and pure-geometry view heuristics lose the "where are we on the model" context; small fasteners are invisible at assembly scale; sparse path sampling produced false "removable" results (washer/bolt ordering bugs).

**Rule (user directives):**
- **Constant zoom, rotate-only:** per-step camera transitions keep the standing whole-assembly distance and only rotate toward the action — never re-zoom per step or frame a single small part tightly.
- **Occlusion-aware angles:** choose view direction by scoring how many parts block the line of sight to the animated part (seated pose + travel midpoint), not by pure geometry heuristics.
- **Exaggerate small parts:** bolts/washers get display-only exaggerated travel (>=2.5x their size) so insertions read at assembly scale.
- **Manual motion editing is a 0.001% escape hatch:** keep it collapsed behind "Edit manually"; motions come from the geometry planner.
- **Planner correctness beats coverage:** cap sample spacing (2mm) rather than sample count. Threaded fasteners need a thread-depth penetration allowance along their own axis because CAD models them as interfering solid cylinders.

**Applies to:** `packages/viewer/`, geometry planner (`crates/planner`).
