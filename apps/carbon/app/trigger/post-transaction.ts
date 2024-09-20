import { task } from "@trigger.dev/sdk/v3";
import { z } from "zod";

import { getSupabaseServiceRole } from "~/lib/supabase";
import type { Result } from "~/types";

const supabaseClient = getSupabaseServiceRole();

const postTransactionSchema = z.object({
  documentId: z.string(),
  type: z.enum(["receipt", "purchase-invoice"]),
});

export const postTransactionTask = task({
  id: "post-transactions",
  run: async (payload: z.infer<typeof postTransactionSchema>) => {
    console.info(
      `🔰 User admin update ${payload.type} for ${payload.documentId}`
    );

    let result: Result;

    switch (payload.type) {
      case "receipt":
        console.info(`📫 Posting receipt ${payload.documentId}`);
        const postReceipt = await supabaseClient.functions.invoke(
          "post-receipt",
          {
            body: {
              receiptId: payload.documentId,
            },
          }
        );

        result = {
          success: postReceipt.error === null,
          message: postReceipt.error?.message,
        };

        break;
      case "purchase-invoice":
        console.info(`📫 Posting purchase invoice ${payload.documentId}`);
        const postPurchaseInvoice = await supabaseClient.functions.invoke(
          "post-purchase-invoice",
          {
            body: {
              invoiceId: payload.documentId,
            },
          }
        );

        result = {
          success: postPurchaseInvoice.error === null,
          message: postPurchaseInvoice.error?.message,
        };

        if (result.success) {
          console.info(
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
            success: priceUpdate.error === null,
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
      console.info(`✅ Success ${payload.documentId}`);
    } else {
      console.error(
        `❌ Admin action ${payload.type} failed for ${payload.documentId}: ${result.message}`
      );
    }

    return result;
  },
});
