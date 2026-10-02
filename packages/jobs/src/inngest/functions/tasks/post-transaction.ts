// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { ServerFnContext } from "@carbon/server-functions";
import { postPurchaseInvoice as postPurchaseInvoiceOperation } from "@carbon/server-functions/post-purchase-invoice";
import { postReceipt as postReceiptOperation } from "@carbon/server-functions/post-receipt";
import { postShipment as postShipmentOperation } from "@carbon/server-functions/post-shipment";
import { updatePurchasedPrices } from "@carbon/server-functions/update-purchased-prices";
import { getJobDatabaseClient } from "../../../db";
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
          const postReceipt = await postReceiptOperation(
            ServerFnContext.system({
              db: getJobDatabaseClient(),
              companyId: payload.companyId,
              userId: payload.userId
            }),
            { receiptId: payload.documentId }
          );

          result = {
            success: postReceipt.error === null,
            message: postReceipt.error?.message ?? ""
          };

          break;
        case "purchase-invoice":
          logger.info("Posting purchase invoice", { payload });
          const postPurchaseInvoice = await postPurchaseInvoiceOperation(
            ServerFnContext.system({
              db: getJobDatabaseClient(),
              companyId: payload.companyId,
              userId: payload.userId
            }),
            { invoiceId: payload.documentId }
          );

          result = {
            success: postPurchaseInvoice.error === null,
            message: postPurchaseInvoice.error?.message ?? ""
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

              const priceUpdate = await updatePurchasedPrices(
                ServerFnContext.system({
                  db: getJobDatabaseClient(),
                  companyId: payload.companyId,
                  userId: payload.userId
                }),
                { invoiceId: payload.documentId, source: "purchaseInvoice" }
              );

              result = {
                success: priceUpdate.error === null,
                message: priceUpdate.error?.message ?? ""
              };
            }
          }

          break;
        case "shipment":
          logger.info("Posting shipment", { payload });

          const postShipment = await postShipmentOperation(
            ServerFnContext.system({
              db: getJobDatabaseClient(),
              companyId: payload.companyId,
              userId: payload.userId
            }),
            { type: "post", shipmentId: payload.documentId }
          );

          result = {
            success: postShipment.error === null,
            message: postShipment.error?.message ?? ""
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
