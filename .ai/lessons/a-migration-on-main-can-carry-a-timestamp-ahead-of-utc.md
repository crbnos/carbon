---
paths: []
triggers: []
promoted: null
---
# A migration on main can carry a timestamp ahead of UTC

**Context:** `supabase migration new` stamps a migration with the current UTC time. A migration merged to `main` (`20261009141827_link-custom-field-type.sql`) carried a time about 2.5 hours ahead of UTC, likely from a local clock.

**Problem:** Every migration created after the pull got an older timestamp than that file. Production's `supabase db push` refuses a migration that sorts before one it already applied, so the new migrations would have failed to deploy. The clobber check and every test passed; nothing local shows it.

**Rule:** After you pull `main`, compare your migrations' timestamps with the newest one on `main` (`ls packages/database/supabase/migrations | tail`). If yours sort first, rename them to sort after it, keep their order and content, and use a non-`000000` HHMMSS. Re-generate a generated `authz migration` file first, then rename it with the rest.

**Applies to:** `packages/database/supabase/migrations/`; every branch that adds a migration.
