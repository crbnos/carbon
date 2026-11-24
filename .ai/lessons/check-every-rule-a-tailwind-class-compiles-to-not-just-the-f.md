---
paths: ["packages/config/tailwind/theme.css"]
triggers: ["ease-drawer", "tailwindcss-animate"]
promoted: null
---
# Check every rule a Tailwind class compiles to, not just the first

**Context:** Verifying whether `ease-drawer` changes the Drawer's
`tailwindcss-animate` slide.

**Problem:** The compiled CSS has two `.ease-drawer` rules: Tailwind's
(`transition-timing-function`) and `tailwindcss-animate`'s
(`animation-timing-function`). Reading only the first match gave the wrong
answer that the class did not reach the animation.

**Rule:** When checking a utility's effect, print every rule for its selector.
`ease-*` classes set the animation curve as well as the transition curve.

**Applies to:** `packages/config/tailwind/theme.css` tokens and any check of
compiled Tailwind output.
