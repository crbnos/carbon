import { error, getCarbonServiceRole, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "invoicing",
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("invoiceId not found");

  try {
    const serviceRole = getCarbonServiceRole();

    // Verify invoice is posted before allowing void
    const { data: salesInvoice } = await client
      .from("salesInvoice")
      .select("status, postingDate")
      .eq("id", invoiceId)
      .single();

    if (!salesInvoice?.postingDate) {
      throw redirect(
        path.to.salesInvoiceDetails(invoiceId),
        await flash(
          request,
          error(
            new Error("Can only void posted invoices"),
            "Invalid operation"
          )
        )
      );
    }

    const voidInvoice = await serviceRole.functions.invoke("post-sales-invoice", {
      body: {
        type: "void",
        invoiceId: invoiceId,
        userId: userId,
        companyId: companyId,
      },
      region: FunctionRegion.UsEast1,
    });

    if (voidInvoice.error) {
      throw redirect(
        path.to.salesInvoiceDetails(invoiceId),
        await flash(
          request,
          error(voidInvoice.error, "Failed to void sales invoice")
        )
      );
    }

    return redirect(
      path.to.salesInvoiceDetails(invoiceId),
      await flash(request, success("Sales invoice voided"))
    );
  } catch (err) {
    throw redirect(
      path.to.salesInvoiceDetails(invoiceId),
      await flash(request, error(err, "Failed to void sales invoice"))
    );
  }
}