import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { getCompanySettings } from "~/modules/settings";
import {
  createApprovalRequestAndNotify,
  hasPendingApproval,
  isApprovalRequired
} from "~/modules/shared";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("invoiceId not found");

  const formData = await request.formData();
  const skipReceiptPost = formData.get("skipReceiptPost") === "true";

  // Approval gate. purchaseInvoices.totalAmount is already in base currency
  // (includes tax + shipping). Park a Draft invoice in "Pending Approval" and
  // request approval when a matching enabled rule exists; the approve flow
  // re-enters this action from "Pending Approval", skipping the gate below.
  const invoiceForApproval = await client
    .from("purchaseInvoices")
    .select("baseStatus, totalAmount")
    .eq("id", invoiceId)
    .single();
  if (
    invoiceForApproval.data &&
    invoiceForApproval.data.baseStatus === "Draft"
  ) {
    const baseAmount = Number(invoiceForApproval.data.totalAmount ?? 0);
    if (
      await isApprovalRequired(client, "purchaseInvoice", companyId, baseAmount)
    ) {
      if (!(await hasPendingApproval(client, "purchaseInvoice", invoiceId))) {
        const parked = await client
          .from("purchaseInvoice")
          .update({ status: "Pending Approval", updatedBy: userId })
          .eq("id", invoiceId)
          .eq("companyId", companyId)
          .eq("status", "Draft");
        if (parked.error) {
          return {
            success: false,
            message: "Failed to submit purchase invoice for approval"
          };
        }
        await createApprovalRequestAndNotify(getCarbonServiceRole(), {
          documentType: "purchaseInvoice",
          documentId: invoiceId,
          companyId,
          requestedBy: userId,
          amount: baseAmount
        });
      }
      return {
        success: true,
        message: "Purchase invoice submitted for approval"
      };
    }
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

  const receiptId =
    skipReceiptPost && receiptIds?.[0] ? receiptIds[0] : undefined;

  return {
    success: true,
    message: "Purchase invoice posted successfully",
    receiptId
  };
}
