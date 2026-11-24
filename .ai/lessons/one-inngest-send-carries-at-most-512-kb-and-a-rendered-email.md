---
paths: []
triggers: []
promoted: null
---
# One Inngest send carries at most 512 KB, and a rendered email is about 17 KB

**Context:** `notify` rendered every recipient's notification email in one step, then sent all the `carbon/send-email` events with one `step.sendEvent` (2026-10-09).

**Problem:** One rendered `NotificationEmail` is about 16.9 KB, because the event carries the full HTML. Inngest accepts at most 512 KB in one send and 4 MB in one step's output. So email to about 30 recipients or more could fail the send, and about 240 filled the step. A group notification reaches those sizes; a test with one recipient never does.

**Rule:** Size a fan-out by its bytes, not its count. When each event carries a rendered body, render and send it in chunks (`EMAIL_CHUNK` in `notify.ts`), each chunk in its own step with an indexed id (`render-emails-${index}`). A new step id replays a run in flight at deploy, so a send step that changes id sends again for those runs.

**Applies to:** `packages/jobs/src/inngest/functions/notifications/notify.ts`; any job that fans out events with large payloads.
