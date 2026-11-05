// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createHmac } from "node:crypto";
import { z } from "zod";
import {
  outboundHttpAgent,
  outboundHttpsAgent
} from "../../../workflows/actions/url-guard.ts";

// Separate from webhook.ts so the contract below is testable — the handler
// imports client.server, which validates the server env at module load.

const eventSchema = z.object({
  table: z.string(),
  operation: z.enum(["INSERT", "UPDATE", "DELETE", "TRUNCATE"]),
  recordId: z.string().optional(),
  new: z.record(z.string(), z.any()).nullable().optional(),
  old: z.record(z.string(), z.any()).nullable().optional(),
  timestamp: z.string().optional()
});

export const webhookPayloadSchema = z.object({
  url: z.string().url(),
  companyId: z.string(),
  msgId: z.union([z.number(), z.string()]),
  data: eventSchema,
  config: z
    .object({
      headers: z.record(z.string(), z.string()).optional(),
      webhookId: z.string().optional()
    })
    .passthrough()
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
export type WebhookEvent = z.infer<typeof eventSchema>;

/**
 * Map a queue event onto the body external consumers receive. PUBLIC contract —
 * see docs/content/docs/building/webhooks.mdx and webhook-body.test.ts.
 *
 *   INSERT  { type, record: NEW,           companyId, table, eventId }
 *   UPDATE  { type, record: NEW, old: OLD, companyId, table, eventId }
 *   DELETE  { type, record: OLD,           companyId, table, eventId }
 *
 * DELETE is the trap: the queue event carries the row under `old` (its `new` is
 * null), but consumers expect it as `record`.
 *
 * `eventId` is the only addition to what the pg_net path sent, and it exists
 * because delivery is now at-least-once: consumers need something to de-dup a
 * retried delivery on, and `type` + `record.id` cannot serve — two genuine
 * updates to the same row share both, so de-duping on them drops real changes.
 * It is the pgmq message id, which is stable across an event's retries (it is
 * also the Inngest idempotency key) and distinct per change.
 */
export function toWebhookBody(
  event: WebhookEvent,
  companyId: string,
  eventId: string
): {
  type: string;
  record: Record<string, unknown> | null;
  old?: Record<string, unknown>;
  companyId: string;
  table: string;
  eventId: string;
} {
  const isRemoval =
    event.operation === "DELETE" || event.operation === "TRUNCATE";
  const record = (isRemoval ? event.old : event.new) ?? null;

  // `old` must be absent, not null, for non-UPDATE operations.
  return {
    type: event.operation,
    record,
    ...(event.operation === "UPDATE" && event.old ? { old: event.old } : {}),
    companyId,
    table: event.table,
    eventId
  };
}

/**
 * The header carrying a delivery's signature. PUBLIC contract — see
 * docs/content/docs/building/webhooks.mdx.
 */
export const WEBHOOK_SIGNATURE_HEADER = "Carbon-Signature";

/**
 * The axios options every delivery uses. The agents run the SSRF guard at
 * connect time, so the address `checkWebhookUrl` approved is the address
 * dialled. Redirects are off: following one would leave the guard behind, so a
 * 3xx fails the attempt. So is any proxy from the environment (`HTTP_PROXY`):
 * through one, the socket — and the guard — would reach the proxy, and the proxy
 * the target. The timeout is PUBLIC contract (30 s, see the docs).
 */
export const webhookTransport = {
  timeout: 30_000,
  maxRedirects: 0,
  proxy: false as const,
  httpAgent: outboundHttpAgent,
  httpsAgent: outboundHttpsAgent
};

/**
 * Sign a delivery: `t=<unix seconds>,v1=<hex HMAC-SHA256>`, where the HMAC is
 * keyed by the webhook's signing secret (the whole `whsec_…` string) and runs
 * over `${t}.${body}`, the exact bytes sent. The scheme Carbon itself verifies
 * for Paperless Parts. A consumer recomputes it from the raw request body and
 * rejects an old `t` to stop replays.
 */
export function signWebhookBody(
  secret: string,
  body: string,
  timestamp: number
): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}
