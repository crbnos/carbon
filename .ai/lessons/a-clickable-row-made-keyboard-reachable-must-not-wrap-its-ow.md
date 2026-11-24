---
paths: []
triggers: []
promoted: null
---
# A clickable row made keyboard-reachable must not wrap its own controls

**Context:** Turning on Biome's `useKeyWithClickEvents` / `noStaticElementInteractions` meant giving every clickable `div` a role, `tabIndex` and an Enter/Space handler.

**Problem:** The quick fix, `role="button"` on the row, was applied to rows that already held a link, a chevron button or a date picker (document line summaries, share pages, the BOM list title). A button's children are presentational, so a screen reader hears one button named after the whole row and cannot reach the controls inside. A keyboard user gets two tab stops for one toggle. And a row handler that calls `preventDefault()` on Enter with no target check swallows Enter on the link inside, which then opens the row instead of following the link. Lint, typecheck and tests all pass.

**Rule:** Before adding `role="button"`, look inside the element. If it holds a link, button or field, keep the row pointer-only (`biome-ignore` with the reason, ignore clicks on `a, button`) and make the existing chevron or a stretched link the control. Any `role="button"` Enter/Space handler starts with `if (e.target !== e.currentTarget) return;`. A page-wide bare-key shortcut (MES Space) checks `isBareKeyForAnotherControl` in its guard.

**Applies to:** every a11y lint fix on a clickable container; `conventions-ui.md` → Accessibility tree.
