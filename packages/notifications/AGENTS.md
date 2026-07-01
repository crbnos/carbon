# @carbon/notifications

Notification event taxonomy — enums and topic mapping shared across app routes, jobs, and Inngest functions.

## Always

- **Import `NotificationEvent` from `@carbon/notifications`** — this is the single source of truth for event types
- **Map new events to a `NotificationTopic` in `getNotificationTopic()`** — every event must belong to exactly one topic
- **Remember topic strings are persisted** — `NotificationTopic` values are stored in the `notification.topic` DB column; renaming is a migration
- **Dispatch via `trigger("notify", payload)` from `@carbon/lib`** — the `carbon/notify` Inngest function handles fan-out (inApp / email / Slack)

## Ask First

- Renaming any `NotificationTopic` enum value (requires a DB migration)
- Adding a new `NotificationDestination` beyond inApp/email/Slack

## Never

- Put fan-out logic in this package — it's enum-only; fan-out lives in `packages/jobs`
- Send notifications directly — always go through the `trigger("notify", ...)` pathway

## Validation Commands

```bash
pnpm --filter @carbon/notifications typecheck  # tsgo --noEmit
```

## Key Patterns

- **Enums only** — `NotificationEvent`, `NotificationTopic`, `NotificationDestination`
- **inApp is always included** — regardless of caller-specified destinations
- **Single export**: `@carbon/notifications` barrel from `src/index.ts`

## Cross-References

- `packages/lib/src/events.ts` — typed `Events["carbon/notify"]` payload
- `packages/lib/src/trigger.ts` — `trigger("notify", ...)` dispatch helper
- `packages/jobs/` — Inngest `notify` function (fan-out implementation)
