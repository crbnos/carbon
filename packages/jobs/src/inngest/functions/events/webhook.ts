import axios from "axios";
import { z } from "zod";
import { inngest } from "../../client.ts";
import { buildWebhookEnvelope, signWebhookBody } from "./webhook-signing.ts";

const webhookPayloadSchema = z.object({
  msgId: z.union([z.string(), z.number()]).optional(),
  url: z.string().url(),
  data: z.any(),
  config: z
    .object({
      headers: z.record(z.string()).optional(),
      // Present only for the curated, signed accounting-webhook path. Absent for
      // legacy raw-diff subscriptions, which keep their exact behavior.
      registrationId: z.string().optional(),
      topic: z.string().optional(),
      signingSecret: z.string().optional()
    })
    .passthrough()
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

export const webhookFunction = inngest.createFunction(
  {
    id: "event-handler-webhook",
    retries: 3,
    idempotency: "event.data.msgId",
    concurrency: {
      limit: 0,
      key: "event.data.data.table + '-' + event.data.data.recordId"
    }
  },
  { event: "carbon/event-webhook" },
  async ({ event, step, logger }) => {
    const payload = webhookPayloadSchema.parse(event.data);
    const { registrationId, topic, signingSecret } = payload.config;

    // Curated + HMAC-signed accounting webhook.
    if (registrationId && topic && signingSecret) {
      await step.run("send-signed-webhook", async () => {
        const msgId = String(payload.msgId ?? registrationId);
        const envelope = buildWebhookEnvelope(msgId, topic, payload.data);
        const body = JSON.stringify(envelope);
        // Sign over the exact bytes sent, so the raw string is the request body.
        const timestamp = envelope.occurredAt ?? new Date().toISOString();
        const signature = signWebhookBody(signingSecret, timestamp, body);

        logger.info(`Firing signed webhook (${topic}) to ${payload.url}`);
        await axios.post(payload.url, body, {
          headers: {
            ...payload.config.headers,
            "content-type": "application/json",
            "carbon-webhook-id": msgId,
            "carbon-webhook-timestamp": timestamp,
            "carbon-signature": signature
          }
        });
      });
      return;
    }

    // Legacy raw-diff webhook (unchanged).
    await step.run("send-webhook", async () => {
      logger.info(`Firing webhook to ${payload.url}`);
      await axios.post(payload.url, payload.data, {
        headers: payload.config.headers
      });
    });
  }
);
