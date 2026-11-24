---
paths: []
triggers: []
promoted: null
---
# Typed quantities do not need Number wrappers

**Context:** Showing issued quantities and current bin stock in MES and ERP.

**Problem:** New code wrapped `number` and nullable `number` values in `Number(...)`, adding noise around ordinary comparisons and arithmetic.

**Rule:** Use a typed quantity directly, with `?? 0` when it is nullable. Convert only at a boundary where the value can actually be a string.

**Applies to:** MES quantity displays, inventory RPC results, and ERP posting code using parsed numeric inputs.
