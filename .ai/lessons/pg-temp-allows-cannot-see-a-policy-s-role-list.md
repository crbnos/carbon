---
paths: []
triggers: []
promoted: null
---
# `pg_temp.allows` cannot see a policy's role list

**Context:** `authz-pieces.test.sql` evaluates a policy with `pg_temp.allows(table, command, clause, row)`, which reads the policy's `USING` or `WITH CHECK` text from `pg_policies` and runs it as the current role.

**Problem:** It ignores `pg_policies.roles`. `exchangeRate` kept API keys out with `TO authenticated USING (true)`, so an `allows('exchangeRate', …)` assertion made as `anon` passed against the old policy: the test could not fail.

**Rule:** For a policy restricted by `TO <role>`, or whenever the role decides, test the behaviour instead: select from the table, or call the function that reads it (`get_exchange_rate`), as that role. Prove the assertion red against the old policy before trusting it.

**Applies to:** `packages/database/supabase/tests/authz-*.test.sql` and any test built on `pg_temp.allows`.
