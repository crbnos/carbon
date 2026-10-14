# Notification Digest via pg_cron Sweep

Last tested: 2026-10-04
Route: /x (topbar bell)

## Prerequisites
- Migration `20261004183512_scheduled-jobs-from-database.sql` applied.
- Vault secret `inngest_event_url` set and the Inngest dev server running (both
  are done by `crbn up`).
- The test user has no unread notifications (start from `has_work = false`).

## Steps
### 1. Seed — five unread notifications for `test@carbon.ms`, same company and
topic (`event = 'job-assignment'`, `topic = 'jobs'`), `createdAt` more than
60 minutes ago. Give them a recognisable `title` so they can be deleted.

### 2. Sweep
- `SELECT util.notification_digest_has_work();` → `true`
- `SELECT util.sweep_notification_digest();`

### 3. Verify — database (within about 5 seconds)
- One `event = 'digest'` row for the user with `payload->>'count' = '5'` and
  title "5 unread notifications".
- The five seeded rows have `digestedInto` set to that row.
- `util.notification_digest_has_work()` → `false`.
- The newest `net._http_response` rows are 200.

### 4. Verify — app
- Reload `/x`. The bell badge reads 1, not 5.
- Open the bell: the Inbox lists "5 unread notifications".

### 5. Clean up — delete the seeded rows and the digest row.

## Selector Notes
- The bell is the topbar button with class `w-8 h-8 flex items-center relative`;
  it has no aria-label. Its text content is the unread count.

## Common Failures
- Fewer than five rows, or rows younger than 60 minutes: `has_work` stays false
  and nothing is sent. Both thresholds are in `notification-digest.ts`.
- Seeding rows across two companies or topics: each bucket is counted separately.
