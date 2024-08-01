import { eventTrigger } from "@trigger.dev/sdk";
import { z } from "zod";

import { getSupabaseServiceRole } from "~/lib/supabase";
import { triggerClient } from "~/lib/trigger.server";
import type { Result } from "~/types";

const supabaseClient = getSupabaseServiceRole();
export const postTransactionSchema = z.object({
  documentId: z.string(),
  type: z.enum(["receipt", "purchase-invoice"]),
});

const job = triggerClient.defineJob({
  id: "post-transactions",
  name: "Post Transactions",
  version: "0.0.1",
  trigger: eventTrigger({
    name: "post.transactions",
    schema: postTransactionSchema,
  }),
  run: async (payload, io, ctx) => {
    await io.logger.info(
      `🔰 User admin update ${payload.type} for ${payload.documentId}`
    );

    let result: Result;

    switch (payload.type) {
      case "receipt":
        await io.logger.info(`📫 Posting receipt ${payload.documentId}`);
        const postReceipt = await supabaseClient.functions.invoke(
          "post-receipt",
          {
            body: {
              receiptId: payload.documentId,
            },
          }
        );

        result = {
          success: postReceipt.error === null ? true : false,
          message: postReceipt.error?.message,
        };

        break;
      case "purchase-invoice":
        await io.logger.info(
          `📫 Posting purchase invoice ${payload.documentId}`
        );
        const postPurchaseInvoice = await supabaseClient.functions.invoke(
          "post-purchase-invoice",
          {
            body: {
              invoiceId: payload.documentId,
            },
          }
        );

        result = {
          success: postPurchaseInvoice.error === null ? true : false,
          message: postPurchaseInvoice.error?.message,
        };

        if (result.success) {
          await io.logger.info(
            `💵 Updating pricing from invoice ${payload.documentId}`
          );
          const priceUpdate = await supabaseClient.functions.invoke(
            "update-purchased-prices",
            {
              body: {
                invoiceId: payload.documentId,
              },
            }
          );

          result = {
            success: priceUpdate.error === null ? true : false,
            message: priceUpdate.error?.message,
          };
        }

        break;
      default:
        result = {
          success: false,
          message: `Invalid posting type: ${payload.type}`,
        };
        break;
    }

    if (result.success) {
      await io.logger.info(`✅ Success ${payload.documentId}`);
    } else {
      await io.logger.error(
        `❌ Admin action ${payload.type} failed for ${payload.documentId}: ${result.message}`
      );
    }
  },
});

export default job;
