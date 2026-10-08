// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ZonedDateTime } from "@internationalized/date";

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
