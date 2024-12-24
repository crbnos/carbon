import { task } from "@trigger.dev/sdk/v3";
import { z } from "zod";

const payloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("quote.created"),
    created: z.string(),
    object: z.string(),
    data: z.any(),
  }),
  z.object({
    type: z.literal("quote.status_changed"),
    created: z.string(),
    object: z.string(),
    data: z.any(),
  }),
  z.object({
    type: z.literal("quote.sent"),
    created: z.string(),
    object: z.string(),
    data: z.object({
      uuid: z.string(),
      number: z.number(),
      status: z.string(),
      created: z.string(),
      expired: z.boolean(),
      due_date: z.string().nullable(),
      erp_code: z.string().nullable(),
      metadata: z.object({}),
      priority: z.number().nullable(),
      tax_rate: z.string().nullable(),
      estimator: z.string().nullable(),
      sent_date: z.string(),
      contact_id: z.number(),
      rfq_number: z.string().nullable(),
      quote_items: z.array(z.string()),
      quote_notes: z.string().nullable(),
      salesperson: z.string().nullable(),
      expired_date: z.string().nullable(),
      private_notes: z.string().nullable(),
      revision_number: z.number().nullable(),
      supporting_files: z.array(z.string()),
      export_controlled: z.boolean(),
      send_from_facility: z.string(),
      request_for_quote_id: z.string().nullable(),
      digital_last_viewed_on: z.string().nullable(),
      manual_rfq_received_date: z.string().nullable(),
      authenticated_pdf_quote_url: z.string().nullable(),
    }),
  }),
  z.object({
    type: z.literal("order.created"),
    created: z.string(),
    object: z.string(),
    data: z.any(),
  }),
  z.object({
    type: z.literal("order.status_changed"),
    created: z.string(),
    object: z.string(),
    data: z.any(),
  }),
  z.object({
    type: z.literal("integration_action.requested"),
    created: z.string(),
    object: z.string(),
    data: z.any(),
  }),
  z.object({
    type: z.literal("integration.turned_on"),
    created: z.string(),
    object: z.string(),
    data: z.any(),
  }),
  z.object({
    type: z.literal("integration.turned_off"),
    created: z.string(),
    object: z.string(),
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
        const quotePayload = payload.payload.data;

        const ppQuoteNumber = quotePayload.number;
        const ppQuoteRevisionNumber = quotePayload.revision_number;
        console.log(
          `📦 PP Quote Number: ${ppQuoteNumber}, Revision Number: ${ppQuoteRevisionNumber}`
        );
        const ppQuote = await paperless.quotes.quoteDetails(
          ppQuoteNumber,
          ppQuoteRevisionNumber
            ? { revision: ppQuoteRevisionNumber }
            : undefined
        );

        if (ppQuote.error || !ppQuote.data) {
          throw new Error("Failed to fetch quote details from Paperless Parts");
        }

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
