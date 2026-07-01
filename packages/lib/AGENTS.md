# @carbon/lib

Shared server utilities — event system, Inngest client, trigger dispatch, Resend email, Slack messaging, and Twenty CRM.

## Always

- **Use `trigger(taskId, payload)` for dispatching background jobs** — typed helper that maps task IDs to Inngest event names; drop-in replacement for old `tasks.trigger()`
- **Add new events to the `Events` type in `events.ts`** — every Inngest event needs a typed payload here
- **Add new task mappings to `taskToEvent` in `trigger.ts`** — maps human-readable task IDs to `carbon/*` event names
- **Guard external calls** — `resend.server.ts` respects `DISABLE_RESEND` env; `slack.server.ts` skips sends on localhost

## Ask First

- Adding new Inngest event types (coordinate with `packages/jobs/` function registration)
- Changing the Inngest client ID (`"carbon"`)

## Never

- Send emails or Slack messages directly from app routes — dispatch via `trigger("send-email", ...)` or `trigger("send-slack", ...)`
- Import this package on the client — all exports are server-only (`.server.ts` convention)

## Validation Commands

```bash
pnpm --filter @carbon/lib typecheck   # tsgo --noEmit
```

## Key Patterns

- **Inngest client**: `src/inngest/client.ts` — singleton `new Inngest({ id: "carbon" })`
- **Trigger helper**: `trigger(taskId, payload)` / `batchTrigger(taskId, items)` — typed dispatch
- **Events**: `src/events.ts` — full `Events` type map (`carbon/notify`, `carbon/send-email`, `carbon/send-slack`, etc.)
- **Exports**: `./events`, `./inngest`, `./trigger`, `./resend.server`, `./slack.server`, `./twenty.server`

## Cross-References

- `packages/notifications/` — `NotificationEvent` / `NotificationDestination` enums used in event payloads
- `packages/jobs/` — Inngest function implementations that consume these events
- `packages/env/` — `SLACK_BOT_TOKEN`, `RESEND_API_KEY`, and other env vars
