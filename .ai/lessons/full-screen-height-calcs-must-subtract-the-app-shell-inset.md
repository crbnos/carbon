---
paths: []
triggers: []
promoted: null
---
# Full-screen height calcs must subtract the app-shell inset

**Context:** The ERP app shell (`apps/erp/app/routes/x+/_layout.tsx`, PR #1551) moved
content into an inset floating panel with `md:mt-2 md:mb-2` (8px top + 8px bottom
gutters). ~81 full-screen pages/explorers sized themselves with
`calc(100dvh - var(--topbar-height) [- var(--header-height)])`, which assumes the
content spans the full viewport.

**Problem:** Those containers are 16px taller than the panel at md+, so bottom-pinned
content is pushed below the panel's clipped edge. The Procedures "Add Step" footer was
sheared in half; the overflow was invisible on pages whose content merely scrolls.

**Rule:** `vh`/`dvh` ignore the panel inset by nature, so any full-height calc inside the
content panel must subtract `var(--content-inset)` (defined in `styles/tailwind.css`: 0
below md, 1rem at md+), e.g. `h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]`.
Prefer `h-full`/flex height inheritance from `<main>` for new pages so the inset never
has to be tracked by hand. Do NOT add the inset to viewport-fixed/body-portaled elements
(dialogs, drawers) or to `PrimaryNavigation`, which live outside the panel.

**Applies to:** every `calc(100dvh-var(--topbar-height)...)` in `apps/erp/app`, the shared
`components/Layout/Panels.tsx` + `Navigation/CollapsibleSidebar.tsx`, and any new
full-screen ERP route.
