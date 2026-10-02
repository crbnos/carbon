// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import { raiseMoment } from "@carbon/lib/workflows";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { getCompanySettings } from "~/modules/settings";
import { checkPartyContactRequirement } from "~/modules/settings/party-contact.server";

const logger = getLogger("erp", "purchase-invoice.post");

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("invoiceId not found");

  const formData = await request.formData();
  const skipReceiptPost = formData.get("skipReceiptPost") === "true";

  // A supplier with no reachable contact cannot be created as a vendor at a
  // spend platform, so an invoice posted for one is rejected downstream, hours
  // later, in a sync log nobody is watching. Gate it here while the person who
  // can fix the supplier is still looking at it. No-op unless the company has
  // turned the setting on.
  const invoiceSupplier = await client
    .from("purchaseInvoice")
    .select("supplierId")
    .eq("id", invoiceId)
    .eq("companyId", companyId)
    .maybeSingle();

  // Fail CLOSED. Without the error check this read was the gate's own bypass: any
  // failure (or a row in another tenant) left `supplierId` undefined, and
  // `checkPartyContactRequirement` returns null for a party with no id — so the
  // requirement the company switched on silently let the invoice post.
  if (invoiceSupplier.error || !invoiceSupplier.data) {
    logger.error("Could not read the invoice supplier before posting", {
      companyId,
      invoiceId,
      error: invoiceSupplier.error
    });
    return {
      success: false,
      message: "Failed to post purchase invoice"
    };
  }

  const supplierContactError = await checkPartyContactRequirement(
    client,
    companyId,
    { kind: "supplier", id: invoiceSupplier.data.supplierId }
  );
  if (supplierContactError) {
    return { success: false, message: supplierContactError };
  }

  const setPendingState = await client
    .from("purchaseInvoice")
    .update({
      status: "Pending"
    })
    .eq("id", invoiceId);

  if (setPendingState.error) {
    return {
      success: false,
      message: "Failed to post purchase invoice"
    };
  }

  let receiptIds: string[] | undefined;

  try {
    const serviceRole = await getCarbonServiceRole();
    const postPurchaseInvoice = await serviceRole.functions.invoke<{
      receiptIds?: string[];
    }>("post-purchase-invoice", {
      body: {
        invoiceId: invoiceId,
        userId: userId,
        companyId: companyId,
        skipReceiptPost: skipReceiptPost
      }
    });

    if (postPurchaseInvoice.error) {
      await client
        .from("purchaseInvoice")
        .update({
          status: "Draft"
        })
        .eq("id", invoiceId);

      return {
        success: false,
        message: "Failed to post purchase invoice"
      };
    }

    receiptIds = postPurchaseInvoice.data?.receiptIds;

    // Check if we should update prices on invoice post
    const companySettings = await getCompanySettings(serviceRole, companyId);
    if (
      !companySettings.data?.purchasePriceUpdateTiming ||
      companySettings.data.purchasePriceUpdateTiming === "Purchase Invoice Post"
    ) {
      const priceUpdate = await serviceRole.functions.invoke(
        "update-purchased-prices",
        {
          body: {
            invoiceId: invoiceId,
            companyId: companyId,
            userId: userId,
            source: "purchaseInvoice",
            updatePrices: true,
            updateLeadTimes: false
          }
        }
      );

      if (priceUpdate.error) {
        await client
          .from("purchaseInvoice")
          .update({
            status: "Draft"
          })
          .eq("id", invoiceId);

        return {
          success: false,
          message: "Failed to update prices"
        };
      }
    }
    // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  } catch (error) {
    await client
      .from("purchaseInvoice")
      .update({
        status: "Draft"
      })
      .eq("id", invoiceId);

    return {
      success: false,
      message: "Failed to post purchase invoice"
    };
  }

  // Must stay below the rollback catch above — a post that got reverted to
  // Draft must not fire workflows.
  await raiseMoment("invoicing.purchaseInvoicePosted", {
    outputs: { purchaseInvoice: { id: invoiceId }, postedBy: { id: userId } },
    companyId,
    actorId: userId
  });

  trackWorkEvent("purchase_invoice_posted", {
    companyId,
    userId,
    purchaseInvoiceId: invoiceId
  });

  const receiptId =
    skipReceiptPost && receiptIds?.[0] ? receiptIds[0] : undefined;

  return {
    success: true,
    message: "Purchase invoice posted successfully",
    receiptId
  };
}
