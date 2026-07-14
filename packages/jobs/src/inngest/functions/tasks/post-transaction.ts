import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { inngest } from "../../client";

export const postTransactionFunction = inngest.createFunction(
  { id: "post-transactions", retries: 3 },
  { event: "carbon/post-transaction" },
  async ({ event, step, logger }) => {
    const serviceRole = getCarbonServiceRole();
    const payload = event.data;

    const result = await step.run("post-transaction", async () => {
      logger.info("Post transaction", {
        type: payload.type,
        documentId: payload.documentId
      });

      let result: { success: boolean; message: string };

      switch (payload.type) {
        case "receipt":
          logger.info("Posting receipt", { payload });
          const postReceipt = await serviceRole.functions.invoke(
            "post-receipt",
            {
              body: {
                receiptId: payload.documentId,
                userId: payload.userId,
                companyId: payload.companyId
              }
            }
          );

          result = {
            success: postReceipt.error === null,
            message: postReceipt.error?.message
          };

          break;
        case "purchase-invoice":
          logger.info("Posting purchase invoice", { payload });
          const postPurchaseInvoice = await serviceRole.functions.invoke(
            "post-purchase-invoice",
            {
              body: {
                invoiceId: payload.documentId,
                userId: payload.userId,
                companyId: payload.companyId
              }
            }
          );

          result = {
            success: postPurchaseInvoice.error === null,
            message: postPurchaseInvoice.error?.message
          };

          if (result.success) {
            // Check if we should update prices on invoice post
            const companySettings = await serviceRole
              .from("companySettings")
              .select("purchasePriceUpdateTiming")
              .eq("id", payload.companyId)
              .single();

            if (
              !companySettings.data?.purchasePriceUpdateTiming ||
              companySettings.data.purchasePriceUpdateTiming ===
                "Purchase Invoice Post"
            ) {
              logger.info("Updating pricing from invoice", {
                documentId: payload.documentId
              });

              const priceUpdate = await serviceRole.functions.invoke(
                "update-purchased-prices",
                {
                  body: {
                    invoiceId: payload.documentId,
                    companyId: payload.companyId,
                    userId: payload.userId,
                    source: "purchaseInvoice"
                  }
                }
              );

              result = {
                success: priceUpdate.error === null,
                message: priceUpdate.error?.message
              };
            }
          }

          break;
        case "shipment":
          logger.info("Posting shipment", { payload });

          const postShipment = await serviceRole.functions.invoke(
            "post-shipment",
            {
              body: {
                shipmentId: payload.documentId,
                userId: payload.userId,
                companyId: payload.companyId
              }
            }
          );

          result = {
            success: postShipment.error === null,
            message: postShipment.error?.message
          };

          break;
        default:
          result = {
            success: false,
            message: `Invalid posting type: ${payload.type}`
          };
          break;
      }

      if (result.success) {
        logger.info("Success", { documentId: payload.documentId });
      } else {
        logger.error("Admin action failed", {
          type: payload.type,
          documentId: payload.documentId,
          message: result.message
        });
      }

      return result;
    });

    return result;
  }
);
