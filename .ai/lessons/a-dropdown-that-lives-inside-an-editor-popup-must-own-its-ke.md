---
paths: []
triggers: []
promoted: null
---
# A dropdown that lives inside an editor popup must own its keys on the document, not take them from its host

**Context:** The workflow builder's variable menu (`apps/erp/app/modules/workflows/ui/Builder/fields/VariableTreeMenu.tsx`), hosted both inside a tiptap suggestion popup and inside a Radix popover. Arrow-key navigation stayed dead across two rounds of fixes.

**Problem:** The menu exposed a `ref` handle and relied on each host to call it — the tiptap suggestion plugin's `onKeyDown` delegation in one case, the popover search input's `onKeyDown` in the other. That chain is long (ProseMirror direct props → plugin order → `ReactRenderer` ref → imperative handle) and every link is invisible when it breaks: the menu still renders, so the failure looks like "keys do nothing" with no error anywhere. Debugging it by reading the chain repeatedly produced plausible-but-wrong root causes.

**Rule:** Bind the navigation keys in a `document` `keydown` listener in the **capture** phase, inside the menu component itself, and `preventDefault()` + `stopPropagation()` only for keys it claims. The host then cannot swallow or fail to forward anything, and both hosts get identical behaviour for free. Guard the listener on the menu's own root being connected and visible — a popup that is *hidden* rather than unmounted (tippy's `hide()`) leaves the component mounted and would keep eating keys. Never claim `Escape`; dismissal belongs to the wrapping popup. Keep DOM focus in the field being typed into (search-as-you-type depends on it) and mark the highlighted row `aria-selected` instead of focusing it.

**Applies to:** any menu rendered by tiptap's `ReactRenderer` or otherwise mounted outside the React tree that owns the focused input.
