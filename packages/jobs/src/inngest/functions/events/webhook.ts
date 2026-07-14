import axios from "axios";
import { z } from "zod";
import { inngest } from "../../client.ts";

const webhookPayloadSchema = z.object({
  url: z.string().url(),
  data: z.any(),
  config: z
    .object({
      headers: z.record(z.string()).optional()
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

    await step.run("send-webhook", async () => {
      logger.info(`Firing webhook to ${payload.url}`);
      await axios.post(payload.url, payload.data, {
        headers: payload.config.headers
      });
    });
  }
);
