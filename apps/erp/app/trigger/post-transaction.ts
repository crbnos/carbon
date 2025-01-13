import { task } from "@trigger.dev/sdk/v3";
import { z } from "zod";

import { getCarbonServiceRole } from "@carbon/auth";
import type { Result } from "~/types";

const serviceRole = getCarbonServiceRole();

const postTransactionSchema = z.object({
  documentId: z.string(),
  type: z.enum(["receipt", "purchase-invoice"]),
  userId: z.string(),
  companyId: z.string(),
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
        console.info(payload);
        const postReceipt = await serviceRole.functions.invoke("post-receipt", {
          body: {
            receiptId: payload.documentId,
            userId: payload.userId,
            companyId: payload.companyId,
          },
        });

        result = {
          success: postReceipt.error === null,
          message: postReceipt.error?.message,
        };

        break;
      case "purchase-invoice":
        console.info(`📫 Posting purchase invoice ${payload.documentId}`);
        console.info(payload);
        const postPurchaseInvoice = await serviceRole.functions.invoke(
          "post-purchase-invoice",
          {
            body: {
              invoiceId: payload.documentId,
              userId: payload.userId,
              companyId: payload.companyId,
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

          const priceUpdate = await serviceRole.functions.invoke(
            "update-purchased-prices",
            {
              body: {
                invoiceId: payload.documentId,
                companyId: payload.companyId,
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
