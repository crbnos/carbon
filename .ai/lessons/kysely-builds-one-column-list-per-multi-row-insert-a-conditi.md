---
paths: []
triggers: []
promoted: null
---
# Kysely builds ONE column list per multi-row insert — a conditionally-set key writes NULL into its siblings

**Context:** `get-method`'s `quoteLineToJob` builds every `jobMaterial` row into one array, then inserts them with a single `trx.insertInto("jobMaterial").values(rows)`. Only rows whose item had an effective supersession successor carried a `unitCost` key; the rest omitted it, on the assumption that omitting a key lets the column default apply.

**Problem:** Kysely derives the INSERT's column list from the union of keys across ALL rows, not per row. The moment one swapped row carries `unitCost`, the column joins the statement and every row that omitted the key is written `NULL`. `jobMaterial.unitCost` is `NOT NULL DEFAULT 0`, so the whole insert failed with a 23502 and job creation died — and because it is one statement in one transaction, a single swapped line took down the entire job. The column default is only reached when NO row in the batch has the key, which is why it worked until the first quote-to-job with a superseded line. It was invisible to typecheck, to 157 unit tests, and to three review agents; it surfaced the first time a human clicked the flow in a browser.

**Rule:** In a multi-row insert, set every column on EVERY row or on none. Never conditionally spread a key (`...(cond ? {col: v} : {})`) into rows of a batch — that is the shape that writes NULL into the others. If a column is `NOT NULL DEFAULT x` and you want the default, either omit it from all rows or write `x` explicitly. When in doubt write the value explicitly; a default duplicated in code is cheaper than a constraint violation that fails the whole transaction.

**Applies to:** any Kysely `.values([...])` over more than one row, especially `jobMaterial` / `methodMaterial` / any table with `NOT NULL DEFAULT` columns.
