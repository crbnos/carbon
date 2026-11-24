---
paths: ["crates/planner/tests/**"]
triggers: ["trimesh"]
promoted: null
---
# Synthetic box meshes fake huge penetration under sustained sliding contact

**Context:** Writing planner ordering tests (`test_part_with_blocked_insertion_is_not_demoted`) with raw `trimesh.creation.box` parts: a slider seated 0.05mm into a channel floor read as depth **29.8mm** against the rail at every sweep sample, so the planner declared it inseparable and rigid-merged it.

**Problem:** FCL reports per-triangle-pair local penetration. A box face is two giant triangles; two near-coplanar giant triangles overlapping 0.05mm in the normal direction report a depth spanning their tangential overlap. Real STEP models never hit this — tessellation at `linearDeflection` keeps triangles small, so local depths stay bounded by element scale. The artifact only appears in synthetic tests whose parts sustain face-on-face sliding contact; brief seated contact that separates immediately (stacked boxes lifting off) is fine.

**Rule:** In planner tests, any part that must SLIDE while touching another needs `mesh.subdivide_to_size(5.0)` on both meshes — and prefer seating the moving part against a face perpendicular to its travel (contact vanishes on the first sample) over a face parallel to it (contact persists the whole sweep). Also avoid geometry where a seated bite must scrape past an opening sill: that is a real interference, not an artifact.

**Applies to:** `crates/planner/tests` synthetic fixtures; debugging any "cannot separate / planned as one rigid unit" result on hand-built trimesh geometry.
