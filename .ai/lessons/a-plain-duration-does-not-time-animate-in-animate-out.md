---
paths: ["packages/react/src/Modal.tsx", "packages/react/src/Drawer.tsx", "packages/react/src/BottomSheet.tsx"]
triggers: ["animate-in", "animate-out"]
promoted: null
---
# A plain `duration-*` does not time `animate-in` / `animate-out`

**Context:** The modal was meant to open in 200ms and the drawer in 300ms; both opened in 150ms.

**Problem:** `tailwindcss-animate`'s `animate-in` / `animate-out` set `animation-duration` themselves (the 150ms default). They are used as `data-[state=open]:animate-in`, and a state-variant rule comes after a plain `duration-300` in the CSS, so the plain duration never applied. Only the closing durations, already written as `data-[state=closed]:duration-200`, worked. Nothing looked wrong: the motion was simply shorter than the class said.

**Rule:** Time an enter/exit animation on its state variant — `data-[state=open]:duration-300 data-[state=closed]:duration-200` — never with a bare `duration-*` beside `animate-in`. Verify with `getComputedStyle(el).animationDuration` in each state, not by reading the class list. The motion scale is in `.claude/rules/conventions-ui.md` (Animations).

**Applies to:** `Modal.tsx`, `Drawer.tsx`, `BottomSheet.tsx` (fixed), and any component that pairs `animate-in`/`animate-out` with a duration.
