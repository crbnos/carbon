---
paths: []
triggers: ["DROP COLUMN", "RENAME COLUMN", "drop column", "rename column"]
promoted: null
---
# A dropped column breaks string selects that typecheck cannot see

**Context:** The several-assets change for lessee leases (2026-10-11) moved twelve columns from `lease` to `leaseLine` and recreated the `leases` view.

**Problem:** Typecheck passed, but the Lease Liabilities report still selected the moved columns from the view through `fetchAllFromTable(client, "leases", "id, …, lesseeClassification, …")`. The column list is a string, so the report would only have failed at runtime.

**Rule:** After a migration drops or moves a column, grep every string select of the table and its views (`.select("…")`, `fetchAllFromTable` column lists, embeds) for the old name. Do not rely on typecheck for them.

**Applies to:** any migration that drops, renames or moves a column.
