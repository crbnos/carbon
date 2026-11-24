---
paths: []
triggers: ["useResizeObserver"]
promoted: null
---
# Content sized from its own scroll box needs a fixed scrollbar

- **Context:** The document preview draws PDF pages at the width of the box that scrolls them.
- **Problem:** A page about as tall as the box looped forever: the scrollbar narrowed the box, the narrower page fit, the scrollbar left, the wider page no longer fit. It redrew about 60 times a second, at only some window heights, so it looked like a random flicker on open.
- **Rule:** When a box's content takes its size from the box, keep the scrollbar's space fixed (`overflow-y-scroll`) so the width cannot depend on the content's height.
- **Applies to:** Any `useResizeObserver` width that sizes content inside the observed scroll box.
