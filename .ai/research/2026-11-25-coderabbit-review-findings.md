# CodeRabbit review findings: the mistakes agents repeat

Date: 2026-11-25. Source: every inline review comment the CodeRabbit bot left on
crbnos/carbon pull requests (`GET /repos/crbnos/carbon/pulls/comments`, user
`coderabbitai[bot]`).

## Method

1. Downloaded 5,149 inline comments on 674 pull requests, 2026-07-03 to
   2026-11-24.
2. Kept the comments rated Critical or Major: 2,233 (113 and 2,120). Minor ones
   are mostly wording. The script read the rating of 2,130 of them; the
   grouping used those 2,130.
3. Split them by date into five slices of about 426 comments. One agent per
   slice grouped them into mistakes that recur: the same error in at least 2
   pull requests and 3 comments.
4. Merged the five lists and compared each mistake with the checks in
   `packages/checks`, the rules in `.claude/rules/` and the lessons in
   `.ai/lessons/`.

The counts are approximate: an agent counted each comment under one mistake.
The trend reads July → November, one number per slice.

## Mistakes a guard now covers

| Mistake | Comments (Jul → Nov) | Guard |
|---|---|---|
| A query's `error` is ignored, so a failed read looks like "no rows" | ~138 (27/33/33/25/20) | `no-discarded-query-error`, added 2026-11-24 |
| A status is read outside the lock, or a status write has no from-state guard | ~88 (8/16/18/14/32) | `status-write-guarded`, `counter-write-relative`, `concurrency.md` rules 1–3, added 2026-11-24 |
| A migration fails when it runs again over a failed deploy | part of ~27 | `migration-replay-safe`, added 2026-11-24 |
| A Kysely write has no `companyId` | part of ~104 | `no-unscoped-kysely-write`, added 2026-09-26 |
| A broken or empty `.po` catalog; a domain term translated wrongly | ~84 (to October) | the glossary (2026-08-28) and `/translate`; none since October |
| A retried external create makes a duplicate | ~33 | `concurrency.md` rule 4 (no check) |
| A spec or plan contradicts the code | ~56 (to September) | none since September |

The three largest recent mistakes got their checks on 2026-11-24. Before that
date, review was the only thing that caught them.

## Mistakes no guard covered, and the guard added

| Mistake | Comments | Guard added on 2026-11-25 |
|---|---|---|
| A single-column foreign key to a table keyed on `("id", "companyId")` | ~40 | check `tenant-fk-composite` |
| A supabase-js update or delete on a tenant table with no `.eq("companyId")` | ~60 of ~104 | check `no-unscoped-supabase-write` |
| Two or more dependent writes in a service function, no transaction | ~63 (19 in Nov) | check `no-chained-client-writes` |
| A migration adds a CHECK or FK to a live table without `NOT VALID`, or drops an index without `lock_timeout` | ~27 | check `migration-lock-safe`, written but not registered (see the run file) |
| An external `fetch` with no timeout | ~9 | check `no-untimed-fetch` |
| A child id from the request belongs to the company but not to the parent the request names | ~62 (24 in Nov) | rule: `conventions-services.md` ("A child id belongs to its parent"), checklist question |
| A lost update: fields read earlier are written back over a concurrent edit | ~26 (15 in Nov) | rule: `concurrency.md` rule 5, checklist question |
| A missing required value becomes a plausible default (`exchangeRate ?? 1`, `?? "USD"`, `rows[0]`) | ~39 | rule: `coding-conventions.md` ("Missing data is an error, not a default") |
| A `Map` keyed by a column that is not unique keeps one row | 7 (Nov) | rule: same section |
| A read that feeds a total, a gate or a loop stops at the 1,000-row cap | ~38 (15 in Nov) | checklist question (`write-time-checklist.md`, Reads at volume); lesson `database-access.md#max-rows-is-enforced-in-production-but-not-by-the-local-dev` |

The fixes behind each check, its proof on the code from before a fix, and its
baseline are in `.ai/runs/2026-11-25-repeated-mistakes-coderabbit.md`.

## Mistakes left to judgment

No text shows these. Lessons cover parts of them.

- The UI acts on stale state: a response for another unit, a save still in
  flight, a modal left from the last open (~36).
- A fix is applied to one call site and not its siblings, or a rule is enforced
  on one entry path only (~22). Lesson: `production-and-mes.md` "A gate on the
  buttons is not a gate".
- A void or delete misses one side effect of the posting it reverses (12 in
  November). Lessons: `inventory-and-traceability.md` "A void reverses only what
  is still where the posting put it".
- A guard or preview uses another basis than the action it predicts (11 in
  November).

## Also found

`.claude/rules/conventions-services.md` showed `today(getLocalTimeZone())` in
its `upsertCustomer` example, which `no-local-timezone` bans in server code. The
example now matches the code (`datetime.timestamp()`).
