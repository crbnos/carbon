---
paths:
  - "**/*.service.ts"
  - "**/*.server.ts"
  - "packages/jobs/**"
  - "packages/database/supabase/migrations/**"
---

# Concurrency

Two requests can run the same code on the same row at the same time: a double
click, a retried job, a second tab, an API call next to the UI. Each rule below
is a bug that shipped. The checks in `@carbon/checks` fail new code that breaks
the first three. They read text, so they see one function at a time. When a
protocol has several actors (a post and a void, a completion and a backflush,
a close and a reopen), check it with the formal models: the
`formal-verification` skill (`.claude/skills/formal-verification/SKILL.md`,
`packages/models`).

## 1. Lock, then read

Read the values you decide on after you take the lock, never before. A lock
taken after the read does not protect the read. Lock the row you change, not a
parent row: a different writer of the same row may not take the parent lock.

- Kysely: `.selectFrom("t")…forUpdate()` (or `.forNoKeyUpdate()`) in the
  transaction, then re-check the status or re-read the total.
- Examples: `lockPostedReceipt` and the posting that re-checks the receipt's
  status under it. A lock without the re-check is not enough: the invoice void
  locked the invoice and never read its status, so a second void reversed it
  again (578c411ffe). A lock on the wrong row is not enough either:
  `issueJobOperationMaterials` locked the operation, but the job's backflush
  takes the draw locks, so the fix reads `quantityIssued` again after
  `lockUntrackedDraws` (f92d1b24fa).
- Enforced by `status-write-guarded` and `counter-write-relative` (a lock on
  the written table counts only when it comes before the write).

## 2. Guard the status in the UPDATE

An UPDATE that moves a lifecycle status names the status it moves from, and
the caller refuses when no row changed.

```ts
const moved = await client
  .from("accountingPeriod")
  .update({ closeStatus: "Locked" })
  .eq("id", periodId)
  .eq("companyId", companyId)
  .eq("closeStatus", "Open")
  .select("id")
  .maybeSingle();
if (!moved.data) return refuse("Only open periods can be locked");
```

Kysely: `.where("status", "=", "Sent")`, then check `numUpdatedRows`. Or lock
the row first (rule 1) and re-check the status under the lock.

- Enforced by `status-write-guarded`. Fixed bugs: de82a88cc6 (period
  lock/unlock), 2c9ef0dd8f (quote conversion), bbe8dfd6a9 (receipt post).

## 3. Write running totals relatively, or under the lock

Do not compute a total in JavaScript from a value you read earlier and write it
back (`quantityIssued: line.quantityIssued + delta`). A writer that commits
between your read and your write is lost or counted twice.

- Write it in SQL: `` sql`"quantityIssued" + ${delta}` `` or
  `(eb) => eb("quantityIssued", "+", delta)`.
- Or read the total under the row lock (rule 1) and write it in the same
  transaction.
- Enforced by `counter-write-relative` (`quantityIssued`, `quantityReceived`,
  `quantityShipped`, `quantitySent`, `quantityInvoiced`, … — `COUNTER_COLUMNS`).
  Fixed bugs: ca513209d8 and f92d1b24fa (`issueJobOperationMaterials`).

## 4. Side effects after commit; an idempotency key on a retried external create

- Send an email, print, trigger a job or call an external API after the
  transaction commits. Inside it, a rollback leaves the email sent, and a retry
  sends it again.
- A create in an external system that can be retried (an Inngest step, a sync
  operation, a webhook) carries an idempotency key, so the retry finds the
  first create instead of making a second one (`idempotencyKey` in
  `packages/ee/src/accounting/core/operations.ts`).
- No check enforces this rule: a side effect is usually a call to another
  function, which a text check cannot follow. Review it, and model it when
  several actors are involved.

## When a check flags your code

Fix the code; do not add it to the baseline. The baseline
(`packages/checks/src/conformance/baseline.json`) holds only the sites that
existed when the checks were added. If the write is safe for a reason the
check cannot see (a lock taken in a helper in another file, a claim on another
column), restructure so the check can see it, or ask before you baseline it.
