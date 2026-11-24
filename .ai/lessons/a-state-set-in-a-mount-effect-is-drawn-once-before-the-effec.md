---
paths: []
triggers: []
promoted: null
---
# A state set in a mount effect is drawn once before the effect runs

**Context:** The quote explorer's method tree mounted with every node expanded
and collapsed it to one level in a `useEffect`.

**Problem:** React paints before it runs `useEffect`. The browser drew the whole
tree open for one frame, then the effect collapsed it, so every expand of a
line jittered. Nothing in the code looks wrong; it shows only frame by frame.

**Rule:** When a component's first state is known at render time, give it as
the initial state (`useTree`'s `collapsedIds`, a `useState` initializer), not as
a correction in an effect. If it can only be computed after layout, use
`useLayoutEffect`.

**Applies to:** `BoMExplorerProvider` / `useTree` callers, and any component
that sets expanded, selected or measured state on mount.
