import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { receiptId } = params;
  if (!receiptId) throw new Error("receiptId not found");

  const setPendingState = await client
    .from("receipt")
    .update({
      status: "Pending"
    })
    .eq("id", receiptId);

  if (setPendingState.error) {
    throw redirect(
      path.to.receipt(receiptId),
      await flash(
        request,
        error(setPendingState.error, "Failed to post receipt")
      )
    );
  }

  try {
    const serviceRole = await getCarbonServiceRole();

    const receiptMetadata = await serviceRole
      .from("receipt")
      .select("sourceDocument,sourceDocumentId")
      .eq("id", receiptId)
      .single();

    const companySettings = await (serviceRole.from("companySettings") as any)
      .select("updateLeadTimesOnReceipt")
      .eq("id", companyId)
      .single();

    const postReceipt = await serviceRole.functions.invoke("post-receipt", {
      body: {
        receiptId: receiptId,
        userId: userId,
        companyId: companyId
      },
      region: FunctionRegion.UsEast1
    });

    if (postReceipt.error) {
      await client
        .from("receipt")
        .update({
          status: "Draft"
        })
        .eq("id", receiptId);

      throw redirect(
        path.to.receipt(receiptId),
        await flash(request, error(postReceipt.error, "Failed to post receipt"))
      );
    }

    const shouldUpdateLeadTimesOnReceipt = Boolean(
      (companySettings.data as { updateLeadTimesOnReceipt?: boolean } | null)
        ?.updateLeadTimesOnReceipt
    );

    if (
      shouldUpdateLeadTimesOnReceipt &&
      receiptMetadata.data?.sourceDocument === "Purchase Order" &&
      receiptMetadata.data?.sourceDocumentId
    ) {
      const leadTimeUpdate = await serviceRole.functions.invoke(
        "update-purchased-prices",
        {
          body: {
            source: "purchaseOrder",
            purchaseOrderId: receiptMetadata.data.sourceDocumentId,
            companyId,
            updatePrices: false,
            updateLeadTimes: true
          },
          region: FunctionRegion.UsEast1
        }
      );

      if (leadTimeUpdate.error) {
        console.error(
          "Failed to update lead time on receipt posting:",
          leadTimeUpdate.error
        );
      }
    }
    // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  } catch (error) {
    await client
      .from("receipt")
      .update({
        status: "Draft"
      })
      .eq("id", receiptId);
  }

  throw redirect(path.to.receipt(receiptId));
}
