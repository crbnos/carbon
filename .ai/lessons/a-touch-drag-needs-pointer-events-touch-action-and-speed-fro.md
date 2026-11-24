---
paths: []
triggers: []
promoted: null
---
# A touch drag needs pointer events, `touch-action`, and speed from the moves

**Context:** A gesture audit drove the code with Chrome's real touch input. The
inspection splitters, a dozen drag handles and the bottom sheet's flick all failed.

**Problem:** A finger fires no `mousemove`, so a `onMouseDown` drag is dead on touch,
and `touch-none` hides that. A `PointerSensor` or Motion `dragControls` handle without
`touch-action: none` gets one move, then `pointercancel`, and the page scrolls. A
`pointerup` carries the last move's position, so its distance from that move is 0 and
a flick reads as no speed. A `TouchSensor` activates with a `TouchEvent`, which has no
`clientY`.

**Rule:** Start a drag with pointer events and capture. Put `touch-none` on a handle;
a whole draggable row or card uses `MouseSensor` + `TouchSensor` with a delay instead,
plus `pointer-coarse:select-none`, because the hold that starts the drag also selects text.
ERP sensor options come from `~/utils/drag-sensors`, never a local constant, so every
drag starts the same way; only a custom keyboard `coordinateGetter` stays with its board.
Read a release's speed from the moves (`releaseVelocity`). Read a dnd-kit
`activatorEvent` with `getEventCoordinates`. The `width >= 48rem` clause of the `hover`
variant in `theme.css` is what lets a tap reveal `md:opacity-0 group-hover:opacity-100`
controls on a tablet: do not remove it without another way to reach them.

**Applies to:** anything the user drags; `packages/react/src/utils/drag.ts`,
`usePaneResize`, dnd-kit sensor choices, `packages/config/tailwind/theme.css`.
