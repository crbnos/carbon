// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
