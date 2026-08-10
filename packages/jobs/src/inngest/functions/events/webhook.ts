import { getCarbonServiceRole } from "@carbon/auth/client.server";
import axios from "axios";
import { inngest } from "../../client.ts";
import { toWebhookBody, webhookPayloadSchema } from "./webhook-body.ts";

const RETRIES = 3;

export const webhookFunction = inngest.createFunction(
  {
    id: "event-handler-webhook",
    retries: RETRIES,
    idempotency: "event.data.msgId",
    // One in-flight delivery per record, so a rapid update burst can't reorder
    // on the wire. limit must be >= 1 -- 0 is no capacity, not unlimited, and
    // parks every run in QUEUED forever.
    concurrency: {
      limit: 1,
      key: "event.data.data.table + '-' + event.data.data.recordId"
    }
  },
  { event: "carbon/event-webhook" },
  async ({ event, step, logger, attempt }) => {
    const payload = webhookPayloadSchema.parse(event.data);
    const body = toWebhookBody(
      payload.data,
      payload.companyId,
      String(payload.msgId)
    );
    const webhookId = payload.config.webhookId;

    await step.run("send-webhook", async () => {
      // Never log payload.url — the docs tell customers to treat the URL itself
      // as the secret (an unguessable token in the path or query), since Carbon
      // does not sign webhooks. webhookId identifies it without leaking that.
      logger.info(
        `Firing ${body.type} webhook ${webhookId ?? "<unknown>"} for ${payload.data.table}`
      );

      try {
        await axios.post(payload.url, body, {
          headers: {
            "Content-Type": "application/json",
            ...payload.config.headers
          }
        });
      } catch (err) {
        // Count one failure per event, not per attempt — otherwise retries
        // inflate errorCount 4x for a single undelivered event.
        if (webhookId && attempt >= RETRIES) {
          await getCarbonServiceRole().rpc("increment_webhook_error", {
            webhook_id: webhookId
          });
        }
        throw err;
      }

      if (webhookId) {
        await getCarbonServiceRole().rpc("increment_webhook_success", {
          webhook_id: webhookId
        });
      }
    });
  }
);
