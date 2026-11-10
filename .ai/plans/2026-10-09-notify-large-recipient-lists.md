# Notifications for large recipient lists — implementation plan

**Spec:** none. The input is the user's request on PR #1867: make `notify` work for a large group, not only the read limit.
**Research:** none. The limits come from the code, `.claude/skills/inngest/SKILL.md` and a measurement on 2026-10-09.
**Branch:** `naveenkash/carbon-browser-notifications` (PR #1867). The user chose this branch on 2026-10-09, so the work does not wait for the merge. The plan needs `fetchAllByIds` from that PR.

## Why

`notify` (`packages/jobs/src/inngest/functions/notifications/notify.ts`) handles each recipient list in one request, one insert or one send. That is correct for a few recipients. A group notification can have hundreds.

PR #1867 fixed the reads: `fetchAllByIds` (`@carbon/database`) sends 100 ids per `.in()` request and pages each group. These limits remain:

| Limit | Where in `notify.ts` | What fails |
|---|---|---|
| `.in()` writes each id into the URL; the gateway rejects a long request line (HTTP 431) | The 2 supersede updates in `write-in-app-notifications` | The digest step throws for a large group |
| One round trip per recipient | The multi-item digest loop: 1 parent insert and 1 child insert per user | A large digest is slow, and the step can time out |
| Inngest keeps a step output up to 4 MB | `resolve-email-recipients` returns the rendered HTML of every recipient | About 240 recipients fill 4 MB (16.9 KB per email) |
| Inngest accepts a send batch up to 512 KB | `fan-out-emails`, `fan-out-slack`, `fan-out-push` send all events at once | Email fails at about 30 recipients (30 × 16.9 KB) |
| Slack rate-limits `users.lookupByEmail` (Tier 3, 50+ calls a minute) | `resolve-slack-recipients` looks up every recipient at the same time | Not a lost DM: `@slack/web-api` waits for `Retry-After` and tries again, up to 10 times in about 30 minutes. A large first-time fan-out makes the step wait. |
| One `user` read per Slack recipient | `getSlackUserIdByCarbonId` (`packages/ee/src/slack/lib/service.ts:252`) reads the email by user id | Only on a Redis cache miss (`slack-user:<id>`), so the first DM to a user only |

The 16.9 KB is the rendered `NotificationEmail` for one job assignment with one detail row (`render(getNotificationEmailComponent(…))`, measured in a temporary vitest file).

## Progress
- [x] Task 1: Add the chunk sizes to `notify.ts`
- [x] Task 2: Chunk the in-app supersede updates
- [x] Task 3: Insert digest rows in batches, and chunk the flat insert
- [x] Task 4: Render and send emails in chunks
- [x] Task 5: Send the Slack and push events in chunks
- [x] Task 6: Look up Slack users with the email in hand and bounded concurrency — skipped by the user, see the task
- [x] Task 7: Use the shared `fetchAllByIds` in the production module
- [x] Task 8: Update the docs and the lessons
- [ ] Task 9: Run the gates and a large-group check

## Dependencies

- Task 1 comes first. Tasks 2, 3, 4 and 5 use its chunk sizes.
- Tasks 2 and 3 change the same step. Do them in order.
- Tasks 4, 5 and 6 are independent of each other after Task 1.
- Task 7 is independent of every other task.
- Task 8 needs Tasks 1–7. Task 9 comes last.

## Caution: step ids and runs in flight

Inngest replays a completed step from its stored output. It finds that output by the step id. See `.ai/lessons.md`, "A new key in an Inngest step's return breaks runs in flight at deploy".

- If you keep a step id, keep the shape of its return value.
- If you change the shape, give the step a new id.
- A new id makes a run that is in flight at deploy run that step again. For a send step, that run sends its events again.
- Deploy when no `carbon/notify` run is in flight, or accept one duplicate for each run in flight.

---

## Task 1: Add the chunk sizes to `notify.ts`

**Depends on:** none
**Files:**
- Modify: `packages/jobs/src/inngest/functions/notifications/notify.ts` — 4 constants after the imports
- Copy from (precedent): `for (const [index, batch] of chunkArray(…).entries())` in `packages/jobs/src/inngest/functions/integrations/accounting-master-sync.ts:222`

The splitting helper already exists: `chunkArray` in `@carbon/utils`. A chunk's step id is a template string with its index, as in `scheduled/weekly.ts:294`. Do not add a wrapper for either (decision of the user, 2026-10-09).

**Steps:**
1. Add `chunkArray` to the existing `import { datetime } from "@carbon/utils"` line.
2. Add `IN_FILTER_CHUNK = 100`. Comment: ids per `.in()` request, so the URL fits (HTTP 431).
3. Add `INSERT_CHUNK = 500`. Comment: rows per `notification` insert.
4. Add `EMAIL_CHUNK = 20`. Comment: 20 × 16.9 KB stays under the 512 KB send limit.
5. Add `EVENT_CHUNK = 500`. Comment: Slack and push events are under 1 KB each.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: Tasks: 1 successful
```

**Out of scope:** a new helper module. Tasks 2–5 use `chunkArray(…).entries()` directly.

Add each constant in the task that first uses it. Biome rejects an unused constant as an error, and the commit hook runs Biome. So Task 1 commits together with Task 2.

## Task 2: Chunk the in-app supersede updates

**Depends on:** Task 1
**Files:**
- Modify: `packages/jobs/src/inngest/functions/notifications/notify.ts` — the `if (content.digest)` block in `write-in-app-notifications`

**Steps:**
1. Find the `Promise.all` with the 2 `update({ readAt, seenAt })` calls.
2. Loop over `chunkArray(userIds, IN_FILTER_CHUNK)`, one chunk at a time.
3. In each pass, run the 2 updates with `.in("userId", chunk)` instead of `userIds`.
4. Keep `supersededAt` as one value for all chunks.
5. If an update returns an error, log it and throw it, as the code does now.
6. Keep the step id `write-in-app-notifications`. Its return value does not change.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: Tasks: 1 successful
grep -n '.in("userId", userIds)' packages/jobs/src/inngest/functions/notifications/notify.ts
# Expected: no line inside write-in-app-notifications
```

**Out of scope:** the order of supersede and insert. Supersede stays first, because it makes a retry self-healing.

## Task 3: Insert digest rows in batches, and chunk the flat insert

**Depends on:** Task 2
**Files:**
- Modify: `packages/jobs/src/inngest/functions/notifications/notify.ts` — the `if (digestItems && digestItems.length > 1)` loop and the flat insert after it

**Steps:**
1. Replace the per-user loop with a loop over `chunkArray(userIds, IN_FILTER_CHUNK)`.
2. For each chunk, build one parent row per user, with the same fields as now.
3. Insert the parents in one call with `.select("id, userId")`.
4. Build a map from `userId` to parent `id`.
5. If a user in the chunk has no parent id, throw an error that names the user.
6. Build the child rows for every user in the chunk, with `digestedInto` from the map.
7. Insert the children in calls of at most `INSERT_CHUNK` rows each.
8. Add each inserted count to `inserted`.
9. For the flat path, insert `rows` in calls of at most `INSERT_CHUNK` rows each.
10. Keep the return value `{ inserted, userIds }`, so the step id stays the same.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: Tasks: 1 successful
pnpm --filter @carbon/jobs test
# Expected: all tests pass
```

**Out of scope:** the `DigestNotification` UI and the shape of a digest row.

If PostgREST does not return the inserted rows in input order, do not rely on order. The map in step 4 keys on `userId`, so order does not matter. If `.select("id, userId")` does not return `userId`, STOP and report.

## Task 4: Render and send emails in chunks

**Depends on:** Task 1
**Files:**
- Modify: `packages/jobs/src/inngest/functions/notifications/notify.ts` — the `resolve-email-recipients` step and `fan-out-emails`

**Steps:**
1. Add a step `load-email-recipients` that returns `{ id, email, fullName }[]` from the `fetchAllByIds` read.
2. Remove the `resolve-email-recipients` step. Its stored output has the old shape.
3. Loop over `chunkArray(recipients, EMAIL_CHUNK).entries()`.
4. For each chunk, run ``step.run(`render-emails-${index}`, …)`` with the render code that exists now.
5. Return the events of that chunk only.
6. Send them with ``step.sendEvent(`fan-out-emails-${index}`, events)``.
7. Keep the subject, text, tracking and `to` fields exactly as now.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: Tasks: 1 successful
grep -n '"resolve-email-recipients"\|"fan-out-emails"' packages/jobs/src/inngest/functions/notifications/notify.ts
# Expected: no output (the old ids are gone)
```

**Out of scope:** `send-email.ts` and the `carbon/send-email` event shape. Other callers use them.

Read the caution about step ids before you deploy. Inngest allows 1000 steps in one run, and each email chunk uses 2. If a group can have more than 9,000 email recipients, STOP and report.

## Task 5: Send the Slack and push events in chunks

**Depends on:** Task 1
**Files:**
- Modify: `packages/jobs/src/inngest/functions/notifications/notify.ts` — `fan-out-slack` and `fan-out-push`

**Steps:**
1. Replace `step.sendEvent("fan-out-slack", slackEvents)` with a loop over `chunkArray(slackEvents, EVENT_CHUNK).entries()`.
2. Send each chunk with ``step.sendEvent(`fan-out-slack-${index}`, chunk)``.
3. Do the same for `fan-out-push` with `pushEvents`.
4. Keep the `resolve-…` steps that build the events. Their return shapes do not change.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: Tasks: 1 successful
grep -n 'sendEvent("fan-out-slack"\|sendEvent("fan-out-push"' packages/jobs/src/inngest/functions/notifications/notify.ts
# Expected: no output
```

**Out of scope:** `send-slack.ts` and `send-push.ts`.

## Task 6: Look up Slack users with the email in hand and bounded concurrency

> **Skipped (2026-10-09, the user's decision).** The premise was wrong. A rate-limited lookup does not drop the user: `@slack/web-api` 7.15 defaults to `rejectRateLimitedCalls = false` and `tenRetriesInAboutThirtyMinutes`, so it waits and tries again. The `user` read happens only on a Redis cache miss. `getSlackUserIdByCarbonId` also has 6 callers inside `service.ts`, which the escape hatch in step 2 guards. The steps below stay as a record; do not do them.

**Depends on:** Task 1
**Files:**
- Modify: `packages/ee/src/slack/lib/service.ts` — `getSlackUserIdByCarbonId`
- Modify: `packages/jobs/src/inngest/functions/notifications/notify.ts` — the Slack recipient lookup
- Copy from (precedent): the bounded loop in `fetchAllRecords` (`packages/database/src/utils.ts`), which runs `PAGE_CONCURRENCY` requests at a time

**Steps:**
1. Run `git grep -n "getSlackUserIdByCarbonId"`. On 2026-10-09, `notify.ts` was the only caller.
2. If there is another caller, STOP and report. Do not change a signature it uses.
3. Rename it to `getSlackUserIdByEmail(accessToken, userId, email)`. Remove its `user` read.
4. Keep the Redis cache key `slack-user:${userId}`, so cached ids stay valid.
5. In `notify.ts`, read `id, email` for the Slack recipients with `fetchAllByIds`.
6. Look up at most 5 users at a time. Wait for each group of 5 before the next.
7. Count the users whose lookup returned nothing. Log the count once, with `companyId`.
8. Keep the skip: a user with no Slack account gets no DM, as now.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: Tasks: 1 successful (each)
```

**Out of scope:** retry on a Slack 429. Before you choose 5, read Slack's current rate tier for `users.lookupByEmail`. If the tier allows fewer than 20 calls a minute, STOP and report.

`packages/ee` is commercial code. Keep its SPDX header. Do not move the function out of `packages/ee`.

## Task 7: Use the shared `fetchAllByIds` in the production module

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts` — the private `fetchAllByIds` and `IN_FILTER_BATCH_SIZE`

**Steps:**
1. Delete the private `fetchAllByIds` function and the `IN_FILTER_BATCH_SIZE` constant.
2. Add `fetchAllByIds` to the existing `import { … } from "@carbon/database"` line.
3. Keep every call site as it is. The shared function has the same signature.
4. Keep the `chunkArray` import. The planning-actions read still uses it.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 1 successful
grep -n "async function fetchAllByIds" apps/erp/app/modules/production/production.service.ts
# Expected: no output
```

**Out of scope:** the call sites, and any other module.

## Task 8: Update the docs and the lessons

**Depends on:** Tasks 1–7
**Files:**
- Modify: `packages/jobs/AGENTS.md` — the `notify` row
- Modify: `.ai/lessons.md` — a new lesson

**Steps:**
1. Add a `notify` row. Say that it chunks its writes, renders and sends (`EMAIL_CHUNK` and the other sizes).
2. Add a lesson about the 512 KB send limit and the 16.9 KB email.
3. Use the format Context → Problem → Rule → Applies to.

**Verify:**
```bash
grep -n "EMAIL_CHUNK" packages/jobs/AGENTS.md
# Expected: 1 line
```

**Out of scope:** product docs. The change is not visible to a user.

## Task 9: Run the gates and a large-group check

**Depends on:** Tasks 1–8
**Files:** none

**Steps:**
1. Run Biome on the changed files.
2. Run the typecheck for `@carbon/jobs`, `@carbon/ee`, `@carbon/database` and `erp`, one at a time.
3. Run the tests for `@carbon/jobs` and `@carbon/database`.
4. Ask the user before you create test data for the large-group check.
5. With approval, create a group of 1,200 users and send one notification to it.
6. Check that `notification` has 1,200 new rows for that event.
7. Check that the `carbon/notify` run has no failed step.
8. If the company's plan includes email notifications, check for steps `fan-out-emails-0` to `fan-out-emails-59`.

**Verify:**
```bash
pnpm --filter @carbon/jobs test
# Expected: all tests pass
pnpm --filter @carbon/database test
# Expected: all tests pass
```

**Out of scope:** any database write without the user's approval (`.ai/lessons.md` and the user's standing rule).
