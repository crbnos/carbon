---
paths: []
triggers: []
promoted: null
---
# Adding CHECK + VALIDATE requires auditing every WRITER of the column and pre-cleaning data in the same migration

**Context:** The currency refactor added `CHECK ("exchangeRate" > 0)` + `VALIDATE` on 12 document tables. Review found `get-method` had been writing `exchangeRate: l.exchangeRate ?? 0` into `quoteLinePrice` for every legacy null-rate quote line, and the old `NUMERIC(10,4)` clamp had stored sub-0.00005 rates as literal `0.0000`.

**Problem:** `VALIDATE CONSTRAINT` scans existing rows mid-deploy — one violating row anywhere fails the whole migration in production, and post-deploy the unfixed writer fails at runtime (a whole edge-function transaction). A constraint that is obviously true "going forward" says nothing about years of rows written by code paths you didn't grep.

**Rule:** Before adding a CHECK on an existing column: (1) grep EVERY writer of that column — app services, edge functions, triggers, seeds — and fix any that can produce a violating value in the same change set; (2) repair existing violating rows in the same migration, before the VALIDATE (`UPDATE … WHERE <violates>` with an explainable value); (3) remember old NUMERIC(p,s) clamps — a widened column can still hold rounded-to-zero values from its clamped era.

**Applies to:** any `ADD CONSTRAINT … CHECK` + `VALIDATE` migration; posting writers (`apps/erp/app/modules/*/*.service.ts`) of the constrained column.
