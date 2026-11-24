---
paths: ["apps/erp/app/modules/workflows/ui/Builder/**"]
triggers: ["@xyflow/react", "useUpdateNodeInternals"]
promoted: null
---
# Never hand-measure React Flow handle positions; and never `stopPropagation` inside a node

**Context:** `apps/erp/app/modules/workflows/ui/Builder/NodeCard.tsx` needed one
source handle per condition path, and needed nodes draggable from their body.

**Problem:** Two separate self-inflicted bugs. (1) Handle rows were measured with
`getBoundingClientRect()` and the offset written to `style.top`. `getBoundingClientRect()`
returns **zoom-scaled** pixels but `style.top` is applied *inside* the zoom transform,
so every handle sat at the wrong height at any zoom except 1.0 — and the effect
depended on the freshly-built `ports` array, so it re-ran and re-set state every
render. (2) The body used `onPointerDown={e => e.stopPropagation()}` on interactive
targets to stop React Flow dragging. React's `stopPropagation` also stops the native
event reaching `document`, and Radix `DismissableLayer` dismisses on a document-level
`pointerdown` — so every dropdown inside a node became impossible to close.

**Rule:** React Flow measures handle bounds from the DOM itself (zoom-aware) — put
the `<Handle>` inside a `position: relative` row and let its default
`.react-flow__handle-right` CSS anchor it; call `useUpdateNodeInternals(nodeId)`
when the handle set or node size changes, and never compute `top`/`right` yourself.
To exempt something from dragging, toggle React Flow's own `nodrag` class (a
capture-phase `pointerdown` listener runs before its bubble-phase drag listener) —
never `stopPropagation`, which silently breaks every portalled overlay's dismissal.

**Applies to:** `apps/erp/app/modules/workflows/ui/Builder/**`, and any `@xyflow/react`
canvas hosting Radix popovers/selects.
