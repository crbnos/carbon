---
paths: ["packages/database/supabase/migrations/*.sql"]
triggers: ["schema_migrations"]
promoted: null
---
# A migration file created while migrations are running is recorded as applied — empty

**Context:** Phase D of the rentals plan. `crbn up` was booting (its migrate step
runs `supabase migration up --include-all`) while `pnpm db:migrate:new lease-enum`
created the next migration file, whose SQL was written a few seconds later.

**Problem:** The running migrate step picked up the brand-new, still-empty file and
recorded version `20260923051441` in `supabase_migrations.schema_migrations` with
zero statements. Every later `crbn migrate` treated it as applied, so the enum value
it adds never reached the database; the regenerated types silently lacked it and
the first symptom was an unrelated-looking TS2353 in `@carbon/ee`. A sibling file
created four seconds later had its SQL in time and applied normally — so "the other
migration worked" proves nothing.

**Rule:** Never create or edit a migration file while `crbn up` / `crbn migrate` /
`pnpm db:migrate` is running; write the SQL first (or wait for the run to finish).
When a regenerated type is missing something a new migration adds, check
`select version, array_length(statements, 1) from supabase_migrations.schema_migrations
order by version desc limit 5` — a NULL statement count on your version means it was
recorded empty. Idempotent SQL can then be re-applied with `psql -f`.

**Applies to:** every new migration under `packages/database/supabase/migrations/`
during a `crbn up` boot or a background migrate.
