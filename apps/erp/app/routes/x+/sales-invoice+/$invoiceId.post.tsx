import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { path, requestReferrer } from "~/utils/path";

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
    throw redirect(
      requestReferrer(request) ?? path.to.salesInvoices,
      await flash(
        request,
        error(setPendingState.error, "Failed to post sales invoice")
      )
    );
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

      throw redirect(
        path.to.salesInvoices,
        await flash(
          request,
          error(postSalesInvoice.error, "Failed to post sales invoice")
        )
      );
    }

    const priceUpdate = await serviceRole.functions.invoke(
      "update-sales-prices",
      {
        body: {
          invoiceId: invoiceId,
          companyId: companyId,
        },
      }
    );

    if (priceUpdate.error) {
      await client
        .from("salesInvoice")
        .update({
          status: "Draft",
        })
        .eq("id", invoiceId);

      throw redirect(
        path.to.salesInvoices,
        await flash(
          request,
          error(priceUpdate.error, "Failed to update prices")
        )
      );
    }
  } catch (error) {
    await client
      .from("salesInvoice")
      .update({
        status: "Draft",
      })
      .eq("id", invoiceId);
  }

  throw redirect(requestReferrer(request) ?? path.to.salesInvoice(invoiceId));
}
