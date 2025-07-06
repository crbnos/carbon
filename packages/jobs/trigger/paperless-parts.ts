import { task } from "@trigger.dev/sdk/v3";
import { z } from "zod";

const payloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("quote.created"),
    data: z.any(),
  }),
  z.object({
    type: z.literal("quote.status_changed"),
    data: z.any(),
  }),
  z.object({
    type: z.literal("quote.sent"),
    data: z.any(),
  }),
  z.object({
    type: z.literal("order.created"),
    data: z.any(),
  }),
  z.object({
    type: z.literal("order.status_changed"),
    data: z.any(),
  }),
  z.object({
    type: z.literal("integration_action.requested"),
    data: z.any(),
  }),
  z.object({
    type: z.literal("integration.turned_on"),
    data: z.any(),
  }),
  z.object({
    type: z.literal("integration.turned_off"),
    data: z.any(),
  }),
]);

const paperlessPartsSchema = z.object({
  apiKey: z.string(),
  companyId: z.string(),
  payload: payloadSchema,
});

export const paperlessPartsTask = task({
  id: "paperless-parts",
  run: async (payload: z.infer<typeof paperlessPartsSchema>) => {
    let result: { success: boolean; message: string };

    console.info(
      `🔰 Paperless Parts webhook received: ${payload.payload.type}`
    );
    console.info(`📦 Payload:`, payload);

    // const carbon = getCarbonServiceRole();
    // const paperless = new PaperlessPartsClient(payload.apiKey);

    switch (payload.payload.type) {
      case "quote.created":
        console.info(`📫 Processing quote created event`);
        result = {
          success: true,
          message: "Quote created event processed successfully",
        };
        break;
      case "quote.status_changed":
        console.info(`📫 Processing quote status changed event`);
        result = {
          success: true,
          message: "Quote status changed event processed successfully",
        };
        break;
      case "quote.sent":
        console.info(`📫 Processing quote sent event`);
        result = {
          success: true,
          message: "Quote sent event processed successfully",
        };
        break;
      case "order.created":
        console.info(`📫 Processing order created event`);
        result = {
          success: true,
          message: "Order created event processed successfully",
        };
        break;
      case "order.status_changed":
        console.info(`📫 Processing order status changed event`);
        result = {
          success: true,
          message: "Order status changed event processed successfully",
        };
        break;
      case "integration_action.requested":
        console.info(`📫 Processing integration action requested event`);
        result = {
          success: true,
          message: "Integration action requested event processed successfully",
        };
        break;
      case "integration.turned_on":
        console.info(`📫 Processing integration turned on event`);
        result = {
          success: true,
          message: "Integration turned on event processed successfully",
        };
        break;
      case "integration.turned_off":
        console.info(`📫 Processing integration turned off event`);
        result = {
          success: true,
          message: "Integration turned off event processed successfully",
        };
        break;
      default:
        console.error(`❌ Unsupported event type: ${payload.payload}`);
        result = {
          success: false,
          message: `Unsupported event type`,
        };
        break;
    }

    if (result.success) {
      console.info(`✅ Successfully processed ${payload.payload.type} event`);
    } else {
      console.error(
        `❌ Failed to process ${payload.payload.type} event: ${result.message}`
      );
    }

    return result;
  },
});
