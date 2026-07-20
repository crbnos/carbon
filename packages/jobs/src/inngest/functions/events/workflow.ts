import { z } from "zod";
import { inngest } from "../../client";

const workflowPayloadSchema = z.object({
  workflowId: z.string(),
  data: z.any()
});

export type WorkflowPayload = z.infer<typeof workflowPayloadSchema>;

export const workflowFunction = inngest.createFunction(
  {
    id: "event-handler-workflow",
    retries: 3,
    idempotency: "event.data.msgId",
    concurrency: {
      limit: 0,
      key: "event.data.data.table + '-' + event.data.data.recordId"
    }
  },
  { event: "carbon/event-workflow" },
  async ({ event, step, logger }) => {
    const payload = workflowPayloadSchema.parse(event.data);

    await step.run("trigger-workflow", async () => {
      logger.info(`Triggering workflow ${payload.workflowId}`);
      // Here you would trigger another business logic function
      // e.g., await inngest.send({ name: payload.workflowId, data: payload.data });
    });
  }
);
