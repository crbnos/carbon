// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { serverFns } from "@carbon/server-functions";
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
          const postReceipt = await serverFns
            .system({
              db: getJobDatabaseClient(),
              companyId: payload.companyId,
              userId: payload.userId
            })
            .invoke("post-receipt", { receiptId: payload.documentId });

          result = {
            success: postReceipt.error === null,
            message: postReceipt.error?.message ?? ""
          };

          break;
        case "purchase-invoice":
          logger.info("Posting purchase invoice", { payload });
          const postPurchaseInvoice = await serverFns
            .system({
              db: getJobDatabaseClient(),
              companyId: payload.companyId,
              userId: payload.userId
            })
            .invoke("post-purchase-invoice", { invoiceId: payload.documentId });

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

              const priceUpdate = await serverFns
                .system({
                  db: getJobDatabaseClient(),
                  companyId: payload.companyId,
                  userId: payload.userId
                })
                .invoke("update-purchased-prices", {
                  invoiceId: payload.documentId,
                  source: "purchaseInvoice"
                });

              result = {
                success: priceUpdate.error === null,
                message: priceUpdate.error?.message ?? ""
              };
            }
          }

          break;
        case "shipment":
          logger.info("Posting shipment", { payload });

          const postShipment = await serverFns
            .system({
              db: getJobDatabaseClient(),
              companyId: payload.companyId,
              userId: payload.userId
            })
            .invoke("post-shipment", {
              type: "post",
              shipmentId: payload.documentId
            });

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
