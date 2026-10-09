# Push notifications in the browser (Web Push) — implementation plan

**Spec:** .ai/specs/2026-10-08-web-push-notifications.md
**Research:** none. The `/feature` run skipped research (`.ai/runs/2026-10-08-web-push-notifications.md`).
**Branch:** naveenkash/carbon-browser-notifications

## Progress
- [x] Task 1: Add the `pushSubscription` table and widen the preference channel
- [x] Task 2: Add the push channel to `@carbon/notifications`
- [x] Task 3: Add the VAPID env vars to `@carbon/env`
- [x] Task 4: Add the `carbon/send-push` event to `@carbon/lib`
- [x] Task 5: Add the `send-push` job
- [x] Task 6: Fan out push from `notify`
- [x] Task 7: Add the ERP models and service functions
- [x] Task 8: Add the `/api/push-subscription` route
- [x] Task 9: Add the service worker `push-worker.js`
- [x] Task 10: Add the `usePushSubscription` hook
- [x] Task 11: Add the device card and the Browser column to Account → Notifications
- [x] Task 12: Unsubscribe on Sign Out
- [x] Task 13: Extract and translate the new strings
- [x] Task 14: Update the docs, the rules and the AGENTS.md files
- [x] Task 15: Run the final gates

## Dependencies

- Task 1 comes first. Every later task that reads `pushSubscription` needs its generated types.
- Tasks 2, 3 and 4 are independent of each other. Each one needs only Task 1.
- Task 5 needs Tasks 3 and 4.
- Task 6 needs Tasks 2, 3, 4 and 5.
- Task 7 needs Tasks 1 and 2.
- Task 8 needs Tasks 3, 4 and 7.
- Task 9 is independent of all other tasks.
- Task 10 needs Task 8. It also needs the worker file path from Task 9.
- Task 11 needs Tasks 7, 8 and 10.
- Task 12 needs Task 10.
- Task 13 needs Tasks 11 and 12.
- Task 14 needs Tasks 1 to 12.
- Task 15 needs every other task.

## Rules for every task

- Start every new source file with its SPDX header. Run `pnpm --filter @carbon/checks license-headers` after you create it. All new files in this plan are AGPL: none is under `packages/ee/` and none has `.ee.` in its name.
- Do not use JavaScript `Date` for arithmetic or formatting. For a timestamp to store, use `datetime.timestamp()` from `@carbon/utils`, as `notify.ts` does.
- Do not use `Math.round`, `Math.ceil`, `Math.floor` or `.toFixed`.
- Do not commit. The user asks for each commit (`.ai/runs/2026-10-08-web-push-notifications.md`, item 9).

---

## Task 1: Add the `pushSubscription` table and widen the preference channel

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_push-subscription.sql` (from `pnpm db:migrate:new`)
- Modify: `packages/database/src/authz/manifest.ts` — add the `pushSubscription` rule
- Create: `packages/database/supabase/migrations/<timestamp>_authz-push-subscription.sql` (from `authz migration`)
- Copy from (precedent): `packages/database/supabase/migrations/20260714095112_notification-preferences.sql` and the `notificationPreference` rule in `manifest.ts` (line 1026)

**Steps:**
1. Run `pnpm db:migrate:new push-subscription`.
2. Write this SQL into the new file. It has no `CREATE POLICY`, because the manifest owns the policies.

```sql
-- One browser push subscription per (user, company, endpoint). A user-owned
-- device row, shaped like "notificationPreference": xid() id, no audit columns.
CREATE TABLE IF NOT EXISTS "pushSubscription" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "userId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "userAgent" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "pushSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pushSubscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pushSubscription_endpoint_companyId_key" UNIQUE ("endpoint", "companyId")
);

ALTER TABLE "pushSubscription" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "pushSubscription_userId_companyId_idx"
  ON "pushSubscription" ("userId", "companyId");

CREATE INDEX IF NOT EXISTS "pushSubscription_companyId_idx"
  ON "pushSubscription" ("companyId");

ALTER TABLE "notificationPreference"
  DROP CONSTRAINT IF EXISTS "notificationPreference_channel_check";

ALTER TABLE "notificationPreference"
  ADD CONSTRAINT "notificationPreference_channel_check"
  CHECK ("channel" IN ('email', 'slack', 'push'));
```

3. In `manifest.ts`, add this rule in alphabetical order (after the `purchase*` keys, before `quote*`):

```ts
  pushSubscription: policies({
    select: and(owner("userId"), member("companyId")),
    insert: and(owner("userId"), member("companyId")),
    update: {
      using: owner("userId"),
      check: and(owner("userId"), member("companyId"))
    },
    delete: and(owner("userId"), member("companyId"))
  }),
```

4. Run `pnpm db:migrate`. It applies the migration and runs `authz sync`.
5. Run `pnpm --filter @carbon/database authz migration push-subscription`.
6. Run `pnpm run generate:types`.
7. Run `pnpm --filter @carbon/database test -- migration.test`.
8. Run `pnpm db:check:backups`.

If `pnpm db:migrate` reports that the local database is unreachable, STOP and report. Do not rebuild the database.

**Verify:**
```bash
grep -c '"pushSubscription"' packages/database/src/types.ts
# Expected: a number greater than 0
pnpm --filter @carbon/database test -- migration.test
# Expected: all tests pass
pnpm db:check:backups
# Expected: the check passes, or reports only that the new table is new
```

**Out of scope:** the company backup engine, the demo datasets, `serviceWorker.js`.

---

## Task 2: Add the push channel to `@carbon/notifications`

**Depends on:** none
**Files:**
- Modify: `packages/notifications/src/index.ts`
- Create: `packages/notifications/src/push.test.ts`

**Steps:**
1. Add `Push = "push"` to `enum NotificationDestination`. Update the enum comment: push, email and slack are opt-in extras.
2. Change `NotificationPreferenceChannel` to `"email" | "slack" | "push"`.
3. In `getNotificationTopicChannels`, make the `default` arm return `["email", "slack", "push"]`. Leave `Changelog` as `["email"]`.
4. Add this exported function below `getNotificationTopicChannels`:

```ts
// Push follows the external channels: an event that emails or posts to Slack
// also pushes. In-app-only events (IntegrationSync re-fires every sweep) stay
// quiet on the device.
export function wantsPushDelivery(
  destinations: readonly NotificationDestination[]
): boolean {
  return destinations.some(
    (destination) =>
      destination === NotificationDestination.Push ||
      destination === NotificationDestination.Email ||
      destination === NotificationDestination.Slack
  );
}
```

5. Move the `NotificationDestination` enum above `wantsPushDelivery` if the compiler reports a use before definition.
6. In `push.test.ts`, test 4 cases of `wantsPushDelivery`: `[InApp]` → false; `[InApp, Email]` → true; `[Slack]` → true; `[Push]` → true.
7. Add 1 test: `getNotificationTopicChannels(NotificationTopic.Job)` contains `"push"`, and `getNotificationTopicChannels(NotificationTopic.Changelog)` does not.

**Verify:**
```bash
pnpm --filter @carbon/notifications test
# Expected: all tests pass, including push.test.ts
pnpm exec turbo run typecheck --filter=@carbon/notifications
# Expected: no errors
```

**Out of scope:** `defaultDestinations` in `notify.ts` (Task 6 does not change it).

---

## Task 3: Add the VAPID env vars to `@carbon/env`

> **Superseded 2026-10-09:** the env vars were removed. `getVapidDetails()` in `packages/env/src/push.server.ts` (`@carbon/env/push.server`) derives the pair from `SESSION_SECRET`. See the spec's changelog.

**Depends on:** none
**Files:**
- Modify: `packages/env/src/schema.ts` — new group `push`, 3 vars
- Modify: `packages/env/src/index.ts` — export the 3 values and `isPushConfigured()`
- Modify: `.env.example` — a commented push block
- Copy from (precedent): the `slack` group in `schema.ts` (lines 308–338)

**Steps:**
1. Add `"push"` to the `Group` union in `schema.ts`.
2. Add `push: "Push notifications"` to `FEATURES`.
3. Add this block after the `slack` block in `schema`:

```ts
  // ── push ──────────────────────────────────────────────────────────────────
  VAPID_PUBLIC_KEY: {
    group: "push",
    description:
      "Web Push public key (pnpm dlx web-push generate-vapid-keys). Generate once: a new pair makes every user turn push on again",
    needed: true
  },
  VAPID_PRIVATE_KEY: {
    group: "push",
    description: "Web Push private key, paired with VAPID_PUBLIC_KEY",
    secret: true,
    needed: true
  },
  VAPID_SUBJECT: {
    group: "push",
    description: "Contact for push services: a mailto: or https: URL",
    needed: true
  },
```

4. In `index.ts`, near `ERP_URL`, add:

```ts
// Web Push. All three or none: the notify job and the account page treat a
// half-set pair as "push off" (validateEnv warns about it).
export const VAPID_PUBLIC_KEY = getEnv("VAPID_PUBLIC_KEY");
export const VAPID_PRIVATE_KEY = getEnv("VAPID_PRIVATE_KEY");
export const VAPID_SUBJECT = getEnv("VAPID_SUBJECT");

export function isPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
}
```

5. Do not add the vars to `getBrowserEnv()`. The settings loader sends the public key (spec, Design Decisions).
6. In `.env.example`, after the SMTP block, add:

```
# Web Push (browser notifications; leave unset to disable push)
# Generate once with: pnpm dlx web-push generate-vapid-keys
# VAPID_PUBLIC_KEY=""
# VAPID_PRIVATE_KEY=""
# VAPID_SUBJECT="mailto:ops@example.com"
```

**Verify:**
```bash
pnpm --filter @carbon/env test
# Expected: all tests pass (deployments.test.ts included)
pnpm exec turbo run typecheck --filter=@carbon/env
# Expected: no errors
```

**Out of scope:** `sst.config.ts`, `ci/src/deploy.ts`, `vercel-production.json`. Production keys are an ops step for the user (report it in the hand-off).

---

## Task 4: Add the `carbon/send-push` event to `@carbon/lib`

**Depends on:** none
**Files:**
- Modify: `packages/lib/src/events.ts` — new event type
- Modify: `packages/lib/src/trigger.ts` — new map entry
- Copy from (precedent): `"carbon/send-slack"` in `events.ts` (line 46)

**Steps:**
1. In `events.ts`, after `"carbon/send-slack"`, add:

```ts
  // Web Push events: one per pushSubscription row
  "carbon/send-push": {
    data: {
      subscriptionId: string;
      companyId: string;
      title: string;
      body: string;
      url: string;
      tag: string;
    };
  };
```

2. In `trigger.ts`, add `"send-push": "carbon/send-push",` after `"send-slack"`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/lib
# Expected: no errors
```

**Out of scope:** none.

---

## Task 5: Add the `send-push` job

**Depends on:** Tasks 3, 4
**Files:**
- Modify: `packages/jobs/package.json` — add `web-push`, dev `@types/web-push`
- Create: `packages/jobs/src/inngest/functions/notifications/push-outcome.ts`
- Create: `packages/jobs/src/inngest/functions/notifications/push-outcome.test.ts`
- Create: `packages/jobs/src/inngest/functions/notifications/send-push.ts`
- Modify: `packages/jobs/src/inngest/functions/notifications/index.ts`
- Modify: `packages/jobs/src/inngest/index.ts` — register the function
- Copy from (precedent): `send-slack.ts` and `delivery-failure.ts` / `delivery-failure.test.ts` in the same folder

**Steps:**
1. Run `pnpm --filter @carbon/jobs add web-push`.
2. Run `pnpm --filter @carbon/jobs add -D @types/web-push`.
3. Create `push-outcome.ts`:

```ts
export type PushOutcome = "delivered" | "gone" | "retry" | "fail";

// What a push service's HTTP status means for the subscription row.
// 404 / 410: the subscription is gone for good, so the caller deletes it.
// 429 / 5xx: transient, so the caller throws and Inngest retries.
// Any other non-2xx: a bad request that a retry would repeat.
export function pushDeliveryOutcome(statusCode: number): PushOutcome {
  if (statusCode >= 200 && statusCode < 300) return "delivered";
  if (statusCode === 404 || statusCode === 410) return "gone";
  if (statusCode === 429 || statusCode >= 500) return "retry";
  return "fail";
}
```

4. In `push-outcome.test.ts`, test 6 statuses: 201 → delivered, 404 → gone, 410 → gone, 413 → fail, 429 → retry, 503 → retry.
5. Create `send-push.ts`. Copy the shape of `send-slack.ts`. The function:
   1. `inngest.createFunction({ id: "send-push", retries: 3 }, { event: "carbon/send-push" }, …)`.
   2. If `isPushConfigured()` is false, return `{ skipped: "push not configured" }`.
   3. In `step.run("load-subscription")`, read `id, endpoint, p256dh, auth` from `pushSubscription` by `id` and `companyId` with `getCarbonServiceRole()`. If the read returns an error, throw it.
   4. If no row exists, return `{ skipped: "subscription not found" }`.
   5. In `step.run("send-push")`, call `webpush.sendNotification(...)`:

```ts
await webpush.sendNotification(
  { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
  JSON.stringify({ title, body, url, tag }),
  {
    TTL: 86400,
    urgency: "normal",
    vapidDetails: {
      subject: VAPID_SUBJECT!,
      publicKey: VAPID_PUBLIC_KEY!,
      privateKey: VAPID_PRIVATE_KEY!
    }
  }
);
```

   6. Catch the error. Read `statusCode` from it: `web-push` throws a `WebPushError` with `statusCode`. If the error has no `statusCode`, throw it again (a network error, so Inngest retries).
   7. Map the status with `pushDeliveryOutcome`.
   8. If the outcome is `gone`, return `{ status: statusCode, gone: true }` from the step.
   9. If the outcome is `retry`, throw an `Error` that names the status.
   10. If the outcome is `fail`, throw `new NonRetriableError(...)` with the status and the response body.
   11. On success, return `{ status: result.statusCode }`.
   12. If the send step returned `gone: true`, run `step.run("delete-subscription")`. It deletes the row by `id` and `companyId` with the service role. If the delete returns an error, throw it.
6. Import the VAPID values and `isPushConfigured` from `@carbon/env`.
7. Export `sendPushFunction` from `notifications/index.ts`.
8. Import `sendPushFunction` in `packages/jobs/src/inngest/index.ts`. Add it to the functions list next to `sendSlackFunction` (lines 62–64 and 117–119).

If `web-push` throws an error type that has no `statusCode` property, STOP and report. Do not guess the field name.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- push-outcome
# Expected: 6 tests pass
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: no errors
```

**Out of scope:** `send-email.ts`, `send-slack.ts`, delivery tracking (`increment_notification_delivery`).

---

## Task 6: Fan out push from `notify`

**Depends on:** Tasks 2, 3, 4, 5
**Files:**
- Modify: `packages/jobs/src/inngest/functions/notifications/notify.ts`

**Steps:**
1. Import `isPushConfigured` from `@carbon/env` and `wantsPushDelivery` from `@carbon/notifications`.
2. After `const wantsSlack = …`, add:

```ts
    // Push is free on every plan and follows the external channels; a
    // deployment without VAPID keys has no push channel at all.
    const wantsPush = isPushConfigured() && wantsPushDelivery(destinations);
```

3. Change the condition of the step `filter-recipients-by-preference` to `wantsEmail || wantsSlack || wantsPush`.
4. In that step, change `mutedFor`'s parameter type to `NotificationPreferenceChannel` (import it from `@carbon/notifications`).
5. In that step, compute `const pushMuted = mutedFor("push");`.
6. In that step, also return `pushRecipientIds: userIds.filter((id) => !pushMuted.has(id))`.
7. In the fallback object, add `pushRecipientIds: userIds`. Destructure `pushRecipientIds` with the other 2.
8. 🛑 Do not change the step id `filter-recipients-by-preference`. In-flight runs resume by step id; the new key is only an extra field.
9. After the Slack fan-out block, add the push fan-out:

```ts
    // ---- Push fan-out ----
    // One carbon/send-push per device row, so each device retries on its own.
    if (wantsPush && pushRecipientIds.length > 0) {
      const pushEvents = await step.run(
        "resolve-push-subscriptions",
        async () => {
          const { data: subscriptions, error } = await client
            .from("pushSubscription")
            .select("id")
            .eq("companyId", payload.companyId)
            .in("userId", pushRecipientIds);
          if (error) {
            console.error("Failed to load push subscriptions", error);
            throw error;
          }
          const url = buildNotificationLink(
            payload.event,
            primaryDocumentId,
            payload.companyId,
            payload.documentType
          );
          const title = getNotificationEmailHeading(payload.event);
          return (subscriptions ?? []).map((subscription) => ({
            data: {
              body: description,
              companyId: payload.companyId,
              subscriptionId: subscription.id,
              tag: `${payload.event}:${primaryDocumentId}`,
              title,
              url
            },
            name: "carbon/send-push" as const
          }));
        }
      );
      if (pushEvents.length > 0) {
        await step.sendEvent("fan-out-push", pushEvents);
      }
    }
```

10. Update the comment above `defaultDestinations`: push also goes to every event that has Email or Slack.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: no errors
pnpm --filter @carbon/jobs test
# Expected: all tests pass
grep -n '"resolve-push-subscriptions"\|"fan-out-push"\|"filter-recipients-by-preference"' packages/jobs/src/inngest/functions/notifications/notify.ts
# Expected: 3 lines
```

**Out of scope:** `notification-digest.ts` (the digest cron sends no push), `defaultDestinations` entries.

---

## Task 7: Add the ERP models and service functions

**Depends on:** Tasks 1, 2
**Files:**
- Modify: `apps/erp/app/modules/account/account.models.ts`
- Modify: `apps/erp/app/modules/account/account.service.ts`
- Copy from (precedent): `notificationPreferenceValidator` and `upsertNotificationPreference` in the same files

**Steps:**
1. In `account.models.ts`, change `notificationPreferenceValidator.channel` to `z.enum(["email", "slack", "push"])`.
2. In `account.models.ts`, add:

```ts
// The browser's PushSubscription.toJSON(), plus the endpoint it replaces when
// the service worker re-subscribes after a pushsubscriptionchange.
export const pushSubscriptionValidator = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1)
  }),
  oldEndpoint: z.string().url().optional()
});

export const pushSubscriptionEndpointValidator = z.object({
  endpoint: z.string().url()
});
```

3. In `account.service.ts`, change the `channel` type of `upsertNotificationPreference` to `NotificationPreferenceChannel` (from `@carbon/notifications`).
4. In `account.service.ts`, add 3 functions with a one-line doc comment and NO `@mcp` tag:

```ts
/** Reads this device's push subscription for the user and company. */
export async function getPushSubscription(
  client: SupabaseClient<Database>,
  args: { userId: string; companyId: string; endpoint: string }
) {
  return client
    .from("pushSubscription")
    .select("id")
    .eq("userId", args.userId)
    .eq("companyId", args.companyId)
    .eq("endpoint", args.endpoint)
    .maybeSingle();
}

/** Saves this device's push subscription for the user and company. */
export async function upsertPushSubscription(
  client: SupabaseClient<Database>,
  subscription: {
    userId: string;
    companyId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent: string | null;
  }
) {
  return client
    .from("pushSubscription")
    .upsert(
      { ...subscription, updatedAt: datetime.timestamp() },
      { onConflict: "endpoint,companyId" }
    )
    .select("id")
    .single();
}

/** Removes this device's push subscription for the user and company. */
export async function deletePushSubscription(
  client: SupabaseClient<Database>,
  args: { userId: string; companyId: string; endpoint: string }
) {
  return client
    .from("pushSubscription")
    .delete()
    .eq("userId", args.userId)
    .eq("companyId", args.companyId)
    .eq("endpoint", args.endpoint);
}
```

5. Import `datetime` from `@carbon/utils` if the file does not already import it.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
pnpm run generate:mcp && git status --short apps/erp | grep -i mcp
# Expected: no MCP file changes caused by the 3 new functions
```

If `generate:mcp` changes an MCP file because of the new functions, STOP and report.

**Out of scope:** `getNotificationPreferences`, other account services.

---

## Task 8: Add the `/api/push-subscription` route

**Depends on:** Tasks 3, 4, 7
**Files:**
- Create: `apps/erp/app/routes/api+/push-subscription.ts`
- Modify: `apps/erp/app/utils/path.ts` — add `pushSubscription: \`${api}/push-subscription\`` next to `messagingNotify` (line 217)
- Copy from (precedent): `apps/erp/app/routes/api+/messaging.notify.ts`

**Steps:**
1. Export only an `action`. The route has no loader and no default export.
2. Call `requirePermissions(request, {})`. Read `client`, `userId` and `companyId`.
3. If `isPushConfigured()` is false, return `data({ error: "Push is not configured" }, { status: 404 })`.
4. If `request.method === "PUT"`:
   1. Parse `await request.json()` with `pushSubscriptionValidator.safeParse`. If it fails, return status 400.
   2. If `oldEndpoint` is set, call `deletePushSubscription(client, { userId, companyId, endpoint: oldEndpoint })`.
   3. With `getCarbonServiceRole()`, delete the `pushSubscription` rows where `endpoint` equals the new endpoint and `userId` is not this user. This step stops a shared browser from getting the previous user's notifications.
   4. Call `upsertPushSubscription(client, { userId, companyId, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: request.headers.get("user-agent") })`.
   5. If any call returns an error, return status 500 with `{ error: message }`.
   6. Return `{ id }`.
5. If `request.method === "DELETE"`:
   1. Parse the body with `pushSubscriptionEndpointValidator`. If it fails, return status 400.
   2. Call `deletePushSubscription`. If it returns an error, return status 500.
   3. Return `{ ok: true }`.
6. If `request.method === "POST"`:
   1. Parse the body with `pushSubscriptionEndpointValidator.extend({ intent: z.literal("test") })`. If it fails, return status 400.
   2. Call `getPushSubscription`. If no row exists, return status 404.
   3. Set `title` to "Carbon" and `body` to "Push notifications work on this device."
   4. Set `url` to `` `${getAppUrl()}${path.to.notificationSettings}` ``. Import `getAppUrl` from `@carbon/env`.
   5. Call `trigger("send-push", { subscriptionId: row.id, companyId, title, body, url, tag: "carbon-test" })`.
   6. Return `{ ok: true }`.
7. For any other method, return status 405.
8. Import `trigger` from `@carbon/jobs`, as `messaging.notify.ts` does.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

**Out of scope:** CSRF changes. The `securityMiddleware` already checks the origin of a same-origin `fetch`.

---

## Task 9: Add the service worker `push-worker.js`

**Depends on:** none
**Files:**
- Create: `apps/erp/public/push-worker.js`
- Copy from (precedent): the SPDX header of `apps/erp/public/serviceWorker.js` (deleted 2026-10-09; use `pnpm --filter @carbon/checks license-headers`)

**Steps:**
1. Write the file with 3 listeners and no `fetch` listener:

```js
// Web Push for Carbon: shows the notification, opens its link on click, and
// re-registers a subscription the browser rotated. No fetch handler — this
// worker caches nothing.

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "Carbon";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      tag: payload.tag,
      icon: "/carbon-mark-dark.png",
      data: { url: payload.url || "/" }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true
      });
      const target = new URL(url, self.location.origin);
      for (const client of windows) {
        if (new URL(client.url).origin === target.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target.href);
          return;
        }
      }
      await self.clients.openWindow(target.href);
    })()
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      const key = old && old.options && old.options.applicationServerKey;
      if (!key) return;
      const next =
        event.newSubscription ||
        (await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key
        }));
      await fetch("/api/push-subscription", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...next.toJSON(), oldEndpoint: old.endpoint })
      });
    })()
  );
});
```

2. Run `pnpm --filter @carbon/checks license-headers`.

**Verify:**
```bash
node --check apps/erp/public/push-worker.js && echo OK
# Expected: OK
pnpm exec biome check apps/erp/public/push-worker.js
# Expected: no errors
```

**Out of scope:** `apps/erp/public/serviceWorker.js` (left unregistered here; deleted 2026-10-09), MES.

---

## Task 10: Add the `usePushSubscription` hook

**Depends on:** Tasks 8, 9
**Files:**
- Create: `apps/erp/app/utils/push.ts` — `urlBase64ToUint8Array`
- Create: `apps/erp/app/utils/push.test.ts`
- Create: `apps/erp/app/hooks/usePushSubscription.ts`
- Copy from (precedent): `apps/erp/app/hooks/useNotifications.tsx` (hook shape, `getLogger`)

**Steps:**
1. In `push.ts`, export `urlBase64ToUint8Array(base64Url: string): Uint8Array`:
   1. Pad the string with `=` to a length that is a multiple of 4.
   2. Replace `-` with `+` and `_` with `/`.
   3. Decode with `atob`, then copy each char code into a `Uint8Array`.
2. In `push.test.ts`, test 2 cases: `"AQID"` → `[1, 2, 3]`, and `"-_8"` → `[251, 255]`.
3. In `usePushSubscription.ts`, export `type PushState = "loading" | "unsupported" | "denied" | "off" | "on"`.
4. Export `usePushSubscription({ publicKey }: { publicKey: string | null })`. It returns `{ state, busy, turnOn, turnOff, sendTest }`.
5. On mount (`useEffect`), compute the state:
   1. If `publicKey` is null, set `unsupported`.
   2. If `"serviceWorker" in navigator`, `"PushManager" in window` or `"Notification" in window` is false, set `unsupported`.
   3. If `Notification.permission === "denied"`, set `denied`.
   4. Call `navigator.serviceWorker.getRegistration("/")`. Read `registration?.pushManager.getSubscription()`.
   5. If no subscription exists, set `off`.
   6. If a subscription exists, `PUT` it to `path.to.api.pushSubscription`. This step re-syncs the row for the current company. If the response is OK, set `on`. Else set `off`.
6. `turnOn()`:
   1. Call `Notification.requestPermission()`. If the result is `denied`, set `denied` and return. If it is `default`, return.
   2. Call `navigator.serviceWorker.register("/push-worker.js", { scope: "/" })`.
   3. Await `navigator.serviceWorker.ready`.
   4. Call `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })`.
   5. `PUT` `subscription.toJSON()` as JSON.
   6. If the response is OK, set `on`. Else call `subscription.unsubscribe()`, set `off`, and show `toast.error`.
7. `turnOff()`:
   1. Read the current subscription. If none exists, set `off` and return.
   2. Send `DELETE` with `{ endpoint }`.
   3. Call `subscription.unsubscribe()`.
   4. Set `off`.
8. `sendTest()`: send `POST` with `{ endpoint, intent: "test" }`. If the response is OK, show `toast.success`. Else show `toast.error`.
9. Set `busy` to true while `turnOn`, `turnOff` or `sendTest` runs.
10. Wrap each action in `try`/`catch`. Log with `logger.error` and show `toast.error` on failure.
11. Use `toast` from `@carbon/react`. Use `useLingui` for the toast text.
12. Also export `unsubscribeThisDevice(): Promise<void>` (not a hook). It reads the current subscription, sends `DELETE`, and calls `unsubscribe()`. It never throws. Task 12 uses it.

**Verify:**
```bash
pnpm --filter erp test -- push.test
# Expected: 2 tests pass
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

**Out of scope:** `useNotifications.tsx`, the bell.

---

## Task 11: Add the device card and the Browser column to Account → Notifications

**Depends on:** Tasks 7, 8, 10
**Files:**
- Modify: `apps/erp/app/routes/x+/account+/notifications.tsx`
- Copy from (precedent): the same file's `Card` and `Switch` cells; `Button` from `@carbon/react`

**Steps:**
1. In the loader, add `push: isPushConfigured() ? { publicKey: VAPID_PUBLIC_KEY as string } : null` to the returned object.
2. In the component, read `push` from `useLoaderData`.
3. Call `usePushSubscription({ publicKey: push?.publicKey ?? null })`.
4. If `push` is not null, render a second `Card` above the topic card:
   1. `CardTitle`: "This device".
   2. `CardDescription` and actions by state:

| `state` | Text | Buttons |
|---|---|---|
| `loading` | none | none |
| `off` | "Get notifications on this device, even when Carbon is closed." | **Turn on** (`variant="primary"`) |
| `on` | "Push notifications are on for this device." | **Send a test notification** (`variant="secondary"`), **Turn off** (`variant="secondary"`) |
| `denied` | "Notifications are blocked for Carbon in this browser's site settings." | none |
| `unsupported` | "This browser does not support push notifications. On iPhone or iPad, add Carbon to the Home Screen first." | none |

   3. Set `isDisabled={busy}` on each button.
5. Change the `Channel` cells:
   1. If `push` is not null, add a header cell **Browser** after Slack.
   2. If `push` is not null, add `cell("push", t\`browser\`)` after the Slack cell.
6. If `push` is not null, use the new card description: "In-app notifications are always delivered. Choose which topics also reach you by email, Slack or on your devices." When Slack is not active, drop "Slack" from the text. Use one `<Trans>` per variant, like the existing code.
7. Keep the existing `isEnabled`, `isPending` and `toggle` code. It already works for any channel.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
pnpm exec biome check apps/erp/app/routes/x+/account+/notifications.tsx apps/erp/app/hooks/usePushSubscription.ts apps/erp/app/utils/push.ts
# Expected: no errors
```

**Out of scope:** the email plan note, the Slack loader query.

---

## Task 12: Unsubscribe on Sign Out

**Depends on:** Task 10
**Files:**
- Modify: `apps/erp/app/components/AvatarMenu.tsx` — the Sign Out `<Form>` (line 299)

**Steps:**
1. Import `useSubmit` from `react-router` and `unsubscribeThisDevice` from `~/hooks/usePushSubscription`.
2. Add an `onSubmit` handler to the Sign Out `<Form>`:
   1. Call `event.preventDefault()`.
   2. Read the form element from `event.currentTarget`.
   3. `await Promise.race([unsubscribeThisDevice(), wait(1000)])`. `wait` is a local promise that resolves after 1 000 ms with `setTimeout`.
   4. Call `submit(form)`.
3. Keep the `method="post"` and `action={path.to.logout}` attributes, so the form still works if the script fails.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

**Out of scope:** the other `logoutAction` users (`MfaEnrollmentRequired`, `SessionLockOverlay`, `_public+/mfa.tsx`, `_public+/unlock.tsx`, `select-company+/_index.tsx`, `onboarding+/plan.tsx`). A user on those screens has not turned on push in this session. The spec lists the expired-session gap under Risks.

---

## Task 13: Extract and translate the new strings

**Depends on:** Tasks 11, 12
**Files:**
- Modify: `packages/locale/locales/*/*.po`

**Steps:**
1. Run `pnpm run lingui:extract` from the repo root.
2. Run the `/translate` skill to fill the empty `msgstr` entries.

**Verify:**
```bash
git diff --stat packages/locale/locales | tail -1
# Expected: the .po files changed
```

**Out of scope:** strings outside this feature.

---

## Task 14: Update the docs, the rules and the AGENTS.md files

**Depends on:** Tasks 1–12
**Files:**
- Modify: `docs/content/docs/reference/account.mdx` — the "Notification preferences" section and the AgentContext notes
- Modify: `docs/content/docs/reference/notifications.mdx` — the channels list
- Modify: `docs/content/docs/platform/self-hosting/environment-variables.mdx` — the 3 VAPID vars
- Modify: `packages/jobs/AGENTS.md` — a `send-push` row next to the other notification functions
- Modify: `packages/notifications/AGENTS.md` — the `Push` destination and `wantsPushDelivery`
- Modify: `.claude/rules/environment-configuration.md` — the `push` group

**Steps:**
1. Use the `carbon-docs` skill for the 3 docs pages. Ground each claim in the code from Tasks 1–12.
2. In `account.mdx`, describe the "This device" card and the Browser column. Note that a user turns on push once per company and per browser.
3. In `notifications.mdx`, add push as a channel. Say that push follows email and Slack, and that push needs the VAPID env vars.
4. In `environment-variables.mdx`, add the 3 `<EnvVar>` entries next to the SMTP or Slack entries. Copy the descriptions from `schema.ts`.
5. In `packages/jobs/AGENTS.md`, add `send-push` with the trigger `carbon/send-push` and the 404/410 delete rule.

**Verify:**
```bash
pnpm --filter docs typecheck
# Expected: no errors
```

**Out of scope:** a changelog entry (the user asks for that separately).

---

## Task 15: Run the final gates

**Depends on:** every other task
**Files:** none

**Steps:**
1. Run each command below. Fix each failure before you continue.
2. Update the spec status to `in-progress` and add a changelog line for each divergence from the spec.
3. Write the manual browser checklist into the run record (the run skipped `/test`):
   1. Restart the ERP and the Inngest dev server. (Originally: set the 3 VAPID vars. Since 2026-10-09 the pair is derived from `SESSION_SECRET`.)
   2. Open Account → Notifications, click **Turn on**, and allow the prompt.
   3. Click **Send a test notification**. Expect an OS notification. Click it and expect Account → Notifications.
   4. Close every Carbon tab. Assign a job to the user from a second account. Expect "Job assigned to you".
   5. Turn off the Jobs **Browser** switch. Assign another job. Expect no push and a new bell row.
   6. Click **Turn off**. Expect 0 `pushSubscription` rows for the user.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/notifications --filter=@carbon/env --filter=@carbon/lib --filter=@carbon/jobs --filter=erp
# Expected: all tasks succeed
pnpm --filter @carbon/notifications test && pnpm --filter @carbon/jobs test && pnpm --filter @carbon/env test
# Expected: all tests pass
pnpm --filter erp test -- push.test
# Expected: 2 tests pass
pnpm --filter @carbon/database test -- migration.test
# Expected: all tests pass
pnpm run lint
# Expected: no errors
pnpm --filter @carbon/checks license-headers && git status --short
# Expected: no new header changes
```

**Out of scope:** commit and push. Ask the user first.
