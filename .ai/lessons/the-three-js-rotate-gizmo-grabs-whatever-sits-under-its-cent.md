---
paths: []
triggers: []
promoted: null
---
# The three.js rotate gizmo grabs whatever sits under its center

**Context:** The assembly path editor shows drei `TransformControls` (`mode="rotate"`) on a selected waypoint, whose draggable sphere sits at the gizmo's center.

**Problem:** In rotate mode the gizmo adds an invisible free-rotation picker — a sphere of radius 0.7 × gizmo size (`XYZE` in three-stdlib `controls/TransformControls.js`) — centred on its object. Dragging the waypoint sphere started that free rotation as well as the drag, so one gesture moved the part and spun it at once (2026-10-08).

**Rule:** Never let a rotate gizmo and another drag handle share a position. Make it a mode: either the handles drag or the rings show, never both. The path editor's Move / Rotate tool is the precedent (`MotionPathEditor.tsx`, `tool`).

**Applies to:** any `TransformControls` / `PivotControls` placed on top of an existing pointer handle in `packages/viewer`.
