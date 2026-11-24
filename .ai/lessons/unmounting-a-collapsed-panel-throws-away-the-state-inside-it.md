---
paths: []
triggers: []
promoted: null
---
# Unmounting a collapsed panel throws away the state inside it

**Context:** Collapsed line panels on the document summaries stayed mounted at
height 0, so their controls stayed in the tab order. The fix renders the panel
only while open.

**Problem:** On `share+/supplier-quote.$id.tsx` the panel's `LinePricing` holds
the supplier's typed prices in local state. Unmounting it on collapse would
reset them to the saved values, and the screen and the submission would
disagree.

**Rule:** Before unmounting a collapsed panel, check what state lives inside
it. If any must survive, keep it mounted and end the Motion collapse with
`transitionEnd: { display: "none" }`; that also takes it out of the tab order.

**Applies to:** every expand/collapse panel built with Motion.
