# Changelog subscriptions — email, RSS, Slack (Linear-style)

## Implementation status (2026-09-05)

IMPLEMENTED on this branch (uncommitted). Model, after two rounds of simplification:

- **The newsletter preference is a `notificationPreference` row** — topic `changelog`
  (`NotificationTopic.Changelog`, deliberately NOT in `USER_FACING_NOTIFICATION_TOPICS`),
  channel `email`, opt-in (no row → off). One `Switch` in the "Updates from Carbon" card on
  Account → Notifications, going through the SAME action/validator/upsert as the topic grid.
  There is no in-app on/off preference: the "What's new" card always shows until dismissed.
  There is NO subscriber table — a signed-in user's verified email is the address.
- **Migration `20260904191748_changelog-subscriptions.sql`** (applied locally, types
  regenerated): the `changelogDispatch` ledger (`guid`, `title`, `description`,
  `dispatchedAt`, `emailsSent`; platform-level, RLS on / no policies).
- **Unsubscribe** = the same toggle. Emails link (footer + `List-Unsubscribe` header) to the
  signed-in Account → Notifications page; there is no public unsubscribe endpoint and no
  one-click `List-Unsubscribe-Post`, by decision — only the user may change their preference.
- **Dispatcher** `packages/jobs/src/inngest/functions/scheduled/changelog-dispatch.ts`
  (`changelogDispatchFunction`, hourly cron + `changelog/entry.merged`): recipients =
  `notificationPreference ⋈ user` (enabled email rows, active users, deduped per user);
  renders `ChangelogEntryEmail` (`@carbon/documents/email`, the notification card) per
  recipient; Resend batches ≤100 with List-Unsubscribe; ledger insert incl. description;
  empty-ledger bootstrap. Pure helpers + tests in `packages/jobs/src/changelog/`.
- `.github/workflows/changelog-dispatch.yml`; docs popover (email → "Manage in your Carbon
  account" link, RSS + Slack copy rows, unsubscribe notice).

DEPLOY PREREQUISITES: GitHub secret `INNGEST_EVENT_KEY`; `RESEND_API_KEY`/`RESEND_DOMAIN`,
and a PUBLIC `ERP_URL` in the jobs environment (the emails' settings link).

Dispatcher bootstrap: an EMPTY ledger means never-run → record every feed entry WITHOUT sending
(`planDispatch`). Feed URL: `CHANGELOG_FEED_URL`, else `INNGEST_DEV` → local docs, else prod.

In-app "What's new": `apps/erp/app/components/ChangelogPanel.tsx` + `hooks/useChangelogPanel.ts`
— a bottom-right card like the training panel (NEW pill, title, description, Dismiss,
"Changelog" link to the permalink), mounted in the app shell after `TrainingPanel` and hidden
while that panel is open. Data: `getChangelogPanelEntry` (account module) — the newest
`changelogDispatch` row. Dismissal is
per ACCOUNT via `user.flags` — `changelog:<entry slug>` = true, written through the generic
`/x/acknowledge` `flag` intent exactly like the training panel (`userFlagKeyValidator` accepts
the `changelog:` prefix); `useChangelogPanel` reads it from `useUser().flags`. A sidebar version was
tried and rejected: it displaced the rail's bottom items.

NOT implemented: Phase 3 (Slack app).

Goal: a "Subscribe for updates" affordance on docs.carbon.ms/changelog offering the three
channels Linear does — email, RSS, Slack. RSS already exists (`/changelog/rss.xml`).

## Architecture: RSS is the source of truth, everything else consumes it

An entry is "published" when its MDX merges to `main` and Vercel redeploys the docs site.
There is no publish API call to hook — so instead of wiring CI triggers, a scheduled
dispatcher in `@carbon/jobs` polls the live RSS feed, diffs the entry GUIDs against a
dispatch ledger, and fans each NEW entry out to email + Slack. One feed, three channels;
the docs site stays a static publisher with no DB access of its own.

Verified infra to build on: Resend is configured (`RESEND_API_KEY` / `RESEND_DOMAIN` in
`packages/env/src/index.ts:56`), and `packages/jobs` already ships `@react-email/components`
+ nodemailer, and runs Inngest scheduled functions (e.g.
`packages/jobs/src/inngest/functions/scheduled/workflow-run-retention.ts` as a template).

## Decisions to confirm with the user before Phase 2 (Ask First items)

1. **Self-built vs newsletter service.** A service (Buttondown/Mailchimp/Kit) does
   RSS-to-email with zero repo code but adds an external dependency + cost and moves
   subscriber PII off-platform. This plan assumes SELF-BUILT on Resend; flip to a service
   if the team prefers zero maintenance.
2. **Platform-scope tables.** Subscribers are not tenant data — the new tables carry no
   `companyId`, which deviates from the every-table-has-companyId convention. They must be
   service-role-only (RLS enabled, no policies), never readable from app clients.
3. **Sending domain + volume.** Broadcast email from `RESEND_DOMAIN`; confirm the domain's
   reputation can take newsletter volume, or use a subdomain (e.g. `updates.carbon.ms`).

## Phase 1 — ship now, zero backend (Slack + email via RSS)

- [ ] Subscribe popover on `/changelog` (docs app only): a small "Subscribe" button next to
      the RSS link opening a card with the three channels:
      - **RSS** — copy-able feed URL.
      - **Slack** — instructions: `/feed subscribe https://docs.carbon.ms/changelog/rss.xml`
        (Slack's built-in RSS app; no Carbon Slack app needed).
      - **Email** — hidden until Phase 2 (or an external-service embed if decision 1 flips).
      Files: `docs/app/changelog/page.tsx` + a new `docs/components/changelog-subscribe.tsx`
      (client component, house palette).
- [ ] Verification: `pnpm --filter docs build` green; popover renders; `/feed subscribe`
      tested against the production feed once deployed.

## Phase 2 — email subscriptions (self-built)

Storage + endpoints as ORIGINALLY planned (a `changelogSubscriber` table, public
subscribe/confirm/unsubscribe edge functions, double opt-in) were built, then replaced —
see "Implementation status" above for what actually shipped: `notificationPreference`
rows for signed-in users; unsubscribe is the same toggle (no public endpoint). Kept below only for the
merge trigger and dispatcher design, which are unchanged.

Merge trigger (fast path — the cron below stays as the safety net):

- [ ] `.github/workflows/changelog-dispatch.yml` — `push` to `main` with
      `paths: ["docs/content/changelog/**"]` + `workflow_dispatch` for manual re-fires
      (same trigger shape as `deploy.yml` / `inngest.yml`). One step: `curl` an
      `changelog/entry.merged` event to Inngest's event API (`INNGEST_EVENT_KEY` secret).
- [ ] The dispatcher handles the deploy race: an event-triggered run that finds no new
      GUIDs in the feed (Vercel still deploying) does `step.sleep` ~2 min and refetches,
      up to ~5 attempts, then gives up and lets the cron catch it.

Dispatcher (`packages/jobs`):

- [ ] `changelogDispatchFunction` — Inngest function with TWO triggers: the hourly cron
      AND the `changelog/entry.merged` event. Same logic either way; the ledger makes
      overlapping runs idempotent. Steps: fetch
      `https://docs.carbon.ms/changelog/rss.xml` → parse → GUIDs not in `changelogDispatch`
      → for each new entry: render the email (react-email template: entry title, date,
      description, "Read more" link — NOT the full body; the feed only carries the
      description, and the permalink is the destination) → Resend batch send to `confirmed`
      subscribers (chunk ≤100/call), `List-Unsubscribe` header set → insert dispatch row.
      Concurrency limit 1; a retry re-reads the ledger so no double-send.
- [ ] Email template in `packages/jobs` alongside existing react-email templates.

Docs site:

- [ ] Enable the email tab in the subscribe popover: form POSTs to the
      `changelog-subscribe` edge function URL (public, CORS) — the docs app needs only the
      Supabase functions origin as an env/constant, no DB client.

Verification:

- [ ] Unit: dispatcher GUID-diff logic + RSS parse (vitest in `packages/jobs`).
- [ ] Manual: subscribe → confirm → publish a test entry locally → run dispatcher against
      local feed → email received; unsubscribe link works; re-run dispatcher → no
      double-send (`changelogDispatch` hit).

## Phase 3 — first-class Slack ("Add to Slack" button)

Only worth it if `/feed subscribe` feels too manual for customers.

- [ ] Create a Carbon Changelog Slack app (incoming-webhook scope only).
- [ ] `changelogSlackWebhook` table: `id`, `webhookUrl` (encrypted — use the existing
      vaulted-secret pattern), `teamName`, `channel`, `createdAt`. Service-role only.
- [ ] `changelog-slack-oauth` edge function: handles the OAuth redirect, exchanges the code
      (`oauth.v2.access`), stores `incoming_webhook.url` + team/channel, redirects back to
      `/changelog?slack=connected`.
- [ ] Dispatcher gains a Slack step: post Block Kit message (title linked to permalink,
      date, description) to every stored webhook; drop webhooks that return `410 Gone`.
- [ ] "Add to Slack" button in the subscribe popover.

## Out of scope

- In-app "What's new" notifications (separate feature; would ride the ERP notification
  system, not this pipeline).
- Per-tag subscription filtering (add a `tags` column to subscriber later if asked).
