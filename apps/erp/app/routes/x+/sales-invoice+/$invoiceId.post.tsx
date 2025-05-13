import { getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";

export const config = { runtime: "nodejs" };

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "invoicing",
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("invoiceId not found");

  const setPendingState = await client
    .from("salesInvoice")
    .update({
      status: "Pending",
    })
    .eq("id", invoiceId);

  if (setPendingState.error) {
    return json({
      success: false,
      message: "Failed to post sales invoice",
    });
  }

  try {
    const serviceRole = await getCarbonServiceRole();
    const postSalesInvoice = await serviceRole.functions.invoke(
      "post-sales-invoice",
      {
        body: {
          invoiceId: invoiceId,
          userId: userId,
          companyId: companyId,
        },
      }
    );

    if (postSalesInvoice.error) {
      await client
        .from("salesInvoice")
        .update({
          status: "Draft",
        })
        .eq("id", invoiceId);

      return json({
        success: false,
        message: "Failed to post sales invoice",
      });
    }
  } catch (error) {
    await client
      .from("salesInvoice")
      .update({
        status: "Draft",
      })
      .eq("id", invoiceId);

    return json({
      success: false,
      message: "Failed to post sales invoice",
    });
  }

  return json({
    success: true,
    message: "Sales invoice posted successfully",
  });
}
