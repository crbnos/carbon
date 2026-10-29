// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ZonedDateTime } from "@internationalized/date";

export type PushOutcome = "gone" | "rejected" | "retry" | "fail";

// What a push service's error status means for the subscription row. web-push
// throws a WebPushError only for a non-2xx response, so a 2xx never gets here.
// 404 / 410: the subscription is gone for good, so the caller deletes it.
// 401 / 403: the push service refused our signature. Usually the subscription
// was made with another VAPID key (WNS answers 401, FCM 403), and the browser
// replaces it on its next page load. But Apple answers 403 when it rejects the
// token itself, which hits every Safari row at once, so the caller only logs:
// deleting would wipe every Safari browser over a problem on our side.
// 429 / 5xx: transient, so the caller throws and Inngest retries.
// Any other non-2xx: a bad request that a retry would repeat.
export function pushDeliveryOutcome(statusCode: number): PushOutcome {
  if (statusCode === 404 || statusCode === 410) return "gone";
  if (statusCode === 401 || statusCode === 403) return "rejected";
  if (statusCode === 429 || statusCode >= 500) return "retry";
  return "fail";
}

// A pushSubscription row is live only while a session could still be signed
// in to its browser. Every page load saves the row again (updatedAt), so a row
// older than the longest session — 12 h in a controlled environment, the 7-day
// session cookie elsewhere — belongs to a browser whose session has ended
// without a sign-out. notify skips it; the next sign-in saves it again.
export function pushSessionMaxAgeMs({
  controlledEnvironment,
  absoluteMaxMs,
  cookieMaxAgeSeconds
}: {
  controlledEnvironment: boolean;
  absoluteMaxMs: number;
  cookieMaxAgeSeconds: number;
}) {
  return controlledEnvironment ? absoluteMaxMs : cookieMaxAgeSeconds * 1000;
}

export function pushSubscriptionCutoff(at: ZonedDateTime, maxAgeMs: number) {
  return at.subtract({ milliseconds: maxAgeMs }).toAbsoluteString();
}
