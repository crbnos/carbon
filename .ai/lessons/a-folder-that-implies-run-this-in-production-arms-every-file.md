---
paths: []
triggers: []
promoted: null
---
# A folder that implies "run this in production" arms every file dropped into it

**Context:** One-off data migrations (copying the legacy `private` bucket into
per-company buckets) needed to run automatically, once per database. The design
made `scripts/one-off/` self-registering: `discoverOneOffScripts` reads the
directory and every `.ts` file is executed against every production database
after `supabase db push`, recorded in that database's own `scriptRun` table.

**Problem:** Removing the hardcoded registry array killed a real duplication —
a list that could disagree with the folder — but replaced an explicit opt-in
with an implicit one. `endsWith(".ts")` also matches `foo.test.ts`, and
`scripts/lib/` already colocates `*.test.ts` beside its sources. A developer
following the repo's own established convention would have shipped a test file
into production execution. Nothing in the type system, the linter, or a review
diff makes a new file in a directory look dangerous.

**Rule:** When a directory's *membership* is what triggers an action, gate it
with an ALLOWLIST pattern and make non-matching files a loud failure, never a
silent skip. A blocklist arms whatever nobody thought to exclude; a silent skip
is worse than a crash, because a script ignored for a filename typo is
indistinguishable from one that already ran, and the deploy reports success
having done nothing. State the naming rule in the folder's README, and test it
with the exact filename the surrounding conventions would produce.

**Applies to:** `ci/src/one-off-scripts.ts` (`SCRIPT_FILENAME`,
`discoverOneOffScripts`), `scripts/one-off/`, and any future
convention-over-configuration discovery where the discovered thing is executed
rather than merely loaded.
