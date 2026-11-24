---
paths: []
triggers: []
promoted: null
---
# A correction's rows live in the routing and BOM tables

**Context:** A make method's corrections store their operations and materials in
`methodOperation` and `methodMaterial`, marked by `methodCorrectionId`. Their Op
Nos start at 1, like the routing's.

**Problem:** The CSV method import read the routing and BOM by `makeMethodId`
alone. Op No 1 then matched two operations and the row failed; a step for an Op
No only a correction had attached to the correction; and a BOM line was skipped
as "already on the BOM" when only a correction used the item.

**Rule:** A read of a make method's routing or bill of materials filters
`methodCorrectionId IS NULL`. Read correction rows only through their
`methodCorrectionId`. A write by row id or by item (a part merge, a method type
change) needs no filter.

**Applies to:** every query on `methodOperation` / `methodMaterial` by
`makeMethodId`, in TypeScript and in SQL (`get_method_tree`).
