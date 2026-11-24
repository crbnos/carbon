---
paths: []
triggers: []
promoted: null
---
# A push service's 401 or 403 does not mean the subscription is dead

**Context:** After the VAPID key changed, WNS answered 401 for a subscription made with the old key, and FCM answers 403 for the same case. Deleting the row on 401/403 was proposed so such rows stop failing (2026-10-09).

**Problem:** Apple's push service answers 403 when it refuses our own token (`BadJwtToken`, for example a contact address it does not accept). That refusal hits every Safari subscription at once. A delete on 403 would remove every Safari row on each push, the page load would save them again, and no Safari user would ever get a push, with no error anywhere.

**Rule:** Delete a subscription only on 404 or 410. On 401 or 403, log a warning with the push service's body and keep the row (`pushDeliveryOutcome` → `rejected`). An old-key row is replaced on the browser's next page load or ages out.

**Applies to:** `packages/jobs/src/inngest/functions/notifications/push-outcome.ts`, `send-push.ts`; any Web Push sender.
