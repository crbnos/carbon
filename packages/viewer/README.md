# @carbon/viewer

Animated assembly work-instruction playback built on react-three-fiber.
Implements the shared contracts in
`docs/specs/animated-work-instructions-contracts.md` (graph.json, step motion
JSON, `AssemblyStep`, and the step playback semantics).

## Usage

```tsx
import { AssemblyPlayer, type AssemblyStep } from "@carbon/viewer";

const steps: AssemblyStep[] = [
  {
    id: "step-1",
    title: "Install base plate",
    instructionText: "Lower the base plate onto the fixture.",
    componentNodeIds: ["a1b2c3d4e5f60718"],
    motion: { type: "linear", direction: [0, 0, -1], distance: 80 },
    camera: null,
    fastener: null
  }
];

<AssemblyPlayer
  glbUrl={signedGlbUrl}      // meshopt-compressed GLB with nodeId extras
  graphUrl={signedGraphUrl}  // graph.json from the geometry service
  steps={steps}
  activeStepIndex={activeStepIndex}
  onStepChange={setActiveStepIndex}
  onSelectParts={(nodeIds) => ...} // editor: click-to-select (shift = additive)
  readOnly                   // MES: disables part selection
  mode="dark"
  className="h-[480px]"
/>;
```

## Step playback semantics

For active step `k` (0-based):

- parts of steps `< k` are shown **solid** at their final pose
- parts of step `k` **animate** their insertion motion (looping, with a short
  hold at the seated pose) and are highlighted
- parts of steps `> k` are **hidden**, or **ghosted** wireframe when the
  x-ray toggle is on
- parts in no step (base/fixture parts) are always shown solid

Motion JSON describes the **insertion** of the step's parts; the viewer
derives the displaced start pose from it. `path` motions are absolute world
poses (`t` normalized 0..1, strictly increasing, last keyframe must equal the
part's final pose). `camera: null` auto-frames the active parts.

## Building blocks

- `useAssembly(glbUrl, graphUrl)` — loads the GLB (meshopt decoding wired)
  and graph.json; returns `{ scene, nodesById, graph, isLoading, error }`.
  `nodesById` maps stable nodeIds (glTF `extras.nodeId`) to `Object3D`s.
- `motionToKeyframes(motion, basePose, opts)` / `buildStepClip(step,
  nodesById, opts)` — pure keyframe/clip construction, unit-testable without
  WebGL.
- `AssemblyViewer` — bare Canvas wrapper (lights + orbit controls) for
  custom scenes.

## Integration notes

- The footer controls use Carbon design-token Tailwind classes
  (`bg-background`, `text-muted-foreground`, `accent-primary`, ...); the
  consuming app's Tailwind build must scan `packages/viewer/src` as a source.
- Peer deps: `react` / `react-dom` 18. Three is pinned to `0.163.0` to match
  `@carbon/react`.
