# Editable imported charges

Implementation plan for the charge half of
`.ai/specs/2026-09-23-editable-imported-spend-documents.md`.
The reimbursement half is `.ai/plans/2026-09-23-reimbursements-first-class.md`;
this plan deliberately reuses its shared components rather than cloning them.

## The gap this closes

A Ramp card transaction whose coding Carbon cannot resolve **never becomes a
Carbon document at all**. `buildTransactionLines`
(`packages/jobs/src/inngest/functions/integrations/ramp-sync-card.ts:125-211`)
returns `{ error: uncoded }` when any line has no `accountId`, when a coded
account is not in the company group, or when a cost center / project fails
verification. The caller records a Sync Activity **Warning** and stops. The
spend exists on the card statement and in Ramp, and in Carbon it is a log line.

The only remedy today is to go and fix the coding **in Ramp** and wait for the
next sync. That is exactly backwards for a system of record: Carbon owns the
chart of accounts, the cost centers and the dimensions, and it is where the
person doing the coding already works.

So: an uncoded charge should land as an editable **Draft** carrying whatever
Ramp did send (amount, merchant, memo, and any coding that DID resolve), and a
human finishes it in Carbon and posts it.

## Decisions taken here (flagged for veto)

**D1 — Auto-post is DERIVED, not configured.** A charge whose every line
resolves to a real account posts exactly as it does today; a charge with any
unresolved line stages a Draft and waits. There is no `autoPostCharges`
setting.

Rationale: a setting would make every existing customer choose, and the honest
default reproduces today's behaviour anyway. Deriving it is strictly additive —
nobody's coded charges change behaviour, and the charges that change behaviour
are the ones that currently produce *nothing*. It also respects the standing
"no matrix config" steer: this is not a classification the user should have to
describe, it is a fact about the row.

**D2 — The detail surface stays a Drawer.** `charges.$id.tsx` is already a
Drawer child route under `charges.tsx`, and the standing convention is that
child routes via `<Outlet>` use Drawer overlays. The line editor is denser than
what is there now, but density is not a reason to break a stated convention,
and the reimbursement detail (Tasks 16-17 of the sibling plan) is a Drawer too —
two spend documents that differ only in chrome would be worse than either.

**D3 — `chargeLine.accountId` becomes nullable, and `post-charge` refuses a
null.** This is the only way to stage an uncoded line while preserving its
amount, memo and dimensions; the alternative (stage a header with no lines)
throws away Ramp's split on every multi-line charge. The constraint does not
disappear, it MOVES to the posting boundary, where the sibling plan already
puts its totals guard. A CHECK constraint cannot express "null only while the
parent is Draft" — it cannot see the parent row — so the guard belongs in
`post-charge` regardless.

## Dependencies

Tasks 12 and 13 of `.ai/plans/2026-09-23-reimbursements-first-class.md` build
`DocumentSourceBadge` and `DocumentLineEditor` as **shared** components. This
plan consumes them. Do not start Task 6 below until those exist, and do not
fork a charge-specific copy of either — if one of them does not fit the charge
case, fix the shared component and re-verify the reimbursement caller.

## Progress

- [ ] Task 1: Migration — nullable `chargeLine.accountId`, `chargeLineDimension`
- [ ] Task 2: Regenerate database types
- [ ] Task 3: `invoicing.models.ts` — charge EDIT validators
- [ ] Task 4: `invoicing.service.ts` — `updateCharge` + `upsertChargeLines`
- [ ] Task 5: `post-charge` — uncoded-line guard + generic dimension union
- [ ] Task 6: `charges.$id.tsx` — two-mode detail with the source badge
- [ ] Task 7: Post action route + the totals guard
- [ ] Task 8: Ramp inbound — stage a Draft instead of dropping an uncoded charge
- [ ] Task 9: Full validation gate
- [ ] Task 10: Browser verification via `/test`

---

## Task 1: Migration — nullable `chargeLine.accountId`, `chargeLineDimension`

**Depends on:** nothing

**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_editable-imported-charges.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260923231244_reimbursements-first-class.sql` — the `reimbursementLineDimension` table, its RLS, and the NOT VALID / VALIDATE pattern

**Steps:**

1. Create the migration with `pnpm db:migrate:new editable-imported-charges`.
   **Randomize HHMMSS** in the filename — never `000000` — to avoid
   cross-branch collisions.
2. Drop the NOT NULL on `chargeLine.accountId`, guarded so a re-run is a no-op:
   ```sql
   DO $$
   BEGIN
     IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'chargeLine'
         AND column_name = 'accountId'
         AND is_nullable = 'NO'
     ) THEN
       ALTER TABLE "chargeLine" ALTER COLUMN "accountId" DROP NOT NULL;
     END IF;
   END $$;
   ```
3. Create `chargeLineDimension` as an exact structural mirror of
   `reimbursementLineDimension`: single-column `id` PK default `id('cld')`,
   `chargeLineId`, `dimensionId`, `valueId`, `companyId`, audit columns,
   `UNIQUE (chargeLineId, dimensionId)`.
   - `dimensionId` is a **single-column** FK to `dimension("id")` — that table
     is companyGroup-scoped and its PK is `id` alone, so a composite FK is
     invalid. This is the `journalLineDimension` precedent.
   - `valueId` is deliberately **NOT** a FK. It is polymorphic across dimension
     entity types. Same precedent.
   - `chargeLineId` FK is composite to `chargeLine("id", "companyId")` with
     `ON DELETE CASCADE`.
4. RLS: mirror `reimbursementLineDimension` exactly — simple policy names
   (`SELECT`/`INSERT`/`UPDATE`/`DELETE`) with `::text[]` casts on the helper
   functions, gated on the `invoicing` module.
5. Every DDL statement must be idempotent (`IF NOT EXISTS` / the guarded `DO`
   block above). The deploy runner retries a failed file over committed partial
   state.
6. Redefine any view that does `SELECT *` over `chargeLine` — DROP and recreate
   it, so the nullability change propagates.

**Verify:**
```bash
pnpm db:migrate
psql "$SUPABASE_DB_URL" -c '\d "chargeLineDimension"'
psql "$SUPABASE_DB_URL" -tAc "select is_nullable from information_schema.columns where table_name='chargeLine' and column_name='accountId';"
pnpm db:migrate   # second run proves idempotence
pnpm db:check:datasets
pnpm db:check:backups
```
```
# Expected: the table exists with the UNIQUE and both FKs; is_nullable = YES;
# the SECOND db:migrate run is clean (idempotent); all four demo datasets
# apply; existing backups still restore.
```

**Out of scope:** Do not add a `source` column to `charge` — `charge.integration`
already carries the provider and is what the badge reads. Do not add a CHECK
tying `accountId` nullability to `status`; a CHECK cannot see the parent row
(see D3).

**Note:** this worktree's Postgres is NOT on the root `.env`'s 54322 — read the
port from `.env.local` or `docker ps`. See the lessons.md entry.

---

## Task 2: Regenerate database types

**Depends on:** Task 1

**Steps:**

1. `pnpm run generate:types` — always after a migration, BEFORE any typecheck.
2. Commit the regenerated `@carbon/database` types. This is normal and expected;
   do NOT hand-edit them.

**Verify:**
```bash
pnpm run generate:types && git diff --stat packages/database/src/types.ts
pnpm exec turbo run typecheck --filter=@carbon/database
```
```
# Expected: chargeLineDimension appears; chargeLine.accountId becomes
# `string | null` on Row. Typecheck clean.
```

---

## Task 3: `invoicing.models.ts` — charge EDIT validators

**Depends on:** Task 2

**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.models.ts`
- Copy from (precedent): the `reimbursement*` validators added by Task 4 of the
  sibling plan (same file, ~line 460+)

**Steps:**

1. Add `isChargeLocked(status)` — true for anything but `Draft`. `chargeStatus`
   already exists at line 438 (`Draft | Posted | Voided`); do not redefine it.
2. Add `chargeUpdateValidator` for the editable header fields only:
   `memo`, `postingDate`, `supplierId`, `merchantName`, `offsetAccountId`.
   **Not** `amount`, `currencyCode`, `exchangeRate`, `transactionDate`,
   `cardAccountId` or `integration` — those are provider facts, and letting a
   human edit the settled amount would silently desynchronise Carbon from the
   card statement.
3. Add `chargeLineDimensionValidator`, `chargeLineValidator`,
   `chargeLinesValidator`, mirroring the reimbursement trio. Two differences
   that matter:
   - `accountId` is `z.string().nullish()` here, not `.min(1)` — an uncoded
     Draft line is a legal stored state (D3). The POSTING guard is what
     requires it, not the validator.
   - `amount` is `z.number().finite()` WITHOUT `.positive()`. A card `Credit`
     (a refund) is genuinely negative, and `CHARGE_CREDIT_PROVIDERS` already
     pushes negative items to Rillet. Requiring positive would make every
     refund uneditable.
4. These lines arrive as parsed JSON from a hidden field, not as FormData, so
   the line validators are **plain zod** with no `zfd` coercion — `zfd.numeric`
   expects a FormData string and rejects an already-numeric amount. The
   reimbursement validators carry this same comment; keep it.
5. **There is NO create validator.** A charge is imported from a provider and is
   never authored by hand in Carbon. Adding one would be the whole point of the
   spec, inverted.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm --filter erp test
```

**Out of scope:** no create validator, no `amount`/`currencyCode` edit path.

---

## Task 4: `invoicing.service.ts` — `updateCharge` + `upsertChargeLines`

**Depends on:** Task 3

**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts`
- Copy from (precedent): `updateReimbursement` / `upsertReimbursementLines`
  from Task 5-6 of the sibling plan, in this same file

**Steps:**

1. `updateCharge(client, id, companyId, data)` — header write, scoped by
   `companyId`, refusing a non-Draft parent.
2. `upsertChargeLines(db, { chargeId, companyId, userId, lines })` — replaces
   the line set and its `chargeLineDimension` rows in ONE Kysely transaction.
   Refuses a non-Draft parent.
3. **Never construct the DB client inside `invoicing.service.ts`.** That file is
   re-exported through the module barrel that client components import, so it is
   bundled for the browser. Build the client in a `.server` helper with
   `getDatabaseClient()` and pass it in from the route action as a
   `db: Kysely<KyselyDatabase>` argument. This is enforced by the
   `no-db-client-in-service` check — run the real check, not a grep proxy.
4. For `updatedAt` use `datetime.timestamp()`. Do **not** use
   `today(getLocalTimeZone()).toString()` — `getLocalTimeZone()` is banned in
   server code by the `no-local-timezone` conformance check, which explicitly
   scans `*.service.ts`, and a date-only string is the wrong shape for a
   `timestamptz` column. (This exact defect was in the sibling plan's Task 5.)

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm --filter erp test
pnpm exec tsx packages/checks/src/cli.ts no-db-client-in-service
```
```
# Expected: typecheck clean, tests pass, 0 violations.
```

**Note:** adding scanned service functions legitimately changes
`apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json`. That file is
committed — include it, do not revert it as churn.

---

## Task 5: `post-charge` — uncoded-line guard + generic dimension union

**Depends on:** Task 2

**Files:**
- Modify: `packages/database/supabase/functions/post-charge/post-charge-post.ts`
- Copy from (precedent):
  `packages/database/supabase/functions/post-reimbursement/post-reimbursement-post.ts`
  — the merged legacy/generic dimension pass

**Steps:**

1. Refuse to post a charge with any line whose `accountId` is null, with a
   message naming how many lines are uncoded. This is the constraint moved from
   the column to the boundary (D3). It must run BEFORE the totals check, so an
   uncoded charge gets the actionable message rather than an arithmetic one.
2. Union the legacy `costCenterId`/`projectId` columns with the new
   `chargeLineDimension` rows into ONE `Map<dimensionId, valueId>` per line
   before a single `journalLineDimension` insert. That table is UNIQUE on
   `(journalLineId, dimensionId)`, so two passes throw.
3. On a collision the **generic table wins**: the legacy columns are what the
   Ramp sync wrote at import, the generic table is where a human's edit lands,
   and human intent beats a machine default. Put that sentence at the call site —
   the precedence is surprising without it.
4. Do not duplicate `allocateJournalLineIds`; import it from
   `../post-charge/journal-line-ids.ts` as `post-reimbursement` does.

**Verify:**
```bash
cd packages/database/supabase/functions
deno test --no-lock --no-check post-charge/
SUPABASE_DB_URL="postgresql://postgres:postgres@localhost:<PORT>/postgres" \
  deno task test:db post-charge/
```
```
# Expected: the existing suite still passes, plus new cases for the uncoded
# guard and the dimension union. Read <PORT> from .env.local / docker ps —
# NOT the root .env's 54322.
```
```
# NOTE: `deno check post-charge/index.ts` exits 1 with ~10 errors in shared
# lib/ files. That is PRE-EXISTING and true of every edge function; it is not
# a signal about this change. Do not chase it.
```

---

## Task 6: `charges.$id.tsx` — two-mode detail with the source badge

**Depends on:** Tasks 4, 5, and Tasks 12-13 of the sibling plan

**Files:**
- Modify: `apps/erp/app/routes/x+/invoicing+/charges.$id.tsx` (currently 285
  lines, read-only Drawer)
- Reuse: the shared `DocumentSourceBadge` and `DocumentLineEditor`

**Steps:**

1. Keep the Drawer (D2). Keep the existing single batched account query — do not
   reintroduce an N+1 over lines.
2. Read mode for a locked charge (`Posted` / `Voided`); edit mode for `Draft`.
   `isChargeLocked` is the one predicate — derive both the mode and the
   action-button set from it, never from two independent status checks.
3. `DocumentSourceBadge` renders the provider from `charge.integration`, using
   the Ramp logo as first-class attribution.
4. `DocumentLineEditor` gets `availableDimensions: DimensionWithValues[]` from
   the loader via `getActiveDimensionsWithValues(client, companyGroupId, companyId)`
   added to the existing `Promise.all`. Add no new service function or API route.
5. An uncoded line must be visibly uncoded — the account cell is an empty
   required-looking selector, not a blank. That row is the entire reason the
   Draft exists.
6. The hidden JSON field carries only
   `dimensions: Array<{ dimensionId, valueId }>` per line; the display names in
   `JournalLineDimensionValue` are client-side only and must be stripped on
   submit.
7. Wrap new user-visible strings for Lingui. Use `<Plural>` for any
   count-dependent wording — never a ternary inside a `t` template (that
   extracts the English word as a placeholder value and passes the
   missing-translation gate while still rendering English).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm --filter erp test
pnpm run lingui:extract
```

---

## Task 7: Post action route + the totals guard

**Depends on:** Task 6

**Files:**
- Create: `apps/erp/app/routes/x+/invoicing+/charges.$id.post.tsx`
- Copy from (precedent): `charges.$id.void.tsx` (same directory) for the action
  shape, and the sibling plan's Task 18 for the guard

**Steps:**

1. The action invokes the `post-charge` edge function and redirects on success.
2. Guard in the route as well as the function: refuse when the lines do not sum
   to the header, or when any line is uncoded. The route guard exists to give a
   field-level error the user can act on; the edge-function guard exists because
   the route is not the only caller. Both are needed — do not delete one as
   duplication.
3. Services return `{ data, error }`; on failure
   `return data({}, await flash(request, error(...)))`, on success
   `throw redirect(...)`. Never `Response.json`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm --filter erp test
```

---

## Task 8: Ramp inbound — stage a Draft instead of dropping an uncoded charge

**Depends on:** Tasks 1-5

**Files:**
- Modify: `packages/jobs/src/inngest/functions/integrations/ramp-sync-card.ts`
  (`buildTransactionLines` ~125-211, `createAndPostTransaction` ~224+)
- Modify: `packages/jobs/src/inngest/functions/integrations/ramp-sync-card-stage.ts`

**Steps:**

1. `buildTransactionLines` currently returns `{ error: uncoded }` for three
   distinct situations: a line with no Ramp account, a coded account not in the
   company group, and a failed cost-center/project verification. Change it to
   return the lines it COULD build, with `accountId: null` where it could not,
   plus a flag saying the set is incomplete. Keep the three cases
   distinguishable in the message — they have different fixes.
2. Fully coded → stage and post, exactly as today. Any incomplete line → stage
   the Draft and STOP; do not invoke `post-charge`.
3. **Sync CREATES but never re-writes.** A charge already mapped to this Ramp id
   must not have a human's edits overwritten by a later sync pass. A Posted
   charge is never rewritten at all. A Draft may only be refreshed when it is
   still untouched by a human — use the same "unposted system Draft whose
   expected reference, supplier, dates, currency, line structure, coding and
   amounts all match" discipline the Ramp reimbursement invoice path already
   applies; a partial or mismatched match is rejected without rewriting.
4. Preserve the existing transactional staging: the advisory lock scoped to
   company + Ramp id, the atomic Kysely staging of header + lines + mapping, and
   the tenant-scoped reread before confirming to Ramp. Do NOT split a staged
   write set into Supabase-client calls — those do not form a transaction.
5. `scaleLinesToTotal` must still run: Ramp line amounts are in MERCHANT
   currency and the header is the SETTLEMENT amount, so an unscaled set will not
   sum to the header and `post-charge` would reject it. Scaling must operate on
   the coded lines and leave a null-account line's amount intact.
6. A staged-Draft outcome is NOT a failure. Record it in Sync Activity as an
   informational/Warning row whose message says the charge is waiting on coding
   in Carbon and links to it — not as the current dead-end "uncoded" error. Clear
   that row once the charge posts.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
pnpm --filter @carbon/jobs test
```
```
# Expected: ramp-sync-card.integration.test.ts and
# reconcile-charge-lifecycle.test.ts both still pass, plus new cases for
# (a) uncoded -> Draft staged, not posted; (b) a later sync pass does not
# overwrite a human-edited Draft; (c) a Posted charge is never rewritten.
```

**Migration note to confirm while doing this:** an uncoded charge that was
dropped BEFORE this ships was never written to Carbon, so there is nothing to
backfill — but the Ramp cursor has already advanced past it. Determine whether
those transactions are re-listable on a re-sync, and if they are not, say so
explicitly in the report rather than implying history will self-heal.

---

## Task 9: Full validation gate

**Depends on:** Tasks 1-8

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm exec turbo run typecheck --filter=@carbon/jobs
pnpm exec turbo run typecheck --filter=@carbon/ee
pnpm run lint
pnpm run test
cd packages/database/supabase/functions && deno test --no-lock --no-check post-charge/
pnpm db:check:datasets
pnpm db:check:backups
pnpm run lingui:extract
```
```
# Every command green. Any new msgid needs a filled msgstr per locale via
# /translate — a blank catalog entry ships English to twelve locales.
```

---

## Task 10: Browser verification via `/test`

**Depends on:** Task 9

**Steps:**

1. Boot the stack with plain `crbn up` (portless `*.dev`), not `--no-portless`.
2. Verify, with screenshots:
   - a Draft charge with an uncoded line shows the Ramp source badge and an
     empty, obviously-required account cell;
   - coding that line and adding a dimension via `DimensionSelector` saves;
   - Post produces a balanced journal (debits == credits) and flips the charge
     to Posted with the detail now in read mode;
   - a Posted charge offers no edit affordance;
   - Void still works and reverses.
3. A UI change is not done until it has been verified in a browser. If the stack
   cannot boot, the task is BLOCKED, not done — say so.

**Out of scope:** live Ramp/Rillet sandbox verification. That needs credentials
installed on a dev company and is tracked separately.
