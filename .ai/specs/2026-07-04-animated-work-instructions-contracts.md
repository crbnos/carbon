# Animated Work Instructions — Shared Contracts (Phase 0)

These contracts bind three components: the geometry service (`services/geometry`,
Python), the viewer (`packages/viewer`, TypeScript), and the ERP/Inngest layer.
Change them only by updating all three.

## 1. Stable node IDs

Every part instance in the assembly gets a stable `nodeId`:

```
nodeId = sha1(geometryHash : parentPath : siblingOrdinal)[:16]
```

- `geometryHash`: sha1 of the part's tessellated geometry (vertex positions quantized
  to 1e-3 mm, triangle indices), independent of placement.
- `parentPath`: '/'-joined product names from root to parent.
- `siblingOrdinal`: 0-based index among siblings sharing the same geometryHash and
  parent (disambiguates 4 identical brackets).

The `nodeId` appears in (a) glTF node `extras.nodeId`, (b) `graph.json` nodes,
(c) `assemblyInstructionStep.componentNodeIds`.

## 2. graph.json (written by /convert)

```jsonc
{
  "version": 1,
  "unit": "mm",                  // normalized output unit (always mm in Phase 0)
  "sourceUnit": "inch",          // unit declared in the STEP file
  "componentCount": 42,               // count of leaf instances
  "root": {                      // assembly tree, root has no geometry
    "nodeId": "a1b2c3d4e5f60718",
    "name": "MAIN-ASSY",
    "isAssembly": true,
    "geometryHash": null,        // null for assemblies
    "transform": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], // local, column-major 4x4
    "bbox": { "min": [0,0,0], "max": [100,50,25] },     // world-space, mm
    "volume": 1234.5,            // mm^3, leaf nodes only (null for assemblies)
    "color": [0.5, 0.5, 0.5, 1], // RGBA 0-1 or null
    "children": [ /* same shape */ ]
  }
}
```

## 3. Geometry service API

Auth: `Authorization: Bearer <GEOMETRY_SERVICE_API_KEY>` (shared secret env var on
both sides).

### POST /convert
```jsonc
// request
{
  "jobId": "string",                  // assemblyPlanJob.id, used in logs
  "source": { "url": "https://signed-get-url", "format": "step" },
  "outputs": {
    "glb":   { "url": "https://signed-put-url" },
    "graph": { "url": "https://signed-put-url" }
  },
  "options": { "linearDeflection": 0.1, "angularDeflection": 0.5 } // optional
}
// response 200 (synchronous in Phase 0; Inngest applies its own timeout/retries)
{ "ok": true, "componentCount": 42, "unit": "mm", "stats": { "convertMs": 1234, "meshTriangles": 100000 } }
// response 4xx/5xx
{ "ok": false, "error": "human-readable message", "code": "READ_FAILED" | "TESSELLATION_FAILED" | "UPLOAD_FAILED" | "INVALID_INPUT" | "LIMIT_EXCEEDED" | "BUSY" }
// status mapping: 400 INVALID_INPUT (incl. URL policy violations), 413
// LIMIT_EXCEEDED (source size / part count), 422 READ_FAILED, 429 BUSY (no
// conversion slot free — caller should retry with backoff), 500
// TESSELLATION_FAILED, 502 UPLOAD_FAILED.
```

### GET /health → `{ "ok": true, "version": "x.y.z" }`

### POST /plan (async: submit → poll)

Computes a collision-free insertion motion for every leaf part plus a
constraint-consistent assembly sequence. Re-tessellates the same STEP source
with the same nodeId derivation as /convert, so plan.json keys join against
graph.json and GLB extras.

**Async** (v3): planning a large model runs 10+ minutes — longer than any single
HTTP request survives across the Inngest → tunnel → app → tunnel → geometry hops
(and a pre-signed upload URL's 60s TTL). So `/plan` starts the work in a
background thread and returns **202 immediately**; the caller polls
`GET /plan/{jobId}` until it reports `done` and then persists the inline plan
itself (the worker uploads plan.json with its service-role client — no expiring
URL). Submits are idempotent: a duplicate `/plan` for a jobId already running
attaches to it rather than starting a second planner.

Pipeline: **merge `options.units` into single rigid bodies** (a purchased PCB's
hundreds of component solids → one body; see units below) → classify named
fasteners (symmetry axis + threaded mates) → rigid-merge inseparable pairs →
greedy disassembly for motions → precedence DAG + preference topo sort → forward
verification → **expand merged units back to member leaves** (each carries the
unit's motion + `groupId`; the unit is one `groups` entry).

```jsonc
// POST /plan request
{
  "jobId": "string",                 // the caller's plan-job id; also the poll key
  "source": { "url": "https://signed-get-url", "format": "step" },
  "options": {                       // all optional
    "linearDeflection": 0.1,
    "angularDeflection": 0.5,
    "clearance": 0.5,                // mm of required clearance along the path
    "pathSamples": 60,               // collision checks per candidate path
    // Pre-grouped units: leaf nodeIds merged into one rigid body for planning,
    // then expanded back to members (one step, one motion). Derived app-side
    // from BOM membership + an LLM part→BOM assignment + user overrides.
    "units": [ { "id": "unit:<itemId>", "name": "BCU PCB", "nodeIds": ["leaf1", "..."] } ]
  }
}
// POST /plan response 202 — accepted, running in the background
{ "ok": true, "jobId": "string", "status": "pending" }

// GET /plan/{jobId} response 200
{ "ok": true, "status": "pending" | "running" | "done" | "error",
  // present only when status == "done":
  "plan": { "version": 3, "unit": "mm", "sequence": ["..."], "components": { }, "groups": { } },
  "componentCount": 431, "plannedCount": 424,
  "stats": { "planMs": 105000, "verifiedCount": 18,
             "tiers": { "linear": 13, "l": 4, "escape": 0, "group": 0, "flagged": 2, "forced": 0, "unplanned": 0 },
             "warnings": [] },
  // present only when status == "error":
  "error": "message" }
// unknown jobId → 404; errors otherwise use the same codes/status mapping as /convert
```

plan.json is **version 3**: `groups` entries gain an optional `name` (the unit's
BOM/subassembly name → the draft step title). A merged unit's member leaves each
carry `groupId` (= the unit id) and sit consecutively in `sequence`, so
`buildAssemblyStepGroups` folds them into one step.

Motion tiers: 1 = straight-line removal (the part's symmetry axis first, then
the six world axes; **named fasteners only ever exit along their bore axis**,
with contacts against their threaded mate allowed up to the seated
interference — there is no blanket penetration allowance, so thin blockers
can never be tunneled), 2 = fixed lift-then-slide "L", 3 = adaptive
multi-segment escape (BFS over axis-aligned hops), group = subassembly
extraction in stuck states (mutually interlocked parts that remove as one
unit — members share one step and one motion), flagged = **no collision-free
escape exists: motion stays "none"**, blockers are recorded, and the viewer
fades the parts in at the seated pose. The planner never fabricates a motion
through geometry; `tiers.forced` is always 0 and remains only for stats
compatibility.

Sequence: after motions are chosen (per part: the least-entangling clear
direction — fewest full-assembly sweep blockers, natural-axis order as the
tiebreak; recorded travel is "reach free space", not exit-the-bounding-box),
the order comes from a precedence DAG topologically sorted with
preferences.

Hard edges, all cycle-guarded:
- **Derived**: U before X when X's seated body blocks U's insertion sweep.
- **Joint**: everything a fastener joins — threaded mates plus every part
  whose material radially surrounds its shank (ring-containment probes at
  the shank radius, just outside the candidate's own bore, and at the
  bore-rim height) — installs before it; the one inversion is a disc mate
  (nut) after its rod fastener. Washer-before-bolt is therefore
  unconditional, slip fits and counterbores included.
- **Joint-stack**: a joint's members order by WHERE they engage the shank,
  tip → head (head = the fastener's geometrically widest end) — the bolt
  clamps the head-side part onto the tip-side part, across CAD air gaps.
- **Support**: for mostly-vertical structure-structure seated contact
  (hemisphere-aligned normals), the lower part precedes the upper.
- **Sandwich**: a thin part with seated contact on BOTH sides along one
  shared contact axis (gasket, seal, shim — detected from contact-point
  positions and the winding-invariant structure tensor, never bbox
  z-centers, which degenerate for thin parts) assembles after its
  heavier side (the enclosure) and before its lighter side (the
  compressor). Detection is strict because a false positive corrupts
  collision truth: thickness is capped relative to the part's largest
  extent AND absolutely (≤ ~6mm — gaskets are thin in millimeters), and
  the observed interference must be squish-scale (≤ ~0.6mm; a 10mm bite
  is a press fit or broken CAD, never compliance). Sandwich edges are
  added BEFORE support edges so the cycle guard rejects a wrong
  z-center-degenerate support edge. Near-equal sides add nothing rather
  than guessing.

Preferences, in order: the base first (the biggest part survives greedy
disassembly by design); runs of identical parts kept together; **securing
fasteners** — those whose joint contains a through-part that is neither
their threaded mate nor the base — immediately after their joint
completes (anchor bolts into the skeleton take no jump); the
**dependency spine** — parts other parts are waiting on (outgoing
precedence edges: their insertion window closes, or later parts build on
them) precede terminal parts nothing depends on, regardless of size (a
small slider beats a big badge subassembly; deferring the terminal
accessory also defers its fasteners' securing jump, so a structural
joint's fasteners aren't interrupted by accessory hardware); then
structure big → small by MATERIAL volume (watertight mesh volume, else
the sum of watertight split bodies, else bbox — bboxes lie for tilted and
wrap-around parts), with horizontal centrality as the tiebreak —
EXCEPT **weakly-secured terminal parts** (no fastener engages them, no
outgoing precedence edge, exactly one seated structural neighbor, AND a
verified tier-1/2 clean removal — snap clips, badges), which go last
regardless of size. The removability-evidence gate matters on real CAD:
fastener detection is name-only and clearance fits hide contacts, so
the static signal alone matches a large share of a wire harness.
Escape/flagged parts and bbox proxies never demote. This is a topo-sort
preference ONLY — the greedy removal priority deliberately ignores it,
because that ranking schedules expensive removal attempts and picks
flag/merge victims, and fronting hard-to-remove one-contact parts
(cables, interlocked clips) multiplies failed sweeps.

Fastener axes come from an evidence cascade: own symmetry (SVD) → bbox
shape → thread-mate contact band → the full seated contact cloud → the
dominant contact normal; along its bore axis a fastener keeps sliding
engagement with its joint (allowances capped at seated interference /
mesh tolerance). Sandwiched parts and their flanges likewise exchange a
seated-interference allowance (observed depth + the mate margin, valid
ONLY along the sandwich axis — lateral motion is judged strictly, like a
thread mate along its bore) — a compressed gasket's squish is
evidence-backed compliance, same reasoning as thread interference, so it
never reads as a blocking collision during removal sweeps or forward
verification. Collision tolerance scales with tessellation:
max(0.15mm, 2.5 × linearDeflection).

Unresolvable geometry is handled by evidence, never fabrication: a stuck
part blocked by exactly ONE other (captive SEMS washers, coincident CAD
variants) rigid-merges into it (`mergedInto`) — sandwiched parts are
exempt on both sides (a gasket pressed into its lid is compliant, not
rigid with it) and their deep bites don't deprioritize them as group
members; mutually interlocked sets that clear together become
subassembly `groups`; anything else is flagged with its real sweep
blockers. Finally the whole sequence is
forward-verified: each part's insertion is re-checked against exactly the
parts present at that point; failures demote to flagged
(`verified: false`).

plan.json (returned inline in the `done` poll response; the caller persists it):

```jsonc
{
  "version": 3,
  "unit": "mm",
  "sequence": ["nodeId", "..."],     // constraint-consistent assembly order; [0] is the base
  "components": {
    "<nodeId>": {
      "motion": { /* INSERTION motion per §4 (removal reversed) */ },
      "confidence": "high" | "low",
      "removalDirection": [0, 0, 1], // unit vector, removal sense
      "tier": "linear" | "L" | "escape" | "group" | "flagged" | "base",
      "verified": true,              // forward-verified against its predecessors
      "blockedBy": ["nodeId"],       // flagged parts: what obstructs them
      "groupId": "g1",               // subassembly members (see groups)
      "mergedInto": "nodeId"         // rigidly merged: rides the host's step
    }
  },
  "groups": {                        // subassembly units (optional)
    "g1": { "componentNodeIds": ["nodeId", "..."], "motion": { /* shared */ },
            "name": "BCU PCB" }      // v3: unit name → step title (optional)
  },
  "warnings": ["..."]                // one entry per flagged part / merge / skipped preference
}
```

All v2/v3 fields are optional additions — older files keep parsing. Bumping the
version invalidates stored plans (consumers treat below-current as absent and
re-plan), which is how pre-grouping (v2) plans get replaced.

Editor semantics: when a step's `componentNodeIds` change, motion is auto-filled
from plan.json (single part → its motion; multiple parts → the shared motion
if all agree, else the first part's motion with confidence low). Parts the
plan flagged are never auto-filled — their recorded motion is "none" and the
editor shows the blockers. When the plan has nothing for the parts,
`synthesizeFallbackMotion` (`@carbon/viewer`) derives an AABB-based motion
from graph.json so the step still animates; the manual motion form is an
override, only shown on demand. `buildAssemblyStepGroups` (`@carbon/viewer`)
turns a plan into draft step groups: sequence order, consecutive identical
parts merged, subassembly units one step, merged parts riding their host's
step, flagged parts stored with motion "none" plus a
`warnings: { flagged, blockedBy }` payload on `assemblyInstructionStep`.
A step's parts animate SIMULTANEOUSLY, so merging is corridor-gated: each
part's swept corridor (AABB of its seat pose union every insertion pose,
from graph.json bboxes) must be disjoint from every corridor already in
the step. Side-by-side same-direction screws share a step; clips sliding
in-line into the same channel each take their own step (the only way
their simultaneous animation avoids collision). Subassembly units (one
rigid body) and graph-less calls are exempt.
"Generate Steps" refuses while steps exist; `mode=regenerate` replaces them,
guarded against manually authored (`planConfidence: "manual"`) or Done steps.

### Operational limits (service env vars)

- `GEOMETRY_MAX_SOURCE_MB` (default 250) — source download cap
- `GEOMETRY_MAX_PARTS` (default 5000) — leaf instances, checked before meshing
- `GEOMETRY_MAX_CONCURRENCY` (default 2) — conversion slots per worker; excess → 429 BUSY
- `GEOMETRY_ALLOWED_URL_HOSTS` (optional, comma-separated) — allowlist for
  source/output URL hosts (set to the Supabase storage host in production)
- `GEOMETRY_DEV_MODE=true` — permits http URLs and unauthenticated access when
  no API key is set (local dev only)

## 4. Step motion JSON (`assemblyInstructionStep.motion`)

Describes the **insertion** motion of the step's parts into the assembly. The viewer
derives removal (the reverse) and start poses from it. Distances in mm, in the same
world space as the GLB.

```jsonc
// linear insertion along a vector
{ "type": "linear", "direction": [0, 0, -1], "distance": 80 }

// multi-segment (2+, insertion order), e.g. slide then drop; the tier-3
// escape planner emits up to 3 segments and the viewer interpolates any count
{ "type": "L",
  "segments": [
    { "direction": [1, 0, 0], "distance": 60 },
    { "direction": [0, 0, -1], "distance": 20 }
  ] }

// threaded fastener: helix about axis, then it is seated
{ "type": "helix", "axis": [0, 0, -1], "origin": [10, 20, 5],
  "pitch": 0.8, "turns": 6, "approach": 30 } // approach = linear travel before threading

// explicit keyframe path (planner tier 5 / manual freeform)
{ "type": "path", "keyframes": [
    { "t": 0,   "position": [0,0,100], "quaternion": [0,0,0,1] },
    { "t": 1,   "position": [0,0,0],   "quaternion": [0,0,0,1] }
  ] }

// no geometry motion (process-only step: cure, inspect, torque pattern)
{ "type": "none" }
```

`camera` JSON: `{ "position": [x,y,z], "target": [x,y,z], "fov": 45 }` or `null`
(viewer auto-frames the active parts).

`fastener` JSON: `{ "spec": "M5 SHCS", "count": 4, "torqueNm": 8, "tool": "4mm hex" }`
(all fields optional).

## 5. Viewer step shape (props of AssemblyPlayer)

```ts
type AssemblyStep = {
  id: string;
  title: string | null;
  instructionText: string | null; // derived plain-text snapshot of the step's
                                  // rich-text `description` (tiptap JSON)
  componentNodeIds: string[];     // components installed in this step
  motion: Motion;            // section 4
  camera: CameraPose | null;
  fastener: Fastener | null;
};
```

The DB row behind this carries more authoring data than the viewer consumes:
`assemblyInstructionStep` also has the typed-step fields mirrored from
`jobOperationStep` (`type` `procedureStepType`, `description` tiptap JSON,
`required`, `unitOfMeasureCode`, `minValue`/`maxValue`, `listValues`,
`fileTypes`) so steps can eventually be copied into job operations, and
BOM-part associations live in `assemblyInstructionStepMaterial`
(`stepId` → `itemId` + optional quantity; stored by itemId so links survive
make-method re-versioning).

Playback semantics for step k (0-based): parts of steps < k are shown solid in final
pose; parts of step k animate per `motion` (looping); parts of steps > k are hidden
(or ghosted when the "x-ray" toggle is on). Parts in no step are always shown solid
(base/fixture parts).
