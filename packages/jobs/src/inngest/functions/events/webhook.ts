import axios from "axios";
import { z } from "zod";
import { inngest } from "../../client.ts";

// Imported lazily inside the step: `@carbon/auth/client.server` validates the
// full server env at module load, which would make this file — and therefore
// the pure `toWebhookBody` contract tests — unimportable outside a configured
// runtime.
const serviceRole = async () =>
  (await import("@carbon/auth/client.server")).getCarbonServiceRole();

const RETRIES = 3;

const eventSchema = z.object({
  table: z.string(),
  operation: z.enum(["INSERT", "UPDATE", "DELETE", "TRUNCATE"]),
  recordId: z.string().optional(),
  new: z.record(z.any()).nullable().optional(),
  old: z.record(z.any()).nullable().optional(),
  timestamp: z.string().optional()
});

const webhookPayloadSchema = z.object({
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
 * Map a queue event onto the body external consumers already receive.
 *
 * This shape is a PUBLIC contract. It is what the `webhook` edge function POSTs
 * at the END of the pg_net trigger path — NOT what the triggers posted to that
 * edge function, which carried extra routing fields (`url`, `webhookId`) that
 * never reached the customer. The outbound body is:
 *
 *   INSERT  { type, record: NEW,           companyId, table }
 *   UPDATE  { type, record: NEW, old: OLD, companyId, table }
 *   DELETE  { type, record: OLD,           companyId, table }
 *
 * Two traps:
 *
 * 1. DELETE takes `record` from OLD. The queue event carries the row under
 *    `old` (its `new` is null), but the trigger sent it as `record`. Forwarding
 *    the raw event would hand consumers `record: null` on every delete.
 * 2. `companyId` and `table` are part of the body. `table` is on the event, but
 *    `companyId` lives on the queue message, so the drainer forwards it
 *    explicitly.
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

  // `old` is emitted only for UPDATE — the edge function spreads it
  // conditionally (`...(old && { old })`), and the INSERT trigger explicitly
  // sent `'old', NULL` while the DELETE trigger omitted the key entirely.
  return {
    type: event.operation,
    record,
    ...(event.operation === "UPDATE" && event.old ? { old: event.old } : {}),
    companyId,
    table: event.table
  };
}

export const webhookFunction = inngest.createFunction(
  {
    id: "event-handler-webhook",
    retries: RETRIES,
    idempotency: "event.data.msgId",
    concurrency: {
      limit: 0,
      key: "event.data.data.table + '-' + event.data.data.recordId"
    }
  },
  { event: "carbon/event-webhook" },
  async ({ event, step, logger, attempt }) => {
    const payload = webhookPayloadSchema.parse(event.data);
    const body = toWebhookBody(payload.data, payload.companyId);
    const webhookId = payload.config.webhookId;

    await step.run("send-webhook", async () => {
      logger.info(
        `Firing ${body.type} webhook for ${payload.data.table} to ${payload.url}`
      );

      try {
        await axios.post(payload.url, body, {
          headers: {
            "Content-Type": "application/json",
            ...payload.config.headers
          }
        });
      } catch (err) {
        // Count one failure per EVENT, not per attempt. The trigger path fired
        // once and recorded once; with retries enabled, incrementing on every
        // attempt would inflate errorCount 4x for a single undelivered event.
        if (webhookId && attempt >= RETRIES) {
          await (await serviceRole()).rpc("increment_webhook_error", {
            webhook_id: webhookId
          });
        }
        throw err;
      }

      if (webhookId) {
        await (await serviceRole()).rpc("increment_webhook_success", {
          webhook_id: webhookId
        });
      }
    });
  }
);
