# @carbon/lib

Shared server utilities — event system, Inngest client, trigger dispatch, Resend email, Slack messaging, and Twenty CRM.

## Always

- **Use `trigger(taskId, payload)` for dispatching background jobs** — typed helper that maps task IDs to Inngest event names; drop-in replacement for old `tasks.trigger()`
- **Add new events to the `Events` type in `events.ts`** — every Inngest event needs a typed payload here
- **Add new task mappings to `taskToEvent` in `trigger.ts`** — maps human-readable task IDs to `carbon/*` event names
- **Guard external calls** — `resend.server.ts` respects `DISABLE_RESEND` env; `slack.server.ts` skips sends on localhost
- **Add new work events to `src/telemetry/events.ts`** — the `WorkEvents` type map is the contract; `captureWorkEvent` is typed off it, so an unlisted name will not compile

## Ask First

- Adding new Inngest event types (coordinate with `packages/jobs/` function registration)
- Changing the Inngest client ID (`"carbon"`)

## Never

- Send emails or Slack messages directly from app routes — dispatch via `trigger("send-email", ...)` or `trigger("send-slack", ...)`
- Import this package on the client — all exports are server-only (`.server.ts` convention)

## Validation Commands

```bash
pnpm --filter @carbon/lib typecheck   # tsgo --noEmit
pnpm --filter @carbon/lib test        # vitest run
```

## Key Patterns

- **Inngest client**: `src/inngest/client.ts` — singleton `new Inngest({ id: "carbon", logger: createInngestLogger() })`. The `logger` (from `@carbon/logger/inngest`) routes every job's `ctx.logger` into LogTape under the `["carbon","jobs"]` category.
- **Trigger helper**: `trigger(taskId, payload)` / `batchTrigger(taskId, items)` — typed dispatch
- **Events**: `src/events.ts` — full `Events` type map (`carbon/notify`, `carbon/send-email`, `carbon/send-slack`, etc.)
- **Exports**: `./events`, `./inngest`, `./trigger`, `./telemetry`, `./resend.server`, `./slack.server`, `./twenty.server`
- **Work-event telemetry**: `src/telemetry/` — `trackWorkEvent()` records work done on the platform (jobs released, quotes sent, POs issued) as a PostHog event, over a bare `fetch` with no SDK. Three rules it must keep: it **never throws into the caller** (same contract as `raiseMoment` — a lost measurement beats a failed action), the event `uuid` is **deterministic** from (companyId, event, recordId, discriminator) so a retry collapses instead of double-counting, and it emits only when `POSTHOG_PROJECT_PUBLIC_KEY` is set and `CONTROLLED_ENVIRONMENT` is off — the same gate `apps/erp/app/entry.client.tsx:31` puts on the browser SDK. Deliberately **not** named `.server`: MES service files are in the client graph (React components import their types), so a `.server` specifier fails the React Router build — which is also why the hash is plain TypeScript rather than `node:crypto`. See `src/telemetry/README.md` for the coverage gaps and `VERIFICATION.md` for the post-deploy runbook
- **Workflow moments**: `src/workflows/raise-moment.ts` — `raiseMoment()` announces a business moment (as opposed to a row change) to the workflow matcher. Two rules it must keep: it **never throws into the caller** (a failed announcement must not fail the business operation that raised it — it logs instead), and the `momentId` it mints is used twice, as the Inngest event id *and* as the matcher's `sourceEventId`, which is what makes a redelivery idempotent. See `.claude/rules/workflow-matcher.md`

## Cross-References

- `packages/notifications/` — `NotificationEvent` / `NotificationDestination` enums used in event payloads
- `packages/jobs/` — Inngest function implementations that consume these events
- `packages/env/` — `SLACK_BOT_TOKEN`, `RESEND_API_KEY`, and other env vars
- `packages/logger/` — `createInngestLogger()` wired as the Inngest client's `logger`
