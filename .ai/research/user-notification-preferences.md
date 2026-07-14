# Research: User-Level Notification Preferences

Date: 2026-07-14 · Branch: `naveen/user-notification-settings` (worktree of `origin/main` @ `81494bea8`)

Goal: let each user control whether they receive **email** and **Slack** notifications (per notification category), instead of the current all-or-nothing company-level behavior.

---

## 1. How notifications work today

### The single chokepoint

Every optional (non-transactional) notification flows through **one Inngest function**:

- Producers call `trigger("notify", payload)` (`packages/lib/src/trigger.ts`) → Inngest event `carbon/notify`.
- `packages/jobs/src/inngest/functions/notifications/notify.ts` (`notifyFunction`) then:
  1. **Resolves recipients** (`notify.ts:254-273`) — `recipient.type` is `user` / `users` / `group` (groups expanded via `users_for_groups` RPC); dedupes and drops the sender.
  2. Computes `destinations = InApp ∪ (payload.destinations ?? defaultDestinations[event])` (`notify.ts:194-199`, defaults table `:50-171` — nearly every event defaults to Email + Slack).
  3. Fans out three ways:
     - **In-app** (`:324-455`) — inserts `notification` rows. Always on; comment says in-app cannot be opted out.
     - **Email** (`:457-569`) — gated only by company plan feature `EMAIL_NOTIFICATIONS`; renders via `@react-email` + `packages/documents/src/email/NotificationEmail.tsx`; emits `carbon/send-email` per recipient → `send-email.ts` → **Resend**.
     - **Slack DM** (`:571-641`) — gated only by company `companyIntegration` row `id="slack"` being active; maps Carbon user → Slack user via `getSlackUserIdByCarbonId` (`@carbon/ee/slack.server`, email lookup, Redis-cached); emits `carbon/send-slack` per recipient → `send-slack.ts` → `chat.postMessage`.

**There is no per-user "should we notify?" check anywhere.** The only gates are company-level (plan feature, Slack integration active), sender self-exclusion, and a delivery cap for recurring events (`MAX_NOTIFICATION_DELIVERIES = 5`, `notificationDelivery` table — throttling, not preference).

### Taxonomy (`packages/notifications/src/index.ts`)

- `NotificationEvent` — **30 events** (`:7-39`): all the `*Assignment` events, `Approval{Requested,Approved,Rejected}`, `DigitalQuoteResponse`, `SupplierQuoteResponse`, `JobCompleted`, `JobOperationMessage`, `MaintenanceDispatchCreated`, `QuoteExpired`, `GaugeCalibrationExpired`, `SalesRfqReady`, `SuggestionResponse`, `TrainingReminder`, `Digest`, …
- `NotificationTopic` — **11 persisted buckets** (`:44-56`): Approval, General, Inventory, Job, Maintenance, Purchasing, Quality, Quote, Sales, Suggestion, Training. Mapping via `getNotificationTopic(event)` (`:92-138`).
- `NotificationDestination` — `InApp | Email | Slack` (`:86-90`). No push channel.

### Producers (all funnel into `carbon/notify`)

- **Central assignment hub**: `apps/erp/app/routes/api+/assign.ts` — 17 assignment events chosen by table.
- **Approvals**: purchase-order, supplier, quality-document routes → approver lists from approval rules + `requestedBy`.
- **Groups from company settings**: `supplierQuoteNotificationGroup`, digital-quote group, `rfqReadyNotificationGroup`, `suggestionNotificationGroup`, `gaugeCalibrationExpiredNotificationGroup`, work-center `notificationGroup`.
- **Crons** (`packages/jobs/src/inngest/functions/scheduled/`): `dispatch.ts` (MaintenanceDispatchCreated), `cleanup.ts` (QuoteExpired, GaugeCalibrationExpired), `weekly.ts` (TrainingReminder), `notification-digest.ts` / `notification-purge.ts` (in-app maintenance only).
- **Edge function** `packages/database/supabase/functions/trigger/index.ts` — pass-through producer.

### Out of scope (must NOT be preference-gated)

- **Transactional documents to external parties** via direct `carbon/send-email`: sales orders, quotes, RFQs, POs to suppliers, supplier-quote requests, sales invoices, onboarding enrollment.
- **Auth/account email** via `packages/lib/src/resend.server.ts`: email verification/magic links, user invites, admin flows.
- **Company-channel Slack document sync** (`integrations/slack-document-sync.ts`) and internal Carbon-team Slack (feedback, onboarding leads) — company/integration-level, not per-user DMs.
- **EE issue pipeline** (Linear/Jira/Slack threads for non-conformances) — external tracker sync, separate system.

### Existing UI hook that's already dangling

- `apps/erp/app/utils/path.ts:1431` defines `notificationSettings: ${x}/account/notifications`.
- The notification bell dropdown **already links to it** (`apps/erp/app/components/Layout/Topbar/Notifications.tsx:603`).
- **The route file does not exist.** The feature has a reserved parking spot.

---

## 2. Existing per-user settings conventions to imitate

- **`userModulePreference`** (`20260512174538_menu-customization.sql`) — the canonical per-(user, company) preference table: surrogate xid PK, UNIQUE `(userId, companyId, module)`, FKs `ON DELETE CASCADE`, **self-scoped RLS** (all four policies `"userId" = auth.uid()::text`, no permission check), upsert with `onConflict`. Service: `users.server.ts:709,722`.
- **`user.flags` JSONB** — user-global (no companyId) extensible boolean bag; wrong shape for this (notifications are company-scoped).
- **Company settings** use dedicated typed columns on `companySettings` — the convention for fixed toggles, but 30 events × 2 channels ≈ 60 columns makes columns-per-toggle wrong here.
- **Account UI**: `apps/erp/app/routes/x+/account+/` (`_layout.tsx`, `profile.tsx`, `theme.tsx`); nav from `useAccountSubmodules.tsx` (currently only "Profile"). Form pattern: `ValidatedForm` + zod validator in `account.models.ts` + service in `account.service.ts`. Toggle component: `Boolean` from `@carbon/form` (wraps `@carbon/react` `Switch`, `bordered` variant is the standard settings-row look); `zfd.checkbox()` in validators.

---

## 3. Recommended design

### Granularity: **topic × channel**, sparse overrides, default = on

- Per-**event** (30 rows of toggles) is too noisy for users; per-channel-only is too blunt. The 11 persisted `NotificationTopic` buckets are the natural middle and already stored on every notification row.
- **Sparse table**: absence of a row = enabled (default-on). Rows only record opt-outs (or future explicit opt-ins). This means zero backfill and no migration churn when topics/events are added.
- **In-app stays always-on** (matches the existing design comment; the bell is core UX and digest/purge already manage volume). Only `email` and `slack` are user-controllable.
- Optional master switch per channel: represent as a row with `topic = '*'` (or a nullable topic column) meaning "mute this channel entirely" — checked before topic rows.

### Schema (modeled on `userModulePreference`)

```sql
CREATE TABLE "notificationPreference" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "channel" TEXT NOT NULL CHECK ("channel" IN ('email', 'slack')),
  "topic" TEXT NOT NULL DEFAULT '*',        -- '*' = whole channel; else a NotificationTopic value
  "enabled" BOOLEAN NOT NULL DEFAULT false, -- rows exist to opt OUT
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  PRIMARY KEY ("id"),
  UNIQUE ("userId", "companyId", "channel", "topic")
);
-- RLS: SELECT/INSERT/UPDATE/DELETE all: "userId" = auth.uid()::text
-- Index: ("userId", "companyId")
```

Company-scoped (not global) because Slack integration, plan gating, and the notification rows themselves are all per-company — and it follows `userModulePreference` exactly.

### Enforcement: one step in `notify.ts` (nothing else changes)

After recipient resolution (`:254-273`) and before the email/Slack fan-outs, add a step:

1. One query: `notificationPreference` rows for the resolved `userIds` + `companyId` (they're few — typically 1-20 users).
2. Compute the notification's topic (already done for the in-app insert).
3. Build per-channel recipient lists: a user is dropped from `email` if they have `(channel='email', topic='*')` or `(channel='email', topic=<topic>)` with `enabled=false`; same for `slack`.
4. Email fan-out (`:474+`) and Slack fan-out (`:571+`) iterate the filtered lists. In-app fan-out untouched.

Because enforcement happens at recipient-list construction inside `notify.ts`, the terminal `carbon/send-email` / `carbon/send-slack` functions need **no changes** — and transactional documents that use `carbon/send-email` directly are automatically unaffected. Every producer (routes, crons, edge function) is covered because they all go through `carbon/notify`.

### UI

- New route `apps/erp/app/routes/x+/account+/notifications.tsx` — the path helper and topbar link already exist.
- Add "Notifications" to `useAccountSubmodules.tsx`.
- Layout: a matrix — rows = the 11 topics (labels via `getNotificationTopicPhrase` or a new label helper), columns = Email / Slack switches, plus a master toggle per channel at the top. Use `Switch` from `@carbon/react` posting per-toggle (the `theme.tsx` / settings `intent` pattern) or one `ValidatedForm` submit.
- Loader: `requirePermissions(request, {})` + fetch the user's preference rows. Action: validate (zod in `account.models.ts`) → upsert with `onConflict: "userId,companyId,channel,topic"` in `account.service.ts`.
- Only render the Slack column when the company's Slack integration is active (read `companyIntegration`); optionally note when email notifications aren't in the company's plan.

### Files to touch

1. `packages/database/supabase/migrations/<ts>_notification-preferences.sql` — table + RLS + index; then `pnpm run generate:types`.
2. `packages/notifications/src/index.ts` — export the user-facing topic list/labels (and `'*'` sentinel constant) so jobs + UI share one source.
3. `packages/jobs/src/inngest/functions/notifications/notify.ts` — the filter step.
4. `apps/erp/app/modules/account/account.models.ts` — `notificationPreferencesValidator`.
5. `apps/erp/app/modules/account/account.service.ts` — `getNotificationPreferences` / `upsertNotificationPreference`.
6. `apps/erp/app/routes/x+/account+/notifications.tsx` — new route (loader/action/UI).
7. `apps/erp/app/hooks/useAccountSubmodules.tsx` (or `_layout`) — nav entry.

### Open questions (decide before spec)

1. **Should some events be exempt from opt-out?** e.g. `ApprovalRequested` — an approver muting Purchasing email could stall a PO if they don't check the bell. Options: (a) allow all opt-outs (in-app still always lands), (b) mark approval events non-mutable. Lean (a) for v1 — in-app is guaranteed — but flag it.
2. **Topic vs event granularity** — recommendation is topic; an "advanced" per-event expansion can layer on later (add an `event` column then).
3. **Master-toggle semantics** — does channel-`'*'` mute override per-topic enables, or are they independent layers? Simplest: `'*'` row wins; per-topic rows only consulted when no channel-wide mute.
4. **MES** — MES has no account settings surface; v1 manages preferences in ERP only (they still apply to notifications triggered from MES, since enforcement is in the shared job).
5. **Email footer "manage notifications" link** — nice-to-have: link `NotificationEmail.tsx` footer to `/x/account/notifications`.

---

## 4. Source reports

Produced by three parallel Explore agents (2026-07-14): notification architecture map, per-user settings conventions, dispatch-surface inventory. Key line references verified against `origin/main` @ `81494bea8`.
