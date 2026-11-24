---
paths: ["packages/viewer/src/useBuildFrame.ts", "packages/viewer/src/orientation.ts"]
triggers: ["GizmoHelper", "camera.up"]
promoted: null
---
# drei GizmoHelper resets camera.up after a viewcube click

**Context:** The assembly player shows a step's build orientation by rolling the camera (`camera.up` = the bench's up in the model frame, `packages/viewer/src/orientation.ts`).

**Problem:** drei's `GizmoHelper` writes `camera.up` on every frame of a face-click tween and resets it to the value it saw at mount when the tween ends (`core/GizmoHelper.js`). After one viewcube click the build stood upright again, and every later turn started from the wrong up.

**Rule:** Do not patch drei. Anything that owns `camera.up` must re-assert it in its own frame loop whenever it drifts outside its own animation.

**Applies to:** `packages/viewer/src/useBuildFrame.ts` (its `useFrame`), any code that sets `camera.up` under `GizmoHelper` or `OrbitControls`.
