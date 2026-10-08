# Feature run: Browser push notifications (Web Push) for the ERP

- Date: 2026-10-08
- Mode: fully-autonomous
- Request: "i wanna go with option 2" (Web Push, which works when the browser is closed), then "yes go ahead with /feature".
- Phase plan: research [skip — the requirements are clear and this is not ERP domain logic] · spec [run — new table, migration, dependency, service worker and channel across 3 packages] · plan [run] · execute [run] · test [skip — the user chose not to run it; push delivery needs a manual check] · self-review [run]

## Agreed decisions (from the user, before the run)

1. No plan gate. Push is free for all plans, like the in-app bell.
2. Add `web-push` as a dependency of `@carbon/jobs`.
3. ERP only. MES has no notification UI.
4. The user turns on push per device at Account → Notifications. Each topic gets a "Browser" switch next to Email and Slack.
5. Carbon sends one push per notification when it creates it. Push has no digest.
6. If the VAPID env vars are missing, Carbon skips the push channel and hides the control.
7. If the push service returns 404 or 410, Carbon deletes the subscription.
8. Each deployment has one VAPID key pair in env vars.
9. Carbon commits or pushes only when the user asks.

## Decisions
- Spec gate: the run resolved 7 open questions from codebase precedent. The spec marks each one **Autonomous**. No question is in Ask-First territory: the subscription table keeps `companyId`, and the user approved the `web-push` dependency. — 2026-10-08
- Plan gate: the run approves the plan. It covers every acceptance criterion. Task 15 holds a manual browser checklist because the run skipped `/test`. — 2026-10-08
- Review gate: the run fixed the 1 must-fix item. If a `notify` run is in flight across the deploy, it replays the old step output with no `pushRecipientIds`, and `.length` throws. The run now defaults the value to `[]`. It left the risks and suggestions to the user. — 2026-10-08

## Phase log
- spec: `.ai/specs/2026-10-08-web-push-notifications.md` written. STE-80 pass done.
- plan: `.ai/plans/2026-10-08-web-push-notifications.md` written, 15 tasks. STE-80 pass done.
- execute: 15 tasks done. Nothing committed: the user asks for each commit.
  - Deviation 1: `packages/notifications/src/index.test.ts` pinned the old channel list `["email", "slack"]`. The run updated that assertion to include `"push"`.
  - Deviation 2: `pnpm add web-push` also re-resolved unrelated peer dependencies in `pnpm-lock.yaml`. The run kept only the 49 `web-push` lines. `pnpm install --frozen-lockfile` passes.
  - Deviation 3: `generate:mcp` changed `tool-manifest.digest.json`, because `upsertNotificationPreference` now accepts `push`. None of the 3 new functions became a tool.
  - `pnpm db:check:backups` skipped: the local stack was not running.
  - `/test` skipped by the user. The manual checklist is below.
- self-review: 1 must-fix item, fixed (above). 5 risks and 4 suggestions go to the user. The `@carbon/jobs` typecheck passes after the fix.

## Manual browser checklist

1. Run `pnpm dlx web-push generate-vapid-keys`.
2. Put `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` in `.env.local`.
3. Restart the ERP and the Inngest dev server.
4. Open Account → Notifications. Click **Turn on** and allow the prompt.
5. Click **Send a test notification**. Expect an OS notification. Click it and expect Account → Notifications.
6. Close every Carbon tab. Assign a job to the user from a second account. Expect "Job assigned to you".
7. Turn off the Jobs **Browser** switch. Assign another job. Expect no push and a new bell row.
8. Click **Turn off**. Expect 0 `pushSubscription` rows for the user.

## Outcome
- Built, verified, not committed. The run waits for the user to review it and ask for a commit.
