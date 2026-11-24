---
paths: ["apps/erp/app/components/Table/Table.tsx"]
triggers: ["forceEditMode"]
promoted: null
---
# Seeding useState from a prop goes stale when the document flips state in place

**Context:** After Rectify flipped a Posted inventory count back to Draft, the lines table stayed read-only until a full page reload.

**Problem:** `Table` read `forceEditMode` only as the `useState` initial value. Rectify/Post actions revalidate the route in place — the component never remounts, so the prop change never reached the state, and the Edit/Lock toggle is hidden while `forceEditMode` is set, leaving no way to recover. The same staleness applied in the opposite direction after posting a Draft (table looked editable on a read-only document).

**Rule:** When a prop derives from a document's mutable status (Draft/Posted etc.) and controls interaction mode, sync it with an effect (`useEffect(() => setEditMode(forceEditMode), [forceEditMode])`) or derive it instead of seeding state once. Test the transition without a reload — loader revalidation does not remount components.

**Applies to:** `apps/erp/app/components/Table/Table.tsx` (`forceEditMode`), any component seeding state from status-derived props on revalidating routes.
