---
paths: []
triggers: []
promoted: null
---
# `@ts-expect-error TS2589` on Supabase joined-selects is fragile — flips "used/unused" as files are added

**Context:** The `$itemId.purchasing.$supplierPartId.delete.tsx` routes (material / tool / consumable / part / …) each do `client.from("supplierPart").select("id, supplierId, supplier:supplierId(name)")`. Some carried `// @ts-expect-error TS2589 — … type instantiation too deep`. Adding an unrelated new route file (`periods.generate.tsx`) flipped which file the checker reported: `material` went from TS2578 (unused directive) to clean, `tool` went from clean to TS2589 — a whack-a-mole that broke `erp` typecheck without touching those files.

**Problem:** TS2589 ("type instantiation is excessively deep") on PostgREST joined-select types is **order/threshold dependent** — it surfaces at whichever file crosses a cumulative-depth limit during a given check pass, so which file errors changes as files are added/removed elsewhere. `@ts-expect-error` *requires* an error on the next line, so a directive that was "used" becomes an "unused directive" (TS2578) the moment the trigger moves — and the newly-triggering file now lacks a directive (TS2589). Swapping directives just moves the problem.

**Rule:** Don't manage TS2589 on Supabase joined-selects with `@ts-expect-error` — it *requires* an error, so it flips to TS2578 the moment the trigger moves to another file. Use `@ts-ignore` instead (the codebase's choice on the `supplierPart` delete routes): it suppresses the error when it fires and stays green when it doesn't, and it preserves the inferred `result` type. A localized `(client as any)` cast is the heavier alternative — it removes the file from the cumulative-depth pool entirely but drops the result's type; prefer `@ts-ignore` unless you specifically need to break the inference chain.

**Applies to:** the `supplierPart` joined-select delete routes and any similar `alias:fkColumn(...)` embed that trips TS2589; `apps/erp/app/routes/x+/{material,tool,consumable,part}+/...delete.tsx`.
