---
paths: []
triggers: []
promoted: null
---
# A drawer rendered as `{item && <Drawer />}` cannot animate closed

**Context:** The planning order drawer slid in but vanished on close.

**Problem:** Three things each removed it before a closing animation could run. The tables
rendered it as `{selectedItem && <Drawer />}` and closed it by clearing `selectedItem`, so
it left the DOM in the same render. The shared `Drawer` panel only had a slide-IN. And Radix
keeps a closing dialog mounted only while the element its portal wraps is animating — that
element is `DrawerPortal`'s positioning div, which had no animation, so even a mounted
drawer with an exit animation on its panel was removed at once. Adding the exit classes to
the panel alone changed nothing; the frame-by-frame trace still showed zero closing frames.

**Rule:** A drawer that should animate closed stays mounted and is driven by `open`; keep the
record it shows until the next open (`useDrawerItem`), and key it per open so each open
still starts fresh. When a Radix exit animation does not play, check every element between
the portal and the animated node — each `Presence` looks only at its own child. Verify with
a trace of `data-state` and `getBoundingClientRect()` per frame, not by eye.

**Applies to:** `packages/react/src/Drawer.tsx` (`portalVariants` + `sheetVariants` closing
durations must match), `useDrawerItem` (`apps/erp/app/hooks`), both planning tables, and every
other modal and drawer (see the next lesson).
