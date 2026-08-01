# User-Level Notification Preferences

> Status: implemented
> Author: naveen (with Claude)
> Date: 2026-07-14
> Research: `.ai/research/user-notification-preferences.md` (codebase map), `.ai/research/user-notification-preferences-competitors.md` (industry survey)

## TLDR

Let each user control, per notification **topic** (the 11 persisted `NotificationTopic` buckets) and per outbound **channel** (Email, Slack), whether they receive notification copies on that channel. In-app delivery is never muted. Preferences are stored sparsely in a new `notificationPreference` table (a row exists only for an opt-out; absence = enabled), enforced in one place — the `notify` Inngest function's recipient fan-out — and edited on a new ERP page at `/x/account/notifications`, a route whose path helper and topbar link already exist but were never built. Notification emails gain a "Manage notification settings" footer link to that page.

## Problem Statement

Today notification channel delivery is all-or-nothing at the **company** level: email is gated only by the company's `EMAIL_NOTIFICATIONS` plan feature (`notify.ts:460-466`) and Slack DMs only by the company's Slack integration being active (`notify.ts:578-589`). An individual user who is in a busy notification group (e.g. `supplierQuoteNotificationGroup`) or holds many assignments receives every email and Slack DM with no way to quiet either channel. There is no preference table, no opt-out check anywhere in the pipeline, and the notification bell's "Notification settings" link (`Notifications.tsx:603` → `path.to.notificationSettings`) points at a route that does not exist.

## Proposed Solution

A sparse per-user opt-out table + one enforcement step in the single notification chokepoint + one settings page.

Every optional notification already flows through the `notify` Inngest function (`packages/jobs/src/inngest/functions/notifications/notify.ts`), which resolves recipient userIds and fans out to in-app (always), email, and Slack. After recipient resolution, a new step loads the recipients' `notificationPreference` rows for the notification's topic and removes opted-out users from the email and Slack recipient lists. The in-app insert is untouched. Because enforcement happens before the per-recipient `carbon/send-email` / `carbon/send-slack` events are emitted, the terminal send functions need no changes — and transactional email that calls `carbon/send-email` directly (POs to suppliers, invoices, invites, verification) is structurally unaffected.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Granularity | Per **topic** (11 `NotificationTopic` values) × channel | User-resolved. Topics are already persisted on every notification row and computed in `notify.ts`; 30 per-event toggles is a wall of switches. Per-event expansion is additive later (add an `event` column). Matches Linear/ERPNext two-axis convention. |
| Master toggle | **None** in v1 | User-resolved ("no master"). Just the 11 topic rows × 2 channels. No `'*'` sentinel row, no layered override logic. A "turn all off" affordance can be added later as pure UI (bulk upsert) or as an override row — both additive. |
| Exemptions / mandatory topics | **All topics mutable** | User-resolved. In-app always delivers, so nothing is silently lost. Security/account email (invites, verification, magic links) already bypasses the notify pipeline via `resend.server.ts` and cannot be muted — the industry "non-suppressible core" exists structurally. |
| Default state | Opt-out (everything on); rows record opt-outs only | Sparse storage means zero backfill, and notification topics added in future releases default ON for everyone — industry consensus (GitHub/Linear/Slack). |
| In-app channel | Not user-controllable | Existing design comment (`notifications/src/index.ts:84-85`, `notify.ts:191-192`) and industry consensus: the inbox/bell always receives; preferences govern outbound copies. |
| Channels covered | `email`, `slack` only | The only outbound channels that exist (`NotificationDestination`). No push channel in Carbon. |
| Table shape | Surrogate xid `id` PK + `UNIQUE(userId, companyId, channel, topic)` | Follows `userModulePreference` (`20260512174538_menu-customization.sql`) exactly — the canonical per-(user, company) preference table. Composite `("id","companyId")` PK is the convention for *business* entities; user-scoped preference tables follow the `userModulePreference` precedent. |
| Company-scoped (not user-global) | `companyId` column, per-company preferences | Slack integration, plan gating, and notification rows are all per-company; `user.flags` JSONB is user-global and therefore the wrong home. |
| RLS | Self-scoped + company-scoped: all four policies require `"userId" = auth.uid()::text` AND membership in the target company (`userToCompany`) | Users manage only their own rows, and only for companies they belong to; no module permission needed. The notify job reads with service role. |
| Enforcement point | `notify.ts`, immediately after recipient resolution, before email/Slack fan-outs | Single chokepoint covers all ~25 producers (routes, crons, edge function `trigger`). Terminal senders and transactional email untouched. |
| Explicit `payload.destinations` vs prefs | User preferences always win for email/Slack | The point of the feature; a caller opting a notification *into* a channel does not override a user's opt-out. |
| Settings surface | ERP only, `/x/account/notifications` | User-resolved. Preferences still govern MES-triggered notifications since enforcement is in the shared job. MES has no account-settings surface today. |
| Email footer link | Plain "Manage notification settings" link (login required) in `NotificationEmail.tsx` | User-resolved. Recipients are internal users with accounts. One-click signed unsubscribe is a digest/marketing-mail pattern (industry survey takeaway 7) — out of scope. |
| Slack column visibility | Rendered only when the company's Slack integration is active | No point offering Slack toggles when no DM can be sent; read `companyIntegration` in the loader. |
| Not an N×M config matrix (lesson check) | Allowed | `.ai/lessons.md` forbids N×M *classification/indirection* config (posting-groups). This is a direct user-preference matrix — the standard notification-settings UX — not indirection to an outcome entity. |
| Module home | `account` module (`account.models.ts` / `account.service.ts`) | It is a per-user account setting; the route lives under `x+/account+` beside profile/theme. |
| Topic labels | New `getNotificationTopicLabel(topic)` + ordered `USER_FACING_NOTIFICATION_TOPICS` export in `packages/notifications` | Single source shared by UI (settings rows) and any future consumers. `getNotificationTopicPhrase` is count-based digest copy, not a label. |

## Data Model Changes

One migration (forward-dated — newest timestamp in the repo, per `.ai/lessons.md`), then `pnpm run generate:types`.

```sql
CREATE TABLE "notificationPreference" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "userId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  CONSTRAINT "notificationPreference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notificationPreference_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notificationPreference_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notificationPreference_channel_check"
    CHECK ("channel" IN ('email', 'slack')),
  CONSTRAINT "notificationPreference_unique"
    UNIQUE ("userId", "companyId", "channel", "topic")
);

CREATE INDEX "notificationPreference_userId_companyId_idx"
  ON "notificationPreference" ("userId", "companyId");

ALTER TABLE "notificationPreference" ENABLE ROW LEVEL SECURITY;

-- Every policy scopes by owner AND membership in the target company
-- (see the migration for the full USING/WITH CHECK bodies):
--   "userId" = auth.uid()::text
--   AND "companyId" IN (
--     SELECT "companyId" FROM "userToCompany" WHERE "userId" = auth.uid()::text
--   )
CREATE POLICY "SELECT" ON "notificationPreference" FOR SELECT USING (...);
CREATE POLICY "INSERT" ON "notificationPreference" FOR INSERT WITH CHECK (...);
CREATE POLICY "UPDATE" ON "notificationPreference" FOR UPDATE USING (...) WITH CHECK (...);
CREATE POLICY "DELETE" ON "notificationPreference" FOR DELETE USING (...);
```

Notes:
- Semantics: **absence of a row = enabled**. A row with `enabled = false` is an opt-out. (`enabled = true` rows are legal — they result from a user toggling off then back on via upsert — and behave identically to no row.)
- `topic` is intentionally `TEXT` validated in app code against `NotificationTopic` (matches how `notification.topic` is stored); no enum type, so adding topics needs no migration.
- No `createdBy`/`customFields`: pure user-owned preference row, following `userModulePreference` which carries neither.
- xid surrogate PK + UNIQUE follows `userModulePreference`; the composite `("id","companyId")` convention applies to business entities, not user-preference rows (Design Decisions table).

## API / Service Changes

### `packages/notifications/src/index.ts`

- `export const USER_FACING_NOTIFICATION_TOPICS: NotificationTopic[]` — ordered list for the settings page (all 11 topics).
- `export function getNotificationTopicLabel(topic: NotificationTopic): string` — human labels ("Approvals", "Jobs", "Purchasing", …).

### `packages/jobs/src/inngest/functions/notifications/notify.ts`

New step after recipient resolution (`resolve-recipients`, `:254-273`) and before the email (`:457`) and Slack (`:571`) fan-outs:

```text
step "filter-recipients-by-preference":
  prefs = client.from("notificationPreference")
    .select("userId, channel, enabled")
    .in("userId", userIds).eq("companyId", companyId).eq("topic", topic)
  emailRecipients = userIds minus users with (channel='email', enabled=false)
  slackRecipients = userIds minus users with (channel='slack', enabled=false)
```

- The email fan-out iterates `emailRecipients`; the Slack fan-out iterates `slackRecipients`; the in-app insert keeps using the full `userIds`.
- Runs regardless of whether destinations came from `defaultDestinations` or explicit `payload.destinations` (prefs always win).
- If both filtered lists are empty, the email/Slack fan-outs are skipped entirely (existing empty-list behavior).
- One indexed query per notification; recipient lists are small (1–20 users).

### `apps/erp/app/modules/account/account.models.ts`

```ts
export const notificationPreferenceValidator = z.object({
  topic: z.nativeEnum(NotificationTopic),
  channel: z.enum(["email", "slack"]),
  enabled: zfd.checkbox(),
});
```

### `apps/erp/app/modules/account/account.service.ts`

- `getNotificationPreferences(client, userId, companyId)` — `client.from("notificationPreference").select("*").eq("userId", userId).eq("companyId", companyId)`; returns `{ data, error }`.
- `upsertNotificationPreference(client, { userId, companyId, topic, channel, enabled })` — `.upsert(..., { onConflict: "userId,companyId,channel,topic" })` with `updatedAt: now()`; returns `{ data, error }`.
- Both exported through the module barrel `index.ts`.

## UI Changes

### New route: `apps/erp/app/routes/x+/account+/notifications.tsx`

- **loader**: `requirePermissions(request, {})` (account routes need no module scope — RLS self-scopes the data; `profile.tsx` precedent), then in parallel: `getNotificationPreferences(client, userId, companyId)` and the company's Slack integration active flag (`companyIntegration` where `id = 'slack'`). Also read whether the company plan has `EMAIL_NOTIFICATIONS` to show an informational hint when email notifications are unavailable at the company level.
- **action**: `assertIsPost` → `validator(notificationPreferenceValidator).validate(formData)` → `upsertNotificationPreference(...)` → `flash` on error. Each switch flip posts one upsert via `fetcher.submit` (same immediate-toggle pattern as the settings-page boolean toggles, e.g. `x+/settings+/sales.tsx`).
- **UI**: Card titled "Notifications" with a short explanation ("In-app notifications are always delivered. Choose which topics also reach you by email or Slack."). One row per `USER_FACING_NOTIFICATION_TOPICS` entry — label from `getNotificationTopicLabel` — with a `Switch` (`@carbon/react`) per channel. Switch state = no row for (topic, channel) OR `enabled = true`. The Slack column renders only when the Slack integration is active. Optimistic toggle state via the fetcher.

### Navigation

- `apps/erp/app/hooks/useAccountSubmodules.tsx`: add `{ name: "Notifications", to: path.to.notificationSettings }` beside Profile (this also revives the commented-out account sidebar as needed — smallest change that makes both entries reachable).
- The topbar bell's existing "Notification settings" link (`Notifications.tsx:603`) starts working with no change — `path.to.notificationSettings` already resolves to `/x/account/notifications` (`path.ts:1431`).

### Email footer link

- `packages/documents/src/email/NotificationEmail.tsx`: footer line "Manage notification settings" linking to `{baseUrl}/x/account/notifications`. The base URL comes from the same origin used by `buildNotificationLink` for the email CTA (the existing `/api/link` resolver origin), so no new config.

## Acceptance Criteria

- [ ] A user opens `/x/account/notifications` (via the bell dropdown link or Account nav) and sees 11 topic rows; each has an Email switch, and a Slack switch iff the company's Slack integration is active. All switches default ON for a user with no saved preferences.
- [ ] Toggling "Purchasing" email OFF, then having another user assign them a purchase order: a `notification` row is created (bell shows it), **no** email is sent to them, and other recipients of the same notification still receive email.
- [ ] With "Purchasing" Slack OFF and email ON (Slack integration active): the same assignment sends the email but no Slack DM to that user.
- [ ] Toggling a switch OFF and back ON results in delivery again (upsert flips `enabled`, no duplicate-row error).
- [ ] Preferences apply to MES-triggered notifications (e.g. a maintenance dispatch created in MES respects a work-center member's Maintenance email opt-out).
- [ ] Transactional email is unaffected: user invites, email verification, and PO/quote/invoice emails to suppliers/customers send regardless of any preference rows.
- [ ] A notification email's footer contains a "Manage notification settings" link that opens `/x/account/notifications` after login.
- [ ] User A cannot read or modify user B's preference rows via the client (RLS: direct Supabase query as A for B's rows returns empty / is rejected).
- [ ] `pnpm run generate:types` regenerated types; `pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=erp` and `pnpm run lint` pass.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| An approver mutes Approval email and misses a pending PO approval | Low | In-app notification always delivered (bell + unread dot); user-accepted trade-off recorded in Open Questions. Revisit with per-topic "required" flags if it bites. |
| Preference query adds latency/failure surface to every notification | Low | One indexed query on `(userId, companyId)` per notify run; wrapped in its own Inngest step so it retries independently. On persistent query failure the step fails the run (no silent fail-open/fail-closed drift). |
| Slack column hidden while integration inactive → user can't pre-mute Slack | Low | When the integration is later activated, defaults are ON — same as today's behavior; user can then mute. Acceptable. |
| Migration timestamp ordering breaks remote deploy | Med | Generate via `pnpm db:migrate:new` at implementation time so the timestamp is newest on `main` (`.ai/lessons.md`). |
| New topics added to `NotificationTopic` don't appear on the settings page | Low | `USER_FACING_NOTIFICATION_TOPICS` lives in `packages/notifications` next to the enum; adding a topic without updating the list is caught by an exhaustiveness check in `getNotificationTopicLabel`. |

## Open Questions

> All resolved with the user on 2026-07-14 before this spec was written (spec-writing Step 5).

- [x] Master-toggle semantics — should a per-channel master switch override or bulk-edit topic toggles? — **Answer: no master toggle at all in v1.** Per-topic switches only; a bulk affordance can be layered on later. (User answer "no master"; simplifies schema — no `'*'` sentinel.)
- [x] Should any topics be exempt from opt-out (e.g. Approvals)? — **Answer: all topics mutable.** In-app always delivers; security/account email already bypasses the pipeline structurally.
- [x] Granularity: topic (11) vs event (30) vs channel-only? — **Answer: per topic.** Matches persisted `notification.topic` and industry two-axis convention; per-event is additive later.
- [x] Email footer link: plain settings link vs signed one-click mute? — **Answer: plain settings link** to `/x/account/notifications` (login required). One-click unsubscribe is a digest/marketing pattern; out of scope.
- [x] Settings surface: ERP only or also MES? — **Answer: ERP only.** Enforcement in the shared notify job covers MES-triggered notifications.

## Changelog

- 2026-07-14: Created after resolving all 5 open questions with the user (grill interview). Research: codebase map + competitor survey linked in header.
- 2026-07-21: Implemented on branch `naveen/user-notification-settings`; moved to `implemented/`. Follow-up deferred: digest-shaped emails (weekly reminder template) do not yet carry the manage-settings footer link.
