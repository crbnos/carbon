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
 * This shape is a PUBLIC contract — it is what the pg_net trigger path
 * (`webhook_insert`/`_update`/`_delete` → the `webhook` edge function) has been
 * POSTing, so it has to survive the move to the event system verbatim:
 *
 *   INSERT  { type, record: NEW }
 *   UPDATE  { type, record: NEW, old: OLD }
 *   DELETE  { type, record: OLD }          <- record comes from OLD, and no `old` key
 *
 * The DELETE row is the trap: the queue event carries the row under `old` (its
 * `new` is null), but the trigger sent it as `record`. Forwarding the raw event
 * would hand consumers `{operation, new, old}` and quietly break every
 * integration.
 */
export function toWebhookBody(event: WebhookEvent): {
  type: string;
  record: Record<string, unknown> | null;
  old?: Record<string, unknown>;
} {
  const isRemoval =
    event.operation === "DELETE" || event.operation === "TRUNCATE";
  const record = (isRemoval ? event.old : event.new) ?? null;

  // `old` is emitted only for UPDATE — the edge function spreads it
  // conditionally (`...(old && { old })`) and the INSERT/DELETE triggers never
  // send a usable one.
  return event.operation === "UPDATE" && event.old
    ? { type: event.operation, record, old: event.old }
    : { type: event.operation, record };
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
    const body = toWebhookBody(payload.data);
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
