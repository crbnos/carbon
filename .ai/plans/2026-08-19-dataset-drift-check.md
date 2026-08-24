# Demo-dataset drift check — implementation plan

**Spec / source:** user description below (no separate spec — the design was settled in conversation)
**Branch:** feat/onboarding-templates

## The problem

The four demo datasets (`packages/database/src/datasets/data/{satellite,robotics,precision,motor}/`)
are inserted by tiers that build SQL from `information_schema` at runtime
(`packages/database/src/datasets/sql.ts:76`). Nothing in the type system knows about them, so a
migration that drops or renames a column only fails when someone actually seeds. That is drift.

## The approach

Run the real apply against a **scratch company created inside a transaction that is always rolled
back**. Nothing is ever committed, so a developer's local data is untouched even if the run fails
or the process is killed (Postgres rolls back automatically on a dropped connection).

Two structural moves make that possible:

1. `bootstrap()`'s reference-data body is extracted so a caller can create a company's config
   inside its own transaction (today it owns its own `BEGIN`/`COMMIT`).
2. `applyDataset()`'s transaction body is extracted for the same reason.

The check then runs from the **pre-commit hook**, only when staged files touch
`packages/database/`, and never blocks a commit for environmental reasons (no database → warn and
pass). CI is deliberately not used — the user's constraint is cost.

## Non-negotiables

- The verify path must NEVER commit. No `COMMIT` on any code path in `verify.ts`.
- The verify path must never touch an existing company. It creates its own and rolls it back.
- `bootstrap()` and `applyDataset()` behavior must be byte-for-byte unchanged for their existing
  callers (the dev CLI and the `company-template` Inngest job).

## Progress

- [x] Task 1: Extract `seedCompanyReferenceData` out of `bootstrap`
- [x] Task 2: Extract `applyDatasetTiers` out of `applyDataset`
- [x] Task 3: Write the dry-run verifier (`datasets/verify.ts`)
- [x] Task 4: Write the CLI entry point + package scripts
- [x] Task 5: Run the checker for real against all four datasets
- [x] Task 6: Wire the pre-commit hook
- [x] Task 7: Update the rule doc and AGENTS.md

## Dependencies

- Task 2 is independent of Task 1 — they may run in parallel.
- Task 3 needs Tasks 1 and 2.
- Task 4 needs Task 3.
- Task 5 needs Task 4 (and a running local database).
- Task 6 needs Task 5 to have passed — do not wire a hook that has never been proven to run.
- Task 7 needs Task 6.

---

## Task 1: Extract `seedCompanyReferenceData` out of `bootstrap`

**Depends on:** none

**Files:**
- Modify: `packages/database/src/datasets/bootstrap.ts` — split the function in two

**Steps:**

1. `bootstrap(client, email)` currently does three things in order: (a) creates/updates the Supabase
   auth user and sets `user.firstName`, (b) `BEGIN`, (c) a long body that creates the companyGroup,
   company, storage bucket, groups, employeeType + permissions, employee, and every piece of
   reference data (customer statuses, scrap reasons, payment terms, units of measure, period-close
   task definitions, gauge types, failure modes, non-conformance types, change-order types and
   required actions, sequences, currencies, accounts, dimensions, accountDefault, fiscalYearSettings,
   fixed asset classes, the HQ location, employeeJob, userPermission), then (d) `COMMIT`.

2. Extract **exactly** the body between `BEGIN` and `COMMIT` into a new exported function, moving no
   logic and changing no SQL:

   ```typescript
   /**
    * Everything a brand-new company needs before the dataset tiers can run: the
    * company itself, its group, and all reference data (chart of accounts, units
    * of measure, sequences, the HQ location).
    *
    * Deliberately owns NO transaction — the caller does. `bootstrap` commits it;
    * the drift checker (`datasets/verify.ts`) rolls it back, which is what lets
    * that check run against a developer's real database without touching it.
    */
   export async function seedCompanyReferenceData(
     client: PoolClient,
     args: { userId: string; companyName: string }
   ): Promise<{ companyId: string; companyGroupId: string; locationId: string }>
   ```

   Replace the two hard-coded uses of `DEV_COMPANY_NAME` inside the body (the `companyGroup` insert
   and the `company` insert) with `args.companyName`. Everything else is a straight move.

3. `bootstrap` becomes: the auth-user work, then

   ```typescript
   await client.query("BEGIN");
   try {
     const { companyId } = await seedCompanyReferenceData(client, {
       userId,
       companyName: DEV_COMPANY_NAME
     });
     await client.query("COMMIT");
     return { companyId, userId };
   } catch (err) {
     try { await client.query("ROLLBACK"); } catch {}
     throw err;
   }
   ```

   Match whatever `bootstrap` returns today (`Resolved`) — read the end of the current function and
   preserve its exact return shape and any post-COMMIT work.

4. If `bootstrap`'s body turns out to contain a Supabase-admin call or any other non-transactional
   side effect BELOW the `BEGIN` (i.e. something that would not roll back), STOP and report — do not
   move it into the extracted function.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: "1 successful, 1 total", no TypeScript errors
git diff --stat packages/database/src/datasets/bootstrap.ts
# Expected: a roughly balanced insertion/deletion count — this is a move, not a rewrite
```

**Out of scope:** the auth-user creation path, `DEV_PASSWORD`, and the `crbn up` bootstrap contract.
Do not change what `bootstrap` inserts or in what order.

---

## Task 2: Extract `applyDatasetTiers` out of `applyDataset`

**Depends on:** none (parallel with Task 1)

**Files:**
- Modify: `packages/database/src/datasets/index.ts` — split `applyDataset` at the transaction boundary

**Steps:**

1. In `applyDataset` (`packages/database/src/datasets/index.ts:55`), the work inside
   `BEGIN` … `COMMIT` is: `SET LOCAL "app.sync_in_progress"`, `ensureSequences`, the optional
   `wipeCompanyBusinessData`, and the tier loop with `onProgress`.

2. Extract that body verbatim into a new exported function that owns no transaction:

   ```typescript
   /**
    * The tier run itself, WITHOUT a transaction — the caller owns it. `applyDataset`
    * wraps this in BEGIN/COMMIT; the drift checker rolls it back instead, which is
    * how it can exercise the real insert path without persisting anything.
    */
   export async function applyDatasetTiers(
     client: PoolClient,
     opts: {
       companyId: string;
       userId: string;
       dataset: Dataset;
       timeZone: string;
       tiers?: number[] | null;
       log?: (message: string) => void;
       onProgress?: (p: { done: number; total: number }) => Promise<void>;
       wipeFirst?: boolean;
     }
   ): Promise<void>
   ```

   `buildCtx` and `selectTiers` move inside it. `SET LOCAL` stays inside it — `LOCAL` scopes to the
   caller's transaction, which is exactly what is wanted in both cases.

3. `applyDataset` keeps its existing signature and doc comment and becomes:

   ```typescript
   await client.query("BEGIN");
   try {
     await applyDatasetTiers(client, opts);
     await client.query("COMMIT");
   } catch (err) {
     // A dropped connection is the likeliest cause of a mid-seed failure, and
     // the ROLLBACK rejects too — swallow that so the original error survives.
     try { await client.query("ROLLBACK"); } catch {}
     throw err;
   }
   ```

4. Do not change `applyDataset`'s exported signature — `seed-dev.ts` and
   `packages/jobs/src/inngest/functions/tasks/company-template.ts` both call it and must not need
   edits. If either needs a change, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/jobs
# Expected: "2 successful, 2 total", no TypeScript errors
```

**Out of scope:** the tiers themselves, `wipe.ts`, and `applyDataset`'s `wipeFirst` semantics.

---

## Task 3: Write the dry-run verifier

**Depends on:** Tasks 1, 2

**Files:**
- Create: `packages/database/src/datasets/verify.ts`
- Copy from (precedent): `packages/database/src/seed-dev.ts` (how a caller opens a pool client,
  resolves a timezone, and calls the engine)

**Steps:**

1. Export one function:

   ```typescript
   export type VerifyResult = {
     key: string;
     ok: boolean;
     error?: string;
     durationMs: number;
   };

   export async function verifyDataset(
     client: PoolClient,
     args: { dataset: Dataset; key: string; userId: string; log?: (m: string) => void }
   ): Promise<VerifyResult>
   ```

2. Its body, in order:
   - `await client.query("BEGIN")`
   - `await client.query('SET LOCAL "app.sync_in_progress" = \'true\'')` — set it here too, before
     the reference-data seed, so bootstrap-triggered event dispatch is suppressed as well.
   - `const { companyId } = await seedCompanyReferenceData(client, { userId, companyName: "Dataset Drift Check" })`
   - `const timeZone = await resolveCompanyTimeZone(client, companyId)`
   - `await applyDatasetTiers(client, { companyId, userId, dataset, timeZone, log })`
   - **always** `await client.query("ROLLBACK")` — in a `finally`, so it runs on both the success and
     the failure path. There must be no `COMMIT` anywhere in this file.
   - Return `{ key, ok: true, durationMs }`; on a thrown error return `{ key, ok: false, error: message, durationMs }`
     rather than rethrowing, so the CLI can report every dataset in one run.

3. Time the run with `performance.now()` — not `Date` (`.claude/rules/date-handling.md` bans JS
   `Date` for arithmetic, and this is elapsed-time math).

4. Add a file-header comment stating the invariant plainly: this file never commits; a scratch
   company is created and thrown away inside one transaction, which is why the check is safe to run
   against a developer's own database.

5. Also export a helper that picks the user the scratch company is attributed to:

   ```typescript
   /** The scratch company needs a real user id for its FKs. Prefer the built-in
    *  `system` user so the check never attributes anything to a real developer. */
   export async function resolveCheckUserId(client: PoolClient): Promise<string | null>
   ```

   Query `SELECT id FROM "user" WHERE id = 'system'`; if that returns nothing, fall back to
   `SELECT id FROM "user" ORDER BY id LIMIT 1`; if the table is empty return `null`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: "1 successful, 1 total"
grep -c "COMMIT" packages/database/src/datasets/verify.ts
# Expected: 0
```

**Out of scope:** row-count assertions or baseline comparison. This task proves the datasets still
*apply*; comparing counts against `.ai/runs/*-baseline.txt` is a separate idea and not in scope.

---

## Task 4: Write the CLI entry point and package scripts

**Depends on:** Task 3

**Files:**
- Create: `packages/database/src/check-datasets.ts`
- Modify: `packages/database/package.json` — add `"db:check:datasets": "tsx src/check-datasets.ts"`
  to `scripts` (alongside the existing `"db:seed:dev": "tsx src/seed-dev.ts"` at line 41)
- Modify: `package.json` (repo root) — add
  `"db:check:datasets": "pnpm --filter @carbon/database db:check:datasets --"` next to the existing
  `"db:seed:dev"` entry
- Copy from (precedent): `packages/database/src/seed-dev.ts` (env loading, pool acquisition,
  try/finally release, exit codes)

**Steps:**

1. Parse args with `node:util`'s `parseArgs`, mirroring `packages/database/src/datasets/cli.ts`:
   - `--dataset <key>` — repeatable (`multiple: true`), defaults to every key from `datasetKeys()`
   - `--help`
   Filter out a bare `--` from `process.argv` exactly as `parseSeedArgs` does, since the root script
   forwards one.

2. Call `loadEnv()` from `./datasets/cli.ts` first, then `getPostgresConnectionPool(1)` from
   `./client.ts` and `pool.connect()`.

3. **Environmental failures must not fail the check.** Wrap the connect in try/catch; on failure
   print `⚠ Dataset drift check skipped — no database connection (is your local stack up?)` and
   `process.exit(0)`. Same for `resolveCheckUserId` returning `null`: warn that the database has no
   users yet and exit 0. A hook that fails for reasons the developer cannot fix gets bypassed with
   `--no-verify` and then never runs again.

4. Run the requested datasets sequentially (they share one connection), printing one line each:
   `✓ satellite (3.4s)` / `✗ robotics — Seed: table "item" has no column "foo"`.

5. Exit 1 if any dataset failed, 0 otherwise. On failure, print a closing line telling the developer
   what it means: the demo datasets no longer match the schema, and
   `packages/database/src/datasets/data/` needs updating.

6. Release the client and end the pool in a `finally`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: "1 successful, 1 total"
pnpm db:check:datasets -- --help
# Expected: usage text listing the four dataset keys, exit code 0
```

**Out of scope:** any flag that would let this command write to the database. There is no
`--commit`, no `--seed`, no company selector.

---

## Task 5: Run the checker for real

**Depends on:** Task 4

**Files:** none (verification only)

**Steps:**

1. Confirm the local database is reachable. The port is worktree-specific and lives in the repo-root
   `.env.local` as `SUPABASE_DB_URL` — read it, do not assume 54322.

2. Record the company count and one table's row count before the run:
   ```bash
   psql "$SUPABASE_DB_URL" -c 'SELECT count(*) FROM company' -c 'SELECT count(*) FROM item'
   ```

3. Run the full check and time it:
   ```bash
   time pnpm db:check:datasets
   ```
   Expected: four `✓` lines, exit code 0.

4. Re-run the counts from step 2. **They must be identical.** If a single row was added, STOP and
   report — the rollback is not holding, and the hook must not be wired until it does.

5. Prove the check actually catches drift: temporarily add a bogus column to one dataset's insert
   path (e.g. add `bogusColumn: 1` to a row in `datasets/tiers/01-foundation.ts`), re-run, confirm it
   reports `✗` with the `Seed: table "…" has no column "bogusColumn"` message and exits 1, then
   revert the edit. A check that has never been seen to fail is not a check.

6. Note the measured wall-clock time for all four datasets — Task 6's hook design depends on it.

**Verify:**
```bash
pnpm db:check:datasets
echo "exit=$?"
# Expected: four ✓ lines and exit=0
```

**Out of scope:** running `pnpm db:seed:dev`, `pnpm db:migrate`, or anything else that writes. Never
rebuild the database to test this.

---

## Task 6: Wire the pre-commit hook

**Depends on:** Task 5 (which must have passed, including step 4)

**Files:**
- Modify: `.husky/pre-commit` — add a conditional block after the existing lingui and MCP blocks
- Copy from (precedent): the existing conditional blocks in the same file, which use
  `git diff --cached --name-only | grep -q '<pattern>'`

**Steps:**

1. Append a block in the same idiom as the file's existing ones:

   ```sh
   # Demo datasets are inserted with SQL built at runtime, so schema drift only
   # shows up when they actually run. Dry-run them (create a scratch company,
   # roll it back) whenever the database package is touched.
   if [ -z "$CARBON_SKIP_DATASET_CHECK" ] && git diff --cached --name-only | grep -q '^packages/database/'; then
       echo "Checking demo datasets against the schema..."
       pnpm db:check:datasets $DATASET_CHECK_ARGS || exit 1
   fi
   ```

2. Decide `$DATASET_CHECK_ARGS` from the measured time in Task 5 step 6:
   - If all four datasets complete in **under ~20 seconds total**, check all four (drop the variable
     and the argument entirely).
   - If it is slower, narrow it: when the staged files are confined to a single
     `packages/database/src/datasets/data/<key>/` directory, check only `<key>`; otherwise check all
     four. Implement that as a small `for` loop over `git diff --cached --name-only` output in the
     hook, building the `--dataset` flags.

   Record which branch was taken and the measured timing in a comment in the hook, so the next
   person does not have to re-measure to understand the choice.

3. `CARBON_SKIP_DATASET_CHECK=1` is the documented escape hatch — it must be honored before the
   `git diff` runs so the skip costs nothing.

4. Test the hook end to end: stage a trivial whitespace change in
   `packages/database/src/datasets/data/motor/foundation.ts`, run `git commit`, confirm the check
   runs and the commit succeeds. Then `git reset` the staged change. Do **not** leave a test commit
   behind — and do not commit anything unless the user has asked for it.

**Verify:**
```bash
sh -n .husky/pre-commit
# Expected: no output (the shell script parses)
CARBON_SKIP_DATASET_CHECK=1 sh -c 'echo skip-path-ok'
# Expected: skip-path-ok
```

**Out of scope:** adding a CI workflow, changing `lint-staged` config, or touching the lingui / MCP
blocks already in the hook.

---

## Task 7: Update the rule doc and AGENTS.md

**Depends on:** Task 6

**Files:**
- Modify: `.claude/rules/onboarding-company-templates.md` — replace the "Verifying a change to the
  tiers" section's manual-diff-only advice with the new command, keeping the baseline-diff guidance
  for structural changes
- Modify: `packages/database/AGENTS.md` — add `db:check:datasets` to the Validation Commands block
  and one line under "Dev Seed"

**Steps:**

1. In the rule, state what the check does and does not prove: it proves every dataset still applies
   against the current schema; it does **not** prove row counts are unchanged, which is still a
   manual baseline diff (`.ai/runs/*-baseline.txt`).

2. State the safety property explicitly, because it is the thing a reader will doubt: the check
   creates a scratch company inside a transaction and always rolls back, so it never touches the
   developer's data — and record that it runs from the pre-commit hook on
   `packages/database/**` changes, with `CARBON_SKIP_DATASET_CHECK=1` to skip.

3. Note the known gap honestly: a git hook can be bypassed with `--no-verify`, so this is a safety
   net rather than a gate, and CI was deliberately not used for cost reasons.

**Verify:**
```bash
grep -n "db:check:datasets" .claude/rules/onboarding-company-templates.md packages/database/AGENTS.md
# Expected: at least one hit in each file
```

**Out of scope:** the four dataset row-count baselines in `.ai/runs/` — this branch already changed
`workCenterProcess` counts and those files are reference snapshots, not assertions.

---

## Final check before reporting done

```bash
pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/jobs
pnpm exec biome check packages/database/src .husky
pnpm db:check:datasets
```

Expected: typecheck 2/2 successful, biome clean (leave pre-existing warnings alone), four `✓`
lines from the checker. Then confirm the `company` row count is unchanged from before the run.
