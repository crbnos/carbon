import { getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { getCompanySettings } from "~/modules/settings";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("invoiceId not found");

  const formData = await request.formData();
  const skipReceiptPost = formData.get("skipReceiptPost") === "true";

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
      },
      region: FunctionRegion.UsEast1
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
            source: "purchaseInvoice"
          },
          region: FunctionRegion.UsEast1
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
