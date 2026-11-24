---
paths: []
triggers: []
promoted: null
---
# `setGenericQueryFilters` erases a query's row type

**Context:** Inventory → Receiving read a view through `setGenericQueryFilters` and its route annotated the rows with a hand-written type (2026-10-26).

**Problem:** The helper's signature is typed loosely (it carries `@ts-expect-error`), so whatever it returns awaits to rows of type `any`. An annotation on those rows is an unchecked cast: renaming a column in the select string, or dropping it from the view, compiles clean and renders blank. Types in `types.ts` derived through `ReturnType<typeof getX>` are `any` the same way.

**Rule:** Keep the typed builder. Assign the helper's result back to the query variable (`query = setGenericQueryFilters(query, { filters })`), which keeps the variable's declared type, then apply the sort and `.range()` on it directly. Derive the row type from that function in `types.ts`, and narrow a view's never-null keys once at the loader boundary rather than guarding them in components.

**Applies to:** list reads in `apps/erp/app/modules/*/*.service.ts` that call `setGenericQueryFilters`, and the `types.ts` row types derived from them.
