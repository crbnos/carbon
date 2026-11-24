---
paths: []
triggers: []
promoted: null
---
# A JS array bound for a jsonb column must be stringified on the Kysely path

**Context:** `quoteLinePrice.priceTrace` (a `PriceTraceStep[]`) is written both through
supabase-js (PostgREST) and through Kysely (`rewriteQuoteLinePrices`,
`saveQuoteLineWithPrices`, `get-method`).

**Problem:** node-postgres and deno-postgres serialise a parameter by its JS type, not the
column's: an object becomes JSON, but an array becomes a Postgres array literal (`{a,b}`),
which a jsonb column rejects. supabase-js sends JSON either way, so the same row "works" on
one path and fails on the other — and typecheck sees nothing, since `Json` admits arrays.

**Rule:** On a Kysely write, `JSON.stringify` any jsonb value that can be an array (or a bare
string). In Deno use `toJson` / `toJsonColumns` (`functions/lib/json.ts`).

**Applies to:** every `insertInto` / `updateTable` that sets a jsonb column — `priceTrace`,
`configuration`, notes, `customFields`, any copied row spread from a supabase-js read.
