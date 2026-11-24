---
paths: []
triggers: ["graph.json", "model.glb", "trimesh"]
promoted: null
---
# GLB node↔nodeId joins must be validated against graph.json bboxes

**Context:** Building BCU acceptance fixtures from the viewer GLB: nodeIds live in glTF node `extras` which trimesh drops, so the join went through world-transform matching. The geometry service bakes vertices in world space with identity node transforms — every node "matched" position (0,0,0) and the assignment silently scrambled 431 parts. The resulting degree/volume table looked plausible ("Seal Electronics Box, degree 19, 742cm³") and drove two wrong fix iterations before the graph.json bboxes exposed it.

**Problem:** A shuffled mesh↔name assignment still produces plausible-looking planner output — garbage in, plausible garbage out. Name-prefix or transform heuristics have no error signal of their own.

**Rule:** When joining GLB scene nodes to graph.json nodeIds, match on world BBOX against graph.json's per-leaf bbox (authoritative, written by the same converter) and assert coverage (all nodes matched, max error < 1mm) before trusting any downstream analysis. `/tmp`-fixture recipe: parse the GLB JSON chunk for extras + walk scenes for world matrices, then bbox-match to trimesh geometry.

**Applies to:** acceptance/repro scripts over viewer GLBs; any offline analysis pairing `graph.json` with `model.glb`.
