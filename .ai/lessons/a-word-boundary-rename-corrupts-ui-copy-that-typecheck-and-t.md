---
paths: []
triggers: []
promoted: null
---
# A word-boundary rename corrupts UI copy that typecheck and tests can't see

**Context:** Splitting ERP list types into `X` (full view row, for detail screens) and `XListItem` (the narrowed list select) on `sid/perf-audit-hot-paths`. Applied with a regex renaming the whole-word alias across each table component.

**Problem:** `Part`, `Material`, `Tool`, `Consumable`, `Service` are single words that appear in **user-visible strings** as well as type positions. The rename produced ``t`PartListItem ID` ``, `<Trans>Delete PartListItem</Trans>`, and a button reading "Add PartListItem" — 20 occurrences across five files. Typecheck passed, 268 unit tests passed, all ten narrowed selects returned 206 from PostgREST, and `EXPLAIN` looked right. Only loading the page caught it. (The five multi-word aliases — `PurchaseOrder`, `SalesOrder`, … — were untouched, because their display text contains a space.)

**Rule:** After any mechanical rename of an identifier that is also an English word, grep for the new name inside string literals, template literals and JSX text (``t`…` ``, `<Trans>…</Trans>`, `"…"`) before committing — and load one affected screen. Type-level green says nothing about copy. Prefer renaming with an editor's symbol-aware rename over a regex; when a regex is the only option, exclude string/JSX regions explicitly.

**Applies to:** `apps/erp/app/modules/*/ui/*/*Table.tsx`, `apps/erp/app/modules/*/types.ts`; any bulk identifier rename in files containing Lingui macros.
