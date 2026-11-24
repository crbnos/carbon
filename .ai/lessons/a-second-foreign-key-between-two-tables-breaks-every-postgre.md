---
paths: []
triggers: ["FOREIGN KEY", "PGRST201", "REFERENCES \"workCenter\"", "REFERENCES \"jobOperation\""]
promoted: null
---
# A second foreign key between two tables breaks every PostgREST embed between them

**Context:** The OEE provider work (2026-10-13) added `workCenter."loadedJobOperationId"` with a foreign key to `jobOperation`, which already had `"workCenterId"` → `workCenter`.

**Problem:** With two relationships between the same pair of tables, PostgREST cannot pick one, and every existing embed of one from the other (`jobOperation` → `workCenter(name)`: batches, the batch PDF, notifications) failed at runtime with PGRST201. Typecheck passed, because the generated types still compiled; only a request to an affected screen showed it.

**Rule:** Before adding a foreign key, grep for embeds between the two tables in both directions (`table(` inside `.select(…)` strings). If any exist, either leave the new column without a foreign key and keep it consistent another way (an interceptor that clears it on delete), or disambiguate every embed with `table!constraint_name(…)` in the same change. When replacing a foreign key (a composite one for tenancy), drop the old one in the same migration, never add beside it.

**Applies to:** migrations that add a foreign key, especially to widely embedded tables (`workCenter`, `jobOperation`, `item`, `job`).
