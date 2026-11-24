---
paths: []
triggers: []
promoted: null
---
# A temporary override lives in the thing it overrides, not in its callers

**Context:** Halloween had to be the theme for everyone while in season (2026-10). The first cut replaced the cookie read in all three apps' `getTheme` (`services/theme.server.ts`) with `resolveTheme(halloweenTheme.name)`.

**Problem:** Undoing it meant rewriting three deleted cookie reads from memory, and nothing pointed at them: deleting `halloween-theme.ts` would just break the imports. The mesh colors in `MeshGradientBackground.tsx` (a `Record<string, …>`, so no compile error) and a test that imported the theme directly had the same shape. The removal checklist went stale twice as pieces were added.

**Rule:** Put a seasonal or temporary behaviour on the removable unit itself (its `available` window and `mesh` on the `SeasonalTheme`, read by the shared resolver) and keep callers generic, so deleting the unit turns the behaviour off. Test the mechanism on a fixture, not on the instance. Keep ONE removal checklist, next to the code, and make every other comment point to it.

**Applies to:** `packages/utils/src/themes.ts` seasonal themes, `packages/react/src/Halloween/`, any feature flag, promo or seasonal UI.
