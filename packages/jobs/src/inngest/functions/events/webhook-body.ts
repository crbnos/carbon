import { z } from "zod";

// Separate from webhook.ts so the contract below is testable — the handler
// imports client.server, which validates the server env at module load.

const eventSchema = z.object({
  table: z.string(),
  operation: z.enum(["INSERT", "UPDATE", "DELETE", "TRUNCATE"]),
  recordId: z.string().optional(),
  new: z.record(z.any()).nullable().optional(),
  old: z.record(z.any()).nullable().optional(),
  timestamp: z.string().optional()
});

export const webhookPayloadSchema = z.object({
  url: z.string().url(),
  companyId: z.string(),
  data: eventSchema,
  config: z
    .object({
      headers: z.record(z.string()).optional(),
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
 *   INSERT  { type, record: NEW,           companyId, table }
 *   UPDATE  { type, record: NEW, old: OLD, companyId, table }
 *   DELETE  { type, record: OLD,           companyId, table }
 *
 * DELETE is the trap: the queue event carries the row under `old` (its `new` is
 * null), but consumers expect it as `record`.
 */
export function toWebhookBody(
  event: WebhookEvent,
  companyId: string
): {
  type: string;
  record: Record<string, unknown> | null;
  old?: Record<string, unknown>;
  companyId: string;
  table: string;
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
    table: event.table
  };
}
